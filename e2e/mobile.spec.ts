import { expect, test } from '@playwright/test';
import { collectOrbs, openGame, screen, simState, trackErrors, waitForTick } from './helpers';

test.describe('SNAKE³ mobile', () => {
  test('touch pad steers, collects orbs, and does not cover the arena controls', async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page);
    await expect(page.getByText('Swipe anywhere or use the arrow pad')).toBeVisible();
    await page.getByRole('button', { name: 'Play' }).tap();
    await expect.poll(() => screen(page)).toBe('playing');
    const pad = page.getByTestId('pad-up');
    await expect(pad).toBeVisible();
    const padBox = await pad.boundingBox();
    expect(padBox!.width).toBeGreaterThanOrEqual(44);
    expect(padBox!.height).toBeGreaterThanOrEqual(44);

    const s = await collectOrbs(page, 2, async (dir) => {
      await page.getByTestId(`pad-${dir}`).tap();
    });
    expect(s.snake.length).toBe(5);

    // HUD pause stays reachable alongside the pad.
    await page.getByTestId('pause-button').tap();
    await expect.poll(() => screen(page)).toBe('paused');
    await page.getByRole('button', { name: 'Resume' }).tap();
    await expect.poll(() => screen(page)).toBe('playing');
    expect(errors).toEqual([]);
  });

  test('page does not scroll during play', async ({ page }) => {
    await openGame(page);
    await page.getByRole('button', { name: 'Play' }).tap();
    const s = await waitForTick(page, 0);
    await page.mouse.wheel(0, 600);
    const scroll = await page.evaluate(() => ({ y: window.scrollY, h: document.documentElement.scrollHeight, vh: window.innerHeight }));
    expect(scroll.y).toBe(0);
    expect(scroll.h).toBeLessThanOrEqual(scroll.vh);
    expect((await simState(page)).tick).toBeGreaterThanOrEqual(s.tick);
  });

  test('landscape layout keeps HUD, pad, and arena separate', async ({ page }) => {
    await page.setViewportSize({ width: 844, height: 390 });
    await openGame(page);
    await page.getByRole('button', { name: 'Play' }).tap();
    await expect.poll(() => screen(page)).toBe('playing');
    const pause = await page.getByTestId('pause-button').boundingBox();
    const up = await page.getByTestId('pad-up').boundingBox();
    expect(pause!.y + pause!.height).toBeLessThanOrEqual(up!.y);
    await page.getByTestId('pause-button').tap();
    await expect.poll(() => screen(page)).toBe('paused');
  });
});
