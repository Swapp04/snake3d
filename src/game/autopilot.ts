import { DELTA, DIRECTIONS, OPPOSITE } from './config';
import { inBounds } from './simulation';
import type { Cell, Direction, GameState } from './types';

/*
 * A small, good-enough snake AI for the menu's attract mode. It is not part of
 * the game rules: it simply chooses an input before each tick.
 *
 * Strategy: breadth-first path to the orb; take it only if the snake would still
 * have room afterwards. Otherwise move to the neighbour with the most reachable
 * space (ties broken towards the tail, which keeps it alive for a long time).
 */

function blockedGrid(state: GameState): Uint8Array {
  const { cols, rows, obstacles } = state.config;
  const grid = new Uint8Array(cols * rows);
  for (const o of obstacles) grid[o.y * cols + o.x] = 1;
  // The tail vacates this tick, so it is not an obstacle.
  for (let i = 0; i < state.snake.length - 1; i++) {
    const c = state.snake[i]!;
    grid[c.y * cols + c.x] = 1;
  }
  return grid;
}

function floodCount(state: GameState, grid: Uint8Array, start: Cell): number {
  const { cols, rows } = state.config;
  const seen = new Uint8Array(cols * rows);
  const stack = [start.y * cols + start.x];
  seen[stack[0]!] = 1;
  let count = 0;
  while (stack.length > 0) {
    const i = stack.pop()!;
    count++;
    const x = i % cols;
    const y = (i - x) / cols;
    for (const d of DIRECTIONS) {
      const nx = x + DELTA[d].x;
      const ny = y + DELTA[d].y;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (seen[j] || grid[j]) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  return count;
}

function firstStepTowards(state: GameState, grid: Uint8Array, target: Cell): Direction | null {
  const { cols, rows } = state.config;
  const head = state.snake[0]!;
  const from = new Int16Array(cols * rows).fill(-1);
  const firstDir = new Int8Array(cols * rows).fill(-1);
  const start = head.y * cols + head.x;
  from[start] = start;
  const queue = [start];
  for (let qi = 0; qi < queue.length; qi++) {
    const i = queue[qi]!;
    const x = i % cols;
    const y = (i - x) / cols;
    if (x === target.x && y === target.y) {
      const d = firstDir[i]!;
      return d >= 0 ? DIRECTIONS[d]! : null;
    }
    for (let k = 0; k < DIRECTIONS.length; k++) {
      const dir = DIRECTIONS[k]!;
      if (i === start && dir === OPPOSITE[state.direction]) continue;
      const nx = x + DELTA[dir].x;
      const ny = y + DELTA[dir].y;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (from[j] !== -1 || grid[j]) continue;
      from[j] = i;
      firstDir[j] = i === start ? k : firstDir[i]!;
      queue.push(j);
    }
  }
  return null;
}

export function chooseDirection(state: GameState): Direction {
  const head = state.snake[0]!;
  const grid = blockedGrid(state);
  const tail = state.snake[state.snake.length - 1]!;

  const options = DIRECTIONS.filter((d) => d !== OPPOSITE[state.direction])
    .map((d) => {
      const cell = { x: head.x + DELTA[d].x, y: head.y + DELTA[d].y };
      const ok = inBounds(state.config, cell) && !grid[cell.y * state.config.cols + cell.x];
      return { d, cell, ok };
    })
    .filter((o) => o.ok);
  if (options.length === 0) return state.direction;

  const room = (cell: Cell) => {
    grid[cell.y * state.config.cols + cell.x] = 1;
    const n = floodCount(state, grid, cell) - 1;
    grid[cell.y * state.config.cols + cell.x] = 0;
    return n;
  };

  if (state.food) {
    const towards = firstStepTowards(state, grid, state.food);
    const pick = options.find((o) => o.d === towards);
    if (pick && room(pick.cell) + 1 >= state.snake.length) return pick.d;
  }

  let best = options[0]!;
  let bestScore = -Infinity;
  for (const o of options) {
    const tailDist = Math.abs(o.cell.x - tail.x) + Math.abs(o.cell.y - tail.y);
    const score = room(o.cell) * 10 - tailDist * 0.1;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return best.d;
}
