import { InputFile, Bot, BotError, Context, GrammyError, HttpError } from "grammy";
import fs from "node:fs";
import path from "node:path";
import type pino from "pino";
import { AgentRegistry } from "../agents/agentRegistry.js";
import { isAuthorizedForAgent, isGloballyAuthorized } from "../security/accessControl.js";
import { AgentExecutionService, type TaskNotifier } from "../services/agentExecutionService.js";
import { SkillRegistry } from "../skills/skillRegistry.js";
import type { AgentConfig, AppConfig, AuthorizationContext, PersistedJob, SkillDefinition } from "../types.js";

export interface TelegramBotDependencies {
  config: AppConfig;
  registry: AgentRegistry;
  skillRegistry: SkillRegistry;
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

  bot.command(["start", "help", "inicio", "ayuda"], async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    await ctx.reply(helpText());
  });

  bot.command(["whoami", "quiensoy"], async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    await ctx.reply(
      [
        "Estos datos te sirven si quieres ajustar permisos mas adelante.",
        `chat_id=${chatId}`,
        `user_id=${ctx.from?.id ?? "unknown"}`,
        `username=${ctx.from?.username ?? "-"}`
      ].join("\n")
    );
  });

  bot.command(["agents", "agentes"], async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    const auth = getAuthContext(chatId, ctx.from?.id);
    const agents = deps.registry.getAll().filter((agent) => isAuthorizedForAgent(agent, auth));

    if (agents.length === 0) {
      await ctx.reply("Ahora mismo no tengo agentes disponibles para este chat.");
      return;
    }

    await ctx.reply(
      ["Estos son los agentes que tienes disponibles:", "", ...agents.map(formatAgentSummary)].join("\n")
    );
  });

  bot.command(["skills", "habilidades"], async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    const args = extractArgs(ctx.message?.text);
    const auth = getAuthContext(chatId, ctx.from?.id);

    if (args.length === 0) {
      const skills = deps.skillRegistry.getAll();
      if (skills.length === 0) {
        await ctx.reply("No encuentro habilidades instaladas en este equipo.");
        return;
      }

      await ctx.reply(
        [
          "Estas son las habilidades instaladas que el bridge puede ver:",
          "",
          ...skills.map((skill) => formatSkillSummary(skill))
        ].join("\n")
      );
      return;
    }

    const agent = deps.registry.getById(args[0]);
    if (!agent) {
      await ctx.reply(`No encuentro ningun agente llamado "${args[0]}".`);
      return;
    }

    if (!isAuthorizedForAgent(agent, auth)) {
      await ctx.reply("No tienes permisos para consultar ese agente.");
      return;
    }

    const skills = deps.skillRegistry.getAllowedForAgent(agent);
    const configuredForAll = agent.allowedSkills.includes("*");
    if (skills.length === 0) {
      await ctx.reply(`El agente ${agent.name} no tiene habilidades activadas.`);
      return;
    }

    await ctx.reply(
      [
        configuredForAll
          ? `El agente ${agent.name} puede usar cualquier habilidad instalada.`
          : `El agente ${agent.name} puede usar estas habilidades:`,
        "",
        ...skills.map((skill) => formatSkillSummary(skill)),
        "",
        `Ejemplo: /ejecutar ${agent.id} --habilidades ${skills[0]?.id} tu tarea aqui`
      ].join("\n")
    );
  });

  bot.command(["status", "estado"], async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    const args = extractArgs(ctx.message?.text);
    if (args.length === 0) {
      await ctx.reply("Prueba asi: /estado <agente>");
      return;
    }

    const agent = deps.registry.getById(args[0]);
    if (!agent) {
      await ctx.reply(`No encuentro ningun agente llamado "${args[0]}".`);
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

  bot.command(["last", "ultimo"], async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    const args = extractArgs(ctx.message?.text);
    if (args.length === 0) {
      await ctx.reply("Prueba asi: /ultimo <agente>");
      return;
    }

    const agent = deps.registry.getById(args[0]);
    if (!agent) {
      await ctx.reply(`No encuentro ningun agente llamado "${args[0]}".`);
      return;
    }

    const auth = getAuthContext(chatId, ctx.from?.id);
    if (!isAuthorizedForAgent(agent, auth)) {
      await ctx.reply("No tienes permisos para consultar ese agente.");
      return;
    }

    const lastJob = await deps.executionService.getLastJob(agent);
    if (!lastJob) {
      await ctx.reply("Ese agente todavia no tiene actividad registrada.");
      return;
    }

    await ctx.reply(formatLastJob(agent, lastJob));
  });

  bot.command(["run", "ejecutar"], async (ctx: Context) => {
    const chatId = ctx.chat?.id;
    if (!chatId) {
      return;
    }

    if (!(await ensureAuthorized(chatId, ctx.from?.id))) {
      return;
    }

    await handleRunCommand(ctx.message?.text, "resume", chatId, ctx.from?.id);
  });

  bot.command(["new", "nuevo"], async (ctx: Context) => {
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
      await bot.api.sendMessage(
        chatId,
        `Prueba asi: /${mode === "new" ? "nuevo" : "ejecutar"} <agente> [--habilidades skill1,skill2] <mensaje>`
      );
      return;
    }

    const agent = deps.registry.getById(parsed.agentId);
    if (!agent) {
      await bot.api.sendMessage(chatId, `No encuentro ningun agente llamado "${parsed.agentId}".`);
      return;
    }

    const auth = getAuthContext(chatId, userId);
    if (!isAuthorizedForAgent(agent, auth)) {
      await bot.api.sendMessage(chatId, "No tienes permisos para usar ese agente.");
      return;
    }

    let selectedSkills: SkillDefinition[];
    try {
      selectedSkills = deps.skillRegistry.resolveForAgent(agent, parsed.skillIds);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await bot.api.sendMessage(chatId, message);
      return;
    }

    try {
      await deps.executionService.enqueueRun({
        agent,
        prompt: parsed.prompt,
        skillIds: selectedSkills.map((skill) => skill.id),
        mode,
        auth,
        notifier: createNotifier(bot, chatId)
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await bot.api.sendMessage(chatId, message);
    }
  }

  async function ensureAuthorized(chatId: number, userId?: number): Promise<boolean> {
    const allowed = isGloballyAuthorized(deps.config, getAuthContext(chatId, userId));
    if (!allowed) {
      await bot.api.sendMessage(chatId, "No puedo atender este chat porque no esta autorizado.");
    }
    return allowed;
  }

  return bot;
}

function createNotifier(bot: Bot, chatId: number): TaskNotifier {
  return {
    async queued({ agent, position }) {
      await bot.api.sendMessage(
        chatId,
        [
          `He dejado tu peticion preparada para ${agent.name}.`,
          `Va en la posicion ${position} de la cola.`,
          position > 1 ? "Te aviso en cuanto le toque." : "Se pone con ello en cuanto quede libre."
        ].join("\n")
      );
    },
    async started({ agent, job }) {
      await bot.api.sendMessage(
        chatId,
        [`${agent.name} ya se ha puesto con ello.`, `Si quieres seguirlo, la referencia es ${job.id}.`].join(
          "\n"
        )
      );
    },
    async completed({ agent, responseText, warnings }) {
      const attachmentResult = extractTelegramAttachments(responseText);
      const userFacingWarnings = warnings.filter((warning) => !isBenignTechnicalWarning(warning));
      const payload = [
        `${agent.name} ya ha terminado.`,
        userFacingWarnings.length > 0 ? `Apunte tecnico: ${userFacingWarnings.slice(0, 2).join(" | ")}` : undefined,
        "",
        attachmentResult.cleanedText || "(No ha dejado una respuesta de texto.)"
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
            `Te he enviado estos archivos:\n${sendResult.sent.map((file) => `- ${path.basename(file)}`).join("\n")}`
          );
        }

        if (sendResult.skipped.length > 0) {
          await bot.api.sendMessage(
            chatId,
            `No he podido adjuntar estos archivos:\n${sendResult.skipped
              .map((item) => `- ${item.file}: ${item.reason}`)
              .join("\n")}`
          );
        }
      }
    },
    async failed({ agent, job, error }) {
      await bot.api.sendMessage(
        chatId,
        [
          `No he podido completar la tarea con ${agent.name}.`,
          `Motivo: ${error}`,
          `Si quieres revisarlo luego, la referencia es ${job.id}.`
        ].join("\n")
      );
    },
    async delegating({ fromAgent, toAgent, message, returnToSource }) {
      await bot.api.sendMessage(
        chatId,
        [
          `${fromAgent.name} va a apoyarse en ${toAgent.name}.`,
          returnToSource ? "Despues retomara la respuesta para darte una conclusion final." : undefined,
          "",
          `Le ha pedido esto: ${truncateForTelegram(message)}`
        ]
          .filter(Boolean)
          .join("\n")
      );
    },
    async delegationFailed({ fromAgent, sourceJob, error }) {
      await bot.api.sendMessage(
        chatId,
        [
          `${fromAgent.name} intento pedir ayuda a otro agente, pero no salio bien.`,
          `Motivo: ${error}`,
          `Si quieres revisarlo luego, la referencia es ${sourceJob.id}.`
        ].join("\n")
      );
    }
  };
}

