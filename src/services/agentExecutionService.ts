import { randomUUID } from "node:crypto";
import type pino from "pino";
import { AgentRegistry } from "../agents/agentRegistry.js";
import { CodexCliAdapter } from "../codex/codexCliAdapter.js";
import { AgentTaskQueue } from "../queue/agentTaskQueue.js";
import { isAuthorizedForAgent } from "../security/accessControl.js";
import { JsonStateStore } from "../store/jsonStateStore.js";
import type {
  AgentConfig,
  AgentRuntimeState,
  AppConfig,
  AuthorizationContext,
  PersistedJob
} from "../types.js";

export interface TaskNotifier {
  queued(args: { agent: AgentConfig; job: PersistedJob; position: number }): Promise<void>;
  started(args: { agent: AgentConfig; job: PersistedJob }): Promise<void>;
  completed(args: {
    agent: AgentConfig;
    job: PersistedJob;
    threadId: string;
    responseText: string;
    warnings: string[];
  }): Promise<void>;
  failed(args: { agent: AgentConfig; job: PersistedJob; error: string }): Promise<void>;
  delegating(args: {
    fromAgent: AgentConfig;
    toAgent: AgentConfig;
    sourceJob: PersistedJob;
    mode: "new" | "resume";
    message: string;
    returnToSource: boolean;
  }): Promise<void>;
  delegationFailed(args: { fromAgent: AgentConfig; sourceJob: PersistedJob; error: string }): Promise<void>;
}

interface RunCompletion {
  job: PersistedJob;
  responseText: string;
  threadId?: string;
}

interface AgentHandoffRequest {
  target: string;
  mode: "new" | "resume";
  returnToSource: boolean;
  message: string;
}

export class AgentExecutionService {
  constructor(
    private readonly appConfig: AppConfig,
    private readonly registry: AgentRegistry,
    private readonly store: JsonStateStore,
    private readonly queue: AgentTaskQueue,
    private readonly adapter: CodexCliAdapter,
    private readonly logger: pino.Logger
  ) {}

  async enqueueRun(args: {
    agent: AgentConfig;
    prompt: string;
    mode: "new" | "resume";
    auth: AuthorizationContext;
    notifier: TaskNotifier;
  }): Promise<{ jobId: string; position: number }> {
    if (!isAuthorizedForAgent(args.agent, args.auth)) {
      throw new Error(`No tienes permisos para usar el agente "${args.agent.id}".`);
    }

    const now = new Date().toISOString();
    const job: PersistedJob = {
      id: randomUUID(),
      agentId: args.agent.id,
      chatId: args.auth.chatId,
      userId: args.auth.userId,
      chainDepth: 0,
      prompt: args.prompt,
      mode: args.mode,
      status: "queued",
      requestedAt: now
    };

    const scheduled = await this.scheduleJob({
      agent: args.agent,
      job,
      auth: args.auth,
      notifier: args.notifier
    });

    scheduled.completion.catch((error: unknown) => {
      this.logger.error({ err: error, jobId: job.id, agentId: args.agent.id }, "queued job failed");
    });

    return { jobId: job.id, position: scheduled.position };
  }

  async getAgentStatus(agent: AgentConfig): Promise<{
    runtimeState: AgentRuntimeState | undefined;
    queue: ReturnType<AgentTaskQueue["snapshot"]>;
  }> {
    const runtimeState = await this.store.getAgentState(agent.id);
    const queue = this.queue.snapshot(agent.id);
    return { runtimeState, queue };
  }

  async getLastJob(agent: AgentConfig): Promise<PersistedJob | undefined> {
    const state = await this.store.readState();
    return Object.values(state.jobs)
      .filter((job) => job.agentId === agent.id)
      .sort((left, right) => right.requestedAt.localeCompare(left.requestedAt))[0];
  }

  private async scheduleJob(args: {
    agent: AgentConfig;
    job: PersistedJob;
    auth: AuthorizationContext;
    notifier: TaskNotifier;
  }): Promise<{ position: number; completion: Promise<RunCompletion> }> {
    if (!isAuthorizedForAgent(args.agent, args.auth)) {
      throw new Error(`No tienes permisos para usar el agente "${args.agent.id}".`);
    }

    await this.store.upsertJob(args.job);

    const queued = this.queue.enqueue(args.agent.id, args.job.id, async () => {
      return await this.runJob(args.agent, args.job, args.auth, args.notifier);
    });

    await args.notifier.queued({ agent: args.agent, job: args.job, position: queued.position });

    return {
      position: queued.position,
      completion: queued.promise.then((result) => {
        if (!result) {
          throw new Error("The queued job finished without a result.");
        }

        return result;
      })
    };
  }

