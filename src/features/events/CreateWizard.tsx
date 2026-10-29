import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { TopBar } from '@/components/Shell';
import { Badge, Banner, Button, Card, EmptyState, LinkButton, Sheet, TextArea } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useFeedback } from '@/components/feedback';
import { SortableList, arrayMove } from '@/components/Sortable';
import { ThemeScope } from '@/features/themes/ThemeScope';
import { getTheme, type ThemeKey } from '@/features/themes/themes';
import { CHALLENGE_LIBRARY, EVENT_DEFAULTS, SCORING_PRESETS, TEMPLATES } from '@/features/templates/content';
import { CHALLENGE_TYPES } from '@/features/challenges/meta';
import { ChallengeForm, blankChallenge, cleanChallenge } from '@/features/challenges/ChallengeForm';
import { VenueForm } from '@/features/venues/VenueForm';
import { CustomThemeFields, DetailsFields, GameModeFields, RulesFields, ThemePicker, type EventForm } from './EventSettingsForm';
import { hasErrors, parseQuickVenues, validateChallenge, validateEvent, validateVenue } from '@/lib/validation/forms';
import { useAuth } from '@/lib/auth';
import { db, rpc, useTemplates } from '@/lib/supabase/queries';
import type { ChallengeDraft, TemplatePayload, VenueDraft } from '@/lib/supabase/types';
import { rememberEvent } from '@/lib/recent';
import { RouteMap, MapCredit } from '@/features/map/LazyMap';
import { GOLF_HOLES } from '@/features/golf/golf';
import { venueLatLng } from '@/features/map/geo';

const STORAGE_KEY = 'roundhouse-wizard-v1';
const STEPS = ['Theme', 'Details', 'Route', 'Rules', 'Review'] as const;

interface WizardState {
  step: number;
  event: EventForm;
  venues: (VenueDraft & { _k: string })[];
  teamNames: string[];
  scoring: string;
}

const key = () => Math.random().toString(36).slice(2);

function fromTheme(themeKey: ThemeKey, organiser = ''): WizardState {
  const t = getTheme(themeKey);
  const tpl = TEMPLATES[themeKey];
  const preset = SCORING_PRESETS.find((p) => p.key === tpl.scoringPreset)!;
  return {
    step: 0,
    event: { ...EVENT_DEFAULTS, ...preset.settings, ...tpl.event, theme_key: themeKey, description: t.description, organiser_name: organiser, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/London', theme_custom: {} },
    venues: tpl.venues.map((v) => ({ ...v, _k: key(), challenges: v.challenges.map((c) => ({ ...c })) })),
    teamNames: tpl.teamNames.slice(0, 4),
    scoring: preset.key,
  };
}

/** Give every hole without one a drink and par from the starter golf course. */
function withGolfDefaults<T extends VenueDraft>(venues: T[]): T[] {
  return venues.map((v, i) => ({ ...v, drink: v.drink || GOLF_HOLES[i % GOLF_HOLES.length].drink, par: v.par ?? GOLF_HOLES[i % GOLF_HOLES.length].par }));
}

function loadSaved(): WizardState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as WizardState) : null;
  } catch {
    return null;
  }
}

