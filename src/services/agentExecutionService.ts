import { randomUUID } from "node:crypto";
import type pino from "pino";
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
}

export class AgentExecutionService {
  constructor(
    private readonly appConfig: AppConfig,
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
      prompt: args.prompt,
      mode: args.mode,
      status: "queued",
      requestedAt: now
    };

    await this.store.upsertJob(job);

    const queued = this.queue.enqueue(args.agent.id, job.id, async () => {
      await this.runJob(args.agent, job, args.notifier);
    });

    await args.notifier.queued({ agent: args.agent, job, position: queued.position });

    queued.promise.catch((error: unknown) => {
      this.logger.error({ err: error, jobId: job.id, agentId: args.agent.id }, "queued job failed");
    });

    return { jobId: job.id, position: queued.position };
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

  private async runJob(agent: AgentConfig, job: PersistedJob, notifier: TaskNotifier): Promise<void> {
    const previousState = await this.store.getAgentState(agent.id);
    const shouldResume = job.mode === "resume" && !agent.forceNewThreadOnEachRun && previousState?.threadId;
    const prompt = buildAgentPrompt(agent, job.prompt);

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

      const completedJob: PersistedJob = {
        ...runningJob,
        status: "completed",
        completedAt: new Date().toISOString(),
        threadId: result.threadId,
        responsePreview: truncate(result.responseText, 400)
      };

      await this.store.upsertJob(completedJob);
      await this.store.patchAgentState(agent.id, {
        threadId: result.threadId,
        activeJobId: undefined,
        lastPrompt: job.prompt,
        lastResponsePreview: truncate(result.responseText, 400),
        lastRunAt: completedJob.completedAt,
        lastRunStatus: "completed"
      });

      await notifier.completed({
        agent,
        job: completedJob,
        threadId: result.threadId,
        responseText: result.responseText,
        warnings: result.warnings
      });
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
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function buildAgentPrompt(agent: AgentConfig, userPrompt: string): string {
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

  const hintEntries = Object.entries(agent.pathHints);
  if (hintEntries.length > 0) {
    guidance.push("Path hints to resolve user language into real filesystem paths:");
    for (const [label, resolvedPath] of hintEntries) {
      guidance.push(`- ${label}: ${resolvedPath}`);
    }
  }

  guidance.push("When the user mentions Desktop or Escritorio and a path hint exists, use that exact path.");
  guidance.push("If an old conversation context suggests you cannot access a path, re-check the filesystem before answering.");

  return `${guidance.join("\n")}\n\nUser request:\n${userPrompt}`;
}
