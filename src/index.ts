import { AgentRegistry } from "./agents/agentRegistry.js";
import { CodexAppServerAdapter } from "./codex/codexAppServerAdapter.js";
import { loadAppConfig } from "./config.js";
import { CodexCliAdapter } from "./codex/codexCliAdapter.js";
import { GmailService } from "./gmail/gmailService.js";
import { createLogger } from "./logger.js";
import { AgentTaskQueue } from "./queue/agentTaskQueue.js";
import { AgentExecutionService } from "./services/agentExecutionService.js";
import { SkillRegistry } from "./skills/skillRegistry.js";
import { JsonStateStore } from "./store/jsonStateStore.js";
import { createTelegramBot } from "./telegram/bot.js";

async function main() {
  const config = loadAppConfig();
  const logger = createLogger(config.logLevel);
  const registry = await AgentRegistry.load(config.agentsFile);
  const skillRegistry = await SkillRegistry.load(process.cwd());
  const store = new JsonStateStore(config.stateFile);
  await store.ensure();
  const gmailService = new GmailService(config, logger);

  const queue = new AgentTaskQueue();
  const appServerAdapter = new CodexAppServerAdapter(config.codexBin, logger);
  const cliAdapter = new CodexCliAdapter(config.codexBin, logger);
  const executionService = new AgentExecutionService(
    config,
    registry,
    skillRegistry,
    gmailService,
    store,
    queue,
    appServerAdapter,
    cliAdapter,
    logger
  );
  const bot = createTelegramBot({
    config,
    registry,
    skillRegistry,
    executionService,
    logger
  });

  await bot.api.setMyCommands([
    { command: "agentes", description: "Ver agentes disponibles" },
    { command: "habilidades", description: "Ver habilidades disponibles" },
    { command: "estado", description: "Consultar el estado de un agente" },
    { command: "ultimo", description: "Ver la ultima actividad" },
    { command: "ejecutar", description: "Continuar el hilo actual" },
    { command: "nuevo", description: "Empezar una conversacion nueva" },
    { command: "quiensoy", description: "Ver chat_id y user_id" },
    { command: "ayuda", description: "Mostrar ayuda" }
  ]);

  logger.info(
    {
      agents: registry.getAll().map((agent) => agent.id),
      transport: config.codexTransport,
      agentsFile: config.agentsFile,
      stateFile: config.stateFile
    },
    "starting telegram bridge"
  );

  await bot.start();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
