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
    { command: "agentes", description: "Ver agentes disponibles" },
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
