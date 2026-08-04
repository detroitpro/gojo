type LockChain = Promise<void>;

export class MergeQueue {
  private readonly locks = new Map<string, LockChain>();

  async withLock<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(projectId) ?? Promise.resolve();

    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });

    const chain = previous.then(() => current);
    this.locks.set(projectId, chain);

    await previous;

    try {
      return await fn();
    } finally {
      release();
      if (this.locks.get(projectId) === chain) {
        this.locks.delete(projectId);
      }
    }
  }
}
