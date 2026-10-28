import { describe, expect, it } from 'vitest';
import { checkFile, proofPath, sniffMime, LIMITS } from '@/lib/media/validate';
import { csvCell, toCsv } from '@/lib/csv';
import { formatCode, parseInvite, parseQuickVenues, validateChallenge, validateEvent, validateVenue, validateDisplayName } from '@/lib/validation/forms';
import { contrastRatio, customThemeVars, readableInk, THEMES, THEME_ORDER } from '@/features/themes/themes';
import { CHALLENGE_LIBRARY, TEMPLATES } from '@/features/templates/content';
import { CHALLENGE_TYPES } from '@/features/challenges/meta';
import { zipEntryName, type EventMediaItem } from '@/features/media/downloadAll';

const bytes = (...xs: (number | string)[]) => {
  const out: number[] = [];
  for (const x of xs) {
    if (typeof x === 'string') out.push(...[...x].map((c) => c.charCodeAt(0)));
    else out.push(x);
  }
  return new Uint8Array(out);
};

describe('media validation', () => {
  it('identifies files by content, not extension', () => {
    expect(sniffMime(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg');
    expect(sniffMime(bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png');
    expect(sniffMime(bytes('RIFF', 0, 0, 0, 0, 'WEBP'))).toBe('image/webp');
    expect(sniffMime(bytes(0, 0, 0, 0x18, 'ftypheic', 0, 0, 0, 0))).toBe('image/heic');
    expect(sniffMime(bytes(0, 0, 0, 0x18, 'ftypisom', 0, 0, 0, 0))).toBe('video/mp4');
    expect(sniffMime(bytes(0, 0, 0, 0x14, 'ftypqt  ', 0, 0, 0, 0))).toBe('video/quicktime');
    expect(sniffMime(bytes(0x1a, 0x45, 0xdf, 0xa3))).toBe('video/webm');
    expect(sniffMime(bytes('<svg xmlns'))).toBeNull();
    expect(sniffMime(bytes('%PDF-1.7'))).toBeNull();
  });

  it('enforces type and size', () => {
    const jpg = bytes(0xff, 0xd8, 0xff, 0xe0);
    const mp4 = bytes(0, 0, 0, 0x18, 'ftypisom', 0, 0, 0, 0);
    expect(checkFile(jpg, 1000, 'photo')).toMatchObject({ ok: true, kind: 'image' });
    expect(checkFile(mp4, 1000, 'photo').error).toMatch(/needs a photo/);
    expect(checkFile(jpg, 1000, 'video').error).toMatch(/needs a video/);
    expect(checkFile(mp4, 1000, 'either')).toMatchObject({ ok: true, kind: 'video' });
    expect(checkFile(jpg, LIMITS.imageBytes + 1, 'photo').error).toMatch(/limit/);
    expect(checkFile(mp4, LIMITS.videoBytes + 1, 'video').error).toMatch(/shorter clip/);
    expect(checkFile(bytes('GIF89a'), 10, 'photo').error).toMatch(/not supported/);
    expect(checkFile(jpg, 0, 'photo').ok).toBe(false);
  });

  it('builds storage paths scoped to event/user/submission', () => {
    const p = proofPath('ev', 'us', 'sub', 'image/jpeg');
    expect(p).toMatch(/^ev\/us\/sub\/[0-9a-f]{8}\.jpg$/);
    expect(proofPath('ev', 'us', 'sub', 'image/jpeg')).not.toBe(p);
  });
});

describe('CSV export', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell('line\nbreak')).toBe('"line\nbreak"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(-5)).toBe('-5');
  });
  it('neutralises spreadsheet formulas in names', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`);
    expect(csvCell('+1')).toBe("'+1");
    expect(csvCell('@me')).toBe("'@me");
  });
  it('produces CRLF rows', () => {
    expect(toCsv(['a', 'b'], [[1, 'x']])).toBe('a,b\r\n1,x\r\n');
  });
});

describe('form validation', () => {
  it('parses invite codes and links', () => {
    expect(parseInvite('abcd-2345')).toBe('ABCD2345');
    expect(parseInvite('https://x.github.io/repo/j/ABCD2345')).toBe('ABCD2345');
    expect(parseInvite('ABCD0O11')).toBeNull(); // ambiguous characters are never issued
    expect(parseInvite('short')).toBeNull();
    expect(formatCode('abcd2345')).toBe('ABCD-2345');
  });
  it('validates names and events', () => {
    expect(validateDisplayName('  ')).toBeTruthy();
    expect(validateDisplayName('x'.repeat(41))).toBeTruthy();
    expect(validateDisplayName('Sam')).toBeUndefined();
    expect(validateEvent({ name: 'A', organiser_name: '' })).toMatchObject({ name: expect.any(String), organiser_name: expect.any(String) });
    expect(validateEvent({ name: 'Good name', organiser_name: 'Sam', capacity: 1 }).capacity).toBeTruthy();
    expect(validateEvent({ name: 'Good name', organiser_name: 'Sam' })).toEqual({});
  });
  it('validates venues', () => {
    expect(validateVenue({ name: '' }).name).toBeTruthy();
    expect(validateVenue({ name: 'x', maps_url: 'http://insecure' }).maps_url).toBeTruthy();
    expect(validateVenue({ name: 'x', maps_url: 'javascript:alert(1)' }).maps_url).toBeTruthy();
    expect(validateVenue({ name: 'x', latitude: 51 }).longitude).toBeTruthy();
    expect(validateVenue({ name: 'x', latitude: 91, longitude: 0 }).latitude).toBeTruthy();
    expect(validateVenue({ name: 'x', maps_url: 'https://maps.apple.com/?q=x' })).toEqual({});
  });
  it('validates challenges', () => {
    expect(validateChallenge({ title: '', points: 10, type: 'photo' }).title).toBeTruthy();
    expect(validateChallenge({ title: 'x', points: -1, type: 'photo' }).points).toBeTruthy();
    expect(validateChallenge({ title: 'x', points: 1, type: 'multiple_choice', choices: ['a', ' '] }).choices).toBeTruthy();
    expect(validateChallenge({ title: 'x', points: 1, type: 'multiple_choice', choices: ['a', 'b'], correct_choice: 5 }).correct_choice).toBeTruthy();
    expect(validateChallenge({ title: 'x', points: 1, type: 'checkbox', reveal: 'at_time' }).reveal_at).toBeTruthy();
  });
  it('quick-adds venues from pasted lines', () => {
    expect(parseQuickVenues('The Crown | 4 Market Sq\n\n  The Fox  \n')).toEqual([
      { name: 'The Crown', address: '4 Market Sq', challenges: [] },
      { name: 'The Fox', address: null, challenges: [] },
    ]);
  });
});

describe('themes and templates', () => {
  it('every theme has a template with venues, challenges and team names', () => {
    for (const k of THEME_ORDER) {
      expect(THEMES[k].key).toBe(k);
      expect(TEMPLATES[k].venues.length).toBeGreaterThan(0);
      expect(TEMPLATES[k].teamNames.length).toBeGreaterThanOrEqual(4);
    }
  });
  it('all seeded challenges are valid and use known types', () => {
    const all = [...CHALLENGE_LIBRARY, ...THEME_ORDER.flatMap((k) => TEMPLATES[k].venues.flatMap((v) => v.challenges))];
    for (const c of all) {
      expect(CHALLENGE_TYPES[c.type]).toBeDefined();
      expect(validateChallenge(c)).toEqual({});
    }
  });
  it('never makes drinking alcohol the basis of a challenge', () => {
    const all = [...CHALLENGE_LIBRARY, ...THEME_ORDER.flatMap((k) => TEMPLATES[k].venues.flatMap((v) => v.challenges))];
    const banned = /\b(down (a|your|the|it)|chug|shot of|drink (a|the) (pint|beer|shot)|fastest drinker|neck|skull a)\b/i;
    for (const c of all) expect(`${c.title} ${c.description ?? ''}`).not.toMatch(banned);
  });
  it('theme palettes keep accent buttons readable', () => {
    for (const k of THEME_ORDER) {
      const p = THEMES[k].preview;
      expect(contrastRatio(p.ink, p.bg)).toBeGreaterThanOrEqual(7);
    }
  });
  it('custom themes pick readable button text', () => {
    expect(readableInk('#ffff00')).toBe('#111111');
    expect(readableInk('#1d2a26')).toBe('#ffffff');
    const vars = customThemeVars({ accent: '#123456', base: 'dark' });
    expect(vars['--c-accent']).toBe('#123456');
    expect(vars['--c-accent-ink']).toBe('#ffffff');
    expect(customThemeVars({ accent: 'not-a-colour' })['--c-accent']).toBe('#b8401b');
  });
});

describe('download all', () => {
  it('names downloaded media by order, time, team, person and challenge', () => {
    const m = { created_at: '2026-10-31T20:05:00', member_name: 'Alex', team_name: 'The Coven', challenge_title: 'Costume reveal / pose', mime_type: 'image/jpeg' } as EventMediaItem;
    expect(zipEntryName(m, 0)).toMatch(/^001 20261031-2005 The Coven - Alex - Costume reveal - pose\.jpg$/);
  });
});
