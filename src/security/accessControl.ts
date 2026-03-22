import type { AgentConfig, AppConfig, AuthorizationContext } from "../types.js";

function listAllows(list: number[], value?: number): boolean {
  if (list.length === 0) {
    return true;
  }

  return value !== undefined && list.includes(value);
}

export function isGloballyAuthorized(config: AppConfig, context: AuthorizationContext): boolean {
  return (
    listAllows(config.allowedTelegramUserIds, context.userId) &&
    listAllows(config.allowedTelegramChatIds, context.chatId)
  );
}

export function isAuthorizedForAgent(agent: AgentConfig, context: AuthorizationContext): boolean {
  return (
    listAllows(agent.allowedTelegramUserIds, context.userId) &&
    listAllows(agent.allowedChatIds, context.chatId)
  );
}
