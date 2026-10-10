import { expect, test } from '@playwright/test';
import { collectOrbs, openGame, screen, simState, trackErrors, waitForTick } from './helpers';

test.describe('SNAKE³ desktop', () => {
  test('menu renders a real 3D canvas and Play starts a run', async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page);
    await expect(page).toHaveTitle(/SNAKE³/);
    await expect(page.getByRole('heading', { name: 'Snake cubed' })).toBeVisible();
    const canvas = page.locator('canvas.game-canvas');
    await expect(canvas).toHaveCount(1);
    const box = await canvas.boundingBox();
    expect(box!.width).toBeGreaterThan(1000);
    const hasGl = await page.evaluate(() => {
      const c = document.querySelector('canvas.game-canvas') as HTMLCanvasElement;
      return Boolean(c.getContext('webgl2') || c.getContext('webgl'));
    });
    expect(hasGl).toBe(true);

    await page.getByRole('button', { name: 'Play' }).click();
    await expect.poll(() => screen(page)).toBe('playing');
    const s = await waitForTick(page, 0);
    expect(s.status).toBe('playing');
    expect(errors).toEqual([]);
  });

  test('keyboard steering works with arrows and WASD and rejects reversal', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    let s = await waitForTick(page, 0);
    const startY = s.snake[0]!.y;
    await page.keyboard.press('ArrowLeft'); // reversal: must be ignored
    await page.keyboard.press('KeyW'); // up
    s = await waitForTick(page, s.tick);
    s = await waitForTick(page, s.tick);
    expect(s.direction).toBe('up');
    expect(s.snake[0]!.y).toBeLessThan(startY);
    await page.keyboard.press('KeyD');
    s = await waitForTick(page, s.tick);
    s = await waitForTick(page, s.tick);
    expect(s.direction).toBe('right');
  });

  test('collecting orbs grows the snake and updates the HUD', async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page);
    await page.keyboard.press('Enter');
    const s = await collectOrbs(page, 3);
    expect(s.snake.length).toBe(6);
    expect(s.score).toBeGreaterThanOrEqual(30);
    await expect(page.getByTestId('score')).toHaveText(String(s.score));
    await expect(page.getByTestId('length')).toHaveText('6');
    expect(errors).toEqual([]);
  });

  test('pause stops the simulation; resume continues', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    const s = await waitForTick(page, 1);
    await page.keyboard.press('Space');
    await expect.poll(() => screen(page)).toBe('paused');
    await expect(page.getByRole('dialog', { name: 'Take a breath' })).toBeVisible();
    const frozen = (await simState(page)).tick;
    await page.waitForTimeout(700);
    expect((await simState(page)).tick).toBe(frozen);
    expect(frozen).toBeGreaterThanOrEqual(s.tick);
    await page.getByRole('button', { name: 'Resume' }).click();
    await expect.poll(() => screen(page)).toBe('playing');
    await waitForTick(page, frozen);
  });

  test('hitting the wall ends the run; Retry fully resets', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    await collectOrbs(page, 1);
    // Steer up and keep going: the wall ends the run.
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => screen(page), { timeout: 10_000 }).toBe('over');
    const card = page.getByRole('dialog');
    await expect(card).toContainText(/You hit the wall|You bit your own tail/);
    const final = await simState(page);
    await expect(page.getByTestId('final-score')).toHaveText(String(final.score));
    // Inputs after game over do nothing.
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(300);
    expect((await simState(page)).tick).toBe(final.tick);

    await page.getByRole('button', { name: 'Retry' }).click();
    await expect.poll(() => screen(page)).toBe('playing');
    const fresh = await simState(page);
    expect(fresh.score).toBe(0);
    expect(fresh.snake.length).toBe(3);
    expect(fresh.tick).toBeLessThanOrEqual(1);
    expect(fresh.queue).toEqual([]);
    await expect(page.getByTestId('score')).toHaveText('0');
  });

  test('personal best persists across a refresh', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    await collectOrbs(page, 2);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    await expect.poll(() => screen(page), { timeout: 10_000 }).toBe('over');
    const score = (await simState(page)).score;
    expect(score).toBeGreaterThan(0);
    await expect(page.getByText('New best')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('menu-best')).toHaveText(String(score));
  });

  test('settings change, apply, and persist', async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('switch', { name: 'Sound' }).click();
    await expect(dialog.getByRole('switch', { name: 'Sound' })).toHaveAttribute('aria-checked', 'false');
    for (const q of ['Low', 'Medium', 'High']) {
      await dialog.getByRole('radio', { name: q }).click();
      await expect.poll(() => page.evaluate(() => window.__SNAKE3__!.diagnostics().quality)).toBe(q.toLowerCase());
    }
    await dialog.getByRole('radio', { name: 'Reduced' }).click();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await page.reload();
    await page.getByRole('button', { name: 'Settings' }).click();
    const again = page.getByRole('dialog', { name: 'Settings' });
    await expect(again.getByRole('switch', { name: 'Sound' })).toHaveAttribute('aria-checked', 'false');
    await expect(again.getByRole('radio', { name: 'High' })).toHaveAttribute('aria-checked', 'true');
    await expect(again.getByRole('radio', { name: 'Reduced' })).toHaveAttribute('aria-checked', 'true');
    await again.getByRole('button', { name: 'Done' }).click();
    expect(errors).toEqual([]);
  });

  test('audio starts only after a gesture; mute suspends it; M toggles it back', async ({ page }) => {
    const audio = () => page.evaluate(() => window.__SNAKE3__!.diagnostics().audio);
    await openGame(page);
    expect(await audio()).toBe('idle'); // nothing plays before the player interacts
    await page.keyboard.press('Enter');
    await expect.poll(audio).toBe('running');
    await page.getByRole('button', { name: 'Mute sound' }).click();
    await expect(page.getByRole('button', { name: 'Unmute sound' })).toBeVisible();
    await expect.poll(audio).toBe('suspended');
    await page.keyboard.press('KeyM');
    await expect(page.getByRole('button', { name: 'Mute sound' })).toBeVisible();
    await expect.poll(audio).toBe('running');
    expect(await screen(page)).toBe('playing');
  });

  test('Enter plays after closing Settings (focus returns to Play)', async ({ page }) => {
    await openGame(page);
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Done' }).click();
    await expect(page.getByRole('button', { name: 'Play' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect.poll(() => screen(page)).toBe('playing');
  });

  test('losing the WebGL context pauses the run and blocks input', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    await waitForTick(page, 1);
    await page.evaluate(() => {
      const gl = (document.querySelector('canvas.game-canvas') as HTMLCanvasElement).getContext('webgl2')!;
      gl.getExtension('WEBGL_lose_context')!.loseContext();
    });
    await expect(page.getByRole('alert').filter({ hasText: 'Graphics interrupted' })).toBeVisible();
    await expect.poll(() => screen(page)).toBe('paused');
    // The only action is Reload, and it has focus.
    await expect(page.getByRole('button', { name: 'Reload' })).toBeFocused();
    const before = await simState(page);
    // Game keys must not resume or steer behind the notice.
    await page.keyboard.press('KeyP');
    await page.keyboard.press('Escape');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(500);
    expect(await screen(page)).toBe('paused');
    const after = await simState(page);
    expect(after.tick).toBe(before.tick);
    expect(after.queue).toEqual([]);
  });

  test('pause menu returns to the main menu', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    await waitForTick(page, 0);
    await page.getByTestId('pause-button').click();
    await page.getByRole('button', { name: 'Menu' }).click();
    await expect.poll(() => screen(page)).toBe('menu');
    await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
  });

  test('mouse drag on the stage steers (swipe input)', async ({ page }) => {
    await openGame(page);
    await page.keyboard.press('Enter');
    let s = await waitForTick(page, 0);
    await page.mouse.move(640, 500);
    await page.mouse.down();
    await page.mouse.move(640, 420, { steps: 4 });
    await page.mouse.up();
    s = await waitForTick(page, s.tick);
    s = await waitForTick(page, s.tick);
    expect(s.direction).toBe('up');

    // A swipe that starts on the HUD strip (not on a button) still reaches the stage.
    await page.mouse.move(640, 30);
    await page.mouse.down();
    await page.mouse.move(560, 30, { steps: 4 });
    await page.mouse.up();
    s = await waitForTick(page, s.tick);
    s = await waitForTick(page, s.tick);
    expect(s.direction).toBe('left');
  });

  test('share uses the native share sheet when available', async ({ page }) => {
    await page.addInitScript(() => {
      (window as unknown as { __shared: unknown[] }).__shared = [];
      Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: (data: unknown) => {
          (window as unknown as { __shared: unknown[] }).__shared.push(data);
          return Promise.resolve();
        },
      });
    });
    await openGame(page);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => screen(page), { timeout: 10_000 }).toBe('over');
    await page.getByRole('button', { name: 'Share score' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Shared' })).toBeVisible();
    const shared = await page.evaluate(() => (window as unknown as { __shared: { text: string }[] }).__shared);
    expect(shared[0]!.text).toContain('SNAKE³');
  });

  test('share falls back to the clipboard', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
    });
    await openGame(page);
    await page.keyboard.press('Enter');
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => screen(page), { timeout: 10_000 }).toBe('over');
    await page.getByRole('button', { name: 'Share score' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'copied' })).toBeVisible();
    const text = await page.evaluate(() => navigator.clipboard.readText());
    expect(text).toContain('in SNAKE³');
  });

  test('filling the board shows the victory screen', async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page, 'grid=6&seed=3');
    await page.keyboard.press('Enter');
    await waitForTick(page, 0);
    // Inject a nearly full 6×6 board (35 cells) with the last orb straight ahead.
    await page.evaluate(() => {
      const eng = window.__SNAKE3__!;
      const ltr = [0, 1, 2, 3, 4, 5];
      const rtl = [5, 4, 3, 2, 1, 0];
      const rows: [number, number[]][] = [[5, [1, 2, 3, 4, 5]], [4, rtl], [3, ltr], [2, rtl], [1, ltr], [0, rtl]];
      const snake = rows.flatMap(([y, xs]) => xs.map((x) => ({ x, y })));
      eng.game.state = { ...eng.game.state, snake, direction: 'left', queue: [], food: { x: 0, y: 5 }, bonus: null };
      eng.game.prevSnake = snake;
    });
    await expect.poll(() => screen(page), { timeout: 5000 }).toBe('won');
    await expect(page.getByRole('dialog')).toContainText('Board cleared');
    await expect(page.getByRole('button', { name: 'Play again' })).toBeVisible();
    expect((await simState(page)).snake.length).toBe(36);
    expect(errors).toEqual([]);
  });

  test('survives 25 rapid pause/restart cycles without errors or leaked canvases', async ({ page }) => {
    const errors = trackErrors(page);
    await openGame(page);
    await page.keyboard.press('Enter');
    for (let i = 0; i < 25; i++) {
      await page.keyboard.press('Space'); // pause
      await page.keyboard.press('KeyR'); // restart from the pause menu
    }
    await expect.poll(() => screen(page)).toBe('playing');
    const s = await waitForTick(page, 0);
    expect(s.snake.length).toBe(3);
    expect(s.score).toBe(0);
    await expect(page.locator('canvas.game-canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
  });
});
