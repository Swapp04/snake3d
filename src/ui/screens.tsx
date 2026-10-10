import { forwardRef, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Snapshot } from '../engine';
import type { Direction } from '../game/types';
import { ArrowIcon, GearIcon, HomeIcon, PauseIcon, PlayIcon, RetryIcon, ShareIcon, SoundOffIcon, SoundOnIcon } from './icons';

const fmt = new Intl.NumberFormat('en-US');
export const formatScore = (n: number) => fmt.format(n);

export function formatTime(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Drops keyboard focus after pointer clicks, so Space can't re-trigger a HUD button. */
const blurOnPointer = (e: ReactPointerEvent<HTMLButtonElement>) => e.currentTarget.blur();

// ------------------------------------------------------------------ menu

interface MenuProps {
  best: number;
  touch: boolean;
  /** While a dialog is open over the menu; Play regains focus when it closes. */
  dialogOpen: boolean;
  onPlay: () => void;
  onSettings: () => void;
}

export const Menu = forwardRef<HTMLDivElement, MenuProps>(function Menu({ best, touch, dialogOpen, onPlay, onSettings }, ref) {
  const playRef = useRef<HTMLButtonElement>(null);
  // Keep Play focused (it advertises Enter), including after Settings closes.
  useEffect(() => {
    if (!touch && !dialogOpen) playRef.current?.focus({ preventScroll: true });
  }, [touch, dialogOpen]);
  return (
    <div className="menu" ref={ref}>
      <p className="eyebrow">A 3D arcade game</p>
      <h1 className="logo" aria-label="Snake cubed">
        SNAKE<span className="logo__cube">3</span>
      </h1>
      <p className="tagline">Classic rules. Real depth. One more round.</p>
      <button ref={playRef} type="button" className="btn btn--primary btn--hero" onClick={onPlay}>
        <PlayIcon width={22} height={22} />
        <span>Play</span>
        {!touch && <kbd className="kbd kbd--onbtn">Enter</kbd>}
      </button>
      <div className="menu__row">
        <div className="stat-card">
          <span className="stat-card__label">Personal best</span>
          <span className="stat-card__value" data-testid="menu-best">
            {formatScore(best)}
          </span>
        </div>
        <button type="button" className="btn btn--ghost" onClick={onSettings}>
          <GearIcon />
          <span>Settings</span>
        </button>
      </div>
      <div className="controls-hint">
        {touch ? (
          <span>Swipe anywhere or use the arrow pad to steer.</span>
        ) : (
          <>
            <span className="controls-hint__keys">
              <kbd className="kbd">←</kbd>
              <kbd className="kbd">↑</kbd>
              <kbd className="kbd">↓</kbd>
              <kbd className="kbd">→</kbd>
              <span className="controls-hint__or">or</span>
              <kbd className="kbd">W</kbd>
              <kbd className="kbd">A</kbd>
              <kbd className="kbd">S</kbd>
              <kbd className="kbd">D</kbd>
              <span>steer</span>
            </span>
            <span className="controls-hint__keys">
              <kbd className="kbd">Space</kbd>
              <span>pause</span>
              <kbd className="kbd">M</kbd>
              <span>mute</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
});

// ------------------------------------------------------------------- HUD

interface HudProps {
  snap: Snapshot;
  visible: boolean;
  sound: boolean;
  onPause: () => void;
  onToggleSound: () => void;
}

export const Hud = forwardRef<HTMLDivElement, HudProps>(function Hud({ snap, visible, sound, onPause, onToggleSound }, ref) {
  const [bump, setBump] = useState(0);
  const lastScore = useRef(snap.score);
  useEffect(() => {
    if (snap.score > lastScore.current) setBump((b) => b + 1);
    lastScore.current = snap.score;
  }, [snap.score]);

  return (
    <header className={`hud ${visible ? '' : 'hud--hidden'}`} ref={ref} aria-hidden={!visible}>
      <div className="hud__group">
        <div className="hud__score">
          <span className="hud__label">Score</span>
          <span key={`score-${bump}`} className={`hud__value ${bump ? 'hud__value--bump' : ''}`} data-testid="score">
            {formatScore(snap.score)}
          </span>
          {snap.gain && (
            <span key={`gain-${snap.gain.id}`} className={`gain gain--${snap.gain.kind}`} aria-hidden="true">
              +{snap.gain.points}
            </span>
          )}
        </div>
        <div className="hud__stat">
          <span className="hud__label">Best</span>
          <span className="hud__small" data-testid="hud-best">
            {formatScore(snap.best)}
          </span>
        </div>
        <div className="hud__stat hud__stat--wide">
          <span className="hud__label">Length</span>
          <span className="hud__small" data-testid="length">
            {snap.length}
          </span>
        </div>
        <div className="hud__stat hud__stat--wide">
          <span className="hud__label">Speed</span>
          <span className="hud__small">Lv {snap.level}</span>
        </div>
      </div>
      <div className="hud__group">
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleSound}
          onPointerUp={blurOnPointer}
          aria-label={sound ? 'Mute sound' : 'Unmute sound'}
          aria-pressed={!sound}
          tabIndex={visible ? 0 : -1}
        >
          {sound ? <SoundOnIcon /> : <SoundOffIcon />}
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={onPause}
          onPointerUp={blurOnPointer}
          aria-label="Pause game"
          tabIndex={visible ? 0 : -1}
          data-testid="pause-button"
        >
          <PauseIcon />
        </button>
      </div>
    </header>
  );
});

// ------------------------------------------------------------- overlays

interface PauseProps {
  onResume: () => void;
  onRestart: () => void;
  onSettings: () => void;
  onMenu: () => void;
}

export function PauseCard({ onResume, onRestart, onSettings, onMenu }: PauseProps) {
  const resumeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => resumeRef.current?.focus({ preventScroll: true }), []);
  return (
    <div className="overlay">
      <div className="card" role="dialog" aria-modal="true" aria-labelledby="pause-title">
        <p className="eyebrow">Game paused</p>
        <h2 className="card__title" id="pause-title">
          Take a breath
        </h2>
        <div className="card__actions">
          <button ref={resumeRef} type="button" className="btn btn--primary btn--block" onClick={onResume}>
            <PlayIcon />
            <span>Resume</span>
          </button>
          <button type="button" className="btn btn--secondary btn--block" onClick={onRestart}>
            <RetryIcon />
            <span>Restart</span>
          </button>
          <div className="card__split">
            <button type="button" className="btn btn--ghost" onClick={onSettings}>
              <GearIcon />
              <span>Settings</span>
            </button>
            <button type="button" className="btn btn--ghost" onClick={onMenu}>
              <HomeIcon />
              <span>Menu</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ResultProps {
  snap: Snapshot;
  touch: boolean;
  shareMessage: string | null;
  shareFallbackText: string | null;
  onRetry: () => void;
  onShare: () => void;
  onMenu: () => void;
}

const CAUSE: Record<string, string> = {
  wall: 'You hit the wall.',
  self: 'You bit your own tail.',
  obstacle: 'You hit an obstacle.',
};

export function ResultCard({ snap, touch, shareMessage, shareFallbackText, onRetry, onShare, onMenu }: ResultProps) {
  const won = snap.screen === 'won';
  const retryRef = useRef<HTMLButtonElement>(null);
  useEffect(() => retryRef.current?.focus({ preventScroll: true }), []);
  return (
    <div className="overlay overlay--result">
      <div className={`card card--result ${won ? 'card--victory' : ''}`} role="dialog" aria-modal="true" aria-labelledby="result-title">
        <p className="eyebrow">{won ? 'Board cleared' : 'Run over'}</p>
        <h2 className="card__title" id="result-title">
          {won ? 'Every cell is yours' : snap.deathCause ? CAUSE[snap.deathCause] : 'Run over'}
        </h2>
        <div className="result__score">
          <span className="result__value" data-testid="final-score">
            {formatScore(snap.score)}
          </span>
          {snap.newBest && <span className="badge">New best</span>}
        </div>
        <dl className="result__stats">
          <div>
            <dt>Best</dt>
            <dd>{formatScore(snap.best)}</dd>
          </div>
          <div>
            <dt>Length</dt>
            <dd>{snap.length}</dd>
          </div>
          <div>
            <dt>Orbs</dt>
            <dd>{snap.foodEaten + snap.bonusEaten}</dd>
          </div>
          <div>
            <dt>Time</dt>
            <dd>{formatTime(snap.elapsedMs)}</dd>
          </div>
        </dl>
        <div className="card__actions">
          <button ref={retryRef} type="button" className="btn btn--primary btn--block btn--big" onClick={onRetry}>
            <RetryIcon />
            <span>{won ? 'Play again' : 'Retry'}</span>
            {!touch && <kbd className="kbd kbd--onbtn">Enter</kbd>}
          </button>
          <div className="card__split">
            <button type="button" className="btn btn--secondary" onClick={onShare}>
              <ShareIcon />
              <span>Share score</span>
            </button>
            <button type="button" className="btn btn--ghost" onClick={onMenu}>
              <HomeIcon />
              <span>Menu</span>
            </button>
          </div>
        </div>
        <p className="share-status" role="status" aria-live="polite">
          {shareMessage}
        </p>
        {shareFallbackText && (
          <textarea className="share-fallback" readOnly value={shareFallbackText} aria-label="Score text to copy" onFocus={(e) => e.currentTarget.select()} />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------- touch pad

interface PadProps {
  visible: boolean;
  onSteer: (dir: Direction) => void;
}

const PAD: { dir: Direction; rotate: number; label: string }[] = [
  { dir: 'up', rotate: 0, label: 'Up' },
  { dir: 'left', rotate: -90, label: 'Left' },
  { dir: 'right', rotate: 90, label: 'Right' },
  { dir: 'down', rotate: 180, label: 'Down' },
];

export const TouchPad = forwardRef<HTMLDivElement, PadProps>(function TouchPad({ visible, onSteer }, ref) {
  return (
    <div className={`pad ${visible ? '' : 'pad--hidden'}`} ref={ref} aria-hidden={!visible}>
      <div className="pad__cross">
        {PAD.map((b) => (
          <button
            key={b.dir}
            type="button"
            className={`pad__btn pad__btn--${b.dir}`}
            aria-label={`Steer ${b.label}`}
            tabIndex={-1}
            data-testid={`pad-${b.dir}`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onSteer(b.dir);
            }}
          >
            <ArrowIcon rotate={b.rotate} />
          </button>
        ))}
      </div>
    </div>
  );
});
