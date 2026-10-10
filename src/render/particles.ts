import {
  AdditiveBlending,
  Color,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  PlaneGeometry,
  ShaderMaterial,
} from 'three';

/*
 * Particles are drawn as instanced camera-facing quads rather than gl.POINTS.
 * Point sprites are emulated on some backends (ANGLE/Direct3D), where waking an
 * idle point buffer caused half-second stalls; quads also avoid point-size caps.
 */

function quadGeometry(count: number): InstancedBufferGeometry {
  const plane = new PlaneGeometry(1, 1);
  const geo = new InstancedBufferGeometry();
  geo.index = plane.index;
  geo.setAttribute('position', plane.getAttribute('position'));
  geo.setAttribute('uv', plane.getAttribute('uv'));
  geo.instanceCount = count;
  return geo;
}

const SPARK_VERT = /* glsl */ `
  attribute vec3 aOffset;
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(aOffset, 1.0);
    mv.xy += position.xy * aSize;
    gl_Position = projectionMatrix * mv;
    vUv = uv;
    vColor = aColor;
    vAlpha = aAlpha;
  }
`;

const SPARK_FRAG = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(vUv - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    if (vAlpha <= 0.001 || a <= 0.001) discard;
    gl_FragColor = vec4(vColor * 1.8, a * a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export interface BurstOptions {
  count: number;
  color: string;
  speed: number;
  life: number;
  size: number;
  /** Upward bias added to each particle's initial vertical velocity. */
  lift?: number;
  gravity?: number;
  spread?: number;
}

/**
 * A fixed pool of additive sparks. Bursts recycle the oldest slots, so the cost
 * is bounded no matter how often the player collects.
 */
export class ParticleSystem {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;
  private readonly max: number;
  private pos: Float32Array;
  private vel: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private baseSize: Float32Array;
  private alpha: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private gravity: Float32Array;
  private attrs: InstancedBufferAttribute[];
  private cursor = 0;
  private active = false;
  private tmp = new Color();
  scaleFactor = 1;

  constructor(max = 420) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.gravity = new Float32Array(max);
    const geo = quadGeometry(max);
    const attr = (name: string, arr: Float32Array, n: number) => {
      const a = new InstancedBufferAttribute(arr, n).setUsage(DynamicDrawUsage);
      geo.setAttribute(name, a);
      return a;
    };
    this.attrs = [attr('aOffset', this.pos, 3), attr('aColor', this.col, 3), attr('aSize', this.size, 1), attr('aAlpha', this.alpha, 1)];
    const material = new ShaderMaterial({
      vertexShader: SPARK_VERT,
      fragmentShader: SPARK_FRAG,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
  }

  burst(x: number, y: number, z: number, o: BurstOptions): void {
    const count = Math.max(0, Math.round(o.count * this.scaleFactor));
    this.tmp.set(o.color);
    const spread = o.spread ?? 1;
    for (let k = 0; k < count; k++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      const sp = o.speed * (0.35 + Math.random() * 0.65);
      this.pos[i * 3] = x + (Math.random() - 0.5) * 0.15 * spread;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.15 * spread;
      this.vel[i * 3] = Math.sin(phi) * Math.cos(theta) * sp * spread;
      this.vel[i * 3 + 1] = Math.abs(Math.cos(phi)) * sp + (o.lift ?? 0);
      this.vel[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * sp * spread;
      const tint = 0.85 + Math.random() * 0.3;
      this.col[i * 3] = this.tmp.r * tint;
      this.col[i * 3 + 1] = this.tmp.g * tint;
      this.col[i * 3 + 2] = this.tmp.b * tint;
      this.baseSize[i] = o.size * (0.6 + Math.random() * 0.6);
      this.maxLife[i] = this.life[i] = o.life * (0.6 + Math.random() * 0.4);
      this.gravity[i] = o.gravity ?? 6;
    }
    this.active = true;
  }

  clear(): void {
    this.life.fill(0);
    this.alpha.fill(0);
    this.size.fill(0);
    this.active = true; // one more upload so the cleared state reaches the GPU
  }

  update(dt: number): void {
    if (!this.active) return;
    let alive = 0;
    const drag = Math.exp(-dt * 2.2);
    for (let i = 0; i < this.max; i++) {
      if (this.life[i]! <= 0) {
        this.alpha[i] = 0;
        this.size[i] = 0;
        continue;
      }
      alive++;
      this.life[i] = this.life[i]! - dt;
      const t = Math.max(0, this.life[i]! / this.maxLife[i]!);
      this.vel[i * 3] = this.vel[i * 3]! * drag;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1]! * drag - this.gravity[i]! * dt;
      this.vel[i * 3 + 2] = this.vel[i * 3 + 2]! * drag;
      this.pos[i * 3] = this.pos[i * 3]! + this.vel[i * 3]! * dt;
      this.pos[i * 3 + 1] = Math.max(0.03, this.pos[i * 3 + 1]! + this.vel[i * 3 + 1]! * dt);
      this.pos[i * 3 + 2] = this.pos[i * 3 + 2]! + this.vel[i * 3 + 2]! * dt;
      this.alpha[i] = t * t;
      this.size[i] = this.baseSize[i]! * (0.4 + 0.6 * t);
    }
    for (const a of this.attrs) a.needsUpdate = true;
    this.active = alive > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

/** Slow ambient motes drifting around the arena; animated entirely on the GPU. */
export class DustField {
  readonly mesh: Mesh<InstancedBufferGeometry, ShaderMaterial>;

  constructor(radius: number, count = 140) {
    const offsets = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = radius * (0.55 + Math.random() * 0.9);
      offsets[i * 3] = Math.cos(a) * r;
      offsets[i * 3 + 1] = -3 + Math.random() * 9;
      offsets[i * 3 + 2] = Math.sin(a) * r;
      seeds[i] = Math.random();
    }
    const geo = quadGeometry(count);
    geo.setAttribute('aOffset', new InstancedBufferAttribute(offsets, 3));
    geo.setAttribute('aSeed', new InstancedBufferAttribute(seeds, 1));
    const material = new ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        attribute vec3 aOffset;
        attribute float aSeed;
        uniform float uTime;
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          vec3 p = aOffset;
          float t = uTime * (0.05 + aSeed * 0.08);
          p.y = mod(p.y + t * 4.0 + 3.0, 9.0) - 3.0;
          p.x += sin(uTime * 0.3 + aSeed * 40.0) * 0.4;
          p.z += cos(uTime * 0.25 + aSeed * 30.0) * 0.4;
          vec4 mv = modelViewMatrix * vec4(p, 1.0);
          mv.xy += position.xy * (0.05 + aSeed * 0.06);
          gl_Position = projectionMatrix * mv;
          vUv = uv;
          float edge = smoothstep(-3.0, -1.5, p.y) * (1.0 - smoothstep(4.5, 6.0, p.y));
          vAlpha = edge * (0.25 + 0.35 * aSeed);
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec2 vUv;
        varying float vAlpha;
        void main() {
          float d = length(vUv - 0.5);
          float a = smoothstep(0.5, 0.0, d);
          gl_FragColor = vec4(vec3(0.62, 0.78, 1.0), a * vAlpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    });
    this.mesh = new Mesh(geo, material);
    this.mesh.frustumCulled = false;
  }

  update(time: number): void {
    this.mesh.material.uniforms.uTime!.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
