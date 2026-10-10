import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { Engine, type Snapshot } from '../engine';
import { actionForKey, SwipeTracker } from '../game/input';
import type { Direction, GameConfig } from '../game/types';
import { loadSettings, saveSettings, type Settings } from '../lib/settings';
import { browserShareEnv, shareScore, shareText } from '../lib/share';
import { SafeStorage } from '../lib/storage';
import { WebGLUnavailableError } from '../render/GameRenderer';
import type { Insets } from '../render/cameraRig';
import { Hud, Menu, PauseCard, ResultCard, TouchPad, formatScore } from './screens';
import { SettingsDialog } from './Settings';

declare global {
  interface Window {
    __SNAKE3__?: Engine;
  }
}

interface AppProps {
  config: GameConfig;
  seed: number | null;
  debug: boolean;
}

const EMPTY_SNAPSHOT: Snapshot = {
  screen: 'menu',
  score: 0,
  best: 0,
  length: 0,
  level: 1,
  foodEaten: 0,
  bonusEaten: 0,
  elapsedMs: 0,
  deathCause: null,
  newBest: false,
  runId: 0,
  gain: null,
  quality: 'medium',
};

const noopSubscribe = () => () => undefined;

function useMediaQuery(query: string): boolean {
  const get = () => typeof matchMedia === 'function' && matchMedia(query).matches;
  const [match, setMatch] = useState(get);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

/** True on touch-first devices, or as soon as any touch is seen. */
function useTouch(): boolean {
  const coarse = useMediaQuery('(pointer: coarse)');
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    const on = (e: PointerEvent) => {
      if (e.pointerType === 'touch') setTouched(true);
    };
    window.addEventListener('pointerdown', on, { passive: true });
    return () => window.removeEventListener('pointerdown', on);
  }, []);
  return coarse || touched;
}

const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const RETRY_GUARD_MS = 300;

/** Treat a UI element as covering the screen edge it hugs. */
function addEdge(ins: Insets, el: Element | null, w: number, h: number): void {
  if (!el) return;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return;
  if (r.width >= w * 0.6) {
    if (r.top + r.height / 2 > h / 2) ins.bottom = Math.max(ins.bottom, h - r.top);
    else ins.top = Math.max(ins.top, r.bottom);
  } else if (r.left + r.width / 2 > w / 2) ins.right = Math.max(ins.right, w - r.left);
  else ins.left = Math.max(ins.left, r.right);
}

