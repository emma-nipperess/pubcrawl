import type { CustomTheme, EventRow } from '@/lib/supabase/types';
import { NumberInput, Segmented, Select, TextArea, TextInput, Toggle } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { CUSTOM_FONTS, THEME_ORDER, THEMES, contrastRatio, type ThemeKey } from '@/features/themes/themes';
import { ThemeMotif } from '@/features/themes/ThemeScope';
import type { Errors } from '@/lib/validation/forms';

export type EventForm = Partial<EventRow> & { organiser_plays?: boolean };

export function ThemePicker({ value, onChange }: { value: string; onChange: (k: ThemeKey) => void }) {
  return (
    <fieldset>
      <legend className="sr-only">Theme</legend>
      <div className="grid-2">
        {THEME_ORDER.map((k) => {
          const t = THEMES[k];
          return (
            <label key={k} className="option-card">
              <input type="radio" name="theme" checked={value === k} onChange={() => onChange(k)} />
              <div className="card" data-theme={k} style={{ padding: 0, overflow: 'hidden', background: t.preview.bg, color: t.preview.ink }}>
                <div className="theme-swatch" style={{ border: 0, borderRadius: 0, background: 'transparent', color: 'inherit' }}>
                  <ThemeMotif motif={t.motif} />
                  <span className="theme-swatch__name">{t.name}</span>
                </div>
                <p className="xsmall" style={{ padding: '0 12px 12px', minHeight: 36 }}>
                  {t.tagline}
                </p>
              </div>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}

export function CustomThemeFields({ value, onChange }: { value: CustomTheme; onChange: (c: CustomTheme) => void }) {
  const accent = value.accent ?? '#b8401b';
  const bg = value.base === 'dark' ? '#16181d' : '#f5f1ea';
  const ratio = contrastRatio(accent, bg);
  return (
    <div className="stack card card--muted">
      <label className="field">
        <span className="field__label">Accent colour</span>
        <div className="row">
          <input type="color" value={accent} onChange={(e) => onChange({ ...value, accent: e.target.value })} style={{ width: 64, height: 44, border: 0, background: 'none' }} />
          <span className="mono small">{accent}</span>
        </div>
        {ratio < 3 && <span className="field__error">This colour is hard to see on the background (contrast {ratio.toFixed(1)}:1). Try a darker or brighter shade.</span>}
      </label>
      <Segmented
        legend="Base"
        value={value.base ?? 'light'}
        onChange={(v) => onChange({ ...value, base: v })}
        options={[
          { value: 'light', label: 'Light', icon: 'sun' },
          { value: 'dark', label: 'Dark', icon: 'moon' },
        ]}
      />
      <Select label="Heading font" value={value.font ?? 'bricolage'} onChange={(e) => onChange({ ...value, font: e.target.value })}>
        {Object.entries(CUSTOM_FONTS).map(([k, f]) => (
          <option key={k} value={k}>
            {f.label}
          </option>
        ))}
      </Select>
      <TextInput label="Tagline (optional)" maxLength={80} value={value.tagline ?? ''} onChange={(e) => onChange({ ...value, tagline: e.target.value })} />
    </div>
  );
}

const TIMEZONES = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    return [];
  }
})();

export function DetailsFields({ value, onChange, errors }: { value: EventForm; onChange: (e: EventForm) => void; errors?: Errors }) {
  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) => onChange({ ...value, [k]: v });
  return (
    <div className="stack">
      <TextInput label="Event name" value={value.name ?? ''} maxLength={80} onChange={(e) => set('name', e.target.value)} error={errors?.name} placeholder="Sam’s 30th Pub Golf" />
      <TextInput label="Your name (organiser)" value={value.organiser_name ?? ''} maxLength={40} onChange={(e) => set('organiser_name', e.target.value)} error={errors?.organiser_name} autoComplete="nickname" />
      <TextArea label="Description" rows={3} maxLength={2000} value={value.description ?? ''} onChange={(e) => set('description', e.target.value)} error={errors?.description} />
      <div className="grid-2">
        <TextInput label="Date" type="date" value={value.event_date ?? ''} onChange={(e) => set('event_date', e.target.value || null)} />
        <Select label="Time zone" value={value.timezone ?? 'Europe/London'} onChange={(e) => set('timezone', e.target.value)}>
          {(TIMEZONES.length ? TIMEZONES : ['Europe/London', 'Europe/Dublin', 'Australia/Sydney', 'America/New_York']).map((z) => (
            <option key={z} value={z}>
              {z.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </div>
      <div className="grid-2">
        <TextInput label="Start" type="time" value={value.start_time?.slice(0, 5) ?? ''} onChange={(e) => set('start_time', e.target.value || null)} />
        <TextInput label="End (optional)" type="time" value={value.end_time?.slice(0, 5) ?? ''} onChange={(e) => set('end_time', e.target.value || null)} error={errors?.end_time} />
      </div>
      <TextInput label="Meeting point" maxLength={200} value={value.start_location ?? ''} onChange={(e) => set('start_location', e.target.value)} placeholder="Outside the station" />
      <TextArea label="Meeting instructions" rows={2} maxLength={1000} value={value.meeting_instructions ?? ''} onChange={(e) => set('meeting_instructions', e.target.value)} />
    </div>
  );
}

/** All game rules, grouped and written as consequences so organisers know what each switch does. */
export function RulesFields({ value, onChange, errors, theme, live }: { value: EventForm; onChange: (e: EventForm) => void; errors?: Errors; theme: (typeof THEMES)[ThemeKey]; live?: boolean }) {
  const set = <K extends keyof EventForm>(k: K, v: EventForm[K]) => onChange({ ...value, [k]: v });
  const team = theme.vocab.team.toLowerCase();
  return (
    <div className="stack-lg">
      <section className="stack-sm">
        <h3 className="row" style={{ gap: 8 }}>
          <Icon name="lock" /> Access
        </h3>
        <Segmented
          legend="Visibility"
          value={value.visibility ?? 'private'}
          onChange={(v) => onChange({ ...value, visibility: v, require_code: v === 'private' ? true : value.require_code })}
          options={[
            { value: 'private', label: 'Private (invite only)', icon: 'lock' },
            { value: 'public', label: 'Listed publicly', icon: 'eye' },
          ]}
        />
        {value.visibility === 'public' && (
          <Toggle label="Still require the invite link or code" hint="Listed, but only people with the link can join." checked={value.require_code ?? true} onChange={(v) => set('require_code', v)} />
        )}
        <NumberInput label="Capacity (optional)" min={2} max={1000} value={value.capacity ?? null} onValue={(n) => set('capacity', n)} error={errors?.capacity} placeholder="No limit" />
        <Toggle label="Allow late arrivals" hint="People can join after the crawl starts. Earlier venues don’t count against them." checked={value.allow_late_join ?? true} onChange={(v) => set('allow_late_join', v)} />
        {live !== undefined && <Toggle label="Joining open" hint="Switch off to stop anyone new joining." checked={value.join_open ?? true} onChange={(v) => set('join_open', v)} />}
      </section>

      <section className="stack-sm">
        <h3 className="row" style={{ gap: 8 }}>
          <Icon name="users" /> Teams
        </h3>
        <Segmented
          legend="Play as"
          value={value.play_mode ?? 'both'}
          onChange={(v) => set('play_mode', v)}
          options={[
            { value: 'individual', label: 'Individuals' },
            { value: 'team', label: `${theme.vocab.team}s` },
            { value: 'both', label: 'Both' },
          ]}
        />
        {value.play_mode !== 'individual' && (
          <>
            <Select label={`How do players get a ${team}?`} value={value.team_selection ?? 'organiser'} onChange={(e) => set('team_selection', e.target.value as EventRow['team_selection'])}>
              <option value="organiser">I assign or shuffle them</option>
              <option value="self">Players choose when they join</option>
              <option value="auto">Automatic — smallest {team} first</option>
            </Select>
            <Toggle label={`Players can create their own ${team}s`} checked={value.allow_self_teams ?? false} onChange={(v) => set('allow_self_teams', v)} />
            <NumberInput label={`Max ${team} size`} min={1} max={100} value={value.team_max_size ?? null} onValue={(n) => set('team_max_size', n)} error={errors?.team_max_size} placeholder="No limit" />
            {live !== undefined && <Toggle label={`Lock ${team}s`} hint="Stops players switching teams." checked={value.teams_locked ?? false} onChange={(v) => set('teams_locked', v)} />}
          </>
        )}
      </section>

      <section className="stack-sm">
        <h3 className="row" style={{ gap: 8 }}>
          <Icon name="skip" /> Skipping & venues
        </h3>
        <Toggle label={`Players can skip a ${theme.vocab.venue.toLowerCase()}`} checked={value.allow_skip ?? true} onChange={(v) => set('allow_skip', v)} />
        <Select label="When someone skips or misses one" value={value.skip_policy ?? 'none'} onChange={(e) => set('skip_policy', e.target.value as EventRow['skip_policy'])}>
          <option value="none">No penalty — skipped challenges just don’t score</option>
          <option value="zero">Missed challenges show as zero on the scorecard</option>
          <option value="penalty">Deduct points for each skip</option>
        </Select>
        {value.skip_policy === 'penalty' && <NumberInput label="Skip penalty" min={0} max={1000} value={value.skip_penalty ?? 0} onValue={(n) => set('skip_penalty', n ?? 0)} error={errors?.skip_penalty} />}
        <Toggle label="Allow catching up on earlier venues" hint="Players can still submit challenges from finished venues." checked={value.allow_any_venue ?? false} onChange={(v) => set('allow_any_venue', v)} />
        <Toggle label="Show challenges before arriving" hint="Otherwise each venue’s challenges are revealed when it opens." checked={value.challenges_visible_early ?? false} onChange={(v) => set('challenges_visible_early', v)} />
      </section>

      <section className="stack-sm">
        <h3 className="row" style={{ gap: 8 }}>
          <Icon name="trophy" /> Scoring & proof
        </h3>
        <Toggle label="New challenges need my approval by default" checked={value.default_requires_approval ?? false} onChange={(v) => set('default_requires_approval', v)} />
        <Toggle label="Count pending proof provisionally" hint="Shown as provisional until approved. Rejected proof is removed." checked={value.provisional_scoring ?? false} onChange={(v) => set('provisional_scoring', v)} />
        <Toggle label="Allow partial points when approving" checked={value.allow_partial_points ?? false} onChange={(v) => set('allow_partial_points', v)} />
        <Select label="Ties" value={value.tie_break ?? 'shared'} onChange={(e) => set('tie_break', e.target.value as EventRow['tie_break'])}>
          <option value="shared">Share the position (=1st)</option>
          <option value="most_completed">More challenges completed wins</option>
          <option value="earliest">First to reach the score wins</option>
        </Select>
        <Toggle label="Everyone can see the leaderboard" hint="Off: players only see their own and their team’s score until the end." checked={value.leaderboard_visible ?? true} onChange={(v) => set('leaderboard_visible', v)} />
        <Toggle label="Players can see other teams’ approved photos" checked={value.show_others_submissions ?? true} onChange={(v) => set('show_others_submissions', v)} />
        <Select
          label="Keep photos & videos for"
          value={String(value.media_retention_days ?? 30)}
          onChange={(e) => set('media_retention_days', Number(e.target.value))}
          hint="After this, delete them from the organiser panel (Settings → Data). Scores stay."
        >
          {[7, 14, 30, 90].map((d) => (
            <option key={d} value={d}>
              {d} days after the event
            </option>
          ))}
        </Select>
        <Toggle label="I’m playing too" hint="Show me on the leaderboard and let me submit. (Another organiser should review my proof.)" checked={value.organiser_plays ?? false} onChange={(v) => set('organiser_plays', v)} />
      </section>
    </div>
  );
}
