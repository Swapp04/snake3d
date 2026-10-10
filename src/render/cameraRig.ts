import { PerspectiveCamera, Vector3 } from 'three';

export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export type CameraView = 'menu' | 'game';

interface Pose {
  azimuth: number;
  elevation: number;
  distance: number;
  shiftX: number;
  shiftY: number;
}

const ZERO: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
const DEG = Math.PI / 180;

const VIEW_ANGLES: Record<CameraView, { elevation: number; azimuth: number }> = {
  game: { elevation: 54 * DEG, azimuth: 0 },
  menu: { elevation: 31 * DEG, azimuth: 22 * DEG },
};

/** The menu camera sways gently around its base azimuth rather than orbiting. */
const MENU_SWAY = 17 * DEG;
const MENU_SWAY_SPEED = 0.16;

/**
 * Elevated three-quarter camera. The distance is solved numerically so the whole
 * arena fits inside the screen area not covered by UI, and the projection centre
 * is shifted (setViewOffset) to centre the arena in that free area.
 */
export class CameraRig {
  readonly camera = new PerspectiveCamera(34, 1, 0.1, 200);
  private width = 1;
  private height = 1;
  private insets: Record<CameraView, Insets> = { menu: { ...ZERO }, game: { ...ZERO } };
  private targets: Record<CameraView, Pose> = {
    menu: { azimuth: 0, elevation: VIEW_ANGLES.menu.elevation, distance: 30, shiftX: 0, shiftY: 0 },
    game: { azimuth: 0, elevation: VIEW_ANGLES.game.elevation, distance: 30, shiftX: 0, shiftY: 0 },
  };
  private pose: Pose = { ...this.targets.menu };
  private view: CameraView = 'menu';
  private swayTime = 0;
  private shakeAmp = 0;
  private readonly target = new Vector3(0, -0.15, 0);
  private readonly corners: Vector3[];
  private readonly scratch = new Vector3();

  constructor(halfWidth: number, halfDepth: number) {
    this.corners = [];
    for (const x of [-halfWidth, halfWidth])
      for (const z of [-halfDepth, halfDepth]) for (const y of [-0.95, 0.95]) this.corners.push(new Vector3(x, y, z));
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.refit();
  }

  setInsets(view: CameraView, insets: Insets): void {
    const cur = this.insets[view];
    if (cur.top === insets.top && cur.right === insets.right && cur.bottom === insets.bottom && cur.left === insets.left) return;
    this.insets[view] = { ...insets };
    this.refit();
  }

  setView(view: CameraView, instant = false): void {
    if (view === this.view && !instant) return;
    this.view = view;
    if (instant) this.pose = { ...this.targets[view], azimuth: this.goalAzimuth() };
  }

  shake(amount: number): void {
    this.shakeAmp = Math.max(this.shakeAmp, amount);
  }

  private refit(): void {
    for (const view of ['menu', 'game'] as CameraView[]) {
      const ins = this.clampInsets(this.insets[view]);
      const shiftX = (ins.left - ins.right) / 2;
      const shiftY = (ins.top - ins.bottom) / 2;
      const angles = view === 'menu' ? { ...VIEW_ANGLES.menu, azimuth: VIEW_ANGLES.menu.azimuth + MENU_SWAY } : VIEW_ANGLES.game;
      // The arena projects as a trapezoid, so centring the projection is not the
      // same as centring the arena. Nudge the shift until its bounding box sits in
      // the middle of the free area, re-solving the distance each time.
      const regionX = (ins.left + this.width - ins.right) / 2;
      const regionY = (ins.top + this.height - ins.bottom) / 2;
      let sx = shiftX;
      let sy = shiftY;
      let distance = this.solveDistance(angles.elevation, angles.azimuth, sx, sy, ins);
      for (let pass = 0; pass < 3; pass++) {
        const box = this.projectedBox({ azimuth: angles.azimuth, elevation: angles.elevation, distance, shiftX: sx, shiftY: sy });
        sx += regionX - (box.minX + box.maxX) / 2;
        sy += regionY - (box.minY + box.maxY) / 2;
        distance = this.solveDistance(angles.elevation, angles.azimuth, sx, sy, ins);
      }
      // Fit the menu at the widest point of its sway, so the board never clips.
      this.targets[view] = { azimuth: VIEW_ANGLES[view].azimuth, elevation: angles.elevation, distance, shiftX: sx, shiftY: sy };
    }
    this.apply(this.pose);
  }

