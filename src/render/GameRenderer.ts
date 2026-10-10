import {
  ACESFilmicToneMapping,
  DirectionalLight,
  HalfFloatType,
  HemisphereLight,
  Material,
  Mesh,
  Object3D,
  PCFShadowMap,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  WebGLRenderTarget,
  type Texture,
} from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { Cell, GameConfig, GameEvent, GameState } from '../game/types';
import type { QualityLevel } from '../lib/settings';
import { Arena } from './arena';
import { CameraRig, type CameraView, type Insets } from './cameraRig';
import { PALETTE, cellX, cellZ } from './palette';
import { DustField, ParticleSystem } from './particles';
import { OrbView, PrismView, Shockwaves, haloTexture } from './pickups';
import { SnakeView } from './snakeView';
import { backdropTexture } from './textures';

export interface RendererOptions {
  quality: QualityLevel;
  reducedMotion: boolean;
  onContextLost?: () => void;
  onContextRestored?: () => void;
}

export interface FrameInput {
  view: CameraView;
  state: GameState;
  prevSnake: readonly Cell[];
  alpha: number;
}

export class WebGLUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('WebGL is not available on this device or browser.');
    this.name = 'WebGLUnavailableError';
    this.cause = cause;
  }
}

const PIXEL_RATIO: Record<QualityLevel, number> = { low: 1, medium: 1.5, high: 2 };
const SHADOW_SIZE: Record<QualityLevel, number> = { low: 0, medium: 1024, high: 2048 };

