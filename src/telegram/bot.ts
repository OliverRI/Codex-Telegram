import { InputFile, Bot, BotError, Context, GrammyError, HttpError } from "grammy";
import fs from "node:fs";
import path from "node:path";
import type pino from "pino";
import { AgentRegistry } from "../agents/agentRegistry.js";
import { isAuthorizedForAgent, isGloballyAuthorized } from "../security/accessControl.js";
import { AgentExecutionService, type TaskNotifier } from "../services/agentExecutionService.js";
import type { AgentConfig, AppConfig, AuthorizationContext, PersistedJob } from "../types.js";

export interface TelegramBotDependencies {
  config: AppConfig;
  registry: AgentRegistry;
  executionService: AgentExecutionService;
  logger: pino.Logger;
}

export function createTelegramBot(deps: TelegramBotDependencies) {
  const bot = new Bot<Context>(deps.config.telegramBotToken);

  bot.catch((error: BotError<Context>) => {
    const ctx = error.ctx;
    deps.logger.error({ err: error.error, updateId: ctx.update.update_id }, "telegram bot error");

    if (error.error instanceof GrammyError) {
      deps.logger.error({ description: error.error.description }, "telegram request error");
      return;
    }

    if (error.error instanceof HttpError) {
      deps.logger.error({ message: error.error.message }, "telegram network error");
    }
  });

  bot.command(["start", "help"], async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    await ctx.reply(helpText());
  });

  bot.command("whoami", async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    await ctx.reply(
      `chat_id=${chatId}\nuser_id=${ctx.from?.id ?? "unknown"}\nusername=${ctx.from?.username ?? "-"}`
    );
  });

  bot.command("agents", async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    const auth = getAuthContext(chatId, ctx.from?.id);
    const agents = deps.registry
      .getAll()
      .filter((agent) => isAuthorizedForAgent(agent, auth));

    if (agents.length === 0) {
      await ctx.reply("No hay agentes disponibles para este chat.");
      return;
    }

    await ctx.reply(agents.map((agent) => `${agent.id}: ${agent.name}\n${agent.cwd}`).join("\n\n"));
  });

  bot.command("status", async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    const args = extractArgs(ctx.message?.text);
    if (args.length === 0) {
      await ctx.reply("Uso: /status <agentId>");
      return;
    }

    const agent = deps.registry.getById(args[0]);
    if (!agent) {
      await ctx.reply(`No existe el agente "${args[0]}".`);
      return;
    }

    const auth = getAuthContext(chatId, ctx.from?.id);
    if (!isAuthorizedForAgent(agent, auth)) {
      await ctx.reply("No tienes permisos para consultar ese agente.");
      return;
    }

    const status = await deps.executionService.getAgentStatus(agent);
    const lastJob = await deps.executionService.getLastJob(agent);
    await ctx.reply(formatStatus(agent, status.runtimeState, status.queue, lastJob));
  });

  bot.command("last", async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    const args = extractArgs(ctx.message?.text);
    if (args.length === 0) {
      await ctx.reply("Uso: /last <agentId>");
      return;
    }

    const agent = deps.registry.getById(args[0]);
    if (!agent) {
      await ctx.reply(`No existe el agente "${args[0]}".`);
      return;
    }

    const auth = getAuthContext(chatId, ctx.from?.id);
    if (!isAuthorizedForAgent(agent, auth)) {
      await ctx.reply("No tienes permisos para consultar ese agente.");
      return;
    }

    const lastJob = await deps.executionService.getLastJob(agent);
    if (!lastJob) {
      await ctx.reply("Ese agente todavia no tiene ejecuciones registradas.");
      return;
    }

    await ctx.reply(formatLastJob(agent, lastJob));
  });

  bot.command("run", async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    await handleRunCommand(ctx.message?.text, "resume", chatId, ctx.from?.id);
  });

  bot.command("new", async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    await handleRunCommand(ctx.message?.text, "new", chatId, ctx.from?.id);
  });

  async function handleRunCommand(
    text: string | undefined,
    mode: "new" | "resume",
    chatId: number,
    userId?: number
  ) {
    const parsed = parseRunCommand(text);
    if (!parsed) {
      await bot.api.sendMessage(chatId, `Uso: /${mode === "new" ? "new" : "run"} <agentId> <prompt>`);
      return;
    }

    const agent = deps.registry.getById(parsed.agentId);
    if (!agent) {
      await bot.api.sendMessage(chatId, `No existe el agente "${parsed.agentId}".`);
      return;
    }

    const auth = getAuthContext(chatId, userId);
    if (!isAuthorizedForAgent(agent, auth)) {
      await bot.api.sendMessage(chatId, "No tienes permisos para usar ese agente.");
      return;
    }

    await deps.executionService.enqueueRun({
      agent,
      prompt: parsed.prompt,
      mode,
      auth,
      notifier: createNotifier(bot, chatId)
    });
  }

  async function ensureAuthorized(chatId: number, userId?: number): Promise<boolean> {
    const allowed = isGloballyAuthorized(deps.config, getAuthContext(chatId, userId));
    if (!allowed) {
      await bot.api.sendMessage(chatId, "Acceso denegado.");
    }
    return allowed;
  }

  return bot;
}

