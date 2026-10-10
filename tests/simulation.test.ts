import { describe, expect, it } from 'vitest';
import { makeConfig } from '../src/game/config';
import {
  createGame,
  intervalFor,
  levelFor,
  pause,
  placeFood,
  pointsForBonus,
  pointsForFood,
  queueDirection,
  resume,
  step,
} from '../src/game/simulation';
import type { Cell, Direction, GameConfig, GameState } from '../src/game/types';

const config = makeConfig({ cols: 10, rows: 10, bonusEvery: 0 });

/** A game with an explicit layout. Food defaults to a far corner so it is never eaten by accident. */
function game(over: Partial<GameState> & { snake?: Cell[] } = {}, cfg: GameConfig = config): GameState {
  return { ...createGame(cfg, 1), food: { x: cfg.cols - 1, y: cfg.rows - 1 }, ...over };
}

function stepN(state: GameState, n: number): GameState {
  for (let i = 0; i < n; i++) state = step(state).state;
  return state;
}

const cells = (...pairs: [number, number][]): Cell[] => pairs.map(([x, y]) => ({ x, y }));

describe('initial state', () => {
  it('starts playing with a centred snake heading right and food off the snake', () => {
    const s = createGame(config, 42);
    expect(s.status).toBe('playing');
    expect(s.snake).toHaveLength(config.initialLength);
    expect(s.direction).toBe('right');
    expect(s.queue).toEqual([]);
    expect(s.score).toBe(0);
    expect(s.foodEaten).toBe(0);
    expect(s.tick).toBe(0);
    expect(s.deathCause).toBeNull();
    // Body extends contiguously to the left of the head.
    for (let i = 1; i < s.snake.length; i++) {
      expect(s.snake[i]).toEqual({ x: s.snake[0]!.x - i, y: s.snake[0]!.y });
    }
    expect(s.food).not.toBeNull();
    expect(s.snake.some((c) => c.x === s.food!.x && c.y === s.food!.y)).toBe(false);
  });

  it('is deterministic for a given seed', () => {
    expect(createGame(config, 7)).toEqual(createGame(config, 7));
    const foods = new Set([1, 2, 3, 4, 5, 6].map((seed) => JSON.stringify(createGame(config, seed).food)));
    expect(foods.size).toBeGreaterThan(1);
  });
});

describe('movement', () => {
  const start = game({ snake: cells([5, 5], [4, 5], [3, 5]), direction: 'right' });
  const cases: [Direction, Direction, Cell][] = [
    ['right', 'right', { x: 6, y: 5 }],
    ['up', 'up', { x: 5, y: 4 }],
    ['down', 'down', { x: 5, y: 6 }],
  ];
  it.each(cases)('moves %s', (input, expectedDir, head) => {
    const r = step(queueDirection(start, input)).state;
    expect(r.direction).toBe(expectedDir);
    expect(r.snake[0]).toEqual(head);
    expect(r.snake).toHaveLength(3);
    expect(r.snake[1]).toEqual({ x: 5, y: 5 });
  });

  it('moves left when heading vertically', () => {
    const s = game({ snake: cells([5, 5], [5, 6], [5, 7]), direction: 'up' });
    const r = step(queueDirection(s, 'left')).state;
    expect(r.snake[0]).toEqual({ x: 4, y: 5 });
  });

  it('keeps moving in the current direction without input', () => {
    const r = stepN(start, 3);
    expect(r.snake[0]).toEqual({ x: 8, y: 5 });
    expect(r.snake).toEqual(cells([8, 5], [7, 5], [6, 5]));
  });
});

