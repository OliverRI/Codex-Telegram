import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { AgentConfig } from "../types.js";

const agentSchema = z.object({
  id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/),
  name: z.string().min(1),
  cwd: z.string().min(1),
  model: z.string().min(1).optional(),
  profile: z.string().min(1).optional(),
  sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).default("workspace-write"),
  skipGitRepoCheck: z.boolean().default(false),
  fullAuto: z.boolean().default(true),
  forceNewThreadOnEachRun: z.boolean().default(false),
  allowedTelegramUserIds: z.array(z.number().int()).default([]),
  allowedChatIds: z.array(z.number().int()).default([]),
  extraArgs: z.array(z.string()).default([])
});

const agentsFileSchema = z.object({
  agents: z.array(agentSchema)
});

export class AgentRegistry {
  private readonly byId: Map<string, AgentConfig>;

  private constructor(agents: AgentConfig[]) {
    this.byId = new Map(agents.map((agent) => [agent.id, agent]));
  }

  static async load(agentsFile: string): Promise<AgentRegistry> {
    const content = await fs.readFile(agentsFile, "utf8");
    const parsed = agentsFileSchema.parse(JSON.parse(content));
    const agents: AgentConfig[] = parsed.agents.map((agent) => ({
      ...agent,
      cwd: path.isAbsolute(agent.cwd) ? agent.cwd : path.resolve(process.cwd(), agent.cwd)
    }));

    return new AgentRegistry(agents);
  }

  getAll(): AgentConfig[] {
    return [...this.byId.values()];
  }

  getById(id: string): AgentConfig | undefined {
    return this.byId.get(id);
  }
}
