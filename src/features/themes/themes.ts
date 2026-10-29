import type { CustomTheme } from '@/lib/supabase/types';

export type ThemeKey = 'halloween' | 'birthday' | 'hens' | 'christmas' | 'classic' | 'retro' | 'custom';
export type Motif = 'bats' | 'confetti' | 'ribbons' | 'snow' | 'golf' | 'sunburst' | 'plain';

export interface ThemeDef {
  key: ThemeKey;
  name: string;
  tagline: string;
  /** Default event description offered in the wizard (editable). */
  description: string;
  motif: Motif;
  /** Preview colours for the theme picker (the full palette lives in themes.css). */
  preview: { bg: string; ink: string; accent: string; accent2: string };
  dark: boolean;
  /** Words used across the UI so the theme has its own voice. */
  vocab: { venue: string; venues: string; challenge: string; challenges: string; team: string; points: string; leaderboard: string };
  /** Golf-style scorecard grid rather than a list. */
  golfCard: boolean;
  /** Icon names (lucide) used as default avatars and team icons. */
  icons: string[];
  /** Lazy-load the theme's display font (self-hosted, no third-party requests). */
  loadFont?: () => Promise<unknown>;
}

export const THEMES: Record<ThemeKey, ThemeDef> = {
  classic: {
    key: 'classic',
    name: 'Classic Pub Golf',
    tagline: 'Nine holes, one scorecard, bragging rights.',
    description: 'Our nine-hole course around town. Every pub is a hole — complete its challenges to score. Highest card at the 19th hole wins.',
    motif: 'golf',
    preview: { bg: '#eaf0e1', ink: '#12322a', accent: '#1d6644', accent2: '#f2d16b' },
    dark: false,
    vocab: { venue: 'Hole', venues: 'Holes', challenge: 'Shot', challenges: 'Shots', team: 'Fourball', points: 'pts', leaderboard: 'Clubhouse board' },
    golfCard: true,
    icons: ['flag', 'target', 'trophy', 'medal', 'clover', 'sun'],
    loadFont: () => import('@fontsource-variable/fraunces/index.css'),
  },
  halloween: {
    key: 'halloween',
    name: 'Halloween',
    tagline: 'A frightfully good night out.',
    description: 'Costumes encouraged, chills guaranteed. Haunt each venue, complete the spooky challenges and earn your place in the crypt of champions.',
    motif: 'bats',
    preview: { bg: '#15111b', ink: '#f7efe4', accent: '#ff7a1a', accent2: '#a6e35f' },
    dark: true,
    vocab: { venue: 'Haunt', venues: 'Haunts', challenge: 'Dare', challenges: 'Dares', team: 'Team', points: 'souls', leaderboard: 'Crypt of champions' },
    golfCard: false,
    icons: ['ghost', 'moon', 'flame', 'cat', 'candy', 'skull'],
    loadFont: () => import('@fontsource/creepster/400.css'),
  },
  birthday: {
    key: 'birthday',
    name: 'Birthday',
    tagline: 'Another lap around the sun — make it count.',
    description: 'We are celebrating in style! Hop between venues, take on the birthday challenges and help make it a night to remember.',
    motif: 'confetti',
    preview: { bg: '#fff2f7', ink: '#2b1b3d', accent: '#c0266f', accent2: '#ffc93c' },
    dark: false,
    vocab: { venue: 'Stop', venues: 'Stops', challenge: 'Challenge', challenges: 'Challenges', team: 'Party', points: 'pts', leaderboard: 'Party standings' },
    golfCard: false,
    icons: ['cake', 'gift', 'party-popper', 'star', 'music', 'heart'],
    loadFont: () => import('@fontsource/bungee/400.css'),
  },
  hens: {
    key: 'hens',
    name: 'Hens Party',
    tagline: 'One last fling before the ring.',
    description: 'A celebration of the bride-to-be. Elegant venues, playful challenges and plenty of memories — all optional, all in good fun.',
    motif: 'ribbons',
    preview: { bg: '#fbf2ed', ink: '#3a2430', accent: '#9c3559', accent2: '#e9b9a7' },
    dark: false,
    vocab: { venue: 'Venue', venues: 'Venues', challenge: 'Mission', challenges: 'Missions', team: 'Squad', points: 'pts', leaderboard: 'The standings' },
    golfCard: false,
    icons: ['gem', 'heart', 'crown', 'sparkles', 'glasses', 'hand-heart'],
    loadFont: () => import('@fontsource/dm-serif-display/400.css'),
  },
  christmas: {
    key: 'christmas',
    name: 'Christmas',
    tagline: 'Deck the halls, then the next hall.',
    description: 'Festive jumpers on! Visit each venue, complete the seasonal challenges and spread some cheer along the way.',
    motif: 'snow',
    preview: { bg: '#10392d', ink: '#fff8ec', accent: '#e23a4e', accent2: '#f2c14e' },
    dark: true,
    vocab: { venue: 'Stop', venues: 'Stops', challenge: 'Challenge', challenges: 'Challenges', team: 'Sleigh', points: 'pts', leaderboard: 'Nice list' },
    golfCard: false,
    icons: ['tree-pine', 'snowflake', 'gift', 'star', 'candy', 'bell'],
    loadFont: () => import('@fontsource/berkshire-swash/400.css'),
  },
  retro: {
    key: 'retro',
    name: 'Retro Throwback',
    tagline: 'Rewind the clock, press play on the night.',
    description: 'Dig out your best throwback outfit. Each venue is a decade — complete the challenges, sing the hits and claim the top of the charts.',
    motif: 'sunburst',
    preview: { bg: '#ffe6bd', ink: '#2a1e5c', accent: '#c2311c', accent2: '#1fa39a' },
    dark: false,
    vocab: { venue: 'Track', venues: 'Tracks', challenge: 'Challenge', challenges: 'Challenges', team: 'Band', points: 'pts', leaderboard: 'Top of the charts' },
    golfCard: false,
    icons: ['disc-3', 'music', 'zap', 'rocket', 'sun', 'star'],
    loadFont: () => import('@fontsource/righteous/400.css'),
  },
  custom: {
    key: 'custom',
    name: 'Custom',
    tagline: 'Your colours, your rules.',
    description: 'A night out, our way. Visit each venue, take on the challenges and see who comes out on top.',
    motif: 'plain',
    preview: { bg: '#f3eadb', ink: '#1d2a26', accent: '#b8401b', accent2: '#f2a93b' },
    dark: false,
    vocab: { venue: 'Venue', venues: 'Venues', challenge: 'Challenge', challenges: 'Challenges', team: 'Team', points: 'pts', leaderboard: 'Leaderboard' },
    golfCard: false,
    icons: ['beer', 'star', 'flag', 'zap', 'heart', 'rocket'],
  },
};