  /** Never let UI insets squeeze the arena into less than ~45% of the screen. */
  private clampInsets(i: Insets): Insets {
    const maxH = this.width * 0.55;
    const maxV = this.height * 0.55;
    const scaleH = i.left + i.right > maxH ? maxH / (i.left + i.right) : 1;
    const scaleV = i.top + i.bottom > maxV ? maxV / (i.top + i.bottom) : 1;
    return { left: i.left * scaleH, right: i.right * scaleH, top: i.top * scaleV, bottom: i.bottom * scaleV };
  }

  /** Screen-space (CSS px) bounding box of the arena for a given pose. */
  private projectedBox(pose: Pose): { minX: number; maxX: number; minY: number; maxY: number } {
    this.apply(pose);
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const c of this.corners) {
      const p = this.scratch.copy(c).project(this.camera);
      const x = ((p.x + 1) / 2) * this.width;
      const y = ((1 - p.y) / 2) * this.height;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    return { minX, maxX, minY, maxY };
  }

  private solveDistance(elevation: number, azimuth: number, shiftX: number, shiftY: number, ins: Insets): number {
    const margin = Math.min(this.width, this.height) < 500 ? 10 : 22;
    const left = -1 + (2 * (ins.left + margin)) / this.width;
    const right = 1 - (2 * (ins.right + margin)) / this.width;
    const bottom = -1 + (2 * (ins.bottom + margin)) / this.height;
    const top = 1 - (2 * (ins.top + margin)) / this.height;
    let lo = 4;
    let hi = 300;
    for (let iter = 0; iter < 28; iter++) {
      const mid = (lo + hi) / 2;
      this.apply({ azimuth, elevation, distance: mid, shiftX, shiftY });
      let fits = true;
      for (const c of this.corners) {
        const p = this.scratch.copy(c).project(this.camera);
        if (p.x < left || p.x > right || p.y < bottom || p.y > top || p.z > 1) {
          fits = false;
          break;
        }
      }
      if (fits) hi = mid;
      else lo = mid;
    }
    return hi;
  }

  private apply(p: Pose, shake = 0): void {
    const cam = this.camera;
    const ax = Math.abs(p.shiftX);
    const ay = Math.abs(p.shiftY);
    const fullW = this.width + 2 * ax;
    const fullH = this.height + 2 * ay;
    cam.aspect = fullW / fullH;
    cam.setViewOffset(fullW, fullH, ax - p.shiftX, ay - p.shiftY, this.width, this.height);
    const horiz = Math.cos(p.elevation) * p.distance;
    cam.position.set(
      this.target.x + Math.sin(p.azimuth) * horiz,
      this.target.y + Math.sin(p.elevation) * p.distance,
      this.target.z + Math.cos(p.azimuth) * horiz,
    );
    if (shake > 0) {
      cam.position.x += (Math.random() - 0.5) * shake;
      cam.position.y += (Math.random() - 0.5) * shake;
    }
    cam.lookAt(this.target);
    cam.updateMatrixWorld();
    cam.updateProjectionMatrix();
  }

  private goalAzimuth(): number {
    if (this.view === 'game') return 0;
    return VIEW_ANGLES.menu.azimuth + Math.sin(this.swayTime * MENU_SWAY_SPEED) * MENU_SWAY;
  }

  update(dt: number, reducedMotion: boolean): void {
    const target = this.targets[this.view];
    if (this.view === 'menu' && !reducedMotion) this.swayTime += dt;
    const goalAzimuth = this.goalAzimuth();
    const k = reducedMotion ? 1 : 1 - Math.exp(-dt * 3.2);
    const p = this.pose;
    p.azimuth += (goalAzimuth - p.azimuth) * k;
    p.elevation += (target.elevation - p.elevation) * k;
    p.distance += (target.distance - p.distance) * k;
    p.shiftX += (target.shiftX - p.shiftX) * k;
    p.shiftY += (target.shiftY - p.shiftY) * k;
    const shake = reducedMotion ? 0 : this.shakeAmp;
    this.shakeAmp = Math.max(0, this.shakeAmp - dt * 1.4);
    this.apply(p, shake);
  }
}
