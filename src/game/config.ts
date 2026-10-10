import type { Cell, Direction, GameConfig } from './types';

export const DEFAULT_CONFIG: GameConfig = {
  cols: 16,
  rows: 16,
  initialLength: 3,
  startIntervalMs: 165,
  minIntervalMs: 72,
  speedupPerFoodMs: 2.4,
  basePoints: 10,
  pointsPerLevel: 5,
  foodsPerLevel: 5,
  bonusEvery: 6,
  bonusDurationTicks: 44,
  bonusPoints: 50,
  bonusMinFreeCells: 12,
  maxQueuedInputs: 3,
  obstacles: [],
};

export const MIN_GRID = 6;
export const MAX_GRID = 24;

export function makeConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  const config = { ...DEFAULT_CONFIG, ...overrides };
  const cols = clampInt(config.cols, MIN_GRID, MAX_GRID);
  const rows = clampInt(config.rows, MIN_GRID, MAX_GRID);
  return {
    ...config,
    cols,
    rows,
    initialLength: clampInt(config.initialLength, 2, Math.max(2, Math.floor(cols / 2))),
    minIntervalMs: Math.max(16, Math.min(config.minIntervalMs, config.startIntervalMs)),
    maxQueuedInputs: clampInt(config.maxQueuedInputs, 1, 6),
  };
}

function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export const DELTA: Readonly<Record<Direction, Cell>> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export const OPPOSITE: Readonly<Record<Direction, Direction>> = {
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
};

export const DIRECTIONS: readonly Direction[] = ['up', 'right', 'down', 'left'];
