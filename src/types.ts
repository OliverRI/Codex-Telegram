export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";

export interface AgentPermissions {
  webAccess: boolean;
  gmailAccess: boolean;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description?: string;
  path: string;
  source: "repo" | "codex-home" | "plugin";
  runtimeSupport: "exec" | "desktop-connector";
}

export interface AgentConfig {
  id: string;
  name: string;
  cwd: string;
  model?: string;
  profile?: string;
  sandbox: SandboxMode;
  skipGitRepoCheck: boolean;
  fullAuto: boolean;
  dangerouslyBypassApprovalsAndSandbox: boolean;
  forceNewThreadOnEachRun: boolean;
  allowedTelegramUserIds: number[];
  allowedChatIds: number[];
  permissions: AgentPermissions;
  allowedSkills: string[];
  addDirs: string[];
  pathHints: Record<string, string>;
  extraArgs: string[];
}

export interface AppConfig {
  telegramBotToken: string;
  allowedTelegramUserIds: number[];
  allowedTelegramChatIds: number[];
  agentsFile: string;
  stateFile: string;
  codexBin: string;
  codexTransport: "exec" | "app-server";
  browserChannel: "chrome" | "msedge";
  gmailStorageStateFile: string;
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
  selectedSkills?: SkillDefinition[];
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
  parentJobId?: string;
  chainDepth: number;
  skillIds?: string[];
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

export interface CodexRuntimeAdapter {
  readonly transportName: "exec" | "app-server";
  readonly supportsNativeSkills: boolean;
  run(request: AgentRunRequest): Promise<AgentRunResult>;
}
