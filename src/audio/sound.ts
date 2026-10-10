export type SoundName = 'eat' | 'bonus' | 'levelUp' | 'pause' | 'resume' | 'gameOver' | 'victory' | 'start';

// A major-pentatonic ladder: consecutive orbs climb it, so a good run sounds like a melody.
const LADDER = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];

type Ctx = AudioContext;

/**
 * Tiny synthesizer built on the Web Audio API. Nothing is created until the
 * first user gesture (browser autoplay rules), and every failure is swallowed:
 * audio is a nice-to-have, never a reason for gameplay to break.
 */
export class SoundEngine {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled: boolean;
  private streak = 0;
  private failed = false;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  /** Call from a user-gesture handler. Safe to call repeatedly. */
  unlock(): void {
    if (this.failed || !this.enabled) return;
    try {
      if (!this.ctx) {
        const Ctor: typeof AudioContext | undefined =
          window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) {
          this.failed = true;
          return;
        }
        const ctx = new Ctor();
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.ratio.value = 4;
        const master = ctx.createGain();
        master.gain.value = 0.32;
        master.connect(comp).connect(ctx.destination);
        this.ctx = ctx;
        this.master = master;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume().catch(() => undefined);
    } catch {
      this.failed = true;
      this.ctx = null;
    }
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (enabled) this.unlock();
    else if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend().catch(() => undefined);
  }

  /** For diagnostics: whether audio is running, suspended, not yet created, or unavailable. */
  get state(): 'running' | 'suspended' | 'idle' | 'unavailable' {
    if (this.failed) return 'unavailable';
    if (!this.ctx) return 'idle';
    return this.ctx.state === 'running' ? 'running' : 'suspended';
  }

  resetStreak(): void {
    this.streak = 0;
  }

  play(name: SoundName): void {
    if (!this.enabled || !this.ctx || !this.master || this.ctx.state !== 'running') return;
    try {
      const t = this.ctx.currentTime + 0.005;
      switch (name) {
        case 'eat': {
          const semis = LADDER[Math.min(this.streak, LADDER.length - 1)]!;
          this.streak = this.streak >= LADDER.length - 1 ? 3 : this.streak + 1;
          const f = 523.25 * Math.pow(2, semis / 12);
          this.tone(f, t, 0.16, 'sine', 0.5);
          this.tone(f * 2, t, 0.09, 'triangle', 0.12);
          break;
        }
        case 'bonus':
          [0, 4, 7, 12].forEach((s, i) => this.tone(880 * Math.pow(2, s / 12), t + i * 0.055, 0.14, 'triangle', 0.28));
          break;
        case 'levelUp':
          this.tone(392, t, 0.25, 'sine', 0.22, 784);
          break;
        case 'pause':
          this.tone(660, t, 0.08, 'sine', 0.25);
          this.tone(440, t + 0.07, 0.12, 'sine', 0.25);
          break;
        case 'resume':
          this.tone(440, t, 0.08, 'sine', 0.25);
          this.tone(660, t + 0.07, 0.12, 'sine', 0.25);
          break;
        case 'start':
          this.tone(330, t, 0.12, 'triangle', 0.25);
          this.tone(494, t + 0.08, 0.12, 'triangle', 0.25);
          this.tone(659, t + 0.16, 0.2, 'triangle', 0.25);
          break;
        case 'gameOver':
          this.tone(311, t, 0.55, 'sawtooth', 0.2, 82, 1400);
          this.thud(t, 0.35);
          break;
        case 'victory':
          [0, 4, 7, 12, 16, 19, 24].forEach((s, i) => this.tone(523.25 * Math.pow(2, s / 12), t + i * 0.09, 0.4, 'triangle', 0.24));
          break;
      }
    } catch {
      /* ignore: a failed sound must never interrupt play */
    }
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, gain: number, glideTo?: number, lowpass?: number): void {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
    env.gain.setValueAtTime(0.0001, start);
    env.gain.exponentialRampToValueAtTime(gain, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    let node: AudioNode = osc;
    if (lowpass) {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(lowpass, start);
      filter.frequency.exponentialRampToValueAtTime(200, start + dur);
      node = node.connect(filter);
    }
    node.connect(env).connect(this.master!);
    osc.start(start);
    osc.stop(start + dur + 0.05);
  }

  private thud(start: number, gain: number): void {
    const ctx = this.ctx!;
    if (!this.noise) {
      const len = Math.floor(ctx.sampleRate * 0.3);
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2);
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 420;
    const env = ctx.createGain();
    env.gain.setValueAtTime(gain, start);
    env.gain.exponentialRampToValueAtTime(0.0001, start + 0.3);
    src.connect(filter).connect(env).connect(this.master!);
    src.start(start);
  }

  dispose(): void {
    try {
      void this.ctx?.close();
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
  }
}
