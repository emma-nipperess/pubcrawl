import { TEMPLATES, TEAM_COLORS } from '@/features/templates/content';
import type { ThemeKey } from '@/features/themes/themes';

export function TEAMS_NAMES_FOR(themeKey: string): string[] {
  return TEMPLATES[themeKey as ThemeKey]?.teamNames ?? TEMPLATES.custom.teamNames;
}

export function teamColor(themeKey: string, i: number): string {
  const list = TEMPLATES[themeKey as ThemeKey]?.teamColors ?? TEAM_COLORS;
  return list[i % list.length] ?? TEAM_COLORS[i % TEAM_COLORS.length];
}
