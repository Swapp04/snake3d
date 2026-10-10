import { Color } from 'three';
import type { GameConfig } from '../game/types';

/** Single source of truth for the scene's colours (sRGB hex, converted by three.js). */
export const PALETTE = {
  slab: '#0a1020',
  tileA: '#1b2338',
  tileB: '#171e31',
  rail: '#161d2e',
  railGlow: '#37d6b5',
  underGlow: 'rgba(32, 140, 132, 0.55)',
  snakeHead: '#27d08a',
  snakeBody: '#10a565',
  snakeTail: '#06603f',
  snakeSpine: '#9ff5cf',
  snakeDead: '#3b4458',
  eyeWhite: '#f3efe4',
  pupil: '#070a12',
  orb: '#ffbe55',
  orbEmissive: '#ff9a1f',
  orbRing: '#ffd27a',
  prism: '#a78bfa',
  prismEmissive: '#7c4dff',
  danger: '#ff5a4f',
  keyLight: '#fff0da',
  rimLight: '#7fb2ff',
  skyLight: '#5b6ea6',
  groundLight: '#090c15',
} as const;

export const color = (hex: string) => new Color(hex);

/** Grid cell -> world position on the arena floor (board centred on the origin). */
export function cellX(config: GameConfig, x: number): number {
  return x - (config.cols - 1) / 2;
}

export function cellZ(config: GameConfig, y: number): number {
  return y - (config.rows - 1) / 2;
}
