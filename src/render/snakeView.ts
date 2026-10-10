import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
} from 'three';
import { DELTA } from '../game/config';
import type { Cell, GameConfig, GameState } from '../game/types';
import type { QualityLevel } from '../lib/settings';
import { PALETTE, cellX, cellZ } from './palette';
import { radialTexture } from './textures';

const BODY_RADIUS = 0.335;
const TAIL_RADIUS = 0.07;
const TAIL_TAPER_CELLS = 2.8;
const CORNER_RADIUS = 0.5; // half a cell: the tube bends through each turn cell
const BODY_START = 0.06; // the tube begins just inside the head mesh
const BULGE_SPEED = 9; // cells per second a swallowed orb travels down the body
const TAIL_CAP_RINGS = 4;

interface QualityProfile {
  spacing: number;
  ringSegments: number;
}

const PROFILES: Record<QualityLevel, QualityProfile> = {
  low: { spacing: 0.25, ringSegments: 8 },
  medium: { spacing: 0.17, ringSegments: 12 },
  high: { spacing: 0.13, ringSegments: 16 },
};

export interface SnakeFrame {
  state: GameState;
  prevSnake: readonly Cell[];
  alpha: number;
  time: number;
  dt: number;
  /** Seconds since death, or -1. */
  deathAge: number;
  /** Seconds since victory, or -1. */
  winAge: number;
}

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
};

/**
 * The snake body is a continuous tube rebuilt every frame from the interpolated
 * cell path (into preallocated buffers). Corners are rounded with quarter-circle
 * arcs, but samples stay parametrised by distance along the original path, so
 * body-relative details (segment swell, spine lights) never slide.
 */
export class SnakeView {
  readonly group = new Group();
  private tube: Mesh<BufferGeometry, MeshPhysicalMaterial>;
  private spine: InstancedMesh;
  private shadows: InstancedMesh;
  private head = new Group();
  private headMat: MeshPhysicalMaterial;
  private disposables: { dispose(): void }[] = [];
  private profile: QualityProfile;
  private readonly maxCells: number;

  // Preallocated per-frame buffers.
  private pts: Float32Array;
  private positions!: Float32Array;
  private normals!: Float32Array;
  private colors!: Float32Array;
  private ringCos!: Float32Array;
  private ringSin!: Float32Array;
  private maxRings = 0;
  private sample = { x: 0, z: 0, tx: 1, tz: 0 };
  private bulgePos: number[] = [];

  private m = new Matrix4();
  private c = new Color();
  private cHead = new Color(PALETTE.snakeHead);
  private cBody = new Color(PALETTE.snakeBody);
  private cTail = new Color(PALETTE.snakeTail);
  private cDead = new Color(PALETTE.snakeDead);
  private cDanger = new Color(PALETTE.danger);
  private cGold = new Color(PALETTE.orb);
  private cWhite = new Color('#ffffff');
  private yaw = 0;
  private yawInit = false;
  private bulges: number[] = []; // start times (seconds)
  private gulpAt = -10;

