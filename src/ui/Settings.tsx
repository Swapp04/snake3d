import { useEffect, useId, useRef, type KeyboardEvent } from 'react';
import type { QualityLevel, Settings } from '../lib/settings';

interface Props {
  settings: Settings;
  effectiveQuality: QualityLevel;
  systemReducedMotion: boolean;
  hapticsSupported: boolean;
  onChange: (next: Settings) => void;
  onClose: () => void;
}

interface Option<T extends string> {
  value: T;
  label: string;
}

function Segmented<T extends string>({ label, value, options, onChange, hint }: { label: string; value: T; options: Option<T>[]; onChange: (v: T) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="setting">
      <div className="setting__label" id={id}>
        {label}
        {hint && <span className="setting__hint">{hint}</span>}
      </div>
      <div className="segmented" role="radiogroup" aria-labelledby={id}>
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={value === o.value}
            className="segmented__option"
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({ label, checked, onChange, hint }: { label: string; checked: boolean; onChange: (v: boolean) => void; hint?: string }) {
  const id = useId();
  return (
    <div className="setting setting--row">
      <div className="setting__label" id={id}>
        {label}
        {hint && <span className="setting__hint">{hint}</span>}
      </div>
      <button type="button" role="switch" aria-checked={checked} aria-labelledby={id} className="switch" onClick={() => onChange(!checked)}>
        <span className="switch__thumb" />
      </button>
    </div>
  );
}

const QUALITY_LABEL: Record<QualityLevel, string> = { low: 'Low', medium: 'Medium', high: 'High' };

export function SettingsDialog({ settings, effectiveQuality, systemReducedMotion, hapticsSupported, onChange, onClose }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialogRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => previous?.focus?.();
  }, []);

  // Keep Tab focus inside the dialog.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>('button'));
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="overlay overlay--modal" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card card--settings" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} onKeyDown={onKeyDown}>
        <h2 className="card__title" id={titleId}>
          Settings
        </h2>
        <Toggle label="Sound" checked={settings.sound} onChange={(sound) => onChange({ ...settings, sound })} />
        <Segmented
          label="Graphics"
          hint={settings.quality === 'auto' ? `Auto · currently ${QUALITY_LABEL[effectiveQuality]}` : 'Lower settings save battery'}
          value={settings.quality}
          options={[
            { value: 'auto', label: 'Auto' },
            { value: 'low', label: 'Low' },
            { value: 'medium', label: 'Medium' },
            { value: 'high', label: 'High' },
          ]}
          onChange={(quality) => onChange({ ...settings, quality })}
        />
        <Segmented
          label="Motion"
          hint={settings.motion === 'system' ? `Following system · ${systemReducedMotion ? 'reduced' : 'full'}` : 'Camera drift, shake and bobbing'}
          value={settings.motion}
          options={[
            { value: 'system', label: 'System' },
            { value: 'reduced', label: 'Reduced' },
            { value: 'full', label: 'Full' },
          ]}
          onChange={(motion) => onChange({ ...settings, motion })}
        />
        {hapticsSupported && (
          <Toggle label="Vibration" hint="On supported phones" checked={settings.haptics} onChange={(haptics) => onChange({ ...settings, haptics })} />
        )}
        <button type="button" className="btn btn--primary btn--block" onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  );
}