function helpText(): string {
  return [
    "Puedo ayudarte a hablar con tus agentes desde Telegram como si fuera tu asistente personal.",
    "",
    "Comandos principales:",
    "/agentes - ver que agentes tienes disponibles",
    "/habilidades [agente] - listar habilidades instaladas o las permitidas para un agente",
    "/estado <agente> - saber como va ese agente",
    "/ultimo <agente> - repasar su ultima actividad",
    "/ejecutar <agente> [--habilidades skill1,skill2] <mensaje> - continuar el hilo actual",
    "/nuevo <agente> [--habilidades skill1,skill2] <mensaje> - empezar una conversacion nueva",
    "/quiensoy - ver tu chat_id y user_id si quieres ajustar permisos",
    "",
    "Tambien puedes mencionar habilidades dentro del mensaje con $nombre, por ejemplo $aspnet-core.",
    "",
    "Tambien puedo enviarte archivos si el agente los encuentra dentro de sus rutas permitidas."
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

function parseRunCommand(text?: string): { agentId: string; prompt: string; skillIds: string[] } | undefined {
  if (!text) {
    return undefined;
  }

  const match = text.match(/^\/\w+(?:@\w+)?\s+(\S+)\s+([\s\S]+)$/);
  if (!match) {
    return undefined;
  }

  const parsedPayload = parsePromptPayload(match[2].trim());
  if (!parsedPayload.prompt) {
    return undefined;
  }

  return {
    agentId: match[1],
    prompt: parsedPayload.prompt,
    skillIds: parsedPayload.skillIds
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
  const skillsSummary =
    agent.allowedSkills.length === 0
      ? "sin acceso"
      : agent.allowedSkills.includes("*")
        ? "todas las instaladas"
        : agent.allowedSkills.join(", ");

  return [
    `${agent.name} (${agent.id})`,
    `Carpeta principal: ${agent.cwd}`,
    `Modo de trabajo: ${agent.sandbox}`,
    `Acceso web: ${agent.permissions.webAccess ? "habilitado" : "deshabilitado"}`,
    `Acceso Gmail: ${agent.permissions.gmailAccess ? "habilitado" : "deshabilitado"}`,
    `Habilidades: ${skillsSummary}`,
    `Ultimo estado: ${runtimeState?.lastRunStatus ?? "-"}`,
    `Ultima actividad: ${runtimeState?.lastRunAt ?? "-"}`,
    `Trabajo en curso: ${runtimeState?.activeJobId ?? queue.activeJobId ?? "-"}`,
    `Tareas pendientes: ${queue.pending}`,
    `Tareas en cola: ${queue.size}`,
    `Ultima referencia: ${lastJob?.id ?? "-"}`
  ].join("\n");
}

function formatLastJob(agent: AgentConfig, job: PersistedJob): string {
  return [
    `${agent.name}: ultima actividad`,
    `Referencia: ${job.id}`,
    `Estado: ${job.status}`,
    `Tipo de ejecucion: ${job.mode}`,
    `Habilidades usadas: ${job.skillIds?.length ? job.skillIds.join(", ") : "-"}`,
    `Solicitado: ${job.requestedAt}`,
    `Hilo: ${job.threadId ?? "-"}`,
    "",
    `Encargo: ${job.prompt}`,
    "",
    `Resumen: ${job.responsePreview ?? job.error ?? "-"}`
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

function formatAgentSummary(agent: AgentConfig): string {
  const skills =
    agent.allowedSkills.length === 0
      ? "sin habilidades"
      : agent.allowedSkills.includes("*")
        ? "todas las habilidades"
        : `habilidades: ${agent.allowedSkills.join(", ")}`;
  return [`- ${agent.name} (${agent.id})`, `  Trabaja desde: ${agent.cwd}`, `  ${skills}`].join("\n");
}

function parsePromptPayload(payload: string): { prompt: string; skillIds: string[] } {
  const skillIds = new Set<string>();
  let rest = payload.trim();

  while (rest.length > 0) {
    const match = rest.match(/^(--skill|--skills|--habilidad|--habilidades)\s+([^\s]+)\s*/);
    if (!match) {
      break;
    }

    for (const skillId of splitSkillIds(match[2])) {
      skillIds.add(skillId);
    }

    rest = rest.slice(match[0].length).trimStart();
  }

  const prompt = rest.trim();
  for (const skillId of extractMentionedSkillIds(prompt)) {
    skillIds.add(skillId);
  }

  return {
    prompt,
    skillIds: [...skillIds]
  };
}

function splitSkillIds(raw: string): string[] {
  return raw
    .split(",")
    .map((value) => normalizeSkillId(value))
    .filter(Boolean);
}

function extractMentionedSkillIds(prompt: string): string[] {
  return [...prompt.matchAll(/\$([a-zA-Z0-9._-]+)/g)].map((match) => normalizeSkillId(match[1]));
}

function normalizeSkillId(value: string): string {
  return value.trim().replace(/^\$/, "");
}

function formatSkillSummary(skill: SkillDefinition): string {
  const sourceLabel =
    skill.source === "repo" ? "repo" : skill.source === "plugin" ? "plugin" : "codex";
  const runtimeLabel =
    skill.runtimeSupport === "desktop-connector" ? " requiere conector Desktop" : "";
  return `- ${skill.id} (${sourceLabel})${runtimeLabel}${skill.description ? `: ${skill.description}` : ""}`;
}

function isBenignTechnicalWarning(warning: string): boolean {
  return /shell snapshot not supported yet for powershell/i.test(warning);
}
