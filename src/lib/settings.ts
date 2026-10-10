import type { SafeStorage } from './storage';

export type QualitySetting = 'auto' | 'low' | 'medium' | 'high';
export type QualityLevel = Exclude<QualitySetting, 'auto'>;
export type MotionSetting = 'system' | 'reduced' | 'full';

export interface Settings {
  sound: boolean;
  quality: QualitySetting;
  motion: MotionSetting;
  haptics: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  sound: true,
  quality: 'auto',
  motion: 'system',
  haptics: true,
};

const SETTINGS_KEY = 'snake3.settings.v1';

const QUALITIES: readonly QualitySetting[] = ['auto', 'low', 'medium', 'high'];
const MOTIONS: readonly MotionSetting[] = ['system', 'reduced', 'full'];

/** Validates each field independently, so one corrupt value never resets the rest. */
export function parseSettings(raw: string | null): Settings {
  if (!raw) return { ...DEFAULT_SETTINGS };
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { ...DEFAULT_SETTINGS };
  const obj = data as Record<string, unknown>;
  return {
    sound: typeof obj.sound === 'boolean' ? obj.sound : DEFAULT_SETTINGS.sound,
    quality: QUALITIES.includes(obj.quality as QualitySetting) ? (obj.quality as QualitySetting) : DEFAULT_SETTINGS.quality,
    motion: MOTIONS.includes(obj.motion as MotionSetting) ? (obj.motion as MotionSetting) : DEFAULT_SETTINGS.motion,
    haptics: typeof obj.haptics === 'boolean' ? obj.haptics : DEFAULT_SETTINGS.haptics,
  };
}

export function loadSettings(storage: SafeStorage): Settings {
  return parseSettings(storage.get(SETTINGS_KEY));
}

export function saveSettings(storage: SafeStorage, settings: Settings): void {
  storage.set(SETTINGS_KEY, JSON.stringify(settings));
}
