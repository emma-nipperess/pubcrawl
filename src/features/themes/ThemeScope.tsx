import { useEffect, type CSSProperties, type ReactNode } from 'react';
import type { CustomTheme } from '@/lib/supabase/types';
import { CUSTOM_FONTS, customThemeVars, getTheme, type Motif } from './themes';

/** Applies an event theme (palette, fonts, motif) to everything inside it. */
export function ThemeScope({ themeKey, custom, children, className }: { themeKey: string; custom?: CustomTheme | null; children: ReactNode; className?: string }) {
  const theme = getTheme(themeKey);
  useEffect(() => {
    theme.loadFont?.().catch(() => undefined);
    if (theme.key === 'custom') CUSTOM_FONTS[custom?.font ?? '']?.load?.().catch(() => undefined);
  }, [theme, custom?.font]);
  useEffect(() => {
    // keep the browser chrome colour in step with the theme
    const meta = document.querySelector('meta[name="theme-color"]');
    const prev = meta?.getAttribute('content');
    const bg = theme.key === 'custom' ? customThemeVars(custom)['--c-bg'] : theme.preview.bg;
    meta?.setAttribute('content', bg);
    return () => {
      if (prev) meta?.setAttribute('content', prev);
    };
  }, [theme, custom]);
  const style = theme.key === 'custom' ? (customThemeVars(custom) as CSSProperties) : undefined;
  return (
    <div className={['app-root', className].filter(Boolean).join(' ')} data-theme={theme.key} data-base={custom?.base ?? undefined} style={style}>
      {children}
    </div>
  );
}

/**
 * Decorative SVG motif for hero cards. Pure CSS/SVG (no image downloads),
 * aria-hidden, and static so it respects reduced-motion by default.
 */
