import { describe, expect, it } from 'vitest';
import { QualityGovernor } from '../src/lib/quality';
import type { QualityLevel } from '../src/lib/settings';

/** Runs `seconds` of frames at a fixed cadence and returns every level change. */
function run(gov: QualityGovernor, start: QualityLevel, seconds: number, intervalMs: number, workMs: number) {
  let level = start;
  const changes: QualityLevel[] = [];
  for (let t = 0; t < seconds * 1000; t += intervalMs) {
    const next = gov.sample(intervalMs, workMs, level);
    if (next) {
      level = next;
      changes.push(next);
    }
  }
  return { level, changes };
}

describe('QualityGovernor (Auto graphics)', () => {
  it('treats a steady 30 fps cap with cheap frames as healthy', () => {
    const r = run(new QualityGovernor('high'), 'high', 60, 1000 / 30, 3);
    expect(r.changes).toEqual([]);
  });

  it('steps down one tier at a time when frames are genuinely slow', () => {
    const r = run(new QualityGovernor('high'), 'high', 20, 50, 4);
    expect(r.changes).toEqual(['medium', 'low']);
  });

  it('steps down when per-frame work is heavy even at 60 fps', () => {
    const r = run(new QualityGovernor('high'), 'high', 6, 1000 / 60, 14);
    expect(r.changes[0]).toBe('medium');
  });

  it('ignores isolated hitches', () => {
    const gov = new QualityGovernor('high');
    let changed = false;
    for (let i = 0; i < 2000; i++) changed ||= gov.sample(i % 50 === 0 ? 900 : 16.7, 2, 'high') !== null;
    expect(changed).toBe(false);
  });

  it('steps back up after a long comfortable stretch, but never above the ceiling', () => {
    const gov = new QualityGovernor('medium');
    const down = run(gov, 'medium', 6, 50, 4);
    expect(down.level).toBe('low');
    const up = run(gov, 'low', 120, 1000 / 60, 2);
    expect(up.changes).toEqual(['medium']);
  });

  it('stops retrying a tier that keeps failing (no oscillation)', () => {
    const gov = new QualityGovernor('high');
    let level: QualityLevel = 'high';
    const history: QualityLevel[] = [];
    for (let cycle = 0; cycle < 5; cycle++) {
      const slow = run(gov, level, 8, 50, 4); // struggle at whatever tier we're on
      level = slow.level;
      history.push(...slow.changes);
      const calm = run(gov, level, 40, 1000 / 60, 2);
      level = calm.level;
      history.push(...calm.changes);
    }
    expect(history.filter((l) => l === 'high').length).toBeLessThanOrEqual(1);
    expect(history.length).toBeLessThan(10);
  });
});
