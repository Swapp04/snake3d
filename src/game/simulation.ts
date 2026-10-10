import { DELTA, OPPOSITE } from './config';
import { nextRandom } from './rng';
import type { Bonus, Cell, Direction, GameConfig, GameEvent, GameState, StepResult } from './types';

/*
 * Pure, deterministic Snake rules. Every function takes a state and returns a new
 * one; nothing here knows about time, rendering, or input devices.
 *
 * Movement rule for a single tick:
 *   1. Consume at most one buffered direction.
 *   2. Compute the next head cell.
 *   3. Leaving the board or entering an obstacle ends the run.
 *   4. The snake collides with every body cell that is still occupied after the
 *      move. When it is not growing, the tail vacates its cell on this same
 *      tick, so moving into the current tail cell is legal. When it is growing
 *      (eating an orb) the tail stays, so that cell is solid.
 */

export function cellsEqual(a: Cell, b: Cell): boolean {
  return a.x === b.x && a.y === b.y;
}

export function inBounds(config: GameConfig, cell: Cell): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < config.cols && cell.y < config.rows;
}

export function playableCells(config: GameConfig): number {
  return config.cols * config.rows - config.obstacles.length;
}

export function levelFor(config: GameConfig, foodEaten: number): number {
  return 1 + Math.floor(foodEaten / config.foodsPerLevel);
}

export function pointsForFood(config: GameConfig, level: number): number {
  return config.basePoints + config.pointsPerLevel * (level - 1);
}

export function pointsForBonus(config: GameConfig, level: number): number {
  return config.bonusPoints + config.pointsPerLevel * 2 * (level - 1);
}

/** Movement interval for a given progress, never faster than the configured cap. */
export function intervalFor(config: GameConfig, foodEaten: number): number {
  return Math.max(config.minIntervalMs, config.startIntervalMs - config.speedupPerFoodMs * foodEaten);
}

export function currentInterval(state: GameState): number {
  return intervalFor(state.config, state.foodEaten);
}

export function initialSnake(config: GameConfig): Cell[] {
  const y = Math.floor(config.rows / 2);
  const headX = Math.min(config.cols - 2, Math.max(config.initialLength - 1, Math.floor(config.cols / 2) - 2));
  const snake: Cell[] = [];
  for (let i = 0; i < config.initialLength; i++) snake.push({ x: headX - i, y });
  return snake;
}

export function createGame(config: GameConfig, seed: number): GameState {
  const snake = initialSnake(config);
  const placed = placeFood(config, snake, null, seed >>> 0);
  return {
    config,
    snake,
    direction: 'right',
    queue: [],
    food: placed.cell,
    bonus: null,
    score: 0,
    foodEaten: 0,
    bonusEaten: 0,
    status: placed.cell ? 'playing' : 'won',
    tick: 0,
    elapsedMs: 0,
    rng: placed.rng,
    deathCause: null,
  };
}

function occupancy(config: GameConfig, snake: readonly Cell[], extra: readonly (Cell | null | undefined)[]): Uint8Array {
  const grid = new Uint8Array(config.cols * config.rows);
  const mark = (c: Cell) => {
    if (inBounds(config, c)) grid[c.y * config.cols + c.x] = 1;
  };
  for (const c of config.obstacles) mark(c);
  for (const c of snake) mark(c);
  for (const c of extra) if (c) mark(c);
  return grid;
}

/**
 * Picks a uniformly random free cell in a single bounded pass: count the free
 * cells, draw an index, then walk to it. Never retries, never loops forever, and
 * returns null when the board is full.
 */
export function placeFood(
  config: GameConfig,
  snake: readonly Cell[],
  avoid: Cell | null,
  rng: number,
): { cell: Cell | null; rng: number; free: number } {
  const grid = occupancy(config, snake, [avoid]);
  let free = 0;
  for (let i = 0; i < grid.length; i++) if (grid[i] === 0) free++;
  if (free === 0) return { cell: null, rng, free };
  const [r, next] = nextRandom(rng);
  let target = Math.min(free - 1, Math.floor(r * free));
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] !== 0) continue;
    if (target === 0) return { cell: { x: i % config.cols, y: Math.floor(i / config.cols) }, rng: next, free };
    target--;
  }
  return { cell: null, rng: next, free }; // unreachable: free > 0 guarantees a hit
}