describe('direction rules and input buffering', () => {
  const start = game({ snake: cells([5, 5], [4, 5], [3, 5]), direction: 'right' });

  it('rejects a 180° reversal', () => {
    const q = queueDirection(start, 'left');
    expect(q.queue).toEqual([]);
    expect(step(q).state.snake[0]).toEqual({ x: 6, y: 5 });
  });

  it('ignores repeating the current direction', () => {
    expect(queueDirection(start, 'right').queue).toEqual([]);
  });

  it('buffers rapid inputs and consumes one per tick', () => {
    let s = queueDirection(start, 'up');
    s = queueDirection(s, 'left');
    expect(s.queue).toEqual(['up', 'left']);
    s = step(s).state;
    expect(s.snake[0]).toEqual({ x: 5, y: 4 });
    expect(s.queue).toEqual(['left']);
    s = step(s).state;
    expect(s.snake[0]).toEqual({ x: 4, y: 4 });
    expect(s.direction).toBe('left');
  });

  it('validates against the last buffered direction, preventing a reversal into the neck', () => {
    // Up then Down within one tick would reverse into the body; Down must be rejected.
    let s = queueDirection(start, 'up');
    s = queueDirection(s, 'down');
    expect(s.queue).toEqual(['up']);
    // Up then Left is a legal U-turn spread over two ticks.
    s = queueDirection(s, 'left');
    expect(s.queue).toEqual(['up', 'left']);
  });

  it('caps the buffer length', () => {
    let s = start;
    for (const d of ['up', 'left', 'down', 'right', 'up'] as Direction[]) s = queueDirection(s, d);
    expect(s.queue).toHaveLength(config.maxQueuedInputs);
  });

  it('never reverses even if a stale reversal reaches the queue head', () => {
    const s = { ...start, queue: ['left'] as Direction[] };
    const r = step(s).state;
    expect(r.direction).toBe('right');
    expect(r.status).toBe('playing');
  });
});

describe('growth and scoring', () => {
  it('grows by one and scores when eating, and respawns food on a free cell', () => {
    const s = game({ snake: cells([5, 5], [4, 5], [3, 5]), food: { x: 6, y: 5 } });
    const { state: r, events } = step(s);
    expect(r.snake).toEqual(cells([6, 5], [5, 5], [4, 5], [3, 5]));
    expect(r.score).toBe(config.basePoints);
    expect(r.foodEaten).toBe(1);
    expect(events.map((e) => e.type)).toEqual(['move', 'eat', 'foodSpawn']);
    expect(r.food).not.toBeNull();
    expect(r.snake.some((c) => c.x === r.food!.x && c.y === r.food!.y)).toBe(false);
  });

  it('tail stays put on the growth tick and resumes following afterwards', () => {
    let s = game({ snake: cells([5, 5], [4, 5], [3, 5]), food: { x: 6, y: 5 } });
    s = step(s).state;
    expect(s.snake[s.snake.length - 1]).toEqual({ x: 3, y: 5 });
    s = { ...s, food: { x: 0, y: 0 } };
    s = step(s).state;
    expect(s.snake).toHaveLength(4);
    expect(s.snake[s.snake.length - 1]).toEqual({ x: 4, y: 5 });
  });

  it('awards more points per orb at higher levels', () => {
    expect(levelFor(config, 0)).toBe(1);
    expect(levelFor(config, config.foodsPerLevel - 1)).toBe(1);
    expect(levelFor(config, config.foodsPerLevel)).toBe(2);
    expect(pointsForFood(config, 1)).toBe(config.basePoints);
    expect(pointsForFood(config, 3)).toBe(config.basePoints + 2 * config.pointsPerLevel);
    const s = game({ snake: cells([5, 5], [4, 5], [3, 5]), food: { x: 6, y: 5 }, foodEaten: config.foodsPerLevel });
    const { state: r, events } = step(s);
    expect(r.score).toBe(pointsForFood(config, 2));
    expect(events.some((e) => e.type === 'levelUp')).toBe(false);
  });

  it('emits levelUp when crossing a level boundary', () => {
    const s = game({ snake: cells([5, 5], [4, 5], [3, 5]), food: { x: 6, y: 5 }, foodEaten: config.foodsPerLevel - 1 });
    const { events } = step(s);
    expect(events).toContainEqual({ type: 'levelUp', level: 2 });
  });
});

describe('collisions', () => {
  it.each([
    ['right', cells([9, 5], [8, 5], [7, 5])],
    ['left', cells([0, 5], [1, 5], [2, 5])],
    ['up', cells([5, 0], [5, 1], [5, 2])],
    ['down', cells([5, 9], [5, 8], [5, 7])],
  ] as [Direction, Cell[]][])('ends the run on a wall heading %s', (direction, snake) => {
    const { state: r, events } = step(game({ snake, direction }));
    expect(r.status).toBe('over');
    expect(r.deathCause).toBe('wall');
    expect(r.snake).toEqual(snake); // the snake does not move into the wall
    expect(events[0]).toMatchObject({ type: 'die', cause: 'wall' });
  });

  it('ends the run when the head hits the body', () => {
    // Head at (5,5) heading up, body curls so (5,4) is occupied mid-body.
    const snake = cells([5, 5], [6, 5], [6, 4], [5, 4], [4, 4], [4, 5]);
    const { state: r } = step(game({ snake, direction: 'left' }));
    // Heading left from (5,5) enters (4,5), which is the tail -> legal (tail vacates).
    expect(r.status).toBe('playing');
    const { state: r2 } = step(queueDirection(game({ snake, direction: 'left' }), 'up'));
    expect(r2.status).toBe('over');
    expect(r2.deathCause).toBe('self');
  });

  it('obstacles end the run', () => {
    const cfg = makeConfig({ cols: 10, rows: 10, bonusEvery: 0, obstacles: [{ x: 6, y: 5 }] });
    const s = game({ snake: cells([5, 5], [4, 5], [3, 5]) }, cfg);
    expect(step(s).state.deathCause).toBe('obstacle');
  });
});

