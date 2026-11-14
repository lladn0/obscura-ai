/**
 * Lightweight FIFO task scheduler: at most `limit` branch workers run at once;
 * further tasks wait in arrival order and start as slots free up.
 */
export const BRANCH_CONCURRENCY = 3;

export class BranchScheduler {
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private readonly limit = BRANCH_CONCURRENCY) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) await new Promise<void>((resolve) => this.waiting.push(resolve));
    this.active++;
    try {
      return await task();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }
}
