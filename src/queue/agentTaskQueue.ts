import PQueue from "p-queue";
import type { QueueSnapshot } from "../types.js";

export class AgentTaskQueue {
  private readonly queues = new Map<string, PQueue>();
  private readonly activeJobs = new Map<string, string>();

  enqueue<T>(agentId: string, jobId: string, task: () => Promise<T>) {
    const queue = this.getQueue(agentId);
    const snapshotBefore = this.snapshot(agentId);

    const runPromise = queue.add(async () => {
      this.activeJobs.set(agentId, jobId);

      try {
        return await task();
      } finally {
        this.activeJobs.delete(agentId);
      }
    });

    return {
      promise: runPromise,
      position: snapshotBefore.pending + snapshotBefore.size + 1
    };
  }

  snapshot(agentId: string): QueueSnapshot {
    const queue = this.getQueue(agentId);
    return {
      agentId,
      pending: queue.pending,
      size: queue.size,
      activeJobId: this.activeJobs.get(agentId)
    };
  }

  private getQueue(agentId: string): PQueue {
    let queue = this.queues.get(agentId);
    if (!queue) {
      queue = new PQueue({ concurrency: 1 });
      this.queues.set(agentId, queue);
    }

    return queue;
  }
}
