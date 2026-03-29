import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type pino from "pino";
import type {
  AgentRunRequest,
  AgentRunResult,
  CodexRuntimeAdapter,
  SandboxMode,
  SkillDefinition
} from "../types.js";

interface JsonRpcResponse {
  id?: number;
  result?: unknown;
  error?: {
    code?: number;
    message?: string;
  };
}

interface JsonRpcNotification {
  method?: string;
  params?: unknown;
}

type JsonRpcMessage = JsonRpcResponse & JsonRpcNotification;

export class CodexAppServerAdapter implements CodexRuntimeAdapter {
  readonly transportName = "app-server" as const;
  readonly supportsNativeSkills = true;

  constructor(
    private readonly codexBin: string,
    private readonly logger: pino.Logger
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const command = this.buildCommand();
    const child = spawn(command.file, command.args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });

    const warnings: string[] = [];
    const rawEvents: unknown[] = [];
    const responseChunks: string[] = [];
    let threadId = request.previousThreadId;
    let usage: AgentRunResult["usage"];
    let turnCompleted = false;
    let resolveTurnCompleted: (() => void) | undefined;
    let rejectTurnCompleted: ((error: Error) => void) | undefined;
    let nextId = 1;
    const pending = new Map<
      number,
      {
        resolve: (value: unknown) => void;
        reject: (error: Error) => void;
      }
    >();

    this.logger.info(
      {
        agentId: request.agent.id,
        mode: request.mode,
        cwd: request.agent.cwd,
        threadId: request.previousThreadId
      },
      "starting codex app-server run"
    );

    const stdoutPromise = this.consumeStream(child.stdout, (line) => {
      const message = this.tryParseJson(line);
      if (!message) {
        warnings.push(line);
        return;
      }

      rawEvents.push(message);
      if (typeof message.id === "number") {
        const deferred = pending.get(message.id);
        if (!deferred) {
          return;
        }

        pending.delete(message.id);
        if (message.error?.message) {
          deferred.reject(new Error(message.error.message));
        } else {
          deferred.resolve(message.result);
        }
        return;
      }

      this.handleNotification(
        message,
        responseChunks,
        warnings,
        (resolvedThreadId) => {
          threadId = resolvedThreadId;
        },
        (nextUsage) => {
          usage = nextUsage;
        },
        () => {
          turnCompleted = true;
          resolveTurnCompleted?.();
        }
      );
    });

    const stderrPromise = this.consumeStream(child.stderr, (line) => {
      warnings.push(line);
    });

    const failPending = (error: Error) => {
      for (const deferred of pending.values()) {
        deferred.reject(error);
      }
      pending.clear();
    };

    const requestRpc = async (method: string, params: unknown): Promise<unknown> => {
      const id = nextId++;
      const resultPromise = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
      return await resultPromise;
    };

    const turnCompletedPromise = new Promise<void>((resolve, reject) => {
      resolveTurnCompleted = resolve;
      rejectTurnCompleted = reject;
    });