function createNotifier(bot: Bot, chatId: number): TaskNotifier {
  return {
    async queued({ agent, job, position }) {
      await bot.api.sendMessage(
        chatId,
        `En cola para ${agent.id}.\njob=${job.id}\nposicion=${position}\nmodo=${job.mode}`
      );
    },
    async started({ agent, job }) {
      await bot.api.sendMessage(chatId, `Ejecutando ${agent.id}.\njob=${job.id}`);
    },
    async completed({ agent, job, threadId, responseText, warnings }) {
      const attachmentResult = extractTelegramAttachments(responseText);
      const payload = [
        `Completado ${agent.id}.`,
        `job=${job.id}`,
        `thread=${threadId}`,
        warnings.length > 0 ? `warnings=${warnings.slice(0, 2).join(" | ")}` : undefined,
        "",
        attachmentResult.cleanedText || "(Sin respuesta textual del agente)"
      ]
        .filter(Boolean)
        .join("\n");

      for (const chunk of toTelegramChunks(payload)) {
        await bot.api.sendMessage(chatId, chunk);
      }

      if (attachmentResult.paths.length > 0) {
        const sendResult = await sendTelegramAttachments(bot, chatId, agent, attachmentResult.paths);
        if (sendResult.sent.length > 0) {
          await bot.api.sendMessage(
            chatId,
            `Archivos enviados:\n${sendResult.sent.map((file) => `- ${path.basename(file)}`).join("\n")}`
          );
        }

        if (sendResult.skipped.length > 0) {
          await bot.api.sendMessage(
            chatId,
            `No pude adjuntar estos archivos:\n${sendResult.skipped
              .map((item) => `- ${item.file}: ${item.reason}`)
              .join("\n")}`
          );
        }
      }
    },
    async failed({ agent, job, error }) {
      await bot.api.sendMessage(chatId, `Fallo en ${agent.id}.\njob=${job.id}\nerror=${error}`);
    },
    async delegating({ fromAgent, toAgent, sourceJob, mode, message, returnToSource }) {
      await bot.api.sendMessage(
        chatId,
        [
          `${fromAgent.id} delega en ${toAgent.id}.`,
          `source_job=${sourceJob.id}`,
          `mode=${mode}`,
          `return_to_source=${returnToSource}`,
          "",
          `mensaje=${truncateForTelegram(message)}`
        ].join("\n")
      );
    },
    async delegationFailed({ fromAgent, sourceJob, error }) {
      await bot.api.sendMessage(
        chatId,
        `Delegacion fallida desde ${fromAgent.id}.\nsource_job=${sourceJob.id}\nerror=${error}`
      );
    }
  };
}

function helpText(): string {
  return [
    "Comandos disponibles:",
    "/agents - lista agentes disponibles",
    "/status <agentId> - estado del agente",
    "/last <agentId> - ultima ejecucion registrada",
    "/run <agentId> <prompt> - reutiliza el hilo previo si existe",
    "/new <agentId> <prompt> - fuerza hilo nuevo",
    "/whoami - muestra chat_id y user_id para permisos",
    "Si pides que envie un archivo por Telegram, el agente puede adjuntarlo si esta dentro de las rutas permitidas."
  ].join("\n");
}

function extractArgs(text?: string): string[] {
  if (!text) {
    return [];
  }

  const normalized = text.replace(/^\/\w+(?:@\w+)?/, "").trim();
  if (!normalized) {
    return [];
  }

  return normalized.split(/\s+/);
}

