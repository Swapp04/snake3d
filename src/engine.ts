import { SoundEngine } from './audio/sound';
import { chooseDirection } from './game/autopilot';
import { makeConfig } from './game/config';
import { GameController } from './game/controller';
import { randomSeed } from './game/rng';
import { levelFor } from './game/simulation';
import type { DeathCause, Direction, GameConfig, GameEvent, GameState } from './game/types';
import type { CameraView, Insets } from './render/cameraRig';
import { GameRenderer } from './render/GameRenderer';
import { QualityGovernor } from './lib/quality';
import type { QualityLevel, QualitySetting, Settings } from './lib/settings';
import { bestKey, loadBest, saveBest, type SafeStorage } from './lib/storage';

export type Screen = 'menu' | 'playing' | 'paused' | 'over' | 'won';

export interface Snapshot {
  readonly screen: Screen;
  readonly score: number;
  readonly best: number;
  readonly length: number;
  readonly level: number;
  readonly foodEaten: number;
  readonly bonusEaten: number;
  readonly elapsedMs: number;
  readonly deathCause: DeathCause | null;
  readonly newBest: boolean;
  /** Increments on every new run; lets the UI reset per-run state. */
  readonly runId: number;
  /** Most recent points gain, for the HUD's "+N" cue. */
  readonly gain: { readonly points: number; readonly kind: 'orb' | 'bonus'; readonly id: number } | null;
  readonly quality: QualityLevel;
}

export interface EngineOptions {
  config: GameConfig;
  storage: SafeStorage;
  settings: Settings;
  reducedMotion: boolean;
  /** Fixed seed (for reproducible runs and automated tests); random when null. */
  seed: number | null;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

const START_LEAD_IN_MS = 520;
const RESUME_GRACE_MS = 300;
const DEMO_RESTART_S = 1.6;

function initialQuality(setting: QualitySetting): QualityLevel {
  if (setting !== 'auto') return setting;
  const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  const small = Math.min(window.innerWidth, window.innerHeight) < 600;
  return coarse || small ? 'medium' : 'high';
}

/**
 * Owns the game loop and wires simulation -> renderer/audio/persistence. React
 * only talks to it through commands and a cheap snapshot that changes when the
 * HUD needs to (never per frame).
 */
export class Engine {
  readonly game: GameController;
  private readonly demo: GameController;
  private readonly renderer: GameRenderer;
  private readonly sound: SoundEngine;
  private readonly bestKey: string;
  private screenIsMenu = true;
  private best: number;
  private newBest = false;
  private runId = 0;
  private gain: Snapshot['gain'] = null;
  private gainId = 0;
  private snapshot: Snapshot;
  private listeners = new Set<() => void>();
  private raf = 0;
  private last = 0;
  private clock = 0;
  private demoEndedAt = -1;
  private settings: Settings;
  private readonly governor: QualityGovernor;
  private frameEma = 16.7;
  private disposed = false;
  private unsubscribers: (() => void)[] = [];

