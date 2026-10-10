import type { Direction } from './types';

export type KeyAction =
  | { kind: 'direction'; dir: Direction }
  | { kind: 'pause' }
  | { kind: 'confirm' }
  | { kind: 'mute' }
  | { kind: 'back' };

const KEY_MAP: Record<string, KeyAction> = {
  ArrowUp: { kind: 'direction', dir: 'up' },
  ArrowDown: { kind: 'direction', dir: 'down' },
  ArrowLeft: { kind: 'direction', dir: 'left' },
  ArrowRight: { kind: 'direction', dir: 'right' },
  KeyW: { kind: 'direction', dir: 'up' },
  KeyS: { kind: 'direction', dir: 'down' },
  KeyA: { kind: 'direction', dir: 'left' },
  KeyD: { kind: 'direction', dir: 'right' },
  Space: { kind: 'pause' },
  KeyP: { kind: 'pause' },
  Escape: { kind: 'back' },
  Enter: { kind: 'confirm' },
  NumpadEnter: { kind: 'confirm' },
  KeyR: { kind: 'confirm' },
  KeyM: { kind: 'mute' },
};

/** Maps a KeyboardEvent.code (layout independent, so WASD works on AZERTY too). */
export function actionForKey(code: string): KeyAction | null {
  return KEY_MAP[code] ?? null;
}

/**
 * Turns pointer movement into discrete swipes. The origin re-anchors after each
 * recognised swipe, so a player can chain turns without lifting their finger.
 * Only the first finger down is followed; extra fingers are ignored until it lifts.
 */
export class SwipeTracker {
  private originX = 0;
  private originY = 0;
  private pointerId: number | null = null;

  constructor(private readonly threshold = 26) {}

  start(x: number, y: number, pointerId = 0): void {
    if (this.pointerId !== null) return;
    this.originX = x;
    this.originY = y;
    this.pointerId = pointerId;
  }

  move(x: number, y: number, pointerId = 0): Direction | null {
    if (this.pointerId === null || pointerId !== this.pointerId) return null;
    const dx = x - this.originX;
    const dy = y - this.originY;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < this.threshold) return null;
    // Require a clear dominant axis so diagonal drags don't produce noise.
    if (Math.max(ax, ay) < Math.min(ax, ay) * 1.2) return null;
    this.originX = x;
    this.originY = y;
    if (ax > ay) return dx > 0 ? 'right' : 'left';
    return dy > 0 ? 'down' : 'up';
  }

  end(pointerId = 0): void {
    if (pointerId === this.pointerId) this.pointerId = null;
  }
}
