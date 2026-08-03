export type TutorialStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export class PersistentTutorialCompletions<TutorialId extends string> {
  private readonly completed = new Set<TutorialId>();
  private readonly storage: () => TutorialStorage;
  private readonly storageKey: string;
  private readonly isTutorialId: (value: string) => value is TutorialId;

  constructor(
    storage: () => TutorialStorage,
    storageKey: string,
    isTutorialId: (value: string) => value is TutorialId,
  ) {
    this.storage = storage;
    this.storageKey = storageKey;
    this.isTutorialId = isTutorialId;
    this.load();
  }

  has(id: TutorialId): boolean {
    return this.completed.has(id);
  }

  complete(id: TutorialId): void {
    this.completed.add(id);
    this.save();
  }

  clear(): void {
    this.completed.clear();
    this.save();
  }

  private load(): void {
    try {
      const stored = this.storage().getItem(this.storageKey);
      if (!stored) return;
      const ids: unknown = JSON.parse(stored);
      if (!Array.isArray(ids)) return;
      for (const id of ids) {
        if (typeof id === 'string' && this.isTutorialId(id)) this.completed.add(id);
      }
    } catch {
      // Ignore malformed data and unavailable storage; tutorials remain usable.
    }
  }

  private save(): void {
    try {
      this.storage().setItem(this.storageKey, JSON.stringify([...this.completed]));
    } catch {
      // Storage can be unavailable in private or sandboxed browser contexts.
    }
  }
}
