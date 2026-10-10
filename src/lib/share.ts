export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

export interface ShareEnv {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  writeClipboard?: (text: string) => Promise<void>;
  legacyCopy?: (text: string) => boolean;
}

export function shareText(score: number, length: number, won: boolean): string {
  const verb = won ? `cleared the board with ${score} points` : `scored ${score}`;
  return `I ${verb} in SNAKE³ (length ${length}). Think you can beat it?`;
}

/** Native share sheet when available, clipboard otherwise. Reports what really happened. */
export async function shareScore(text: string, url: string, env: ShareEnv): Promise<ShareOutcome> {
  const data: ShareData = { title: 'SNAKE³', text, url };
  if (env.share && (!env.canShare || env.canShare(data))) {
    try {
      await env.share(data);
      return 'shared';
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled';
      // Otherwise fall through to the clipboard.
    }
  }
  const full = `${text} ${url}`.trim();
  if (env.writeClipboard) {
    try {
      await env.writeClipboard(full);
      return 'copied';
    } catch {
      /* try the legacy path */
    }
  }
  if (env.legacyCopy?.(full)) return 'copied';
  return 'failed';
}

export function browserShareEnv(): ShareEnv {
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return {
    share: nav?.share ? (d) => nav.share(d) : undefined,
    canShare: nav?.canShare ? (d) => nav.canShare(d) : undefined,
    writeClipboard: nav?.clipboard?.writeText ? (t) => nav.clipboard.writeText(t) : undefined,
    legacyCopy: (t) => {
      try {
        const area = document.createElement('textarea');
        area.value = t;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        const ok = document.execCommand('copy');
        area.remove();
        return ok;
      } catch {
        return false;
      }
    },
  };
}