export class GameRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private rig: CameraRig;
  private keyLight: DirectionalLight;
  private arena: Arena;
  private snake: SnakeView;
  private orb: OrbView;
  private prism: PrismView;
  private shockwaves = new Shockwaves();
  private particles = new ParticleSystem();
  private dust: DustField;
  private textures: Texture[] = [];
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private quality: QualityLevel;
  private reducedMotion: boolean;
  private deathAt = -1;
  private winAt = -1;
  private width = 1;
  private height = 1;
  private disposed = false;

  constructor(
    private readonly host: HTMLElement,
    private readonly config: GameConfig,
    private readonly options: RendererOptions,
  ) {
    this.quality = options.quality;
    this.reducedMotion = options.reducedMotion;
    try {
      this.renderer = new WebGLRenderer({
        antialias: (window.devicePixelRatio || 1) < 2.5,
        powerPreference: 'high-performance',
        alpha: false,
        stencil: false,
      });
    } catch (err) {
      throw new WebGLUnavailableError(err);
    }
    if (!this.renderer.getContext()) throw new WebGLUnavailableError();

    const r = this.renderer;
    r.outputColorSpace = SRGBColorSpace;
    r.toneMapping = ACESFilmicToneMapping;
    r.toneMappingExposure = 1.2;
    r.shadowMap.type = PCFShadowMap;
    r.info.autoReset = false;
    this.canvas = r.domElement;
    this.canvas.className = 'game-canvas';
    this.canvas.setAttribute('aria-hidden', 'true');
    this.canvas.addEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.handleContextRestored);
    host.appendChild(this.canvas);

    const backdrop = backdropTexture();
    this.textures.push(backdrop);
    this.scene.background = backdrop;

    const extent = Math.max(config.cols, config.rows) / 2 + 1.2;
    this.rig = new CameraRig(config.cols / 2 + 0.7, config.rows / 2 + 0.7);

    // Lighting: warm key with soft shadows, cool rim from behind, hemisphere fill.
    this.scene.add(new HemisphereLight(PALETTE.skyLight, PALETTE.groundLight, 1.5));
    this.keyLight = new DirectionalLight(PALETTE.keyLight, 2.7);
    this.keyLight.position.set(-extent * 0.7, extent * 1.9, extent * 1.1);
    const sc = this.keyLight.shadow.camera;
    sc.left = sc.bottom = -extent - 1;
    sc.right = sc.top = extent + 1;
    sc.near = 1;
    sc.far = extent * 6;
    this.keyLight.shadow.bias = -0.0006;
    this.keyLight.shadow.normalBias = 0.025;
    this.keyLight.shadow.radius = 4;
    const rim = new DirectionalLight(PALETTE.rimLight, 1.3);
    rim.position.set(extent * 0.6, extent * 0.7, -extent * 1.6);
    this.scene.add(this.keyLight, this.keyLight.target, rim);

    this.arena = new Arena(config);
    this.snake = new SnakeView(config, this.quality);
    const halo = haloTexture();
    this.textures.push(halo);
    this.orb = new OrbView(config, halo);
    this.prism = new PrismView(config, halo);
    this.dust = new DustField(extent * 1.4);
    this.scene.add(this.arena.group, this.snake.group, this.orb.group, this.prism.group, this.shockwaves.group, this.particles.mesh, this.dust.mesh);

    this.applyQuality(true);
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(host);
    }
    this.rig.setView('menu', true);
    this.warmUp();
  }

  /**
   * Renders one frame with every hidden object switched on (at near-zero scale),
   * so all shader programs, including shadow-depth variants, compile up front
   * instead of stalling the first time a bonus prism or effect appears.
   */
  private warmUp(): void {
    const toggled: { o: Object3D; scale: Vector3 }[] = [];
    this.scene.traverse((o) => {
      if (!o.visible) {
        toggled.push({ o, scale: o.scale.clone() });
        o.visible = true;
        o.scale.setScalar(1e-4);
      }
    });
    try {
      if (this.composer) this.composer.render(0);
      else this.renderer.render(this.scene, this.rig.camera);
    } finally {
      for (const { o, scale } of toggled) {
        o.visible = false;
        o.scale.copy(scale);
      }
    }
  }

  get drawCalls(): number {
    return this.renderer.info.render.calls;
  }

  get triangles(): number {
    return this.renderer.info.render.triangles;
  }

  setQuality(quality: QualityLevel): void {
    if (quality === this.quality) return;
    this.quality = quality;
    this.applyQuality(false);
  }

  getQuality(): QualityLevel {
    return this.quality;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  setInsets(view: CameraView, insets: Insets): void {
    this.rig.setInsets(view, insets);
  }

  setView(view: CameraView): void {
    this.rig.setView(view, this.reducedMotion);
  }

  /** Forget per-run visual state (death/victory timers, particles, swallow bulges). */
  resetRun(): void {
    this.deathAt = -1;
    this.winAt = -1;
    this.snake.reset();
    this.particles.clear();
  }

  private applyQuality(initial: boolean): void {
    const q = this.quality;
    const r = this.renderer;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, PIXEL_RATIO[q]));
    const shadows = SHADOW_SIZE[q] > 0;
    const shadowChanged = r.shadowMap.enabled !== shadows;
    r.shadowMap.enabled = shadows;
    this.keyLight.castShadow = shadows;
    if (shadows) {
      const size = SHADOW_SIZE[q];
      if (this.keyLight.shadow.mapSize.x !== size) {
        this.keyLight.shadow.mapSize.set(size, size);
        this.keyLight.shadow.map?.dispose();
        this.keyLight.shadow.map = null;
      }
    } else if (this.keyLight.shadow.map) {
      // Release the (up to 16 MB) depth target on the devices that need memory most.
      this.keyLight.shadow.map.dispose();
      this.keyLight.shadow.map = null;
    }
    if (shadowChanged && !initial) {
      this.scene.traverse((o) => {
        if (o instanceof Mesh) {
          const mats: Material[] = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of mats) m.needsUpdate = true;
        }
      });
    }
    this.snake.setQuality(q);
    this.particles.scaleFactor = q === 'low' ? 0.5 : 1;
    this.dust.mesh.visible = q !== 'low';

    if (q === 'high' && !this.composer) {
      const target = new WebGLRenderTarget(1, 1, { type: HalfFloatType, samples: 4 });
      this.composer = new EffectComposer(r, target);
      this.composer.addPass(new RenderPass(this.scene, this.rig.camera));
      this.bloom = new UnrealBloomPass(new Vector2(256, 256), 0.5, 0.55, 0.85);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
    } else if (q !== 'high' && this.composer) {
      this.disposeComposer();
    }
    if (!initial) this.resize();
  }

  private disposeComposer(): void {
    if (!this.composer) return;
    for (const pass of this.composer.passes) pass.dispose();
    this.composer.renderTarget1.dispose();
    this.composer.renderTarget2.dispose();
    this.composer.dispose();
    this.composer = null;
    this.bloom = null;
  }

  resize(): void {
    if (this.disposed) return;
    const w = Math.max(1, this.host.clientWidth);
    const h = Math.max(1, this.host.clientHeight);
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.rig.setSize(w, h);
    if (this.composer) {
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(w, h);
    }
  }

  onEvents(events: readonly GameEvent[], state: GameState, time: number): void {
    const cfg = this.config;
    for (const e of events) {
      switch (e.type) {
        case 'eat': {
          const x = cellX(cfg, e.cell.x);
          const z = cellZ(cfg, e.cell.y);
          this.particles.burst(x, 0.5, z, { count: 26, color: PALETTE.orb, speed: 3.2, life: 0.75, size: 0.13, lift: 1.4 });
          this.shockwaves.emit(x, z, PALETTE.orb, time, 0.5);
          this.snake.swallow(time);
          break;
        }
        case 'bonus': {
          const x = cellX(cfg, e.cell.x);
          const z = cellZ(cfg, e.cell.y);
          this.particles.burst(x, 0.5, z, { count: 40, color: PALETTE.prism, speed: 3.8, life: 0.9, size: 0.14, lift: 1.8 });
          this.shockwaves.emit(x, z, PALETTE.prism, time, 0.65);
          this.snake.swallow(time);
          break;
        }
        case 'bonusExpire':
          this.particles.burst(cellX(cfg, e.cell.x), 0.5, cellZ(cfg, e.cell.y), { count: 10, color: PALETTE.prism, speed: 1, life: 0.6, size: 0.1, gravity: -0.5 });
          break;
        case 'levelUp': {
          const h = state.snake[0]!;
          this.shockwaves.emit(cellX(cfg, h.x), cellZ(cfg, h.y), PALETTE.railGlow, time, 0.7);
          break;
        }
        case 'die': {
          const h = state.snake[0]!;
          const x = (cellX(cfg, h.x) + cellX(cfg, e.cell.x)) / 2;
          const z = (cellZ(cfg, h.y) + cellZ(cfg, e.cell.y)) / 2;
          this.particles.burst(x, 0.4, z, { count: 34, color: PALETTE.danger, speed: 3.6, life: 0.8, size: 0.13, lift: 1 });
          this.particles.burst(x, 0.4, z, { count: 18, color: PALETTE.snakeHead, speed: 2.4, life: 0.9, size: 0.1, lift: 0.8 });
          this.shockwaves.emit(x, z, PALETTE.danger, time, 0.6);
          this.rig.shake(0.32);
          break;
        }
        case 'win': {
          for (let i = 0; i < 7; i++) {
            const c = state.snake[Math.floor((i / 7) * state.snake.length)]!;
            const color = i % 2 === 0 ? PALETTE.orb : PALETTE.prism;
            this.particles.burst(cellX(cfg, c.x), 0.6, cellZ(cfg, c.y), { count: 30, color, speed: 4.5, life: 1.3, size: 0.15, lift: 3 });
          }
          break;
        }
        default:
          break;
      }
    }
  }

  frame(input: FrameInput, dt: number, time: number): void {
    if (this.disposed) return;
    const { state } = input;
    if (state.status === 'over') {
      if (this.deathAt < 0) this.deathAt = time;
    } else this.deathAt = -1;
    if (state.status === 'won') {
      if (this.winAt < 0) this.winAt = time;
    } else this.winAt = -1;

    this.rig.update(dt, this.reducedMotion);
    this.snake.update({
      state,
      prevSnake: input.prevSnake,
      alpha: input.alpha,
      time,
      dt,
      deathAge: this.deathAt >= 0 ? time - this.deathAt : -1,
      winAge: this.winAt >= 0 ? time - this.winAt : -1,
    });
    this.orb.update(state.food, time, this.reducedMotion);
    const bonus = state.bonus;
    const remaining = bonus ? Math.max(0, (bonus.expiresAtTick - state.tick - input.alpha) / Math.max(1, bonus.expiresAtTick - bonus.spawnedAtTick)) : 0;
    this.prism.update(bonus ? bonus.cell : null, remaining, time, this.reducedMotion);
    this.shockwaves.update(time);
    this.particles.update(dt);
    this.dust.update(this.reducedMotion ? 0 : time);

    this.renderer.info.reset();
    if (this.composer) this.composer.render(dt);
    else this.renderer.render(this.scene, this.rig.camera);
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.options.onContextLost?.();
  };

  private handleContextRestored = () => {
    this.options.onContextRestored?.();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.resizeObserver?.disconnect();
    this.canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);
    this.disposeComposer();
    this.arena.dispose();
    this.snake.dispose();
    this.orb.dispose();
    this.prism.dispose();
    this.shockwaves.dispose();
    this.particles.dispose();
    this.dust.dispose();
    for (const t of this.textures) t.dispose();
    this.keyLight.shadow.map?.dispose();
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }

  /** Size in CSS pixels, exposed for diagnostics. */
  get size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }
}