describe('tail-vacating edge case', () => {
  // A 2x2 loop: head (4,4), body (5,4), (5,5), tail (4,5). Moving down enters the tail cell.
  const loop = cells([4, 4], [5, 4], [5, 5], [4, 5]);

  it('allows entering the cell the tail leaves on the same tick', () => {
    const s = game({ snake: loop, direction: 'left' });
    const r = step(queueDirection(s, 'down')).state;
    expect(r.status).toBe('playing');
    expect(r.snake).toEqual(cells([4, 5], [4, 4], [5, 4], [5, 5]));
  });

  it('treats the tail as solid when the snake grows on that tick', () => {
    // Food cannot spawn on the snake, but if the move would grow (food on the
    // tail cell, constructed here), the tail stays and the move is fatal.
    const s = game({ snake: loop, direction: 'left', food: { x: 4, y: 5 } });
    const r = step(queueDirection(s, 'down')).state;
    expect(r.status).toBe('over');
    expect(r.deathCause).toBe('self');
  });
});

describe('food placement', () => {
  it('never places food on the snake, obstacles, or the avoided cell', () => {
    const cfg = makeConfig({ cols: 6, rows: 6, obstacles: cells([0, 0], [1, 1]) });
    const snake = cells([3, 3], [2, 3], [1, 3], [0, 3]);
    let rng = 123;
    for (let i = 0; i < 500; i++) {
      const p = placeFood(cfg, snake, { x: 5, y: 5 }, rng);
      rng = p.rng;
      const c = p.cell!;
      expect(c.x).toBeGreaterThanOrEqual(0);
      expect(c.x).toBeLessThan(6);
      expect(snake.some((s) => s.x === c.x && s.y === c.y)).toBe(false);
      expect(cfg.obstacles.some((s) => s.x === c.x && s.y === c.y)).toBe(false);
      expect(c).not.toEqual({ x: 5, y: 5 });
    }
  });

  it('finds the single remaining cell on a nearly full board', () => {
    const cfg = makeConfig({ cols: 6, rows: 6 });
    const all: Cell[] = [];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) if (!(x === 4 && y === 2)) all.push({ x, y });
    for (const seed of [1, 99, 2 ** 31]) {
      const p = placeFood(cfg, all, null, seed);
      expect(p.cell).toEqual({ x: 4, y: 2 });
      expect(p.free).toBe(1);
    }
  });

  it('returns null without looping when the board is full', () => {
    const cfg = makeConfig({ cols: 6, rows: 6 });
    const all: Cell[] = [];
    for (let y = 0; y < 6; y++) for (let x = 0; x < 6; x++) all.push({ x, y });
    expect(placeFood(cfg, all, null, 5).cell).toBeNull();
  });

  it('distributes food across all free cells', () => {
    const cfg = makeConfig({ cols: 6, rows: 6 });
    const seen = new Set<string>();
    let rng = 9;
    for (let i = 0; i < 2000; i++) {
      const p = placeFood(cfg, [], null, rng);
      rng = p.rng;
      seen.add(`${p.cell!.x},${p.cell!.y}`);
    }
    expect(seen.size).toBe(36);
  });
});