function parseRunCommand(text?: string): { agentId: string; prompt: string } | undefined {
  if (!text) {
    return undefined;
  }

  const match = text.match(/^\/\w+(?:@\w+)?\s+(\S+)\s+([\s\S]+)$/);
  if (!match) {
    return undefined;
  }

  return {
    agentId: match[1],
    prompt: match[2].trim()
  };
}

function getAuthContext(chatId: number, userId?: number): AuthorizationContext {
  return { chatId, userId };
}

function formatStatus(
  agent: AgentConfig,
  runtimeState: {
    threadId?: string;
    lastRunStatus?: string;
    lastRunAt?: string;
    activeJobId?: string;
  } | undefined,
  queue: { pending: number; size: number; activeJobId?: string },
  lastJob?: PersistedJob
): string {
  return [
    `${agent.id}: ${agent.name}`,
    `cwd=${agent.cwd}`,
    `sandbox=${agent.sandbox}`,
    `thread=${runtimeState?.threadId ?? "-"}`,
    `last_status=${runtimeState?.lastRunStatus ?? "-"}`,
    `last_run_at=${runtimeState?.lastRunAt ?? "-"}`,
    `active_job=${runtimeState?.activeJobId ?? queue.activeJobId ?? "-"}`,
    `queue_pending=${queue.pending}`,
    `queue_waiting=${queue.size}`,
    `last_job=${lastJob?.id ?? "-"}`
  ].join("\n");
}

function formatLastJob(agent: AgentConfig, job: PersistedJob): string {
  return [
    `${agent.id}: ultima ejecucion`,
    `job=${job.id}`,
    `status=${job.status}`,
    `mode=${job.mode}`,
    `requested_at=${job.requestedAt}`,
    `thread=${job.threadId ?? "-"}`,
    "",
    `prompt=${job.prompt}`,
    "",
    `preview=${job.responsePreview ?? job.error ?? "-"}`
  ].join("\n");
}

function toTelegramChunks(text: string, maxLength = 3500): string[] {
  if (text.length <= maxLength) {
    return [text];
  }

  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    chunks.push(text.slice(start, start + maxLength));
    start += maxLength;
  }

  return chunks;
}

function extractTelegramAttachments(responseText: string): { cleanedText: string; paths: string[] } {
  const match = responseText.match(/\[\[telegram_attachments\]\]([\s\S]*?)\[\[\/telegram_attachments\]\]/i);
  if (!match) {
    return {
      cleanedText: responseText,
      paths: []
    };
  }

  const paths = match[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const cleanedText = responseText.replace(match[0], "").trim();
  return { cleanedText, paths };
}

async function sendTelegramAttachments(
  bot: Bot,
  chatId: number,
  agent: AgentConfig,
  filePaths: string[]
): Promise<{ sent: string[]; skipped: Array<{ file: string; reason: string }> }> {
  const sent: string[] = [];
  const skipped: Array<{ file: string; reason: string }> = [];
  const uniquePaths = [...new Set(filePaths)].slice(0, 5);

  for (const rawFile of uniquePaths) {
    const filePath = path.resolve(rawFile);

    if (!isAllowedAttachmentPath(agent, filePath)) {
      skipped.push({ file: rawFile, reason: "ruta fuera del alcance permitido del agente" });
      continue;
    }

    if (!fs.existsSync(filePath)) {
      skipped.push({ file: rawFile, reason: "archivo no encontrado" });
      continue;
    }

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) {
      skipped.push({ file: rawFile, reason: "no es un archivo regular" });
      continue;
    }

    const maxTelegramBytes = 45 * 1024 * 1024;
    if (stat.size > maxTelegramBytes) {
      skipped.push({ file: rawFile, reason: "supera el limite prudente de tamano para Telegram" });
      continue;
    }

    await bot.api.sendDocument(chatId, new InputFile(filePath, path.basename(filePath)));
    sent.push(filePath);
  }

  return { sent, skipped };
}

function isAllowedAttachmentPath(agent: AgentConfig, candidatePath: string): boolean {
  const allowedRoots = [agent.cwd, ...agent.addDirs].map((dir) => normalizePathForComparison(path.resolve(dir)));
  const normalizedCandidate = normalizePathForComparison(candidatePath);
  return allowedRoots.some(
    (root) => normalizedCandidate === root || normalizedCandidate.startsWith(`${root}${path.sep}`)
  );
}

function normalizePathForComparison(filePath: string): string {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function truncateForTelegram(value: string, maxLength = 600): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}