export function App({ config, seed, debug }: AppProps) {
  const storage = useMemo(() => SafeStorage.fromWindow(), []);
  const [settings, setSettings] = useState<Settings>(() => loadSettings(storage));
  const systemReduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const reducedMotion = settings.motion === 'reduced' || (settings.motion === 'system' && systemReduced);
  const touch = useTouch();
  const hapticsSupported = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

  const hostRef = useRef<HTMLDivElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const padRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [contextLost, setContextLost] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [shareMessage, setShareMessage] = useState<string | null>(null);
  const [shareFallback, setShareFallback] = useState<string | null>(null);
  const initial = useRef({ settings, reducedMotion });

  // Engine lifecycle: created once per mount, fully disposed on unmount.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let eng: Engine;
    try {
      eng = new Engine(host, {
        config,
        storage,
        seed,
        settings: initial.current.settings,
        reducedMotion: initial.current.reducedMotion,
        onContextLost: () => setContextLost(true),
        onContextRestored: () => setContextLost(false),
      });
    } catch (err) {
      console.error(err);
      setFatal(
        err instanceof WebGLUnavailableError
          ? 'SNAKE³ needs WebGL to draw its 3D arena, and this browser could not start it.'
          : 'Something went wrong while starting the 3D renderer.',
      );
      return;
    }
    setEngine(eng);
    if (debug) window.__SNAKE3__ = eng;
    return () => {
      eng.dispose();
      if (window.__SNAKE3__ === eng) delete window.__SNAKE3__;
      setEngine(null);
    };
  }, [config, seed, debug, storage]);

  const snap = useSyncExternalStore(engine ? engine.subscribe : noopSubscribe, engine ? engine.getSnapshot : () => EMPTY_SNAPSHOT);
  const screen = snap.screen;
  const inGame = screen !== 'menu';

  useEffect(() => engine?.applySettings(settings), [engine, settings]);

  // Persist only real changes (never re-save the values we just loaded).
  const loadedSettings = useRef(settings);
  useEffect(() => {
    if (settings !== loadedSettings.current) saveSettings(storage, settings);
  }, [settings, storage]);

  useEffect(() => engine?.setReducedMotion(reducedMotion), [engine, reducedMotion]);

  useEffect(() => {
    setShareMessage(null);
    setShareFallback(null);
  }, [snap.runId]);

  // Tell the camera which parts of the screen the UI covers.
  const measure = useCallback(() => {
    if (!engine) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const game = { ...ZERO };
    if (hudRef.current) game.top = Math.max(0, hudRef.current.getBoundingClientRect().bottom);
    if (touch) addEdge(game, padRef.current, w, h);
    const menu = { ...ZERO };
    addEdge(menu, menuRef.current, w, h);
    engine.setInsets('game', game);
    engine.setInsets('menu', menu);
  }, [engine, touch]);

  useLayoutEffect(() => {
    measure();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
    for (const el of [hudRef.current, padRef.current, menuRef.current]) if (el && ro) ro.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, screen]);

  const updateSettings = useCallback((next: Settings) => setSettings(next), []);
  const toggleSound = useCallback(() => setSettings((s) => ({ ...s, sound: !s.sound })), []);

  const play = useCallback(() => engine?.play(), [engine]);
  const steer = useCallback(
    (dir: Direction) => {
      engine?.unlockAudio();
      engine?.steer(dir);
    },
    [engine],
  );
  const toMenu = useCallback(() => {
    setSettingsOpen(false);
    engine?.toMenu();
  }, [engine]);

  // Guard against an accidental retry (a key or click meant for the run that
  // just ended) in the instant the run ends. Applies to every retry path.
  const endedAt = useRef(0);
  useEffect(() => {
    if (screen === 'over' || screen === 'won') endedAt.current = performance.now();
  }, [screen]);
  const retry = useCallback(() => {
    if (performance.now() - endedAt.current < RETRY_GUARD_MS) return;
    engine?.restart();
  }, [engine]);

  const settingsOpenRef = useRef(settingsOpen);
  settingsOpenRef.current = settingsOpen;
  const contextLostRef = useRef(contextLost);
  contextLostRef.current = contextLost;

  useEffect(() => {
    if (!engine) return;
    const onKey = (e: KeyboardEvent) => {
      engine.unlockAudio();
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const action = actionForKey(e.code);
      if (!action) return;
      if (contextLostRef.current) {
        // The reload notice is modal: only its own button may react to keys.
        if (!(e.target instanceof Element && e.target.closest('.context-lost'))) e.preventDefault();
        return;
      }
      const current = engine.getSnapshot().screen;
      const onControl = e.target instanceof Element && e.target.closest('button, textarea, input, select') !== null;
      // A held Enter/Space must not machine-gun the focused button.
      if (e.repeat && onControl && (action.kind === 'confirm' || action.kind === 'pause')) {
        e.preventDefault();
        return;
      }

      if (settingsOpenRef.current) {
        if (action.kind === 'back') {
          e.preventDefault();
          setSettingsOpen(false);
        }
        return;
      }
      const ended = current === 'over' || current === 'won';

      switch (action.kind) {
        case 'direction':
          e.preventDefault();
          if (current === 'playing') engine.steer(action.dir);
          break;
        case 'pause':
          if (current === 'playing' || current === 'paused') {
            e.preventDefault();
            if (!e.repeat) engine.togglePause();
          } else if (ended && e.code === 'Space') {
            e.preventDefault();
            if (!e.repeat) retry();
          } else if (current === 'menu' && e.code === 'Space' && !onControl) {
            e.preventDefault();
            engine.play();
          }
          break;
        case 'confirm':
          if (e.code === 'KeyR') {
            if (e.repeat) break;
            if (current === 'paused') engine.restart();
            else if (ended) retry();
            break;
          }
          if (onControl) break; // let the focused button handle Enter natively
          e.preventDefault();
          if (current === 'menu') engine.play();
          else if (ended) retry();
          else if (current === 'paused') engine.resume();
          break;
        case 'back':
          e.preventDefault();
          if (current === 'playing') engine.pause();
          else if (current === 'paused') engine.resume();
          else if (ended) engine.toMenu();
          break;
        case 'mute':
          setSettings((s) => ({ ...s, sound: !s.sound }));
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine, retry]);

  // Swipe steering anywhere on the stage.
  const swipe = useMemo(() => new SwipeTracker(24), []);
  const onStagePointerDown = (e: ReactPointerEvent) => {
    engine?.unlockAudio();
    if (screen !== 'playing') return;
    swipe.start(e.clientX, e.clientY, e.pointerId);
    (e.target as Element).setPointerCapture?.(e.pointerId);
  };
  const onStagePointerMove = (e: ReactPointerEvent) => {
    if (screen !== 'playing') return;
    const dir = swipe.move(e.clientX, e.clientY, e.pointerId);
    if (dir) engine?.steer(dir);
  };
  const onStagePointerEnd = (e: ReactPointerEvent) => swipe.end(e.pointerId);

  const onShare = useCallback(async () => {
    const text = shareText(snap.score, snap.length, snap.screen === 'won');
    const url = `${location.origin}${location.pathname}`;
    setShareMessage(null);
    setShareFallback(null);
    const outcome = await shareScore(text, url, browserShareEnv());
    if (outcome === 'shared') setShareMessage('Shared. Good luck to them.');
    else if (outcome === 'copied') setShareMessage('Score copied to your clipboard.');
    else if (outcome === 'cancelled') setShareMessage('Sharing cancelled.');
    else {
      setShareMessage('Sharing isn’t available here. Copy the text below instead.');
      setShareFallback(`${text} ${url}`);
    }
  }, [snap.score, snap.length, snap.screen]);

  const announcement =
    screen === 'over'
      ? `Game over. Score ${formatScore(snap.score)}.${snap.newBest ? ' New personal best!' : ''}`
      : screen === 'won'
        ? `Board cleared! Score ${formatScore(snap.score)}.`
        : screen === 'paused'
          ? 'Paused.'
          : '';

  if (fatal) {
    return (
      <div className="app">
        <div className="fatal" role="alert">
          <h1 className="logo logo--small">
            SNAKE<span className="logo__cube">3</span>
          </h1>
          <h2>3D graphics unavailable</h2>
          <p>{fatal}</p>
          <ul>
            <li>Turn on hardware acceleration in your browser settings.</li>
            <li>Update your browser or graphics drivers.</li>
            <li>Try a recent version of Chrome, Edge, Firefox, or Safari.</li>
          </ul>
          <button type="button" className="btn btn--primary" onClick={() => location.reload()}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={`app app--${screen}${touch ? ' app--touch' : ''}${reducedMotion ? ' app--reduced' : ''}`} data-screen={screen}>
      <div
        className="stage"
        ref={hostRef}
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerEnd}
        onPointerCancel={onStagePointerEnd}
        onLostPointerCapture={onStagePointerEnd}
      />
      <div className="ui">
        {screen === 'menu' && engine && (
          <Menu ref={menuRef} best={snap.best} touch={touch} dialogOpen={settingsOpen} onPlay={play} onSettings={() => setSettingsOpen(true)} />
        )}
        <Hud
          ref={hudRef}
          snap={snap}
          visible={screen === 'playing' || screen === 'paused'}
          sound={settings.sound}
          onPause={() => engine?.pause()}
          onToggleSound={toggleSound}
        />
        {touch && <TouchPad ref={padRef} visible={screen === 'playing'} onSteer={steer} />}
        {screen === 'paused' && !settingsOpen && !contextLost && (
          <PauseCard onResume={() => engine?.resume()} onRestart={() => engine?.restart()} onSettings={() => setSettingsOpen(true)} onMenu={toMenu} />
        )}
        {(screen === 'over' || screen === 'won') && !contextLost && (
          <ResultCard
            key={snap.runId}
            snap={snap}
            touch={touch}
            shareMessage={shareMessage}
            shareFallbackText={shareFallback}
            onRetry={retry}
            onShare={onShare}
            onMenu={toMenu}
          />
        )}
        {settingsOpen && (
          <SettingsDialog
            settings={settings}
            effectiveQuality={snap.quality}
            systemReducedMotion={systemReduced}
            hapticsSupported={hapticsSupported}
            onChange={updateSettings}
            onClose={() => setSettingsOpen(false)}
          />
        )}
        {contextLost && (
          <div className="overlay overlay--modal context-lost">
            <div className="card" role="alert">
              <h2 className="card__title">Graphics interrupted</h2>
              <p className="card__text">The browser reset the 3D graphics context. Reload to keep playing; your best score is saved.</p>
              <button type="button" className="btn btn--primary btn--block" autoFocus onClick={() => location.reload()}>
                Reload
              </button>
            </div>
          </div>
        )}
        <p className="sr-only" role="status" aria-live="polite">
          {announcement}
        </p>
        {!inGame && !engine && <div className="loading">Loading…</div>}
      </div>
    </div>
  );
}
