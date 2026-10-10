export type Direction = 'up' | 'down' | 'left' | 'right';

/** A grid coordinate. x grows to the right, y grows towards the player ("down"). */
export interface Cell {
  readonly x: number;
  readonly y: number;
}

export type GameStatus = 'playing' | 'paused' | 'over' | 'won';

export type DeathCause = 'wall' | 'self' | 'obstacle';

export interface Bonus {
  readonly cell: Cell;
  readonly spawnedAtTick: number;
  readonly expiresAtTick: number;
}

export interface GameConfig {
  readonly cols: number;
  readonly rows: number;
  readonly initialLength: number;
  /** Movement interval at the start of a run. */
  readonly startIntervalMs: number;
  /** Fastest allowed movement interval (the speed cap). */
  readonly minIntervalMs: number;
  /** How much faster each collected orb makes the snake. */
  readonly speedupPerFoodMs: number;
  readonly basePoints: number;
  readonly pointsPerLevel: number;
  readonly foodsPerLevel: number;
  /** A bonus prism appears after every N orbs (0 disables bonuses). */
  readonly bonusEvery: number;
  readonly bonusDurationTicks: number;
  readonly bonusPoints: number;
  /** Bonuses only spawn when at least this many cells are free. */
  readonly bonusMinFreeCells: number;
  readonly maxQueuedInputs: number;
  readonly obstacles: readonly Cell[];
}

/**
 * The authoritative game state. Everything gameplay-related lives here, in grid
 * coordinates; rendering only ever reads it.
 */
export interface GameState {
  readonly config: GameConfig;
  /** Occupied cells, head first. */
  readonly snake: readonly Cell[];
  readonly direction: Direction;
  /** Validated direction changes waiting for upcoming ticks. */
  readonly queue: readonly Direction[];
  readonly food: Cell | null;
  readonly bonus: Bonus | null;
  readonly score: number;
  readonly foodEaten: number;
  readonly bonusEaten: number;
  readonly status: GameStatus;
  readonly tick: number;
  /** Simulated play time (sum of tick intervals); excludes pauses. */
  readonly elapsedMs: number;
  /** Seeded RNG state, so runs are reproducible. */
  readonly rng: number;
  readonly deathCause: DeathCause | null;
}

export type GameEvent =
  | { readonly type: 'move' }
  | { readonly type: 'eat'; readonly cell: Cell; readonly points: number }
  | { readonly type: 'foodSpawn'; readonly cell: Cell }
  | { readonly type: 'bonus'; readonly cell: Cell; readonly points: number }
  | { readonly type: 'bonusSpawn'; readonly cell: Cell }
  | { readonly type: 'bonusExpire'; readonly cell: Cell }
  | { readonly type: 'levelUp'; readonly level: number }
  | { readonly type: 'die'; readonly cause: DeathCause; readonly cell: Cell }
  | { readonly type: 'win' };

export interface StepResult {
  readonly state: GameState;
  readonly events: readonly GameEvent[];
}