  private async runJob(
    agent: AgentConfig,
    job: PersistedJob,
    auth: AuthorizationContext,
    notifier: TaskNotifier
  ): Promise<RunCompletion> {
    const previousState = await this.store.getAgentState(agent.id);
    const shouldResume = job.mode === "resume" && !agent.forceNewThreadOnEachRun && previousState?.threadId;
    const prompt = buildAgentPrompt(
      agent,
      this.registry.getAll().filter((candidate) => candidate.id !== agent.id),
      job.prompt
    );

    const runningJob: PersistedJob = {
      ...job,
      status: "running",
      startedAt: new Date().toISOString()
    };

    await this.store.upsertJob(runningJob);
    await this.store.patchAgentState(agent.id, {
      activeJobId: job.id,
      lastPrompt: job.prompt,
      lastRunAt: runningJob.startedAt,
      lastRunStatus: "running"
    });
    await notifier.started({ agent, job: runningJob });

    try {
      const result = await this.adapter.run({
        agent,
        prompt,
        mode: shouldResume ? "resume" : "new",
        previousThreadId: shouldResume ? previousState?.threadId : undefined,
        timeoutMs: this.appConfig.defaultRunTimeoutMs
      });
      const parsedResponse = extractAgentHandoff(result.responseText);

      const completedJob: PersistedJob = {
        ...runningJob,
        status: "completed",
        completedAt: new Date().toISOString(),
        threadId: result.threadId,
        responsePreview: truncate(parsedResponse.cleanedText, 400)
      };

      await this.store.upsertJob(completedJob);
      await this.store.patchAgentState(agent.id, {
        threadId: result.threadId,
        activeJobId: undefined,
        lastPrompt: job.prompt,
        lastResponsePreview: truncate(parsedResponse.cleanedText, 400),
        lastRunAt: completedJob.completedAt,
        lastRunStatus: "completed"
      });

      await notifier.completed({
        agent,
        job: completedJob,
        threadId: result.threadId,
        responseText: parsedResponse.cleanedText,
        warnings: result.warnings
      });

      if (parsedResponse.handoff && job.chainDepth < 1) {
        await this.handleHandoff({
          sourceAgent: agent,
          sourceJob: completedJob,
          auth,
          notifier,
          handoff: parsedResponse.handoff
        });
      }

      return {
        job: completedJob,
        responseText: parsedResponse.cleanedText,
        threadId: result.threadId
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const failedJob: PersistedJob = {
        ...runningJob,
        status: "failed",
        completedAt: new Date().toISOString(),
        error: errorMessage
      };

      await this.store.upsertJob(failedJob);
      await this.store.patchAgentState(agent.id, {
        activeJobId: undefined,
        lastRunAt: failedJob.completedAt,
        lastRunStatus: "failed"
      });

      await notifier.failed({ agent, job: failedJob, error: errorMessage });
      throw error;
    }
  }

  private async handleHandoff(args: {
    sourceAgent: AgentConfig;
    sourceJob: PersistedJob;
    auth: AuthorizationContext;
    notifier: TaskNotifier;
    handoff: AgentHandoffRequest;
  }): Promise<void> {
    const targetAgent = this.registry.getById(args.handoff.target);
    if (!targetAgent) {
      await args.notifier.delegationFailed({
        fromAgent: args.sourceAgent,
        sourceJob: args.sourceJob,
        error: `No existe el agente objetivo "${args.handoff.target}".`
      });
      return;
    }

    if (targetAgent.id === args.sourceAgent.id) {
      await args.notifier.delegationFailed({
        fromAgent: args.sourceAgent,
        sourceJob: args.sourceJob,
        error: "El agente no puede delegar en si mismo."
      });
      return;
    }

    if (!isAuthorizedForAgent(targetAgent, args.auth)) {
      await args.notifier.delegationFailed({
        fromAgent: args.sourceAgent,
        sourceJob: args.sourceJob,
        error: `No tienes permisos para delegar en "${targetAgent.id}".`
      });
      return;
    }

    await args.notifier.delegating({
      fromAgent: args.sourceAgent,
      toAgent: targetAgent,
      sourceJob: args.sourceJob,
      mode: args.handoff.mode,
      message: args.handoff.message,
      returnToSource: args.handoff.returnToSource
    });

    const delegatedJob: PersistedJob = {
      id: randomUUID(),
      agentId: targetAgent.id,
      chatId: args.auth.chatId,
      userId: args.auth.userId,
      parentJobId: args.sourceJob.id,
      chainDepth: args.sourceJob.chainDepth + 1,
      prompt: args.handoff.message,
      mode: args.handoff.mode,
      status: "queued",
      requestedAt: new Date().toISOString()
    };

    try {
      const scheduled = await this.scheduleJob({
        agent: targetAgent,
        job: delegatedJob,
        auth: args.auth,
        notifier: args.notifier
      });
      const delegatedResult = await scheduled.completion;

      if (args.handoff.returnToSource) {
        const followUpJob: PersistedJob = {
          id: randomUUID(),
          agentId: args.sourceAgent.id,
          chatId: args.auth.chatId,
          userId: args.auth.userId,
          parentJobId: delegatedResult.job.id,
          chainDepth: args.sourceJob.chainDepth + 1,
          prompt: buildReturnToSourcePrompt(
            args.sourceAgent,
            targetAgent,
            args.handoff.message,
            delegatedResult.responseText
          ),
          mode: "resume",
          status: "queued",
          requestedAt: new Date().toISOString()
        };

        await this.scheduleJob({
          agent: args.sourceAgent,
          job: followUpJob,
          auth: args.auth,
          notifier: args.notifier
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await args.notifier.delegationFailed({
        fromAgent: args.sourceAgent,
        sourceJob: args.sourceJob,
        error: errorMessage
      });
    }
  }
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function buildAgentPrompt(agent: AgentConfig, availableAgents: AgentConfig[], userPrompt: string): string {
    const guidance: string[] = [
      "You are running through a Telegram-to-Codex bridge on Windows.",
      `Primary working directory: ${agent.cwd}`,
      `Sandbox mode: ${agent.sandbox}`,
      agent.dangerouslyBypassApprovalsAndSandbox
        ? "Sandbox bypass is enabled for this agent because the Windows shell sandbox may fail in this environment."
        : "Sandbox bypass is disabled for this agent.",
      "If the user asks about local files or folders, inspect them with shell commands instead of guessing."
    ];

  if (agent.addDirs.length > 0) {
    guidance.push("Additional allowed directories:");
    for (const dir of agent.addDirs) {
      guidance.push(`- ${dir}`);
    }
  }

  if (availableAgents.length > 0) {
    guidance.push("Other configured agents available for delegation:");
    for (const availableAgent of availableAgents) {
      guidance.push(`- ${availableAgent.id}: ${availableAgent.name}`);
    }
  }

  const hintEntries = Object.entries(agent.pathHints);
  if (hintEntries.length > 0) {
    guidance.push("Path hints to resolve user language into real filesystem paths:");
    for (const [label, resolvedPath] of hintEntries) {
      guidance.push(`- ${label}: ${resolvedPath}`);
    }
  }

  guidance.push("When the user mentions Desktop or Escritorio and a path hint exists, use that exact path.");
  guidance.push("If an old conversation context suggests you cannot access a path, re-check the filesystem before answering.");
  guidance.push("If another agent should help, append this exact block at the end of your final answer:");
  guidance.push("[[agent_handoff]]");
  guidance.push("target=agent-id");
  guidance.push("mode=resume");
  guidance.push("return_to_source=true");
  guidance.push("---");
  guidance.push("Message for the other agent.");
  guidance.push("[[/agent_handoff]]");
  guidance.push("Use only one handoff block and only when another configured agent is genuinely better suited.");
  guidance.push("If the user explicitly asks you to send one or more local files to Telegram, append this exact block at the end of your final answer with absolute file paths, one per line:");
  guidance.push("[[telegram_attachments]]");
  guidance.push("C:\\absolute\\path\\to\\file.ext");
  guidance.push("[[/telegram_attachments]]");
  guidance.push("Only include files that actually exist and only if they are inside the agent's working directory or additional allowed directories.");

  return `${guidance.join("\n")}\n\nUser request:\n${userPrompt}`;
}

function extractAgentHandoff(responseText: string): {
  cleanedText: string;
  handoff?: AgentHandoffRequest;
} {
  const match = responseText.match(/\[\[agent_handoff\]\]([\s\S]*?)\[\[\/agent_handoff\]\]/i);
  if (!match) {
    return {
      cleanedText: responseText
    };
  }

  const block = match[1].trim();
  const lines = block.split(/\r?\n/);
  const separatorIndex = lines.findIndex((line) => line.trim() === "---");
  const headerLines = separatorIndex >= 0 ? lines.slice(0, separatorIndex) : lines;
  const bodyLines = separatorIndex >= 0 ? lines.slice(separatorIndex + 1) : [];
  const headers = new Map<string, string>();

  for (const line of headerLines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, equalsIndex).trim().toLowerCase();
    const value = trimmed.slice(equalsIndex + 1).trim();
    headers.set(key, value);
  }

  const target = headers.get("target");
  const mode = headers.get("mode") === "new" ? "new" : "resume";
  const returnToSource = headers.get("return_to_source") !== "false";
  const message = bodyLines.join("\n").trim() || headers.get("message") || "";
  const cleanedText = responseText.replace(match[0], "").trim();

  if (!target || !message) {
    return { cleanedText };
  }

  return {
    cleanedText,
    handoff: {
      target,
      mode,
      returnToSource,
      message
    }
  };
}

function buildReturnToSourcePrompt(
  sourceAgent: AgentConfig,
  targetAgent: AgentConfig,
  delegatedMessage: string,
  delegatedResponse: string
): string {
  return [
    `Delegated task result from agent ${targetAgent.id} for agent ${sourceAgent.id}.`,
    "",
    "Delegated request:",
    delegatedMessage,
    "",
    `Response from ${targetAgent.id}:`,
    delegatedResponse,
    "",
    "Continue helping the user based on this result."
  ].join("\n");
}
