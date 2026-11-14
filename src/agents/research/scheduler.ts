/**
 * Lightweight research task scheduler: at most `limit` workers run at once.
 * Waiting tasks start in FIFO order, except that user-initiated actions
 * (Deep Dive, Challenge, ...) jump ahead of queued automatic branch research.
 */
export const BRANCH_CONCURRENCY = 3;

export type TaskPriority = "user" | "auto";

export class BranchScheduler {
  private active = 0;
  private user: (() => void)[] = [];
  private auto: (() => void)[] = [];

  constructor(private readonly limit = BRANCH_CONCURRENCY) {}

  async run<T>(task: () => Promise<T>, priority: TaskPriority = "auto"): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this[priority].push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      (this.user.shift() ?? this.auto.shift())?.();
    }
  }
}

/** Shared by every run in this server process, so all research competes for the same workers. */
export const researchScheduler = new BranchScheduler();