  constructor(host: HTMLElement, private readonly opts: EngineOptions) {
    this.settings = { ...opts.settings };
    const { config } = opts;
    let seedCounter = opts.seed;
    const seedSource = () => (seedCounter === null ? randomSeed() : (seedCounter++ >>> 0));
    this.game = new GameController(config, seedSource);
    this.demo = new GameController(
      makeConfig({ ...config, startIntervalMs: 125, minIntervalMs: 125, speedupPerFoodMs: 0, bonusEvery: 0 }),
      randomSeed,
    );
    this.demo.beforeStep = (c) => c.queueDirection(chooseDirection(c.state));

    this.renderer = new GameRenderer(host, config, {
      quality: initialQuality(this.settings.quality),
      reducedMotion: opts.reducedMotion,
      onContextLost: () => {
        // Nothing can be drawn until the context returns: stop the run so the
        // player doesn't crash unseen behind the "Graphics interrupted" notice.
        this.pause();
        opts.onContextLost?.();
      },
      onContextRestored: opts.onContextRestored,
    });
    this.governor = new QualityGovernor(initialQuality('auto'));
    this.sound = new SoundEngine(this.settings.sound);
    this.bestKey = bestKey(config.cols, config.rows);
    this.best = loadBest(opts.storage, this.bestKey);
    this.snapshot = this.buildSnapshot();

    this.unsubscribers.push(this.game.subscribe((events, state) => this.onGameEvents(events, state)));
    this.unsubscribers.push(this.demo.subscribe((events, state) => this.renderer.onEvents(events, state, this.clock)));

    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('blur', this.onBlur);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- commands

  /** Starts a new run (from the menu, game over, victory, or pause). */
  play(): void {
    this.sound.unlock();
    this.sound.resetStreak();
    this.screenIsMenu = false;
    this.newBest = false;
    this.gain = null;
    this.runId++;
    this.renderer.resetRun();
    this.renderer.setView('game');
    this.game.restart(START_LEAD_IN_MS);
    this.sound.play('start');
    this.refresh();
  }

  restart(): void {
    this.play();
  }

  pause(): void {
    if (this.screenIsMenu || this.game.state.status !== 'playing') return;
    this.game.pause();
    this.sound.play('pause');
  }

  resume(): void {
    if (this.screenIsMenu || this.game.state.status !== 'paused') return;
    this.sound.unlock();
    this.game.resume(RESUME_GRACE_MS);
    this.sound.play('resume');
  }

  togglePause(): void {
    if (this.game.state.status === 'paused') this.resume();
    else this.pause();
  }

  toMenu(): void {
    if (!this.screenIsMenu && this.game.state.status === 'playing') this.game.pause();
    this.screenIsMenu = true;
    this.renderer.resetRun();
    this.renderer.setView('menu');
    this.demo.restart(300);
    this.demoEndedAt = -1;
    this.refresh();
  }

  steer(dir: Direction): void {
    if (this.screenIsMenu) return;
    this.game.queueDirection(dir);
  }

  /** Call from any user gesture so audio can start under autoplay rules. */
  unlockAudio(): void {
    this.sound.unlock();
  }

  applySettings(settings: Settings): void {
    const prev = this.settings;
    this.settings = { ...settings };
    if (prev.sound !== settings.sound) this.sound.setEnabled(settings.sound);
    if (prev.quality !== settings.quality) {
      this.renderer.setQuality(initialQuality(settings.quality));
      this.governor.reset(initialQuality('auto'));
      this.refresh();
    }
  }

  setReducedMotion(reduced: boolean): void {
    this.renderer.setReducedMotion(reduced);
  }

  setInsets(view: CameraView, insets: Insets): void {
    this.renderer.setInsets(view, insets);
  }

  // ------------------------------------------------------------------ store

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): Snapshot => this.snapshot;

  /** Diagnostics for automated tests and performance checks. */
  diagnostics() {
    return {
      state: this.game.state,
      alpha: this.game.alpha,
      screen: this.snapshot.screen,
      quality: this.renderer.getQuality(),
      drawCalls: this.renderer.drawCalls,
      triangles: this.renderer.triangles,
      frameMs: this.frameEma,
      audio: this.sound.state,
    };
  }

  private screen(): Screen {
    if (this.screenIsMenu) return 'menu';
    const s = this.game.state.status;
    return s === 'playing' ? 'playing' : s;
  }

  private buildSnapshot(): Snapshot {
    const s = this.game.state;
    const menu = this.screenIsMenu;
    return {
      screen: this.screen(),
      score: menu ? 0 : s.score,
      best: Math.max(this.best, menu ? 0 : s.score),
      length: s.snake.length,
      level: levelFor(s.config, s.foodEaten),
      foodEaten: s.foodEaten,
      bonusEaten: s.bonusEaten,
      elapsedMs: s.elapsedMs,
      deathCause: s.deathCause,
      newBest: this.newBest,
      runId: this.runId,
      gain: this.gain,
      quality: this.renderer.getQuality(),
    };
  }

