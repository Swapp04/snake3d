import {
  AdditiveBlending,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PointLight,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  type Texture,
} from 'three';
import type { Cell, GameConfig } from '../game/types';
import { PALETTE, cellX, cellZ } from './palette';
import { radialTexture } from './textures';

const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

const cellKey = (c: Cell | null) => (c ? c.y * 10000 + c.x : -1);

/** The golden energy orb: core, orbiting ring, halo, and a warm point light. */
export class OrbView {
  readonly group = new Group();
  /** Everything except the light. The light itself is never hidden: changing the
   *  scene's light count would force every lit material to recompile mid-game. */
  private visual = new Group();
  private core: Mesh;
  private ring: Mesh;
  private halo: Sprite;
  private light: PointLight;
  private key = -1;
  private spawnAt = -10;
  private disposables: { dispose(): void }[] = [];

  constructor(
    private readonly config: GameConfig,
    haloTex: Texture,
  ) {
    const coreGeo = new SphereGeometry(0.22, 32, 20);
    const coreMat = new MeshStandardMaterial({
      color: PALETTE.orb,
      emissive: PALETTE.orbEmissive,
      emissiveIntensity: 2.1,
      roughness: 0.25,
      metalness: 0.1,
    });
    this.core = new Mesh(coreGeo, coreMat);
    this.core.castShadow = true;

    const ringGeo = new TorusGeometry(0.36, 0.016, 8, 72);
    const ringMat = new MeshStandardMaterial({ color: '#3a2a10', emissive: PALETTE.orbRing, emissiveIntensity: 1.6 });
    this.ring = new Mesh(ringGeo, ringMat);

    const haloMat = new SpriteMaterial({ map: haloTex, color: '#ffb340', blending: AdditiveBlending, depthWrite: false, opacity: 0.5 });
    this.halo = new Sprite(haloMat);
    this.halo.scale.setScalar(1.7);

    this.light = new PointLight(PALETTE.orbEmissive, 2.6, 4.5, 2);
    this.visual.add(this.core, this.ring, this.halo);
    this.group.add(this.visual, this.light);
    this.disposables.push(coreGeo, coreMat, ringGeo, ringMat, haloMat);
  }

  update(cell: Cell | null, time: number, reducedMotion: boolean): void {
    const key = cellKey(cell);
    if (key !== this.key) {
      this.key = key;
      this.spawnAt = time;
    }
    this.visual.visible = cell !== null;
    if (!cell) {
      this.light.intensity = 0;
      return;
    }
    const appear = easeOutBack(Math.min(1, (time - this.spawnAt) / 0.38));
    const bob = reducedMotion ? 0 : Math.sin(time * 2.4) * 0.06;
    this.group.position.set(cellX(this.config, cell.x), 0.46 + bob, cellZ(this.config, cell.y));
    this.group.scale.setScalar(Math.max(0.001, appear));
    const spin = reducedMotion ? 0.3 : 1;
    this.ring.rotation.set(1.15 + Math.sin(time * 0.9) * 0.2 * spin, time * 1.3 * spin, 0);
    const pulse = 0.5 + 0.5 * Math.sin(time * 3.2);
    this.halo.material.opacity = 0.38 + 0.16 * pulse;
    this.halo.scale.setScalar(1.55 + 0.18 * pulse);
    this.light.intensity = 2.2 + 0.8 * pulse;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** The violet bonus prism: a faceted octahedron that flickers as it runs out of time. */
export class PrismView {
  readonly group = new Group();
  private gem: Mesh;
  private halo: Sprite;
  private key = -1;
  private spawnAt = -10;
  private disposables: { dispose(): void }[] = [];

  constructor(
    private readonly config: GameConfig,
    haloTex: Texture,
  ) {
    const geo = new OctahedronGeometry(0.27, 0);
    const mat = new MeshStandardMaterial({
      color: PALETTE.prism,
      emissive: PALETTE.prismEmissive,
      emissiveIntensity: 1.4,
      roughness: 0.18,
      metalness: 0.25,
      flatShading: true,
    });
    this.gem = new Mesh(geo, mat);
    this.gem.scale.set(1, 1.35, 1);
    this.gem.castShadow = true;
    const haloMat = new SpriteMaterial({ map: haloTex, color: '#9a7bff', blending: AdditiveBlending, depthWrite: false, opacity: 0.45 });
    this.halo = new Sprite(haloMat);
    this.halo.scale.setScalar(1.5);
    this.group.add(this.gem, this.halo);
    this.disposables.push(geo, mat, haloMat);
  }

  /** remaining: fraction of lifetime left (0..1). */
  update(cell: Cell | null, remaining: number, time: number, reducedMotion: boolean): void {
    const key = cellKey(cell);
    if (key !== this.key) {
      this.key = key;
      this.spawnAt = time;
    }
    this.group.visible = cell !== null;
    if (!cell) return;
    const appear = easeOutBack(Math.min(1, (time - this.spawnAt) / 0.4));
    const urgent = remaining < 0.3;
    const flicker = urgent ? 0.75 + 0.25 * Math.sign(Math.sin(time * (reducedMotion ? 6 : 18))) : 1;
    this.group.position.set(cellX(this.config, cell.x), 0.5 + (reducedMotion ? 0 : Math.sin(time * 3) * 0.05), cellZ(this.config, cell.y));
    this.group.scale.setScalar(Math.max(0.001, appear * (0.85 + 0.15 * Math.min(1, remaining * 3))));
    this.gem.rotation.y = time * (reducedMotion ? 0.6 : 1.8);
    this.halo.material.opacity = 0.45 * flicker;
    (this.gem.material as MeshStandardMaterial).emissiveIntensity = 1.4 * flicker;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

/** Expanding floor rings, used as the collection response. Pooled. */
export class Shockwaves {
  readonly group = new Group();
  private pool: { mesh: Mesh<RingGeometry, MeshBasicMaterial>; start: number; duration: number }[] = [];
  private geo = new RingGeometry(0.82, 1, 56).rotateX(-Math.PI / 2);

  constructor(size = 6) {
    for (let i = 0; i < size; i++) {
      const mat = new MeshBasicMaterial({ color: '#ffffff', transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0 });
      const mesh = new Mesh(this.geo, mat);
      mesh.visible = false;
      mesh.renderOrder = 2;
      this.group.add(mesh);
      this.pool.push({ mesh, start: -10, duration: 0.5 });
    }
  }

  emit(x: number, z: number, color: string, time: number, duration = 0.5): void {
    const slot = this.pool.reduce((a, b) => (a.start < b.start ? a : b));
    slot.start = time;
    slot.duration = duration;
    slot.mesh.position.set(x, 0.02, z);
    slot.mesh.material.color.set(color);
    slot.mesh.visible = true;
  }

  update(time: number): void {
    for (const s of this.pool) {
      if (!s.mesh.visible) continue;
      const t = (time - s.start) / s.duration;
      if (t >= 1) {
        s.mesh.visible = false;
        continue;
      }
      const e = 1 - Math.pow(1 - t, 3);
      s.mesh.scale.setScalar(0.25 + e * 1.35);
      s.mesh.material.opacity = 0.75 * (1 - t);
    }
  }

  dispose(): void {
    this.geo.dispose();
    for (const s of this.pool) s.mesh.material.dispose();
  }
}

export function haloTexture(): Texture {
  return radialTexture([
    [0, 'rgba(255,255,255,0.9)'],
    [0.22, 'rgba(255,255,255,0.35)'],
    [0.55, 'rgba(255,255,255,0.08)'],
    [1, 'rgba(255,255,255,0)'],
  ]);
}