describe('victory', () => {
  it('wins when the final orb fills the board', () => {
    const cfg = makeConfig({ cols: 6, rows: 6, bonusEvery: 0 });
    // Serpentine (head first) covering every cell except (0,5); head at (1,5) heading left onto the food.
    const ltr = [0, 1, 2, 3, 4, 5];
    const rtl = [5, 4, 3, 2, 1, 0];
    const rows: [number, number[]][] = [[5, [1, 2, 3, 4, 5]], [4, rtl], [3, ltr], [2, rtl], [1, ltr], [0, rtl]];
    const snake: Cell[] = rows.flatMap(([y, xs]) => xs.map((x) => ({ x, y })));
    expect(snake).toHaveLength(35);
    const s: GameState = { ...createGame(cfg, 1), snake, direction: 'left', food: { x: 0, y: 5 } };
    const { state: r, events } = step(s);
    expect(r.status).toBe('won');
    expect(r.food).toBeNull();
    expect(r.snake).toHaveLength(36);
    expect(events.map((e) => e.type)).toContain('win');
    // Further steps do nothing.
    expect(step(r).state).toBe(r);
  });
});

describe('difficulty', () => {
  it('speeds up as orbs are collected', () => {
    expect(intervalFor(config, 0)).toBe(config.startIntervalMs);
    expect(intervalFor(config, 5)).toBeLessThan(intervalFor(config, 4));
  });

  it('never exceeds the speed cap', () => {
    for (const n of [50, 100, 1000, 1e6]) expect(intervalFor(config, n)).toBe(config.minIntervalMs);
    const custom = makeConfig({ startIntervalMs: 200, minIntervalMs: 120, speedupPerFoodMs: 10 });
    expect(intervalFor(custom, 100)).toBe(120);
  });

  it('accumulates elapsed time using the current interval', () => {
    const s = game({ snake: cells([2, 5], [1, 5], [0, 5]) });
    expect(stepN(s, 3).elapsedMs).toBe(config.startIntervalMs * 3);
  });
});

describe('pause and resume', () => {
  const s = game({ snake: cells([5, 5], [4, 5], [3, 5]) });

  it('does not advance while paused and ignores inputs', () => {
    let p = pause(queueDirection(s, 'up'));
    expect(p.status).toBe('paused');
    expect(p.queue).toEqual([]);
    p = queueDirection(p, 'down');
    expect(p.queue).toEqual([]);
    expect(step(p).state).toBe(p);
  });

  it('resumes where it left off', () => {
    const r = resume(pause(s));
    expect(r.status).toBe('playing');
    expect(step(r).state.snake[0]).toEqual({ x: 6, y: 5 });
  });

  it('pause/resume are no-ops in other states', () => {
    const over = { ...s, status: 'over' as const };
    expect(pause(over)).toBe(over);
    expect(resume(s)).toBe(s);
  });
});

describe('after game over', () => {
  it('ignores inputs and steps', () => {
    const dead = step(game({ snake: cells([9, 5], [8, 5], [7, 5]) })).state;
    expect(dead.status).toBe('over');
    expect(queueDirection(dead, 'up')).toBe(dead);
    expect(step(dead).state).toBe(dead);
    expect(step(dead).events).toEqual([]);
  });
});

describe('bonus prisms', () => {
  const cfg = makeConfig({ cols: 10, rows: 10, bonusEvery: 1, bonusDurationTicks: 5 });

  it('spawn after the configured number of orbs on a free cell', () => {
    const s = game({ snake: cells([5, 5], [4, 5], [3, 5]), food: { x: 6, y: 5 } }, cfg);
    const { state: r, events } = step(s);
    expect(r.bonus).not.toBeNull();
    expect(events.map((e) => e.type)).toContain('bonusSpawn');
    expect(r.snake.some((c) => c.x === r.bonus!.cell.x && c.y === r.bonus!.cell.y)).toBe(false);
    expect(r.bonus!.cell).not.toEqual(r.food);
  });

  it('award points without growing', () => {
    const s = game({ snake: cells([5, 5], [4, 5], [3, 5]), bonus: { cell: { x: 6, y: 5 }, spawnedAtTick: 0, expiresAtTick: 99 } }, cfg);
    const { state: r, events } = step(s);
    expect(r.snake).toHaveLength(3);
    expect(r.score).toBe(pointsForBonus(cfg, 1));
    expect(r.bonus).toBeNull();
    expect(events.map((e) => e.type)).toContain('bonus');
  });

  it('expire after their lifetime', () => {
    const s = game({ snake: cells([1, 1], [0, 1]), bonus: { cell: { x: 8, y: 8 }, spawnedAtTick: 0, expiresAtTick: 2 } }, cfg);
    const one = step(s);
    expect(one.state.bonus).not.toBeNull();
    const two = step(one.state);
    expect(two.state.bonus).toBeNull();
    expect(two.events.map((e) => e.type)).toContain('bonusExpire');
  });
});
