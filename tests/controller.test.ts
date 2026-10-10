import { describe, expect, it } from 'vitest';
import { chooseDirection } from '../src/game/autopilot';
import { makeConfig } from '../src/game/config';
import { GameController, MAX_FRAME_MS } from '../src/game/controller';
import { createGame, step } from '../src/game/simulation';
import type { GameEvent } from '../src/game/types';

const config = makeConfig({ cols: 12, rows: 12, bonusEvery: 0 });
const interval = config.startIntervalMs;

function make(seed = 3) {
  return new GameController(config, () => seed);
}

describe('GameController fixed timestep', () => {
  it('advances one cell per interval regardless of frame rate', () => {
    const a = make();
    const b = make();
    // 60 fps vs 144 fps over the same wall time
    for (let t = 0; t < interval * 4; t += 1000 / 60) a.update(1000 / 60);
    for (let t = 0; t < interval * 4; t += 1000 / 144) b.update(1000 / 144);
    expect(a.state.tick).toBe(b.state.tick);
    expect(a.state.snake).toEqual(b.state.snake);
  });

  it('clamps huge frame deltas so a resumed tab cannot fast-forward', () => {
    const c = make();
    const head = c.state.snake[0]!;
    c.update(60_000);
    expect(c.state.tick).toBeLessThanOrEqual(1);
    expect(MAX_FRAME_MS).toBeLessThan(interval);
    expect(Math.abs(c.state.snake[0]!.x - head.x)).toBeLessThanOrEqual(1);
  });

  it('exposes an interpolation alpha in [0,1]', () => {
    const c = make();
    c.update(interval / 4);
    c.update(interval / 4);
    expect(c.alpha).toBeCloseTo(0.5, 5);
    c.update(interval / 4);
    c.update(interval / 4 + 1);
    expect(c.state.tick).toBe(1);
    expect(c.alpha).toBeGreaterThanOrEqual(0);
    expect(c.alpha).toBeLessThan(0.1);
  });

  it('pause freezes simulation and interpolation; resume continues', () => {
    const c = make();
    c.update(interval * 0.3);
    c.pause();
    const alpha = c.alpha;
    for (let i = 0; i < 50; i++) c.update(16);
    expect(c.state.tick).toBe(0);
    expect(c.alpha).toBe(alpha);
    c.resume();
    c.update(interval * 0.4);
    c.update(interval * 0.4);
    expect(c.state.tick).toBe(1);
  });

  it('lead-in delays the first tick', () => {
    const c = make();
    c.restart(500);
    for (let i = 0; i < 6; i++) c.update(50);
    expect(c.state.tick).toBe(0);
    for (let i = 0; i < 10; i++) c.update(60);
    expect(c.state.tick).toBeGreaterThan(0);
  });

  it('restart resets all transient state', () => {
    const c = make();
    c.queueDirection('up');
    for (let i = 0; i < 40; i++) c.update(50);
    expect(c.state.tick).toBeGreaterThan(0);
    c.queueDirection('left');
    c.restart();
    const fresh = createGame(config, 3);
    expect(c.state).toEqual(fresh);
    expect(c.prevSnake).toEqual(fresh.snake);
    expect(c.alpha).toBe(0);
  });

  it('notifies listeners with events and stops ticking after death', () => {
    const c = make();
    const seen: GameEvent[] = [];
    c.subscribe((events) => seen.push(...events));
    for (let i = 0; i < 200 && c.state.status === 'playing'; i++) c.update(50);
    expect(c.state.status).toBe('over');
    expect(seen.some((e) => e.type === 'die')).toBe(true);
    const tick = c.state.tick;
    c.queueDirection('up');
    c.update(1000);
    expect(c.state.tick).toBe(tick);
    // Snake rests exactly where it died (alpha parked at 1).
    expect(c.alpha).toBe(1);
  });

  it('inputs during pause are ignored', () => {
    const c = make();
    c.pause();
    c.queueDirection('up');
    c.resume();
    expect(c.state.queue).toEqual([]);
  });
});

describe('autopilot (menu attract mode)', () => {
  it('only chooses legal moves and survives a long time', () => {
    let s = createGame(config, 11);
    let ticks = 0;
    while (s.status === 'playing' && ticks < 800) {
      const dir = chooseDirection(s);
      s = step({ ...s, queue: [dir] }).state;
      ticks++;
    }
    expect(ticks).toBeGreaterThan(150);
    expect(s.foodEaten).toBeGreaterThan(5);
  });
});
