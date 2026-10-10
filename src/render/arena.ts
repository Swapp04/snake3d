import {
  AdditiveBlending,
  BoxGeometry,
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Material,
  type Texture,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import type { GameConfig } from '../game/types';
import { PALETTE, cellX, cellZ } from './palette';
import { radialTexture } from './textures';

export const TILE_TOP = 0;
const RAIL_WIDTH = 0.34;
const RAIL_HEIGHT = 0.4;

/** The floating board: slab, beveled tiles, perimeter rails, and a soft under-glow. */
export class Arena {
  readonly group = new Group();
  private geometries: BufferGeometry[] = [];
  private materials: Material[] = [];
  private textures: Texture[] = [];

  constructor(config: GameConfig) {
    const { cols, rows } = config;
    const w = cols;
    const d = rows;

    const slabGeo = this.geo(new RoundedBoxGeometry(w + 2 * RAIL_WIDTH + 0.5, 0.9, d + 2 * RAIL_WIDTH + 0.5, 3, 0.22));
    const slabMat = this.mat(new MeshStandardMaterial({ color: PALETTE.slab, roughness: 0.82, metalness: 0.18 }));
    const slab = new Mesh(slabGeo, slabMat);
    slab.position.y = TILE_TOP - 0.06 - 0.45;
    slab.receiveShadow = true;
    this.group.add(slab);

    // Beveled tiles: the gaps between them form the grid lines.
    const tileGeo = this.geo(new RoundedBoxGeometry(0.93, 0.12, 0.93, 2, 0.035));
    const tileMat = this.mat(new MeshStandardMaterial({ color: '#ffffff', roughness: 0.72, metalness: 0.06 }));
    const tiles = new InstancedMesh(tileGeo, tileMat, cols * rows);
    const m = new Matrix4();
    const a = new Color(PALETTE.tileA);
    const b = new Color(PALETTE.tileB);
    let i = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        m.makeTranslation(cellX(config, x), TILE_TOP - 0.06, cellZ(config, y));
        tiles.setMatrixAt(i, m);
        tiles.setColorAt(i, (x + y) % 2 === 0 ? a : b);
        i++;
      }
    }
    tiles.receiveShadow = true;
    this.group.add(tiles);

    const railMat = this.mat(new MeshStandardMaterial({ color: PALETTE.rail, roughness: 0.42, metalness: 0.35 }));
    const glowMat = this.mat(new MeshStandardMaterial({ color: '#0b1a1a', emissive: PALETTE.railGlow, emissiveIntensity: 0.9 }));
    const longGeo = this.geo(new RoundedBoxGeometry(w + 2 * RAIL_WIDTH, RAIL_HEIGHT, RAIL_WIDTH, 2, 0.08));
    const sideGeo = this.geo(new RoundedBoxGeometry(RAIL_WIDTH, RAIL_HEIGHT, d, 2, 0.08));
    const stripLong = this.geo(new BoxGeometry(w, 0.025, 0.035));
    const stripSide = this.geo(new BoxGeometry(0.035, 0.025, d));
    const railY = TILE_TOP - 0.12 + RAIL_HEIGHT / 2;
    const stripY = railY + RAIL_HEIGHT / 2 - 0.005;
    const off = (n: number) => n / 2 + RAIL_WIDTH / 2;
    const inner = (n: number) => n / 2 + 0.07;
    for (const sz of [-1, 1]) {
      const rail = new Mesh(longGeo, railMat);
      rail.position.set(0, railY, sz * off(d));
      rail.castShadow = rail.receiveShadow = true;
      const strip = new Mesh(stripLong, glowMat);
      strip.position.set(0, stripY, sz * inner(d));
      this.group.add(rail, strip);
    }
    for (const sx of [-1, 1]) {
      const rail = new Mesh(sideGeo, railMat);
      rail.position.set(sx * off(w), railY, 0);
      rail.castShadow = rail.receiveShadow = true;
      const strip = new Mesh(stripSide, glowMat);
      strip.position.set(sx * inner(w), stripY, 0);
      this.group.add(rail, strip);
    }

    // Under-glow gives the board a sense of floating in space.
    const glowTex = this.tex(radialTexture([[0, PALETTE.underGlow], [0.45, 'rgba(40, 70, 140, 0.18)'], [1, 'rgba(0,0,0,0)']]));
    const under = new Mesh(
      this.geo(new PlaneGeometry(1, 1)),
      this.mat(new MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: AdditiveBlending, opacity: 0.55 })),
    );
    under.rotation.x = -Math.PI / 2;
    under.position.y = -2.4;
    under.scale.setScalar(Math.max(w, d) * 2.4);
    under.renderOrder = -1;
    this.group.add(under);
  }

  private geo<T extends BufferGeometry>(g: T): T {
    this.geometries.push(g);
    return g;
  }

  private mat<T extends Material>(m: T): T {
    this.materials.push(m);
    return m;
  }

  private tex<T extends Texture>(t: T): T {
    this.textures.push(t);
    return t;
  }

  dispose(): void {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.textures) t.dispose();
    this.group.traverse((o) => {
      if (o instanceof InstancedMesh) o.dispose();
    });
    this.group.clear();
  }
}