/** Buffers a direction change if it is valid relative to the last buffered one. */
export function queueDirection(state: GameState, dir: Direction): GameState {
  if (state.status !== 'playing') return state;
  if (state.queue.length >= state.config.maxQueuedInputs) return state;
  const last = state.queue.length > 0 ? state.queue[state.queue.length - 1]! : state.direction;
  if (dir === last || dir === OPPOSITE[last]) return state;
  return { ...state, queue: [...state.queue, dir] };
}

export function pause(state: GameState): GameState {
  return state.status === 'playing' ? { ...state, status: 'paused', queue: [] } : state;
}

export function resume(state: GameState): GameState {
  return state.status === 'paused' ? { ...state, status: 'playing' } : state;
}

export function step(state: GameState): StepResult {
  if (state.status !== 'playing') return { state, events: [] };
  const { config } = state;

  let direction = state.direction;
  let queue = state.queue;
  if (queue.length > 0) {
    const next = queue[0]!;
    queue = queue.slice(1);
    if (next !== OPPOSITE[direction]) direction = next;
  }

  const head = state.snake[0]!;
  const delta = DELTA[direction];
  const nextHead: Cell = { x: head.x + delta.x, y: head.y + delta.y };
  const tick = state.tick + 1;
  const elapsedMs = state.elapsedMs + currentInterval(state);

  const die = (cause: 'wall' | 'self' | 'obstacle'): StepResult => ({
    state: { ...state, direction, queue: [], tick, elapsedMs, status: 'over', deathCause: cause },
    events: [{ type: 'die', cause, cell: nextHead }],
  });

  if (!inBounds(config, nextHead)) return die('wall');
  if (config.obstacles.some((o) => cellsEqual(o, nextHead))) return die('obstacle');

  const eatsFood = state.food !== null && cellsEqual(state.food, nextHead);
  const solidLength = eatsFood ? state.snake.length : state.snake.length - 1;
  for (let i = 0; i < solidLength; i++) {
    if (cellsEqual(state.snake[i]!, nextHead)) return die('self');
  }

  const snake = [nextHead, ...state.snake.slice(0, solidLength)];
  const events: GameEvent[] = [{ type: 'move' }];
  let { score, foodEaten, bonusEaten, rng, food } = state;
  let bonus: Bonus | null = state.bonus;

  if (bonus && cellsEqual(bonus.cell, nextHead)) {
    const points = pointsForBonus(config, levelFor(config, foodEaten));
    score += points;
    bonusEaten++;
    events.push({ type: 'bonus', cell: bonus.cell, points });
    bonus = null;
  } else if (bonus && tick >= bonus.expiresAtTick) {
    events.push({ type: 'bonusExpire', cell: bonus.cell });
    bonus = null;
  }

  if (eatsFood) {
    const levelBefore = levelFor(config, foodEaten);
    const points = pointsForFood(config, levelBefore);
    score += points;
    foodEaten++;
    events.push({ type: 'eat', cell: nextHead, points });
    const levelAfter = levelFor(config, foodEaten);
    if (levelAfter > levelBefore) events.push({ type: 'levelUp', level: levelAfter });

    if (snake.length >= playableCells(config)) {
      events.push({ type: 'win' });
      return {
        state: { ...state, snake, direction, queue, food: null, bonus: null, score, foodEaten, bonusEaten, rng, tick, elapsedMs, status: 'won' },
        events,
      };
    }

    let placed = placeFood(config, snake, bonus?.cell ?? null, rng);
    if (!placed.cell && bonus) {
      // The bonus is squatting on the last free cell: the orb takes priority.
      events.push({ type: 'bonusExpire', cell: bonus.cell });
      bonus = null;
      placed = placeFood(config, snake, null, rng);
    }
    rng = placed.rng;
    food = placed.cell;
    if (!food) {
      events.push({ type: 'win' });
      return {
        state: { ...state, snake, direction, queue, food: null, bonus: null, score, foodEaten, bonusEaten, rng, tick, elapsedMs, status: 'won' },
        events,
      };
    }
    events.push({ type: 'foodSpawn', cell: food });

    if (!bonus && config.bonusEvery > 0 && foodEaten % config.bonusEvery === 0) {
      const spot = placeFood(config, snake, food, rng);
      if (spot.cell && spot.free >= config.bonusMinFreeCells) {
        rng = spot.rng;
        bonus = { cell: spot.cell, spawnedAtTick: tick, expiresAtTick: tick + config.bonusDurationTicks };
        events.push({ type: 'bonusSpawn', cell: spot.cell });
      }
    }
  }

  return {
    state: { ...state, snake, direction, queue, food, bonus, score, foodEaten, bonusEaten, rng, tick, elapsedMs },
    events,
  };
}
