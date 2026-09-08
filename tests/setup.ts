// Node 22 exposes a partial global `localStorage` without a storage file;
// jsdom leaves `window.localStorage` undefined in that case. Keep package
// tests deterministic and browser-like without requiring a host-specific
// `--localstorage-file` flag.
if (typeof window !== 'undefined' && window.localStorage === undefined) {
  class MemoryStorage implements Storage {
    private readonly values = new Map<string, string>()

    get length(): number {
      return this.values.size
    }

    clear(): void {
      this.values.clear()
    }

    getItem(key: string): string | null {
      return this.values.get(String(key)) ?? null
    }

    key(index: number): string | null {
      return [...this.values.keys()][index] ?? null
    }

    removeItem(key: string): void {
      this.values.delete(String(key))
    }

    setItem(key: string, value: string): void {
      this.values.set(String(key), String(value))
    }
  }

  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: new MemoryStorage(),
  })
}
