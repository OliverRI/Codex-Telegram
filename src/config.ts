import { config as loadDotEnv } from "dotenv";
import path from "node:path";
import { z } from "zod";
import type { AppConfig } from "./types.js";

loadDotEnv();

const envSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  ALLOWED_TELEGRAM_USER_IDS: z.string().optional(),
  ALLOWED_TELEGRAM_CHAT_IDS: z.string().optional(),
  AGENTS_FILE: z.string().default("./config/agents.json"),
  STATE_FILE: z.string().default("./data/state.json"),
  CODEX_BIN: z.string().default("codex"),
  CODEX_TRANSPORT: z.enum(["exec", "app-server"]).default("app-server"),
  BROWSER_CHANNEL: z.enum(["chrome", "msedge"]).default("msedge"),
  GMAIL_STORAGE_STATE_FILE: z.string().default("./secrets/gmail-storage-state.json"),
  LOG_LEVEL: z.string().default("info"),
  DEFAULT_RUN_TIMEOUT_MS: z.coerce.number().int().positive().default(900_000)
});

function parseNumberList(raw?: string): number[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function resolveFromCwd(filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
}

export function loadAppConfig(): AppConfig {
  const env = envSchema.parse(process.env);

  return {
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    allowedTelegramUserIds: parseNumberList(env.ALLOWED_TELEGRAM_USER_IDS),
    allowedTelegramChatIds: parseNumberList(env.ALLOWED_TELEGRAM_CHAT_IDS),
    agentsFile: resolveFromCwd(env.AGENTS_FILE),
    stateFile: resolveFromCwd(env.STATE_FILE),
    codexBin: env.CODEX_BIN,
    codexTransport: env.CODEX_TRANSPORT,
    browserChannel: env.BROWSER_CHANNEL,
    gmailStorageStateFile: resolveFromCwd(env.GMAIL_STORAGE_STATE_FILE),
    logLevel: env.LOG_LEVEL,
    defaultRunTimeoutMs: env.DEFAULT_RUN_TIMEOUT_MS
  };
}
