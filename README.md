# SNAKE³

Classic Snake played in a 3D arena that floats in the dark. It's built with
TypeScript, React, and Three.js, and needs no account, backend, or install. Open
it and play.

- **Classic rules.** Steer on a 16×16 grid. Eat golden orbs to grow, avoid the
  walls and your own tail, and fill the whole board to win.
- **Proper 3D presentation.** The snake is one smooth body that bends around
  corners, has a head with eyes, and moves smoothly between cells. The orbs
  glow, the light and shadows are soft, and the effects stay subtle.
- **Game feel.** Turns are buffered so you can chain them quickly, and reversing
  into yourself is blocked. Swallowed orbs travel down the body as a bulge.
  Retry is instant, and the speed rises steadily up to a cap.
- **Bonus prisms.** A violet prism appears after every 6 orbs. It's worth extra
  points if you reach it before it fades.
- **Desktop and mobile.** Play with the arrow keys or WASD, a touch D-pad, or
  swipes. The layout adapts to portrait, landscape, and desktop sizes.
- **Private.** There's no tracking, no ads, and no network calls. Your personal
  best and settings stay in this browser's `localStorage`.

## Controls

| Action | Keyboard | Touch |
| --- | --- | --- |
| Steer | Arrow keys or W A S D | D-pad, or swipe anywhere |
| Pause / resume | Space, P, or Esc | Pause button |
| Start / retry | Enter (also R from pause or game over) | Buttons |
| Mute | M | Speaker button |
| Back to menu | Esc on the game-over screen | Menu button |

## Quick start

You need Node.js 20 or newer (this project was developed on Node 22).

```bash
npm ci            # install the exact locked dependencies
npm run dev       # dev server at http://localhost:5173
```

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with hot reload |
| `npm run build` | Strict type-check (`tsc -b`) and production build into `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm test` | Unit tests (Vitest) for rules, timing, input, storage, and sharing |
| `npm run test:e2e` | Browser tests (Playwright) against the production build |
| `npm run typecheck` | Type-check only |

The first time you run browser tests, install Chromium with
`npx playwright install chromium`.

### URL options

| Parameter | Effect |
| --- | --- |
| `?grid=8` | Play on an N×N board (6–24). A small board is a good way to practise the full-board finish. Each board size has its own personal best. |
| `?seed=42` | Reproducible orb placement |
| `?debug=1` | Exposes `window.__SNAKE3__` for diagnostics and automated tests |

## Deployment

The build output is plain static files and works from any URL path, because
Vite is configured with `base: './'` (all asset URLs are relative).

```bash
npm run build     # outputs dist/
```

Upload the contents of `dist/` to any static host:

- **GitHub Pages:** push `dist/` to a `gh-pages` branch, or publish it with a Pages workflow. Project subpaths such as `/snake3/` work as-is.
- **Netlify / Cloudflare Pages / Vercel:** build command `npm run build`, publish directory `dist`.
- **S3, nginx, or any file server:** copy `dist/` and serve `index.html`.

No server-side routing or environment variables are needed. Serving
`dist/games/snake3/`-style nested paths was verified during development.

## Project structure

```
src/
  game/        Pure gameplay: types, config, seeded RNG, rules (simulation.ts),
               fixed-timestep controller, input mapping, menu autopilot
  render/      Three.js: renderer lifecycle, camera rig, arena, snake tube,
               orbs/prisms, particles, palette
  audio/       Web Audio synthesizer (no audio files)
  lib/         Safe storage, settings validation, share/clipboard
  ui/          React screens: menu, HUD, overlays, settings, touch pad
  engine.ts    Connects simulation, renderer, audio, and persistence; runs the loop
tests/         Vitest unit tests
e2e/           Playwright browser tests (desktop + mobile)
```

### How it works

- **The simulation is the single source of truth.** `simulation.ts` holds pure
  functions over an immutable state: grid cells, a direction queue, and a seeded
  RNG. Collisions are never worked out from meshes. Each tick consumes at most
  one queued turn. Moving into the cell the tail is leaving is legal unless the
  snake grows on that same tick.
- **Fixed timestep.** `GameController` advances whole ticks from an
  accumulator, so speed doesn't depend on frame rate. Frame time is capped at
  100 ms, the game pauses when the tab is hidden or the window loses focus, and
  after a resume the snake waits briefly before moving. It can never jump ahead
  several cells.
- **Interpolated rendering.** The renderer blends between the previous and the
  current cells. It rebuilds the snake as a tube mesh every frame inside
  preallocated buffers, with rounded corners, so the hot path allocates no new
  memory.
- **React does not re-render every frame.** It reads a small snapshot that
  changes only when the score, status, or similar values change.
- **Quality tiers really change rendering.** Low has no shadows, pixel ratio 1,
  and fewer polygons. Medium adds 1024 px shadows. High adds 2048 px shadows,
  bloom, and up to 2× pixel ratio. The Auto setting starts at High on desktop and
  Medium on touch or small screens. It steps down if frames stay below about
  25 fps or per-frame CPU work stays heavy. A steady 30 fps, such as a phone in
  low-power mode, counts as healthy. Auto steps back up after a long smooth
  stretch, and gives up on any tier that fails twice so it can't oscillate.

## Testing

```bash
npm test          # 78 unit tests
npm run test:e2e  # 19 browser tests (builds first, then serves on :4173)
```

The unit tests cover movement, reversal rejection, input buffering, growth,
wall, self, and obstacle collisions, the tail-vacating rule, food placement on
nearly full and full boards, victory, scoring, difficulty and the speed cap,
pause and resume, restart, frame-rate independence, inputs after game over,
storage that is corrupted or unavailable, multi-touch swipes, and the Auto
quality governor.

The browser tests play the real game. They steer with the keyboard, touch pad,
and drag, collect orbs, pause and resume, die, retry, check that the personal
best survives a reload, check that settings persist, test both sharing paths,
force a victory on a 6×6 board, simulate GPU context loss, check that focus
returns to Play after Settings closes, run rapid restart cycles, and check the
mobile portrait and landscape layouts.

## Troubleshooting

- **The page says "3D graphics unavailable".** The browser couldn't create a
  WebGL context. Turn on hardware acceleration (Chrome: Settings → System), update
  your graphics drivers, or try another browser.
- **No sound.** Browsers allow audio only after you interact with the page, so
  press a key or tap first. Also check the speaker button and the Sound setting.
- **Choppy on an older device.** Open Settings and choose Graphics → Low.
- **"Graphics interrupted" message.** The GPU context was reset (for example by
  a driver update or sleep). Reload; your personal best is kept.
- **Browser tests fail to start.** Run `npx playwright install chromium`. Port
  4173 must be free.

## Browser support

Recent versions of Chrome, Edge, Firefox, and Safari (desktop and mobile) with
WebGL 2.

## Known limitations

- Personal bests are kept per device and per browser. There are no global
  leaderboards and no accounts.
- Classic mode is the only game mode in this release.
- Development testing used Chromium (desktop and mobile emulation) on Windows
  with an Intel Iris Xe GPU. Firefox, Safari, and real phones were not tested.
