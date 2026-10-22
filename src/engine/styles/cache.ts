// Per-object cache of generated drawables. One entry per object id, tagged with a
// key built from everything the output depends on (geometry, seed, effective
// style + version, stroke/fill options). A lookup with the same key returns the
// very same array; any change in the key regenerates. Doc evicts on delete.

export class DrawableCache<T> {
  private entries = new Map<string, { key: string; value: T }>();

  get(id: string, key: string, make: () => T): T {
    const hit = this.entries.get(id);
    if (hit && hit.key === key) return hit.value;
    const value = make();
    this.entries.set(id, { key, value });
    return value;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  evict(id: string) {
    this.entries.delete(id);
  }

  clear() {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }
}
