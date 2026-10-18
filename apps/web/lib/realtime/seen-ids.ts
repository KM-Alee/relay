// Bounded "have I seen this event id" set for dedupe (polls overlap on purpose). T-009 [Q11]
export class SeenIds {
  private readonly ids = new Set<string>();
  constructor(private readonly max = 500) {}

  /** Records `id`; returns true when it is NEW (false = duplicate, skip it). */
  add(id: string): boolean {
    if (this.ids.has(id)) return false;
    this.ids.add(id);
    if (this.ids.size > this.max) {
      // Sets iterate in insertion order: drop the oldest.
      const oldest = this.ids.values().next().value;
      if (oldest !== undefined) this.ids.delete(oldest);
    }
    return true;
  }

  get size(): number {
    return this.ids.size;
  }
}
