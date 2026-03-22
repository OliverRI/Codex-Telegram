import fs from "node:fs/promises";
import path from "node:path";
import type { AgentRuntimeState, PersistedJob, PersistedState } from "../types.js";

const EMPTY_STATE: PersistedState = {
  agents: {},
  jobs: {}
};

export class JsonStateStore {
  private writeChain: Promise<void> = Promise.resolve();

  constructor(private readonly stateFile: string) {}

  async ensure(): Promise<void> {
    await fs.mkdir(path.dirname(this.stateFile), { recursive: true });

    try {
      await fs.access(this.stateFile);
    } catch {
      await this.writeState(EMPTY_STATE);
    }
  }

  async readState(): Promise<PersistedState> {
    await this.ensure();
    const raw = await fs.readFile(this.stateFile, "utf8");
    return JSON.parse(raw) as PersistedState;
  }

  async getAgentState(agentId: string): Promise<AgentRuntimeState | undefined> {
    const state = await this.readState();
    return state.agents[agentId];
  }

  async upsertJob(job: PersistedJob): Promise<void> {
    await this.mutate((state) => {
      state.jobs[job.id] = job;
    });
  }

  async patchAgentState(agentId: string, patch: Partial<AgentRuntimeState>): Promise<void> {
    await this.mutate((state) => {
      state.agents[agentId] = {
        ...(state.agents[agentId] ?? {}),
        ...patch
      };
    });
  }

  async mutate(mutator: (state: PersistedState) => void): Promise<void> {
    await this.enqueueWrite(async () => {
      const state = await this.readState();
      mutator(state);
      await this.writeState(state);
    });
  }

  private async writeState(state: PersistedState): Promise<void> {
    const tempFile = `${this.stateFile}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(state, null, 2), "utf8");
    await fs.rm(this.stateFile, { force: true });
    await fs.rename(tempFile, this.stateFile);
  }

  private async enqueueWrite(operation: () => Promise<void>): Promise<void> {
    const next = this.writeChain.then(operation);
    this.writeChain = next.catch(() => undefined);
    await next;
  }
}
