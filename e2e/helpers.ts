import { expect, type Page } from '@playwright/test';

export interface Cell {
  x: number;
  y: number;
}

export interface SimState {
  snake: Cell[];
  food: Cell | null;
  direction: 'up' | 'down' | 'left' | 'right';
  status: 'playing' | 'paused' | 'over' | 'won';
  score: number;
  tick: number;
  queue: string[];
  config: { cols: number; rows: number };
}

/** Collects console errors and uncaught exceptions for later assertion. */
export function trackErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

export async function openGame(page: Page, query = 'seed=11'): Promise<void> {
  await page.goto(`/?debug=1&${query}`);
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__SNAKE3__));
}

export async function simState(page: Page): Promise<SimState> {
  return page.evaluate(() => window.__SNAKE3__!.diagnostics().state as unknown as SimState);
}

export async function screen(page: Page): Promise<string | null> {
  return page.locator('.app').getAttribute('data-screen');
}

export async function waitForTick(page: Page, after: number): Promise<SimState> {
  await page.waitForFunction((t) => window.__SNAKE3__!.diagnostics().state.tick > t, after, { timeout: 5000 });
  return simState(page);
}

const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] } as const;
const OPP = { up: 'down', down: 'up', left: 'right', right: 'left' } as const;
type Dir = keyof typeof DELTA;

/** Breadth-first first move towards the food, avoiding the body (tail excluded). */
export function nextMove(s: SimState): Dir | null {
  if (!s.food) return null;
  const { cols, rows } = s.config;
  const blocked = new Set(s.snake.slice(0, -1).map((c) => c.y * cols + c.x));
  const head = s.snake[0]!;
  const start = head.y * cols + head.x;
  const first = new Map<number, Dir>();
  const queue = [start];
  const seen = new Set([start]);
  while (queue.length) {
    const i = queue.shift()!;
    const x = i % cols;
    const y = Math.floor(i / cols);
    if (x === s.food.x && y === s.food.y) return first.get(i) ?? null;
    for (const d of Object.keys(DELTA) as Dir[]) {
      if (i === start && d === OPP[s.direction]) continue;
      const nx = x + DELTA[d][0];
      const ny = y + DELTA[d][1];
      const j = ny * cols + nx;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows || seen.has(j) || blocked.has(j)) continue;
      seen.add(j);
      first.set(j, i === start ? d : first.get(i)!);
      queue.push(j);
    }
  }
  return null;
}

const KEY: Record<Dir, string> = { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight' };

/** Steers with real key presses until `orbs` orbs have been eaten. */
export async function collectOrbs(page: Page, orbs: number, steer?: (dir: Dir) => Promise<void>): Promise<SimState> {
  const press = steer ?? ((d: Dir) => page.keyboard.press(KEY[d]));
  let s = await simState(page);
  const startLength = s.snake.length;
  const deadline = Date.now() + 60_000;
  while (s.snake.length < startLength + orbs) {
    if (Date.now() > deadline) throw new Error('Timed out collecting orbs');
    if (s.status !== 'playing') throw new Error(`Run ended unexpectedly: ${s.status}`);
    const dir = nextMove(s);
    if (dir && dir !== s.direction && s.queue.length === 0) await press(dir);
    s = await waitForTick(page, s.tick);
  }
  return s;
}
