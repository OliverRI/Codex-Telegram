export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface AgentConfig {
  id: string;
  name: string;
  cwd: string;
  model?: string;
  profile?: string;
  sandbox: SandboxMode;
  skipGitRepoCheck: boolean;
  fullAuto: boolean;
  forceNewThreadOnEachRun: boolean;
  allowedTelegramUserIds: number[];
  allowedChatIds: number[];
  extraArgs: string[];
}

export interface AppConfig {
  telegramBotToken: string;
  allowedTelegramUserIds: number[];
  allowedTelegramChatIds: number[];
  agentsFile: string;
  stateFile: string;
  codexBin: string;
  logLevel: string;
  defaultRunTimeoutMs: number;
}

export interface AuthorizationContext {
  chatId: number;
  userId?: number;
}

export interface AgentRunRequest {
  agent: AgentConfig;
  prompt: string;
  mode: "new" | "resume";
  previousThreadId?: string;
  timeoutMs: number;
}

export interface AgentRunResult {
  threadId: string;
  responseText: string;
  usage?: {
    inputTokens?: number;
    cachedInputTokens?: number;
    outputTokens?: number;
  };
  warnings: string[];
  rawEvents: unknown[];
}

export interface PersistedJob {
  id: string;
  agentId: string;
  chatId: number;
  userId?: number;
  prompt: string;
  mode: "new" | "resume";
  status: "queued" | "running" | "completed" | "failed";
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  threadId?: string;
  responsePreview?: string;
  error?: string;
}

export interface AgentRuntimeState {
  threadId?: string;
  lastPrompt?: string;
  lastResponsePreview?: string;
  lastRunStatus?: PersistedJob["status"];
  lastRunAt?: string;
  activeJobId?: string;
}

export interface PersistedState {
  agents: Record<string, AgentRuntimeState>;
  jobs: Record<string, PersistedJob>;
}

export interface QueueSnapshot {
  agentId: string;
  pending: number;
  size: number;
  activeJobId?: string;
}