    const processExitPromise = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const error = new Error(`Codex app-server run timed out after ${request.timeoutMs} ms`);
        failPending(error);
        rejectTurnCompleted?.(error);
        child.kill();
        reject(error);
      }, request.timeoutMs);

      child.once("error", (error) => {
        clearTimeout(timer);
        failPending(error);
        rejectTurnCompleted?.(error);
        reject(error);
      });

      child.once("close", (code) => {
        clearTimeout(timer);
        if (turnCompleted || code === 0) {
          resolve();
          return;
        }

        const error = new Error(
          `Codex app-server exited with code ${code ?? 0}. ${warnings.slice(-3).join(" ").trim() || "No stderr details"}`
        );
        failPending(error);
        rejectTurnCompleted?.(error);
        reject(error);
      });
    });

    try {
      await requestRpc("initialize", {
        clientInfo: {
          name: "codex-telegram-bridge",
          version: "0.1.0"
        },
        capabilities: {
          experimentalApi: true
        }
      });

      if (request.mode === "resume" && request.previousThreadId) {
        const resumeResult = (await requestRpc("thread/resume", {
          threadId: request.previousThreadId,
          cwd: request.agent.cwd,
          approvalPolicy: "never",
          sandbox: request.agent.sandbox,
          personality: "pragmatic",
          model: request.agent.model ?? null
        })) as { thread?: { id?: string } };
        threadId = resumeResult.thread?.id ?? request.previousThreadId;
      } else {
        const startResult = (await requestRpc("thread/start", {
          cwd: request.agent.cwd,
          approvalPolicy: "never",
          sandbox: request.agent.sandbox,
          personality: "pragmatic",
          model: request.agent.model ?? null,
          experimentalRawEvents: false
        })) as { thread?: { id?: string } };
        threadId = startResult.thread?.id;
      }

      if (!threadId) {
        throw new Error("Codex app-server did not return a thread id.");
      }

      await requestRpc("turn/start", {
        threadId,
        input: buildTurnInput(request.selectedSkills ?? [], request.prompt),
        approvalPolicy: "never",
        cwd: request.agent.cwd,
        model: request.agent.model ?? null,
        personality: "pragmatic",
        sandboxPolicy: toSandboxPolicy(request.agent.sandbox, request.agent.addDirs)
      });

      await turnCompletedPromise;
    } finally {
      if (!child.killed) {
        child.kill();
      }
      await Promise.allSettled([stdoutPromise, stderrPromise, processExitPromise]);
    }

    return {
      threadId: threadId ?? randomUUID(),
      responseText: responseChunks.join("").trim(),
      usage,
      warnings,
      rawEvents
    };
  }

  private buildCommand(): { file: string; args: string[] } {
    const args = ["app-server", "--listen", "stdio://"];
    if (process.platform !== "win32") {
      return {
        file: this.codexBin,
        args
      };
    }

    const nodeInvocation = resolveWindowsNodeInvocation(this.codexBin, args);
    if (nodeInvocation) {
      return nodeInvocation;
    }

    const commandLine = [this.codexBin, ...args].map(quoteForWindowsCmd).join(" ");
    return {
      file: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", commandLine]
    };
  }

  private async consumeStream(
    stream: NodeJS.ReadableStream | null,
    onLine: (line: string) => void
  ): Promise<void> {
    if (!stream) {
      return;
    }

    let buffer = "";
    for await (const chunk of stream) {
      buffer += chunk.toString();

      while (true) {
        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) {
          onLine(line);
        }
      }
    }

    const finalLine = buffer.trim();
    if (finalLine) {
      onLine(finalLine);
    }
  }

  private tryParseJson(line: string): JsonRpcMessage | undefined {
    try {
      return JSON.parse(line) as JsonRpcMessage;
    } catch {
      return undefined;
    }
  }

  private handleNotification(
    message: JsonRpcNotification,
    responseChunks: string[],
    warnings: string[],
    setThreadId: (threadId: string) => void,
    setUsage: (usage: AgentRunResult["usage"]) => void,
    markCompleted: () => void
  ): void {
    if (message.method === "thread/started") {
      const params = message.params as { thread?: { id?: string } } | undefined;
      if (params?.thread?.id) {
        setThreadId(params.thread.id);
      }
      return;
    }

    if (message.method === "item/agentMessage/delta") {
      const params = message.params as { delta?: string } | undefined;
      if (typeof params?.delta === "string") {
        responseChunks.push(params.delta);
      }
      return;
    }

    if (message.method === "item/completed") {
      const params = message.params as { item?: { type?: string; text?: string } } | undefined;
      if (params?.item?.type === "agentMessage" && typeof params.item.text === "string" && params.item.text.length > 0) {
        responseChunks.length = 0;
        responseChunks.push(params.item.text);
      }
      return;
    }

    if (message.method === "thread/tokenUsage/updated") {
      const params = message.params as {
        tokenUsage?: {
          last?: {
            inputTokens?: number;
            cachedInputTokens?: number;
            outputTokens?: number;
          };
        };
      } | undefined;

      setUsage({
        inputTokens: params?.tokenUsage?.last?.inputTokens,
        cachedInputTokens: params?.tokenUsage?.last?.cachedInputTokens,
        outputTokens: params?.tokenUsage?.last?.outputTokens
      });
      return;
    }

    if (message.method === "turn/completed") {
      markCompleted();
      return;
    }

    if (message.method === "error") {
      warnings.push(JSON.stringify(message.params));
    }
  }
}

function buildTurnInput(selectedSkills: SkillDefinition[], prompt: string): Array<Record<string, string>> {
  return [
    ...selectedSkills.map((skill) => ({
      type: "skill",
      name: skill.id,
      path: skill.path
    })),
    {
      type: "text",
      text: prompt
    }
  ];
}

function toSandboxPolicy(sandbox: SandboxMode, addDirs: string[]): Record<string, unknown> {
  if (sandbox === "danger-full-access") {
    return {
      type: "dangerFullAccess"
    };
  }

  if (sandbox === "read-only") {
    return {
      type: "readOnly",
      access: {
        type: "fullAccess"
      }
    };
  }

  return {
    type: "workspaceWrite",
    writableRoots: addDirs,
    readOnlyAccess: {
      type: "fullAccess"
    },
    networkAccess: true,
    excludeTmpdirEnvVar: false,
    excludeSlashTmp: false
  };
}

function quoteForWindowsCmd(value: string): string {
  if (value.length === 0) {
    return '""';
  }

  const escaped = value.replace(/"/g, '\\"');
  if (/[\s"]/u.test(escaped)) {
    return `"${escaped}"`;
  }

  return escaped;
}

function resolveWindowsNodeInvocation(
  codexBin: string,
  args: string[]
): { file: string; args: string[] } | undefined {
  const normalized = codexBin.toLowerCase();
  const candidates: string[] = [];

  if (normalized.endsWith(".cmd")) {
    candidates.push(path.resolve(path.dirname(codexBin), "node_modules", "@openai", "codex", "bin", "codex.js"));
  }

  if (normalized === "codex" || normalized.endsWith("\\codex") || normalized.endsWith("/codex")) {
    const appData = process.env.APPDATA;
    if (appData) {
      candidates.push(path.resolve(appData, "npm", "node_modules", "@openai", "codex", "bin", "codex.js"));
    }
  }

  const scriptPath = candidates.find((candidate) => existsSync(candidate));
  if (!scriptPath) {
    return undefined;
  }

  return {
    file: process.execPath,
    args: [scriptPath, ...args]
  };
}
