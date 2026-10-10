/** Minimal subset of the Web Storage API, so tests can inject a fake. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Falls back to memory when localStorage is missing, blocked, or full. */
export class SafeStorage {
  private memory = new Map<string, string>();

  constructor(private readonly backend: KeyValueStore | null) {}

  static fromWindow(): SafeStorage {
    try {
      const ls = typeof window !== 'undefined' ? window.localStorage : null;
      if (ls) {
        const probe = '__snake3_probe__';
        ls.setItem(probe, '1');
        ls.removeItem(probe);
      }
      return new SafeStorage(ls);
    } catch {
      return new SafeStorage(null);
    }
  }

  get(key: string): string | null {
    try {
      const value = this.backend?.getItem(key);
      if (value !== null && value !== undefined) return value;
    } catch {
      /* fall through to memory */
    }
    return this.memory.get(key) ?? null;
  }

  set(key: string, value: string): void {
    this.memory.set(key, value);
    try {
      this.backend?.setItem(key, value);
    } catch {
      /* quota exceeded or blocked: memory copy keeps this session consistent */
    }
  }
}

const MAX_PLAUSIBLE_SCORE = 10_000_000;

export function bestKey(cols: number, rows: number): string {
  return `snake3.best.${cols}x${rows}`;
}

export function loadBest(storage: SafeStorage, key: string): number {
  const raw = storage.get(key);
  if (raw === null || !/^\d{1,8}$/.test(raw.trim())) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value <= MAX_PLAUSIBLE_SCORE ? value : 0;
}

/** Stores the score if it beats the current best. Returns the resulting best. */
export function saveBest(storage: SafeStorage, key: string, score: number): number {
  const current = loadBest(storage, key);
  if (!Number.isSafeInteger(score) || score <= current || score > MAX_PLAUSIBLE_SCORE) return current;
  storage.set(key, String(score));
  return score;
}
