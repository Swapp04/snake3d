import { createGame, currentInterval, pause, queueDirection, resume, step } from './simulation';
import type { Cell, Direction, GameConfig, GameEvent, GameState } from './types';

/** Longest frame delta we accept, so a stalled tab can never fast-forward the snake. */
export const MAX_FRAME_MS = 100;
/** Hard cap on simulation ticks per frame (the "spiral of death" guard). */
export const MAX_STEPS_PER_FRAME = 2;

export type ControllerListener = (events: readonly GameEvent[], state: GameState) => void;

/**
 * Fixed-timestep driver around the pure simulation. Owns the accumulator and the
 * previous snake snapshot that the renderer interpolates from.
 */
export class GameController {
  state: GameState;
  /** Snake before the most recent tick; render position = lerp(prevSnake, snake, alpha). */
  prevSnake: readonly Cell[];
  private accumulator = 0;
  /** Real time to wait before the simulation runs again (e.g. a grace period after resuming). */
  private holdMs = 0;
  private listeners = new Set<ControllerListener>();
  /** Called right before each tick; the demo autopilot steers through this. */
  beforeStep: ((controller: GameController) => void) | null = null;

  constructor(
    readonly config: GameConfig,
    private readonly seedSource: () => number,
  ) {
    this.state = createGame(config, seedSource());
    this.prevSnake = this.state.snake;
  }

  /** Starts a fresh run. `leadInMs` holds the snake still briefly before the first tick. */
  restart(leadInMs = 0): void {
    this.state = createGame(this.config, this.seedSource());
    this.prevSnake = this.state.snake;
    this.accumulator = 0;
    this.holdMs = Math.max(0, leadInMs);
    this.emit([]);
  }

  subscribe(listener: ControllerListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  queueDirection(dir: Direction): void {
    this.state = queueDirection(this.state, dir);
  }

  pause(): void {
    const next = pause(this.state);
    if (next !== this.state) {
      this.state = next;
      this.emit([]);
    }
  }

  /** Resumes after a pause; `graceMs` gives the player a beat to re-orient. */
  resume(graceMs = 0): void {
    const next = resume(this.state);
    if (next !== this.state) {
      this.state = next;
      this.holdMs = Math.max(this.holdMs, graceMs);
      this.emit([]);
    }
  }

  /** Interpolation factor between prevSnake and snake, in [0, 1]. */
  get alpha(): number {
    const interval = currentInterval(this.state);
    return Math.min(1, Math.max(0, this.accumulator / interval));
  }

  /** Advances real time. Returns every event produced during this frame. */
  update(frameMs: number): GameEvent[] {
    const dt = Math.min(MAX_FRAME_MS, Math.max(0, Number.isFinite(frameMs) ? frameMs : 0));
    const status = this.state.status;
    if (status === 'paused') return [];
    if (status === 'over' || status === 'won') {
      // Let the final movement finish easing into its cell, then rest.
      this.accumulator = Math.min(currentInterval(this.state), this.accumulator + dt);
      return [];
    }

    let remaining = dt;
    if (this.holdMs > 0) {
      const used = Math.min(this.holdMs, remaining);
      this.holdMs -= used;
      remaining -= used;
    }
    this.accumulator += remaining;
    const frameEvents: GameEvent[] = [];
    let steps = 0;
    while (this.state.status === 'playing' && steps < MAX_STEPS_PER_FRAME) {
      const interval = currentInterval(this.state);
      if (this.accumulator < interval) break;
      this.beforeStep?.(this);
      this.accumulator -= interval;
      const before = this.state.snake;
      const result = step(this.state);
      this.state = result.state;
      if (this.state.status === 'playing' || this.state.status === 'won') {
        this.prevSnake = before;
      }
      if (this.state.status !== 'playing') {
        // Death keeps the previous snapshot and parks the interpolation at its end,
        // so the snake rests exactly where it collided instead of popping.
        this.accumulator = this.state.status === 'over' ? currentInterval(this.state) : 0;
      }
      frameEvents.push(...result.events);
      steps++;
    }
    if (steps === MAX_STEPS_PER_FRAME && this.state.status === 'playing') {
      this.accumulator = Math.min(this.accumulator, currentInterval(this.state) * 0.5);
    }
    if (frameEvents.length > 0) this.emit(frameEvents);
    return frameEvents;
  }

  private emit(events: readonly GameEvent[]): void {
    for (const listener of this.listeners) listener(events, this.state);
  }
}
