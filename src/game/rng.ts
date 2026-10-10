/**
 * Pure mulberry32 step. Returns a float in [0, 1) and the next state, so the RNG
 * state can live inside the immutable game state and runs stay reproducible.
 */
export function nextRandom(state: number): [value: number, next: number] {
  const next = (state + 0x6d2b79f5) >>> 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

export function randomSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}