export default function CreateWizard() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [search] = useSearchParams();
  const fb = useFeedback();
  const { ensureUser, user } = useAuth();
  const templates = useTemplates();
  const [s, setS] = useState<WizardState>(() => loadSaved() ?? fromTheme('classic'));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<{ v: number; c: number | 'new' | null } | null>(null);
  const [quickAdd, setQuickAdd] = useState(false);
  const submitting = useRef(false);
  const theme = getTheme(s.event.theme_key);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    } catch {
      /* ignore */
    }
  }, [s]);

  // ?template=<id> starts from a saved template
  useEffect(() => {
    const id = search.get('template');
    const t = id && templates.data?.find((x) => x.id === id);
    if (t) applyTemplate(t.payload, t.theme_key as ThemeKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, templates.data]);

  const applyTemplate = (p: TemplatePayload, themeKey: ThemeKey) => {
    setS({
      step: 1,
      event: { ...EVENT_DEFAULTS, ...p.event, theme_key: themeKey, organiser_name: s.event.organiser_name || p.event.organiser_name },
      venues: p.venues.map((v) => ({ ...v, _k: key() })),
      teamNames: (p.event.team_names ?? []).map((t) => t.name),
      scoring: 'custom',
    });
  };

  const setEvent = (e: EventForm) => setS((x) => ({ ...x, event: e }));
  const setVenues = (fn: (v: WizardState['venues']) => WizardState['venues']) => setS((x) => ({ ...x, venues: fn(x.venues) }));
  const go = (step: number) => {
    setS((x) => ({ ...x, step }));
    window.scrollTo(0, 0);
  };

  const pickTheme = async (k: ThemeKey) => {
    const touched = s.venues.some((v, i) => JSON.stringify({ ...v, _k: '' }) !== JSON.stringify({ ...TEMPLATES[s.event.theme_key as ThemeKey]?.venues[i], _k: '' }));
    if (touched && !(await fb.confirm({ title: `Switch to ${getTheme(k).name}?`, body: 'This replaces your venues and challenges with the theme’s starter set. Your event name and details are kept.', confirmLabel: 'Switch theme' }))) {
      setEvent({ ...s.event, theme_key: k });
      return;
    }
    const fresh = fromTheme(k, s.event.organiser_name);
    const golf = s.event.game_mode === 'golf';
    setS({
      ...fresh,
      venues: golf ? withGolfDefaults(fresh.venues) : fresh.venues,
      event: { ...fresh.event, name: s.event.name, event_date: s.event.event_date, start_time: s.event.start_time, start_location: s.event.start_location, game_mode: s.event.game_mode ?? 'crawl', golf_default_par: s.event.golf_default_par ?? 3, golf_max_over: s.event.golf_max_over ?? 3 },
    });
  };

  const validateStep = (step: number): boolean => {
    if (step === 1) {
      const e = validateEvent(s.event);
      setErrors(e);
      return !hasErrors(e);
    }
    if (step === 2) {
      for (const v of s.venues) {
        const e = validateVenue(v);
        if (hasErrors(e)) {
          fb.toast(`${v.name || 'A venue'}: ${Object.values(e).find(Boolean)}`, 'error');
          return false;
        }
        for (const c of v.challenges) {
          const ce = validateChallenge(c);
          if (hasErrors(ce)) {
            fb.toast(`${v.name} → ${c.title || 'challenge'}: ${Object.values(ce).find(Boolean)}`, 'error');
            return false;
          }
        }
      }
      if (s.venues.length === 0) {
        fb.toast(`Add at least one ${theme.vocab.venue.toLowerCase()}.`, 'error');
        return false;
      }
      return true;
    }
    if (step === 3) {
      const e = validateEvent(s.event);
      setErrors(e);
      return !hasErrors(e);
    }
    return true;
  };

  const next = () => {
    if (validateStep(s.step)) go(Math.min(s.step + 1, STEPS.length - 1));
  };

  const payload = (): { event: EventForm & { team_names: { name: string; color: string }[] }; venues: VenueDraft[] } => {
    const tpl = TEMPLATES[s.event.theme_key as ThemeKey] ?? TEMPLATES.custom;
    return {
      event: {
        ...s.event,
        name: s.event.name?.trim(),
        team_names: s.event.play_mode === 'individual' ? [] : s.teamNames.filter((n) => n.trim()).map((name, i) => ({ name: name.trim(), color: tpl.teamColors[i % tpl.teamColors.length] })),
      },
       
      venues: s.venues.map(({ _k, ...v }) => ({ ...v, challenges: v.challenges.map(cleanChallenge) })),
    };
  };

  const create = async () => {
    if (submitting.current) return;
    for (const st of [1, 2, 3]) if (!validateStep(st)) return go(st);
    submitting.current = true;
    setBusy(true);
    try {
      await ensureUser();
      const p = payload();
      const id = await rpc<string>('create_event', { p_event: p.event, p_venues: p.venues });
      localStorage.removeItem(STORAGE_KEY);
      rememberEvent({ id, name: p.event.name!, theme_key: p.event.theme_key!, role: 'organiser' });
      await qc.invalidateQueries({ queryKey: ['myEvents'] });
      fb.toast('Crawl created as a draft. Preview it, then publish.', 'success');
      nav(`/e/${id}/admin`, { replace: true });
    } catch (e) {
      fb.error(e);
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };

  const saveTemplate = async () => {
    try {
      const u = await ensureUser();
      const p = payload();
      await db.insert('event_templates', { owner_id: u.id, name: p.event.name || `${theme.name} template`, description: p.event.description ?? null, theme_key: p.event.theme_key, payload: p });
      await qc.invalidateQueries({ queryKey: ['templates'] });
      fb.toast('Saved to your templates', 'success');
    } catch (e) {
      fb.error(e);
    }
  };

  const reset = async () => {
    if (await fb.confirm({ title: 'Start over?', body: 'This clears everything in the wizard.', danger: true, confirmLabel: 'Start over' })) {
      localStorage.removeItem(STORAGE_KEY);
      setS(fromTheme('classic'));
    }
  };

  const totalChallenges = useMemo(() => s.venues.reduce((a, v) => a + v.challenges.length, 0), [s.venues]);
  const editVenue = editing ? s.venues[editing.v] : null;

  return (
    <ThemeScope themeKey={s.event.theme_key ?? 'classic'} custom={s.event.theme_custom}>
      <TopBar back="/" title={`New crawl · ${STEPS[s.step]}`} right={<Button variant="ghost" size="sm" onClick={reset}>Reset</Button>} />
      <main className="page page--no-nav stack" id="main">
        <div className="steps" aria-label={`Step ${s.step + 1} of ${STEPS.length}`}>
          {STEPS.map((label, i) => (
            <span key={label} data-done={i <= s.step} title={label} />
          ))}
        </div>

        {s.step === 0 && !user?.email && (
          <Banner
            tone="info"
            icon="badge-check"
            title={user ? 'You’re a guest on this device' : 'Not signed in'}
            action={<LinkButton to="/signin?next=/new" size="sm">{user ? 'Save account' : 'Sign in'}</LinkButton>}
          >
            Sign in with email to run this crawl from your phone too. Otherwise you can only manage it from this browser.
          </Banner>
        )}
        {s.step === 0 && (
          <section className="stack">
            <h1>What are you playing?</h1>
            <GameModeFields
              value={s.event}
              onChange={(e) => setS((x) => ({ ...x, event: e, venues: e.game_mode === 'golf' && x.event.game_mode !== 'golf' ? withGolfDefaults(x.venues) : x.venues }))}
            />
            <h2 style={{ marginTop: 'var(--s-4)' }}>Pick a vibe</h2>
            <p className="muted">Themes change the look, the words and the starter challenges. You can edit everything afterwards.</p>
            <ThemePicker value={s.event.theme_key ?? 'classic'} onChange={pickTheme} />
            {s.event.theme_key === 'custom' && <CustomThemeFields value={s.event.theme_custom ?? {}} onChange={(c) => setEvent({ ...s.event, theme_custom: c })} />}
            {user && templates.data && templates.data.length > 0 && (
              <section className="stack-sm">
                <h2 className="section-title">Your templates</h2>
                <ul className="list">
                  {templates.data.map((t) => (
                    <li key={t.id} className="list-row">
                      <span className="grow">
                        <strong>{t.name}</strong>
                        <span className="xsmall muted" style={{ display: 'block' }}>
                          {getTheme(t.theme_key).name} · {t.payload.venues.length} venues
                        </span>
                      </span>
                      <Button size="sm" onClick={() => applyTemplate(t.payload, t.theme_key as ThemeKey)}>
                        Use
                      </Button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </section>
        )}

        {s.step === 1 && (
          <section className="stack">
            <h1 className="deco-title">The details</h1>
            <DetailsFields value={s.event} onChange={setEvent} errors={errors} />
          </section>
        )}

        {s.step === 2 && (
          <section className="stack">
            <div className="row-between">
              <h1 className="deco-title">The route</h1>
              <Badge>
                {s.venues.length} {theme.vocab.venues.toLowerCase()} · {totalChallenges} {theme.vocab.challenges.toLowerCase()}
              </Badge>
            </div>
            <p className="muted small">Drag to reorder. Tap a {theme.vocab.venue.toLowerCase()} to edit it and its {theme.vocab.challenges.toLowerCase()}.</p>
            {s.venues.some((v) => venueLatLng(v)) && (
              <>
                <RouteMap stops={s.venues.map((v, i) => ({ id: v._k, n: i + 1, name: v.name, at: venueLatLng(v), state: 'upcoming' as const }))} dark={theme.dark} height={240} />
                <MapCredit />
              </>
            )}
            {s.venues.length === 0 ? (
              <EmptyState icon="route" title={`No ${theme.vocab.venues.toLowerCase()} yet`} action={<Button variant="primary" icon="plus" onClick={() => setQuickAdd(true)}>Add {theme.vocab.venues.toLowerCase()}</Button>}>
                Paste a list of pubs to add them all at once.
              </EmptyState>
            ) : (
              <SortableList
                items={s.venues}
                getKey={(v) => v._k}
                label={(v) => v.name}
                onMove={(a, b) => setVenues((vs) => arrayMove(vs, a, b))}
                render={(v, i, handle) => (
                  <div className="card card--tight row" style={{ alignItems: 'stretch' }}>
                    {handle}
                    <button type="button" className="grow" onClick={() => setEditing({ v: i, c: null })} style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}>
                      <span className="eyebrow">
                        {theme.vocab.venue} {i + 1}
                      </span>
                      <strong className="truncate" style={{ display: 'block', fontSize: 'var(--fs-md)' }}>
                        {v.name || 'Untitled'}
                      </strong>
                      <span className="xsmall muted">
                        {s.event.game_mode === 'golf' ? `Par ${v.par ?? s.event.golf_default_par ?? 3}${v.drink ? ` · ${v.drink}` : ''} · ` : ''}
                        {v.challenges.length} {v.challenges.length === 1 ? theme.vocab.challenge.toLowerCase() : theme.vocab.challenges.toLowerCase()}
                        {v.address ? ` · ${v.address}` : ''}
                      </span>
                    </button>
                    <div className="stack-sm" style={{ justifyContent: 'center' }}>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon="copy"
                        onClick={() => setVenues((vs) => [...vs.slice(0, i + 1), { ...structuredClone(v), _k: key(), name: `${v.name} (copy)`.slice(0, 80) }, ...vs.slice(i + 1)])}
                      >
                        Duplicate {v.name}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        icon="trash"
                        onClick={async () => {
                          if (await fb.confirm({ title: `Remove ${v.name || 'this venue'}?`, body: `Its ${v.challenges.length} challenges go too.`, danger: true, confirmLabel: 'Remove' }))
                            setVenues((vs) => vs.filter((_, j) => j !== i));
                        }}
                      >
                        Remove {v.name}
                      </Button>
                    </div>
                  </div>
                )}
              />
            )}
            <div className="grid-2">
              <Button icon="plus" onClick={() => { setVenues((vs) => [...vs, { _k: key(), name: `${theme.vocab.venue} ${vs.length + 1}`, challenges: [] }]); setEditing({ v: s.venues.length, c: null }); }}>
                Add one
              </Button>
              <Button icon="list-checks" onClick={() => setQuickAdd(true)}>
                Add several
              </Button>
            </div>
          </section>
        )}

        {s.step === 3 && (
          <section className="stack">
            <h1 className="deco-title">House rules</h1>
            <fieldset>
              <legend>Quick presets</legend>
              <div className="stack-sm">
                {SCORING_PRESETS.map((p) => (
                  <label key={p.key} className="option-card">
                    <input type="radio" name="preset" checked={s.scoring === p.key} onChange={() => setS((x) => ({ ...x, scoring: p.key, event: { ...x.event, ...p.settings } }))} />
                    <div className="card card--tight">
                      <strong>{p.label}</strong>
                      <p className="small muted">{p.description}</p>
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
            <RulesFields value={s.event} onChange={(e) => setS((x) => ({ ...x, event: e, scoring: 'custom' }))} errors={errors} theme={theme} />
            {s.event.play_mode !== 'individual' && (
              <section className="stack-sm">
                <h3>Starter {theme.vocab.team.toLowerCase()}s</h3>
                <p className="small muted">Created with the event. Add, rename or shuffle players into them later.</p>
                {s.teamNames.map((n, i) => (
                  <div key={i} className="row">
                    <input className="input" value={n} maxLength={40} aria-label={`Team ${i + 1} name`} onChange={(e) => setS((x) => ({ ...x, teamNames: x.teamNames.map((t, j) => (j === i ? e.target.value : t)) }))} />
                    <Button variant="ghost" iconOnly icon="x" onClick={() => setS((x) => ({ ...x, teamNames: x.teamNames.filter((_, j) => j !== i) }))}>
                      Remove team {n}
                    </Button>
                  </div>
                ))}
                <Button
                  size="sm"
                  icon="plus"
                  onClick={() => {
                    const pool = TEMPLATES[s.event.theme_key as ThemeKey]?.teamNames ?? [];
                    const nextName = pool.find((p) => !s.teamNames.includes(p)) ?? `${theme.vocab.team} ${s.teamNames.length + 1}`;
                    setS((x) => ({ ...x, teamNames: [...x.teamNames, nextName] }));
                  }}
                >
                  Add {theme.vocab.team.toLowerCase()}
                </Button>
              </section>
            )}
          </section>
        )}

        {s.step === 4 && (
          <section className="stack">
            <h1 className="deco-title">{s.event.name}</h1>
            <Card className="stack-sm">
              <p>
                <strong>{s.event.game_mode === 'golf' ? 'Pub golf' : 'Pub crawl'}</strong> · {theme.name} · {s.event.event_date || 'No date yet'} {s.event.start_time ? `at ${s.event.start_time}` : ''}
              </p>
              <p className="small muted">
                {s.venues.length} {theme.vocab.venues.toLowerCase()}, {totalChallenges} {theme.vocab.challenges.toLowerCase()}, {s.event.play_mode === 'individual' ? 'individual play' : `${s.teamNames.length} ${theme.vocab.team.toLowerCase()}s`},{' '}
                {s.event.visibility === 'private' ? 'private, invite only' : 'publicly listed'}.
              </p>
            </Card>
            <ol className="timeline">
              {s.venues.map((v, i) => (
                <li key={v._k}>
                  <strong>
                    {i + 1}. {v.name}
                  </strong>
                  {s.event.game_mode === 'golf' && (
                    <span className="small" style={{ display: 'block' }}>
                      Par {v.par ?? s.event.golf_default_par ?? 3}{v.drink ? ` · ${v.drink}` : ''}
                    </span>
                  )}
                  <ul className="small muted" style={{ margin: '4px 0 0', paddingLeft: 18 }}>
                    {v.challenges.map((c, j) => (
                      <li key={j}>
                        {c.title} · {c.points + (c.bonus_points ?? 0)} {theme.vocab.points}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
            <Banner tone="info" title="It starts as a draft">
              Nobody can see it until you publish. You can preview it as a participant and change anything first.
            </Banner>
            <Button icon="download" onClick={saveTemplate}>
              Save as a reusable template
            </Button>
          </section>
        )}

        <div className="sticky-actions">
          {s.step > 0 && (
            <Button onClick={() => go(s.step - 1)} icon="arrow-left">
              Back
            </Button>
          )}
          {s.step < STEPS.length - 1 ? (
            <Button variant="primary" block onClick={next}>
              Next: {STEPS[s.step + 1]}
            </Button>
          ) : (
            <Button variant="primary" block loading={busy} onClick={create} icon="check">
              Create crawl
            </Button>
          )}
        </div>
      </main>

      <Sheet open={quickAdd} onClose={() => setQuickAdd(false)} title={`Add several ${theme.vocab.venues.toLowerCase()}`}>
        <QuickAdd
          onAdd={(list) => {
            setVenues((vs) => [...vs, ...list.map((v) => ({ ...v, _k: key() }))]);
            setQuickAdd(false);
            fb.toast(`Added ${list.length}`, 'success');
          }}
        />
      </Sheet>

      <Sheet open={Boolean(editing && editVenue)} onClose={() => setEditing(null)} title={editing?.c != null ? (editing.c === 'new' ? `New ${theme.vocab.challenge.toLowerCase()}` : `Edit ${theme.vocab.challenge.toLowerCase()}`) : editVenue?.name || theme.vocab.venue}>
        {editing && editVenue && editing.c == null && (
          <div className="stack-lg">
            <VenueForm value={editVenue} theme={theme} golf={s.event.game_mode === 'golf'} defaultPar={s.event.golf_default_par ?? 3} errors={validateVenue(editVenue)} onChange={(nv) => setVenues((vs) => vs.map((x, j) => (j === editing.v ? { ...x, ...nv } : x)))} />
            <section className="stack-sm">
              <div className="row-between">
                <h3>{theme.vocab.challenges}</h3>
                <Button size="sm" icon="plus" variant="secondary" onClick={() => setEditing({ ...editing, c: 'new' })}>
                  Add
                </Button>
              </div>
              {editVenue.challenges.length === 0 && <p className="muted small">No {theme.vocab.challenges.toLowerCase()} yet — this {theme.vocab.venue.toLowerCase()} will just be a stop on the route.</p>}
              <SortableList
                items={editVenue.challenges.map((c, i) => ({ c, i }))}
                getKey={(x) => `${x.i}-${x.c.title}`}
                label={(x) => x.c.title}
                onMove={(a, b) => setVenues((vs) => vs.map((x, j) => (j === editing.v ? { ...x, challenges: arrayMove(x.challenges, a, b) } : x)))}
                render={({ c, i }, _idx, handle) => (
                  <div className="list-row" style={{ padding: 6 }}>
                    {handle}
                    <button type="button" onClick={() => setEditing({ ...editing, c: i })} style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}>
                      <strong className="truncate" style={{ display: 'block' }}>
                        {c.title || 'Untitled'}
                      </strong>
                      <span className="xsmall muted row" style={{ gap: 4 }}>
                        <Icon name={CHALLENGE_TYPES[c.type].icon} size={14} /> {CHALLENGE_TYPES[c.type].label} · {c.points} {theme.vocab.points}
                        {c.scope === 'team' || c.type === 'team' ? ' · team' : ''}
                      </span>
                    </button>
                    <Button
                      size="sm"
                      variant="ghost"
                      iconOnly
                      icon="trash"
                      onClick={() => setVenues((vs) => vs.map((x, j) => (j === editing.v ? { ...x, challenges: x.challenges.filter((_, k) => k !== i) } : x)))}
                    >
                      Remove {c.title}
                    </Button>
                  </div>
                )}
              />
              <details>
                <summary className="btn btn--ghost btn--sm" style={{ display: 'inline-flex' }}>
                  <Icon name="sparkles" /> Add from the challenge library
                </summary>
                <ul className="list" style={{ marginTop: 8 }}>
                  {CHALLENGE_LIBRARY.map((lib) => (
                    <li key={lib.title} className="list-row">
                      <span className="grow">
                        <strong>{lib.title}</strong>
                        <span className="xsmall muted" style={{ display: 'block' }}>
                          {CHALLENGE_TYPES[lib.type].label} · {lib.points} pts
                        </span>
                      </span>
                      <Button
                        size="sm"
                        iconOnly
                        icon="plus"
                        onClick={() => {
                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                          const { tags, ...c } = lib;
                          setVenues((vs) => vs.map((x, j) => (j === editing.v ? { ...x, challenges: [...x.challenges, { ...c }] } : x)));
                          fb.toast(`Added “${lib.title}”`);
                        }}
                      >
                        Add {lib.title}
                      </Button>
                    </li>
                  ))}
                </ul>
              </details>
            </section>
            <Button variant="primary" block onClick={() => setEditing(null)}>
              Done
            </Button>
          </div>
        )}
        {editing && editVenue && editing.c != null && (
          <ChallengeEditorLocal
            initial={editing.c === 'new' ? blankChallenge() : editVenue.challenges[editing.c]}
            theme={theme}
            onCancel={() => setEditing({ ...editing, c: null })}
            onSave={(c) => {
              setVenues((vs) =>
                vs.map((x, j) =>
                  j === editing.v ? { ...x, challenges: editing.c === 'new' ? [...x.challenges, c] : x.challenges.map((y, k) => (k === editing.c ? c : y)) } : x,
                ),
              );
              setEditing({ ...editing, c: null });
            }}
          />
        )}
      </Sheet>
    </ThemeScope>
  );
}

function ChallengeEditorLocal({ initial, theme, onSave, onCancel }: { initial: ChallengeDraft; theme: ReturnType<typeof getTheme>; onSave: (c: ChallengeDraft) => void; onCancel: () => void }) {
  const [c, setC] = useState<ChallengeDraft>(initial);
  const [errs, setErrs] = useState<Record<string, string | undefined>>({});
  return (
    <div className="stack">
      <ChallengeForm value={c} onChange={setC} theme={theme} errors={errs} />
      <div className="row">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          block
          onClick={() => {
            const cleaned = cleanChallenge(c);
            const e = validateChallenge(cleaned);
            setErrs(e);
            if (!hasErrors(e)) onSave(cleaned);
          }}
        >
          Save {theme.vocab.challenge.toLowerCase()}
        </Button>
      </div>
    </div>
  );
}

export function QuickAdd({ onAdd, busy }: { onAdd: (v: VenueDraft[]) => void; busy?: boolean }) {
  const [text, setText] = useState('');
  const list = parseQuickVenues(text);
  return (
    <div className="stack">
      <TextArea
        label="One per line"
        hint="Optionally add the address after a | — e.g. “The Crown | 4 Market Square”."
        rows={8}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={'The Red Lion | 1 High St\nThe Crown\nThe Fox & Hounds | Mill Lane'}
      />
      <Button variant="primary" block disabled={list.length === 0} loading={busy} onClick={() => onAdd(list)}>
        Add {list.length || ''} {list.length === 1 ? 'venue' : 'venues'}
      </Button>
    </div>
  );
}
