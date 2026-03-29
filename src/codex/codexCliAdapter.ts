import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import type pino from "pino";
import type { AgentRunRequest, AgentRunResult, CodexRuntimeAdapter } from "../types.js";

interface JsonEvent {
  type?: string;
  [key: string]: unknown;
}

export class CodexCliAdapter implements CodexRuntimeAdapter {
  readonly transportName = "exec" as const;
  readonly supportsNativeSkills = false;

  constructor(
    private readonly codexBin: string,
    private readonly logger: pino.Logger
  ) {}

  async run(request: AgentRunRequest): Promise<AgentRunResult> {
    const args = this.buildArgs(request);
    const events: JsonEvent[] = [];
    const warnings: string[] = [];
    const responseChunks: string[] = [];
    let threadId = request.previousThreadId;
    let usage: AgentRunResult["usage"];

    this.logger.info(
      {
        agentId: request.agent.id,
        mode: request.mode,
        cwd: request.agent.cwd,
        threadId: request.previousThreadId
      },
      "starting codex run"
    );

    const command = this.buildCommand(args);
    const child = spawn(command.file, command.args, {
      cwd: request.agent.cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });

    const stdoutPromise = this.consumeStream(child.stdout, (line) => {
      const event = this.tryParseJson(line);
      if (!event) {
        warnings.push(line);
        return;
      }

      events.push(event);

      if (event.type === "thread.started" && typeof event.thread_id === "string") {
        threadId = event.thread_id;
      }

      if (
        event.type === "item.completed" &&
        typeof event.item === "object" &&
        event.item !== null &&
        "type" in event.item &&
        "text" in event.item &&
        event.item.type === "agent_message" &&
        typeof event.item.text === "string"
      ) {
        responseChunks.push(event.item.text);
      }

      if (event.type === "turn.completed" && typeof event.usage === "object" && event.usage !== null) {
        const rawUsage = event.usage as Record<string, unknown>;
        usage = {
          inputTokens: asNumber(rawUsage.input_tokens),
          cachedInputTokens: asNumber(rawUsage.cached_input_tokens),
          outputTokens: asNumber(rawUsage.output_tokens)
        };
      }
    });

    const stderrPromise = this.consumeStream(child.stderr, (line) => {
      warnings.push(line);
    });

    const exitCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`Codex run timed out after ${request.timeoutMs} ms`));
      }, request.timeoutMs);

      child.once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });

      child.once("close", (code) => {
        clearTimeout(timer);
        resolve(code ?? 0);
      });
    });

    await Promise.all([stdoutPromise, stderrPromise]);

    if (exitCode !== 0) {
      throw new Error(
        `Codex exited with code ${exitCode}. ${warnings.slice(-3).join(" ").trim() || "No stderr details"}`
      );
    }

    if (!threadId) {
      threadId = randomUUID();
      warnings.push("Codex did not emit thread.started; generated fallback thread id.");
    }

    return {
      threadId,
      responseText: responseChunks.join("\n").trim(),
      usage,
      warnings,
      rawEvents: events
    };
  }

  private buildArgs(request: AgentRunRequest): string[] {
    const isResume = request.mode === "resume" && Boolean(request.previousThreadId);
    const args = isResume ? ["exec", "resume", "--json"] : ["exec", "--json"];

    if (request.agent.model) {
      args.push("-m", request.agent.model);
    }

    if (request.agent.dangerouslyBypassApprovalsAndSandbox) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    }

    if (!isResume && request.agent.profile) {
      args.push("-p", request.agent.profile);
    }

    if (!isResume && !request.agent.dangerouslyBypassApprovalsAndSandbox) {
      args.push("-s", request.agent.sandbox);
    }

    if (request.agent.fullAuto && !request.agent.dangerouslyBypassApprovalsAndSandbox) {
      args.push("--full-auto");
    }

    if (request.agent.skipGitRepoCheck) {
      args.push("--skip-git-repo-check");
    }

    if (!isResume) {
      for (const dir of request.agent.addDirs) {
        args.push("--add-dir", dir);
      }
    }

    args.push(...request.agent.extraArgs);

    if (isResume && request.previousThreadId) {
      args.push(request.previousThreadId);
    }

    args.push(request.prompt);

    return args;
  }

  private buildCommand(args: string[]): { file: string; args: string[] } {
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

        if (line.length > 0) {
          onLine(line);
        }
      }
    }

    const finalLine = buffer.trim();
    if (finalLine.length > 0) {
      onLine(finalLine);
    }
  }

  private tryParseJson(line: string): JsonEvent | undefined {
    try {
      return JSON.parse(line) as JsonEvent;
    } catch {
      return undefined;
    }
  }
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
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