  private refresh(): void {
    const next = this.buildSnapshot();
    const cur = this.snapshot;
    const changed = (Object.keys(next) as (keyof Snapshot)[]).some((k) => next[k] !== cur[k]);
    if (!changed) return;
    this.snapshot = next;
    for (const l of this.listeners) l();
  }

  // ------------------------------------------------------------------- loop

  private onGameEvents(events: readonly GameEvent[], state: GameState): void {
    if (this.screenIsMenu) return;
    this.renderer.onEvents(events, state, this.clock);
    for (const e of events) {
      switch (e.type) {
        case 'eat':
          this.sound.play('eat');
          this.vibrate(8);
          this.gain = { points: e.points, kind: 'orb', id: ++this.gainId };
          break;
        case 'bonus':
          this.sound.play('bonus');
          this.vibrate([8, 30, 8]);
          this.gain = { points: e.points, kind: 'bonus', id: ++this.gainId };
          break;
        case 'levelUp':
          this.sound.play('levelUp');
          break;
        case 'die':
          this.sound.play('gameOver');
          this.vibrate(60);
          this.recordBest(state.score);
          break;
        case 'win':
          this.sound.play('victory');
          this.vibrate([20, 40, 20, 40, 60]);
          this.recordBest(state.score);
          break;
        default:
          break;
      }
    }
    this.refresh();
  }

  private recordBest(score: number): void {
    const before = this.best;
    this.best = saveBest(this.opts.storage, this.bestKey, score);
    this.newBest = score > 0 && score > before;
  }

  private vibrate(pattern: number | number[]): void {
    if (!this.settings.haptics) return;
    try {
      navigator.vibrate?.(pattern);
    } catch {
      /* unsupported */
    }
  }

  private loop = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const raw = this.last ? now - this.last : 16.7;
    this.last = now;
    const dt = Math.min(100, Math.max(0, raw));
    this.clock += dt / 1000;

    const workStart = performance.now();
    const active = this.screenIsMenu ? this.demo : this.game;
    active.update(dt);
    if (this.screenIsMenu) {
      const st = this.demo.state.status;
      if (st === 'over' || st === 'won') {
        if (this.demoEndedAt < 0) this.demoEndedAt = this.clock;
        else if (this.clock - this.demoEndedAt > DEMO_RESTART_S) {
          this.demo.restart(200);
          this.renderer.resetRun();
          this.demoEndedAt = -1;
        }
      }
    }

    this.renderer.frame(
      { view: this.screenIsMenu ? 'menu' : 'game', state: active.state, prevSnake: active.prevSnake, alpha: active.alpha },
      dt / 1000,
      this.clock,
    );
    this.adaptQuality(raw, performance.now() - workStart);
    // Status changes driven purely by commands (pause/resume) are picked up here.
    if (this.snapshot.screen !== this.screen()) this.refresh();
  };

  /** In "auto" quality, let the governor step tiers down (or back up) based on real frame cost. */
  private adaptQuality(intervalMs: number, workMs: number): void {
    if (intervalMs > 0 && intervalMs < 250) this.frameEma += (intervalMs - this.frameEma) * 0.05;
    if (this.settings.quality !== 'auto' || document.hidden) return;
    const next = this.governor.sample(intervalMs, workMs, this.renderer.getQuality());
    if (next) {
      this.renderer.setQuality(next);
      this.refresh();
    }
  }

  private onVisibility = (): void => {
    this.last = 0;
    if (document.hidden) this.pause();
  };

  private onBlur = (): void => {
    this.last = 0;
    this.pause();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('blur', this.onBlur);
    for (const u of this.unsubscribers) u();
    this.listeners.clear();
    this.renderer.dispose();
    this.sound.dispose();
  }
}