export function ThemeMotif({ motif }: { motif: Motif }) {
  switch (motif) {
    case 'bats':
      return (
        <div className="motif" aria-hidden="true">
          <svg viewBox="0 0 200 120" width="62%" style={{ right: -10, top: -6, opacity: 0.9 }}>
            <g fill="var(--c-accent)">
              {[
                [150, 30, 1],
                [110, 18, 0.7],
                [178, 62, 0.55],
              ].map(([x, y, s], i) => (
                <path
                  key={i}
                  transform={`translate(${x} ${y}) scale(${s})`}
                  d="M0 0c-6-8-16-10-24-6 6 1 9 5 9 9-6-3-12-2-16 2 7 0 11 4 12 9 4-5 10-7 19-5 9-2 15 0 19 5 1-5 5-9 12-9-4-4-10-5-16-2 0-4 3-8 9-9-8-4-18-2-24 6z"
                />
              ))}
            </g>
            <g stroke="var(--c-ink-muted)" strokeWidth="0.8" fill="none" opacity="0.5">
              <path d="M200 0 L140 60 M200 0 L170 70 M200 0 L120 30 M200 0 L200 80" />
              <path d="M186 14 Q176 22 168 16 Q160 30 150 26 M176 28 Q166 38 156 34" />
            </g>
          </svg>
          <svg viewBox="0 0 100 100" width="96" style={{ right: -18, bottom: -30, opacity: 0.8 }}>
            <ellipse cx="50" cy="58" rx="40" ry="34" fill="var(--c-accent)" />
            <path d="M50 24 q4 -12 12 -14" stroke="var(--c-accent-2)" strokeWidth="5" fill="none" strokeLinecap="round" />
            <path d="M30 50 l8 8 l-10 2z M70 50 l-8 8 l10 2z M36 72 q14 10 28 0 l-4 -2 l-4 4 l-6 -4 l-6 4 l-4 -4z" fill="var(--c-bg)" />
          </svg>
        </div>
      );
    case 'confetti':
      return (
        <div className="motif" aria-hidden="true">
          <svg viewBox="0 0 300 160" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ inset: 0 }}>
            {Array.from({ length: 34 }, (_, i) => {
              const x = (i * 83) % 300;
              const y = (i * 47) % 160;
              const colors = ['var(--c-accent)', 'var(--c-accent-2)', '#2ec4b6', '#7b2cbf'];
              const r = (i * 37) % 180;
              return i % 3 === 0 ? (
                <circle key={i} cx={x} cy={y} r={3 + (i % 3)} fill={colors[i % 4]} opacity="0.55" />
              ) : (
                <rect key={i} x={x} y={y} width={i % 2 ? 10 : 5} height={i % 2 ? 4 : 12} rx="1.5" fill={colors[i % 4]} opacity="0.55" transform={`rotate(${r} ${x} ${y})`} />
              );
            })}
          </svg>
        </div>
      );
    case 'ribbons':
      return (
        <div className="motif" aria-hidden="true">
          <svg viewBox="0 0 300 40" width="100%" style={{ top: 0, left: 0 }} preserveAspectRatio="none">
            <path d="M0 0 H300 V18 Q285 36 270 18 Q255 36 240 18 Q225 36 210 18 Q195 36 180 18 Q165 36 150 18 Q135 36 120 18 Q105 36 90 18 Q75 36 60 18 Q45 36 30 18 Q15 36 0 18Z" fill="var(--c-accent-2)" opacity="0.65" />
          </svg>
          <svg viewBox="0 0 120 120" width="110" style={{ right: 10, bottom: -18, opacity: 0.6 }}>
            <g fill="none" stroke="var(--c-accent)" strokeWidth="3">
              <circle cx="46" cy="70" r="26" />
              <circle cx="74" cy="70" r="26" />
            </g>
            <path d="M60 30 l6 10 h-12z" fill="var(--c-accent)" />
          </svg>
        </div>
      );
    case 'snow':
      return (
        <div className="motif" aria-hidden="true">
          <svg viewBox="0 0 300 160" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" style={{ inset: 0 }}>
            {Array.from({ length: 40 }, (_, i) => (
              <circle key={i} cx={(i * 71) % 300} cy={(i * 29) % 160} r={(i % 3) + 1} fill="#fff" opacity={0.25 + (i % 4) * 0.12} />
            ))}
            <path d="M0 160 Q60 132 120 148 T240 140 T300 150 V160Z" fill="#fff" opacity="0.18" />
          </svg>
          <svg viewBox="0 0 60 80" width="70" style={{ right: 14, bottom: 6, opacity: 0.85 }}>
            <path d="M30 4 L50 34 H40 L54 56 H6 L20 34 H10Z" fill="var(--c-accent-2)" opacity="0.35" />
            <rect x="26" y="56" width="8" height="10" fill="var(--c-accent-2)" opacity="0.35" />
          </svg>
        </div>
      );
    case 'golf':
      return (
        <div className="motif" aria-hidden="true">
          <svg viewBox="0 0 200 120" width="56%" style={{ right: -6, bottom: -4 }}>
            <ellipse cx="120" cy="104" rx="90" ry="16" fill="var(--c-accent)" opacity="0.18" />
            <ellipse cx="140" cy="102" rx="9" ry="3" fill="var(--c-ink)" opacity="0.6" />
            <line x1="140" y1="102" x2="140" y2="26" stroke="var(--c-ink)" strokeWidth="2.5" />
            <path d="M141 26 L176 36 L141 48Z" fill="var(--c-accent-2)" stroke="var(--c-ink)" strokeWidth="1.5" />
            <circle cx="92" cy="98" r="5" fill="#fff" stroke="var(--c-ink)" strokeWidth="1.2" />
            <path d="M30 98 q40 -40 62 0" stroke="var(--c-ink)" strokeWidth="1.2" strokeDasharray="3 4" fill="none" opacity="0.5" />
          </svg>
        </div>
      );
    case 'sunburst':
      return (
        <div className="motif" aria-hidden="true">
          <svg viewBox="0 0 200 200" width="70%" style={{ right: '-18%', top: '-30%', opacity: 0.35 }}>
            {Array.from({ length: 16 }, (_, i) => (
              <path key={i} d="M100 100 L96 0 H104Z" fill={i % 2 ? 'var(--c-accent)' : 'var(--c-accent-2)'} transform={`rotate(${i * 22.5} 100 100)`} />
            ))}
          </svg>
          <svg viewBox="0 0 300 30" width="100%" style={{ bottom: 0, left: 0 }} preserveAspectRatio="none">
            <rect y="0" width="300" height="6" fill="var(--c-accent)" />
            <rect y="9" width="300" height="6" fill="var(--c-accent-2)" />
            <rect y="18" width="300" height="6" fill="#f4a261" />
          </svg>
        </div>
      );
    default:
      return (
        <div className="motif" aria-hidden="true">
          <svg viewBox="0 0 100 100" width="140" style={{ right: -40, top: -40, opacity: 0.5 }}>
            <circle cx="50" cy="50" r="46" fill="none" stroke="var(--c-accent)" strokeWidth="6" strokeDasharray="10 8" />
            <circle cx="50" cy="50" r="30" fill="var(--c-accent-2)" opacity="0.6" />
          </svg>
        </div>
      );
  }
}
