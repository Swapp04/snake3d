import { describe, expect, it } from 'vitest';
import { actionForKey, SwipeTracker } from '../src/game/input';
import { DEFAULT_SETTINGS, loadSettings, parseSettings, saveSettings } from '../src/lib/settings';
import { shareScore, shareText } from '../src/lib/share';
import { bestKey, loadBest, SafeStorage, saveBest, type KeyValueStore } from '../src/lib/storage';

class MemoryStore implements KeyValueStore {
  data = new Map<string, string>();
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

class ThrowingStore implements KeyValueStore {
  getItem(): string | null {
    throw new Error('SecurityError');
  }
  setItem(): void {
    throw new Error('QuotaExceededError');
  }
  removeItem(): void {
    throw new Error('SecurityError');
  }
}

describe('personal best', () => {
  const key = bestKey(16, 16);

  it('persists and only increases', () => {
    const backend = new MemoryStore();
    const storage = new SafeStorage(backend);
    expect(loadBest(storage, key)).toBe(0);
    expect(saveBest(storage, key, 120)).toBe(120);
    expect(saveBest(storage, key, 80)).toBe(120);
    // A fresh wrapper over the same backend simulates a page refresh.
    expect(loadBest(new SafeStorage(backend), key)).toBe(120);
  });

  it.each(['abc', '-5', '1e9', '12.5', '', 'NaN', '{"a":1}', '999999999999'])('rejects corrupted value %j', (raw) => {
    const backend = new MemoryStore();
    backend.setItem(key, raw);
    expect(loadBest(new SafeStorage(backend), key)).toBe(0);
  });

  it('keeps working when storage throws', () => {
    const storage = new SafeStorage(new ThrowingStore());
    expect(loadBest(storage, key)).toBe(0);
    expect(saveBest(storage, key, 50)).toBe(50);
    expect(loadBest(storage, key)).toBe(50); // memory fallback for this session
  });

  it('keeps working with no storage at all', () => {
    const storage = new SafeStorage(null);
    saveBest(storage, key, 30);
    expect(loadBest(storage, key)).toBe(30);
  });

  it('separates bests by board size', () => {
    expect(bestKey(16, 16)).not.toBe(bestKey(8, 8));
  });
});

describe('settings', () => {
  it('round-trips', () => {
    const storage = new SafeStorage(new MemoryStore());
    const s = { sound: false, quality: 'low' as const, motion: 'reduced' as const, haptics: false };
    saveSettings(storage, s);
    expect(loadSettings(storage)).toEqual(s);
  });

  it('falls back to defaults for corrupt JSON and wrong shapes', () => {
    for (const raw of [null, '', '{', '[]', '42', 'null', '"x"']) expect(parseSettings(raw)).toEqual(DEFAULT_SETTINGS);
  });

  it('validates each field independently', () => {
    expect(parseSettings('{"sound":false,"quality":"ultra","motion":7}')).toEqual({ ...DEFAULT_SETTINGS, sound: false });
  });
});

describe('keyboard mapping', () => {
  it('maps arrows and WASD to directions', () => {
    expect(actionForKey('ArrowUp')).toEqual({ kind: 'direction', dir: 'up' });
    expect(actionForKey('KeyA')).toEqual({ kind: 'direction', dir: 'left' });
    expect(actionForKey('KeyS')).toEqual({ kind: 'direction', dir: 'down' });
    expect(actionForKey('KeyD')).toEqual({ kind: 'direction', dir: 'right' });
    expect(actionForKey('Space')).toEqual({ kind: 'pause' });
    expect(actionForKey('KeyQ')).toBeNull();
  });
});

describe('swipe tracker', () => {
  it('recognises swipes past the threshold and re-anchors for chained turns', () => {
    const t = new SwipeTracker(20);
    t.start(100, 100);
    expect(t.move(110, 102)).toBeNull();
    expect(t.move(130, 104)).toBe('right');
    expect(t.move(131, 140)).toBe('down');
    expect(t.move(100, 141)).toBe('left');
    t.end();
    expect(t.move(0, 0)).toBeNull();
  });

  it('follows only the first finger; a resting second finger is ignored', () => {
    const t = new SwipeTracker(20);
    t.start(100, 100, 1); // steering thumb
    t.start(300, 400, 2); // resting thumb must not re-anchor
    expect(t.move(300, 300, 2)).toBeNull(); // its movement is ignored
    expect(t.move(130, 100, 1)).toBe('right');
    t.end(2); // lifting the other finger doesn't end the swipe
    expect(t.move(130, 140, 1)).toBe('down');
    t.end(1);
    expect(t.move(130, 200, 1)).toBeNull();
    t.start(0, 0, 3); // a new swipe can begin afterwards
    expect(t.move(0, -40, 3)).toBe('up');
  });

  it('ignores ambiguous diagonal drags', () => {
    const t = new SwipeTracker(20);
    t.start(0, 0);
    expect(t.move(30, 28)).toBeNull();
  });
});

describe('share', () => {
  const text = shareText(120, 14, false);

  it('uses the native share sheet when available', async () => {
    let shared: ShareData | null = null;
    const outcome = await shareScore(text, 'https://x.test', { share: async (d) => void (shared = d) });
    expect(outcome).toBe('shared');
    expect(shared).toMatchObject({ text, url: 'https://x.test' });
  });

  it('reports cancellation honestly', async () => {
    const abort = Object.assign(new Error('cancel'), { name: 'AbortError' });
    expect(await shareScore(text, 'u', { share: () => Promise.reject(abort) })).toBe('cancelled');
  });

  it('falls back to the clipboard, then legacy copy, then failure', async () => {
    let copied = '';
    expect(await shareScore(text, 'u', { writeClipboard: async (t) => void (copied = t) })).toBe('copied');
    expect(copied).toContain('120');
    expect(await shareScore(text, 'u', { writeClipboard: () => Promise.reject(new Error()), legacyCopy: () => true })).toBe('copied');
    expect(await shareScore(text, 'u', { legacyCopy: () => false })).toBe('failed');
    expect(await shareScore(text, 'u', {})).toBe('failed');
  });

  it('mentions victory distinctly', () => {
    expect(shareText(900, 256, true)).toContain('cleared the board');
  });
});