  constructor(
    private readonly config: GameConfig,
    quality: QualityLevel,
  ) {
    this.maxCells = config.cols * config.rows;
    this.pts = new Float32Array((this.maxCells + 2) * 2);
    this.profile = PROFILES[quality];

    const bodyMat = new MeshPhysicalMaterial({
      color: '#ffffff',
      vertexColors: true,
      roughness: 0.32,
      metalness: 0.05,
      clearcoat: 0.75,
      clearcoatRoughness: 0.25,
      sheen: 0.25,
      sheenColor: new Color('#5cf0b0'),
    });
    this.tube = new Mesh(this.buildTubeGeometry(), bodyMat);
    this.tube.frustumCulled = false;
    this.tube.castShadow = true;
    this.tube.receiveShadow = true;

    const spineGeo = new SphereGeometry(1, 10, 8);
    const spineMat = new MeshStandardMaterial({ color: '#0f3d2c', emissive: PALETTE.snakeSpine, emissiveIntensity: 1.1, roughness: 0.4 });
    this.spine = new InstancedMesh(spineGeo, spineMat, this.maxCells);
    this.spine.instanceMatrix.setUsage(DynamicDrawUsage);
    this.spine.frustumCulled = false;

    const shadowTex = radialTexture([[0, 'rgba(0,0,0,0.85)'], [0.5, 'rgba(0,0,0,0.35)'], [1, 'rgba(0,0,0,0)']], 64);
    const shadowGeo = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const shadowMat = new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.3, color: '#000000' });
    shadowMat.polygonOffset = true;
    shadowMat.polygonOffsetFactor = -2;
    this.shadows = new InstancedMesh(shadowGeo, shadowMat, this.maxCells * 2 + 4);
    this.shadows.instanceMatrix.setUsage(DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = 1;

    // Head: a slightly elongated, larger sphere with forward-facing eyes.
    this.headMat = new MeshPhysicalMaterial({
      color: PALETTE.snakeHead,
      roughness: 0.3,
      metalness: 0.05,
      clearcoat: 0.8,
      clearcoatRoughness: 0.2,
      sheen: 0.25,
      sheenColor: new Color('#7dffc8'),
      emissive: '#000000',
    });
    const headGeo = new SphereGeometry(0.42, 32, 24);
    const headMesh = new Mesh(headGeo, this.headMat);
    headMesh.scale.set(1, 0.82, 1.14);
    headMesh.position.y = 0.36;
    headMesh.castShadow = true;
    this.head.add(headMesh);

    const eyeGeo = new SphereGeometry(1, 16, 12);
    const eyeMat = new MeshStandardMaterial({ color: PALETTE.eyeWhite, roughness: 0.25, emissive: '#2a2a22', emissiveIntensity: 0.4 });
    const pupilMat = new MeshStandardMaterial({ color: PALETTE.pupil, roughness: 0.12, metalness: 0.2 });
    const glintMat = new MeshBasicMaterial({ color: '#ffffff' });
    for (const side of [-1, 1]) {
      const eye = new Mesh(eyeGeo, eyeMat);
      eye.scale.setScalar(0.125);
      eye.position.set(side * 0.2, 0.58, 0.18);
      const pupil = new Mesh(eyeGeo, pupilMat);
      pupil.scale.setScalar(0.072);
      pupil.position.set(side * 0.215, 0.605, 0.275);
      const glint = new Mesh(eyeGeo, glintMat);
      glint.scale.setScalar(0.022);
      glint.position.set(side * 0.2, 0.655, 0.315);
      this.head.add(eye, pupil, glint);
    }

    this.group.add(this.shadows, this.tube, this.spine, this.head);
    this.disposables.push(spineGeo, spineMat, shadowTex, shadowGeo, shadowMat, headGeo, this.headMat, eyeGeo, eyeMat, pupilMat, glintMat, bodyMat);
  }

  /** Allocates tube buffers sized for the longest possible snake at this quality. */
  private buildTubeGeometry(): BufferGeometry {
    const { spacing, ringSegments: R } = this.profile;
    this.maxRings = Math.ceil((this.maxCells + 1) / spacing) + 4 + TAIL_CAP_RINGS;
    const verts = this.maxRings * R;
    this.positions = new Float32Array(verts * 3);
    this.normals = new Float32Array(verts * 3);
    this.colors = new Float32Array(verts * 3);
    this.ringCos = new Float32Array(R);
    this.ringSin = new Float32Array(R);
    for (let k = 0; k < R; k++) {
      const a = (k / R) * Math.PI * 2;
      this.ringCos[k] = Math.cos(a);
      this.ringSin[k] = Math.sin(a);
    }
    const index = new Uint32Array((this.maxRings - 1) * R * 6);
    let o = 0;
    for (let i = 0; i < this.maxRings - 1; i++) {
      for (let k = 0; k < R; k++) {
        const a = i * R + k;
        const b = i * R + ((k + 1) % R);
        const c = (i + 1) * R + k;
        const d = (i + 1) * R + ((k + 1) % R);
        index[o++] = a;
        index[o++] = c;
        index[o++] = b;
        index[o++] = b;
        index[o++] = c;
        index[o++] = d;
      }
    }
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('normal', new BufferAttribute(this.normals, 3).setUsage(DynamicDrawUsage));
    geo.setAttribute('color', new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage));
    geo.setIndex(new BufferAttribute(index, 1));
    geo.setDrawRange(0, 0);
    return geo;
  }

  setQuality(quality: QualityLevel): void {
    const next = PROFILES[quality];
    if (next === this.profile) return;
    this.profile = next;
    const old = this.tube.geometry;
    this.tube.geometry = this.buildTubeGeometry();
    old.dispose();
  }

  /** Called when an orb is eaten: starts a swallow bulge and a head gulp. */
  swallow(time: number): void {
    this.bulges.push(time);
    this.gulpAt = time;
    if (this.bulges.length > 8) this.bulges.shift();
  }

  reset(): void {
    this.bulges.length = 0;
    this.gulpAt = -10;
    this.yawInit = false;
  }

  /**
   * Position and tangent at distance `s` along the polyline, with corners rounded.
   * Writes into this.sample to avoid allocation.
   */
  private samplePath(count: number, seg: number, segStart: number, segLen: number, s: number): void {
    const pts = this.pts;
    const ax = pts[seg * 2]!;
    const az = pts[seg * 2 + 1]!;
    const bx = pts[seg * 2 + 2]!;
    const bz = pts[seg * 2 + 3]!;
    const inv = segLen > 1e-6 ? 1 / segLen : 0;
    const dx = (bx - ax) * inv;
    const dz = (bz - az) * inv;
    const d0 = Math.min(segLen, Math.max(0, s - segStart));
    const d1 = segLen - d0;
    const out = this.sample;
    out.x = ax + dx * d0;
    out.z = az + dz * d0;
    out.tx = dx;
    out.tz = dz;
    if (segLen <= 1e-6) return;

    // Corner at the start of this segment (we are on its outgoing half).
    if (seg > 0) {
      const px = pts[seg * 2 - 2]!;
      const pz = pts[seg * 2 - 1]!;
      const pl = Math.hypot(ax - px, az - pz);
      if (pl > 1e-6) {
        const ix = (ax - px) / pl;
        const iz = (az - pz) / pl;
        const r = Math.min(CORNER_RADIUS, pl, segLen);
        if (ix * dx + iz * dz < 0.5 && d0 < r) {
          this.arc(ax, az, ix, iz, dx, dz, r, (r + d0) / (2 * r));
          return;
        }
      }
    }
    // Corner at the end of this segment (we are on its incoming half).
    if (seg + 2 < count) {
      const nx = pts[seg * 2 + 4]!;
      const nz = pts[seg * 2 + 5]!;
      const nl = Math.hypot(nx - bx, nz - bz);
      if (nl > 1e-6) {
        const ox = (nx - bx) / nl;
        const oz = (nz - bz) / nl;
        const r = Math.min(CORNER_RADIUS, nl, segLen);
        if (dx * ox + dz * oz < 0.5 && d1 < r) {
          this.arc(bx, bz, dx, dz, ox, oz, r, (r - d1) / (2 * r));
        }
      }
    }
  }

  /** Quarter arc around corner (vx,vz) from incoming dir (ix,iz) to outgoing (ox,oz); u in [0,1]. */
  private arc(vx: number, vz: number, ix: number, iz: number, ox: number, oz: number, r: number, u: number): void {
    const phi = u * Math.PI * 0.5;
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const cx = vx - ix * r + ox * r;
    const cz = vz - iz * r + oz * r;
    const out = this.sample;
    out.x = cx - ox * r * cos + ix * r * sin;
    out.z = cz - oz * r * cos + iz * r * sin;
    const tx = ix * cos + ox * sin;
    const tz = iz * cos + oz * sin;
    const tl = Math.hypot(tx, tz) || 1;
    out.tx = tx / tl;
    out.tz = tz / tl;
  }

  update(f: SnakeFrame): void {
    const { state, prevSnake, time, dt } = f;
    const snake = state.snake;
    const n = snake.length;
    const a = f.alpha;
    const cfg = this.config;

    // Polyline: interpolated head, the cell centres behind it, interpolated tail.
    const pts = this.pts;
    const p0 = prevSnake[0] ?? snake[0]!;
    const h = snake[0]!;
    pts[0] = cellX(cfg, p0.x + (h.x - p0.x) * a);
    pts[1] = cellZ(cfg, p0.y + (h.y - p0.y) * a);
    let count = 1;
    for (let i = 1; i < n; i++) {
      pts[count * 2] = cellX(cfg, snake[i]!.x);
      pts[count * 2 + 1] = cellZ(cfg, snake[i]!.y);
      count++;
    }
    const last = snake[n - 1]!;
    const tailFrom = prevSnake.length >= n ? prevSnake[n - 1]! : last;
    pts[count * 2] = cellX(cfg, tailFrom.x + (last.x - tailFrom.x) * a);
    pts[count * 2 + 1] = cellZ(cfg, tailFrom.y + (last.y - tailFrom.y) * a);
    count++;

    let totalLength = 0;
    for (let i = 0; i < count - 1; i++) {
      totalLength += Math.hypot(pts[i * 2 + 2]! - pts[i * 2]!, pts[i * 2 + 3]! - pts[i * 2 + 1]!);
    }

    const deathFade = f.deathAge >= 0 ? smoothstep(0.15, 0.9, f.deathAge) : 0;
    const winGlow = f.winAge >= 0;

    const bulgePos = this.bulgePos;
    bulgePos.length = 0;
    for (let i = this.bulges.length - 1; i >= 0; i--) {
      const pos = (time - this.bulges[i]!) * BULGE_SPEED;
      if (pos > totalLength + 1) this.bulges.splice(i, 1);
      else bulgePos.push(pos);
    }

    const { spacing, ringSegments: R } = this.profile;
    const P = this.positions;
    const N = this.normals;
    const C = this.colors;
    let seg = 0;
    let segStart = 0;
    let segLen = Math.hypot(pts[2]! - pts[0]!, pts[3]! - pts[1]!);
    let rings = 0;
    let shadowCount = 0;
    let spineCount = 0;
    let nextSpine = 1;
    let nextShadow = 0.3;
    const end = Math.max(BODY_START, totalLength);
    const ringBudget = this.maxRings - TAIL_CAP_RINGS; // reserve rings for the tail cap

    for (let i = 0; rings < ringBudget; i++) {
      const s = Math.min(end, BODY_START + i * spacing);
      while (s > segStart + segLen && seg < count - 2) {
        segStart += segLen;
        seg++;
        segLen = Math.hypot(pts[seg * 2 + 2]! - pts[seg * 2]!, pts[seg * 2 + 3]! - pts[seg * 2 + 1]!);
      }
      this.samplePath(count, seg, segStart, segLen, s);
      const { x, z, tx, tz } = this.sample;

      const toTail = totalLength - s;
      const taper = smoothstep(0, TAIL_TAPER_CELLS, toTail);
      let r = TAIL_RADIUS + (BODY_RADIUS - TAIL_RADIUS) * (0.12 + 0.88 * taper);
      r *= 1 + 0.022 * Math.cos(s * Math.PI * 2); // a subtle swell per cell keeps segments readable
      for (const b of bulgePos) r *= 1 + 0.28 * Math.exp(-((s - b) * (s - b)) / 0.18);
      const ry = r * 0.94;
      const cy = ry;

      const u = totalLength > 0 ? s / totalLength : 0;
      const c = this.c;
      if (u < 0.5) c.copy(this.cHead).lerp(this.cBody, u * 2);
      else c.copy(this.cBody).lerp(this.cTail, (u - 0.5) * 2);
      c.lerp(this.cWhite, 0.05 * (0.5 + 0.5 * Math.cos(s * Math.PI * 2)));
      if (deathFade > 0 || f.deathAge >= 0) {
        const wave = Math.exp(-Math.pow((s - f.deathAge * 14) / 1.4, 2));
        c.lerp(this.cDead, deathFade).lerp(this.cDanger, wave * (1 - deathFade * 0.6) * 0.8);
      }
      if (winGlow) c.lerp(this.cGold, 0.35 + 0.35 * Math.sin(time * 5 - s * 0.7));

      // Ring frame: side = horizontal perpendicular to the tangent, up = +Y.
      const sx = -tz;
      const sz = tx;
      const base = rings * R;
      for (let k = 0; k < R; k++) {
        const cos = this.ringCos[k]!;
        const sin = this.ringSin[k]!;
        const nx = sx * cos;
        const ny = sin;
        const nz = sz * cos;
        const vi = (base + k) * 3;
        P[vi] = x + nx * r;
        P[vi + 1] = cy + ny * ry;
        P[vi + 2] = z + nz * r;
        N[vi] = nx;
        N[vi + 1] = ny;
        N[vi + 2] = nz;
        C[vi] = c.r;
        C[vi + 1] = c.g;
        C[vi + 2] = c.b;
      }
      rings++;

      if (s >= nextShadow && shadowCount < this.shadows.instanceMatrix.count - 1) {
        const sz2 = r * 3.1;
        this.m.makeScale(sz2, 1, sz2).setPosition(x, 0.006, z);
        this.shadows.setMatrixAt(shadowCount++, this.m);
        nextShadow += 0.5;
      }
      if (s >= nextSpine && spineCount < this.spine.instanceMatrix.count && toTail > 0.6) {
        const sr = 0.038 * (0.6 + 0.4 * taper) * (1 - deathFade);
        this.m.makeScale(sr, sr, sr).setPosition(x, ry * 1.98, z);
        this.spine.setMatrixAt(spineCount++, this.m);
        nextSpine += 1;
      }
      if (s >= end) {
        // Hemispherical tail cap: rings shrinking along a quarter circle past the end.
        for (let j = 1; j <= TAIL_CAP_RINGS; j++) {
          const ang = (j / TAIL_CAP_RINGS) * Math.PI * 0.5;
          const along = Math.sin(ang);
          const scale = Math.cos(ang);
          const capBase = rings * R;
          for (let k = 0; k < R; k++) {
            const cos = this.ringCos[k]!;
            const sin = this.ringSin[k]!;
            const vi = (capBase + k) * 3;
            const rx = sx * cos * scale;
            const rz = sz * cos * scale;
            P[vi] = x + tx * along * r + rx * r;
            P[vi + 1] = cy + sin * scale * ry;
            P[vi + 2] = z + tz * along * r + rz * r;
            N[vi] = rx + tx * along;
            N[vi + 1] = sin * scale;
            N[vi + 2] = rz + tz * along;
            C[vi] = c.r;
            C[vi + 1] = c.g;
            C[vi + 2] = c.b;
          }
          rings++;
        }
        break;
      }
    }

    const geo = this.tube.geometry;
    geo.setDrawRange(0, Math.max(0, rings - 1) * R * 6);
    for (const name of ['position', 'normal', 'color']) {
      const attr = geo.getAttribute(name) as BufferAttribute;
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, rings * R * 3);
      attr.needsUpdate = true;
    }
    this.spine.count = spineCount;
    this.spine.instanceMatrix.needsUpdate = true;

    // Head placement and orientation.
    const dir = DELTA[state.direction];
    const targetYaw = Math.atan2(dir.x, dir.y);
    if (!this.yawInit) {
      this.yaw = targetYaw;
      this.yawInit = true;
    }
    let diff = targetYaw - this.yaw;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.yaw += diff * (1 - Math.exp(-dt * 22));
    let hx = pts[0]!;
    let hz = pts[1]!;
    if (f.deathAge >= 0) {
      // A short lunge toward the obstacle, then recoil.
      const k = Math.sin(Math.min(1, f.deathAge / 0.22) * Math.PI) * 0.16;
      hx += dir.x * k;
      hz += dir.y * k;
    }
    this.head.position.set(hx, 0, hz);
    this.head.rotation.y = this.yaw;
    const gulp = Math.max(0, 1 - (time - this.gulpAt) / 0.22);
    const pulse = 1 + 0.12 * Math.sin(gulp * Math.PI);
    this.head.scale.setScalar(pulse);

    this.headMat.color.copy(this.cHead);
    if (f.deathAge >= 0) {
      const flash = Math.max(0, 1 - f.deathAge / 0.5);
      this.headMat.color.lerp(this.cDead, deathFade * 0.85).lerp(this.cDanger, flash * 0.9);
      this.headMat.emissive.copy(this.cDanger).multiplyScalar(flash * 0.6);
    } else if (winGlow) {
      this.headMat.emissive.copy(this.cGold).multiplyScalar(0.25 + 0.2 * Math.sin(time * 5));
    } else {
      this.headMat.emissive.setRGB(0, 0, 0);
    }
    const hs = 0.42 * 3.2 * pulse;
    this.m.makeScale(hs, 1, hs).setPosition(hx, 0.007, hz);
    this.shadows.setMatrixAt(shadowCount++, this.m);
    this.shadows.count = shadowCount;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  dispose(): void {
    this.tube.geometry.dispose();
    this.spine.dispose();
    this.shadows.dispose();
    for (const d of this.disposables) d.dispose();
    this.group.clear();
  }
}
