import { AgentRegistry } from "./agents/agentRegistry.js";
import { loadAppConfig } from "./config.js";
import { CodexCliAdapter } from "./codex/codexCliAdapter.js";
import { createLogger } from "./logger.js";
import { AgentTaskQueue } from "./queue/agentTaskQueue.js";
import { AgentExecutionService } from "./services/agentExecutionService.js";
import { JsonStateStore } from "./store/jsonStateStore.js";
import { createTelegramBot } from "./telegram/bot.js";

async function main() {
  const config = loadAppConfig();
  const logger = createLogger(config.logLevel);
  const registry = await AgentRegistry.load(config.agentsFile);
  const store = new JsonStateStore(config.stateFile);
  await store.ensure();

  const queue = new AgentTaskQueue();
  const adapter = new CodexCliAdapter(config.codexBin, logger);
  const executionService = new AgentExecutionService(config, registry, store, queue, adapter, logger);
  const bot = createTelegramBot({
    config,
    registry,
    executionService,
    logger
  });

  await bot.api.setMyCommands([
    { command: "agents", description: "Lista agentes disponibles" },
    { command: "status", description: "Estado de un agente" },
    { command: "last", description: "Ultima ejecucion registrada" },
    { command: "run", description: "Ejecuta usando el hilo existente" },
    { command: "new", description: "Ejecuta con hilo nuevo" },
    { command: "whoami", description: "Muestra chat_id y user_id" },
    { command: "help", description: "Muestra ayuda" }
  ]);

  logger.info(
    {
      agents: registry.getAll().map((agent) => agent.id),
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
