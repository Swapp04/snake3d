import type { QualityLevel } from './settings';

const ORDER: readonly QualityLevel[] = ['low', 'medium', 'high'];

/** A steady 30 fps (display caps, low-power modes) is healthy; below ~25 fps is not. */
const SLOW_INTERVAL_MS = 40;
/** CPU time per frame (simulation + scene submission) considered too heavy. */
const SLOW_WORK_MS = 12;
const COMFY_INTERVAL_MS = 20;
const COMFY_WORK_MS = 5;
const SLOW_WINDOW_MS = 2500;
const COMFY_WINDOW_MS = 30_000;
const COOLDOWN_MS = 4000;
/** A tier that has failed this many times is never retried, so tiers can't oscillate. */
const MAX_FAILURES = 2;
/** Longer gaps are hitches (tab switch, GC, alert), not a trend. */
const HITCH_MS = 250;

/**
 * Decides when "Auto" graphics quality should step down (sustained slow frames
 * or heavy per-frame work) or back up (a long stretch of comfortable frames).
 * Pure and time-agnostic: it only sees the samples it is fed.
 */
export class QualityGovernor {
  private emaInterval = 16.7;
  private emaWork = 2;
  private slowFor = 0;
  private comfyFor = 0;
  private sinceChange = COOLDOWN_MS;
  private failures: Record<QualityLevel, number> = { low: 0, medium: 0, high: 0 };

  constructor(private ceiling: QualityLevel) {}

  /** Restart measurement, e.g. after the player picks Auto again. */
  reset(ceiling: QualityLevel): void {
    this.ceiling = ceiling;
    this.emaInterval = 16.7;
    this.emaWork = 2;
    this.slowFor = 0;
    this.comfyFor = 0;
    this.sinceChange = COOLDOWN_MS;
    this.failures = { low: 0, medium: 0, high: 0 };
  }

  /** Feeds one frame. Returns the level to switch to, or null to stay. */
  sample(intervalMs: number, workMs: number, current: QualityLevel): QualityLevel | null {
    if (!(intervalMs > 0) || intervalMs > HITCH_MS) return null;
    this.sinceChange += intervalMs;
    this.emaInterval += (intervalMs - this.emaInterval) * 0.05;
    this.emaWork += (Math.max(0, workMs) - this.emaWork) * 0.05;

    const slow = this.emaInterval > SLOW_INTERVAL_MS || this.emaWork > SLOW_WORK_MS;
    const comfy = this.emaInterval < COMFY_INTERVAL_MS && this.emaWork < COMFY_WORK_MS;
    this.slowFor = slow ? this.slowFor + intervalMs : Math.max(0, this.slowFor - intervalMs);
    this.comfyFor = comfy ? this.comfyFor + intervalMs : 0;
    if (this.sinceChange < COOLDOWN_MS) return null;

    const index = ORDER.indexOf(current);
    if (this.slowFor > SLOW_WINDOW_MS && index > 0) {
      this.failures[current]++;
      return this.change(ORDER[index - 1]!);
    }
    const up = ORDER[index + 1];
    if (up && this.comfyFor > COMFY_WINDOW_MS && index < ORDER.indexOf(this.ceiling) && this.failures[up] < MAX_FAILURES) {
      return this.change(up);
    }
    return null;
  }

  private change(level: QualityLevel): QualityLevel {
    this.sinceChange = 0;
    this.slowFor = 0;
    this.comfyFor = 0;
    this.emaInterval = 16.7;
    this.emaWork = 2;
    return level;
  }
}