export const THEME_ORDER: ThemeKey[] = ['classic', 'halloween', 'birthday', 'hens', 'christmas', 'retro', 'custom'];

export function getTheme(key: string | null | undefined): ThemeDef {
  return THEMES[(key as ThemeKey) ?? 'classic'] ?? THEMES.classic;
}

export const CUSTOM_FONTS: Record<string, { label: string; family: string; load?: () => Promise<unknown> }> = {
  bricolage: { label: 'Bold grotesque', family: "'Bricolage Grotesque Variable', system-ui, sans-serif" },
  fraunces: { label: 'Classic serif', family: "'Fraunces Variable', Georgia, serif", load: () => import('@fontsource-variable/fraunces/index.css') },
  dmserif: { label: 'Elegant serif', family: "'DM Serif Display', Georgia, serif", load: () => import('@fontsource/dm-serif-display/400.css') },
  bungee: { label: 'Party block', family: "'Bungee', system-ui, sans-serif", load: () => import('@fontsource/bungee/400.css') },
  righteous: { label: 'Retro rounded', family: "'Righteous', system-ui, sans-serif", load: () => import('@fontsource/righteous/400.css') },
};

// ---------------------------------------------------------------------------
// Colour helpers for the custom theme (WCAG relative luminance / contrast)
// ---------------------------------------------------------------------------
export function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const rgb = hexToRgb(hex);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** Pick black or white text for a background, whichever has more contrast. */
export function readableInk(bg: string): string {
  return contrastRatio(bg, '#ffffff') >= contrastRatio(bg, '#111111') ? '#ffffff' : '#111111';
}

/** CSS custom properties for an organiser-defined theme. */
export function customThemeVars(custom: CustomTheme | null | undefined): Record<string, string> {
  const accent = custom?.accent && hexToRgb(custom.accent) ? custom.accent : '#b8401b';
  const dark = custom?.base === 'dark';
  const font = CUSTOM_FONTS[custom?.font ?? 'bricolage'] ?? CUSTOM_FONTS.bricolage;
  const base = dark
    ? { bg: '#16181d', surface: '#20232b', surface2: '#2b2f39', ink: '#f4f1ea', muted: '#c4c7cf', line: '#f4f1ea', pattern: 'rgba(255,255,255,0.05)' }
    : { bg: '#f5f1ea', surface: '#ffffff', surface2: '#e9e3d8', ink: '#1b1c20', muted: '#4f525b', line: '#1b1c20', pattern: 'rgba(0,0,0,0.05)' };
  return {
    '--c-bg': base.bg,
    '--c-surface': base.surface,
    '--c-surface-2': base.surface2,
    '--c-ink': base.ink,
    '--c-ink-muted': base.muted,
    '--c-line': base.line,
    '--c-bg-pattern': base.pattern,
    '--c-accent': accent,
    '--c-accent-ink': readableInk(accent),
    '--c-accent-2': dark ? '#ffd166' : '#f2a93b',
    '--c-accent-2-ink': '#1b1c20',
    '--font-deco': font.family,
    '--font-display': font.family,
  };
}
