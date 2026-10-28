import { useState } from 'react';
import { AdminShell } from './AdminRoutes';
import { useAdminAction } from './useAdminAction';
import { useEventCtx } from '@/app/EventRoutes';
import { db, rpc, useAnswers, useChallenges, useVenueNotes, useVenues } from '@/lib/supabase/queries';
import { supabase } from '@/lib/supabase/client';
import { Badge, Banner, Button, Card, EmptyState, ErrorState, LoadingBlock, Sheet } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { SortableList, arrayMove } from '@/components/Sortable';
import { VenueForm } from '@/features/venues/VenueForm';
import { ChallengeForm, blankChallenge, cleanChallenge } from '@/features/challenges/ChallengeForm';
import { CHALLENGE_TYPES } from '@/features/challenges/meta';
import { QuickAdd } from '@/features/events/CreateWizard';
import { CHALLENGE_LIBRARY } from '@/features/templates/content';
import { hasErrors, validateChallenge, validateVenue } from '@/lib/validation/forms';
import type { ChallengeDraft, ChallengeRow, VenueDraft, VenueRow } from '@/lib/supabase/types';
import { RouteMap, MapCredit } from '@/features/map/LazyMap';
import { stopsFromVenues } from '@/features/map/stops';
import { coordsFromMapsUrl, formatDistance, geocodeAddress, legs, sleep, venueLatLng, walkingMinutes } from '@/features/map/geo';

function venueToDraft(v: VenueRow, notes?: string): VenueDraft {
  return {
    name: v.name,
    address: v.address,
    maps_url: v.maps_url,
    latitude: v.latitude,
    longitude: v.longitude,
    description: v.description,
    meeting_instructions: v.meeting_instructions,
    arrive_at: v.arrive_at?.slice(0, 5) ?? null,
    depart_at: v.depart_at?.slice(0, 5) ?? null,
    duration_minutes: v.duration_minutes,
    accent_color: v.accent_color,
    par: v.par,
    bonus_points: v.bonus_points,
    time_limit_minutes: v.time_limit_minutes,
    organiser_notes: notes ?? '',
    challenges: [],
  };
}

function challengeToDraft(c: ChallengeRow, ans?: { correct_choice: number | null; accepted_answers: string[] | null }): ChallengeDraft {
  return { ...c, correct_choice: ans?.correct_choice ?? null, accepted_answers: ans?.accepted_answers ?? null };
}

export default function RouteEditor() {
  const { event, theme } = useEventCtx();
  const venues = useVenues(event.id);
  const challenges = useChallenges(event.id);
  const notes = useVenueNotes(event.id, true);
  const answers = useAnswers(event.id, true);
  const { run, busy, fb } = useAdminAction(event.id);
  const [editVenue, setEditVenue] = useState<{ id: string; draft: VenueDraft } | null>(null);
  const [editChallenge, setEditChallenge] = useState<{ venueId: string | null; draft: ChallengeDraft } | null>(null);
  const [quick, setQuick] = useState(false);
  const [order, setOrder] = useState<string[] | null>(null);
  const [errs, setErrs] = useState<Record<string, string | undefined>>({});
  const [showMap, setShowMap] = useState(true);
  const [geo, setGeo] = useState<{ done: number; total: number } | null>(null);

  if (venues.isLoading || challenges.isLoading)
    return (
      <AdminShell title={theme.vocab.venues}>
        <LoadingBlock />
      </AdminShell>
    );
  if (venues.isError)
    return (
      <AdminShell title={theme.vocab.venues}>
        <ErrorState error={venues.error} onRetry={() => venues.refetch()} />
      </AdminShell>
    );

  const list = venues.data ?? [];
  const ordered = order ? order.map((id) => list.find((v) => v.id === id)!).filter(Boolean) : list;
  const all = challenges.data ?? [];
  const editingFinished = event.status === 'completed' || event.status === 'archived';

  const unpinned = ordered.filter((v) => !v.disabled && !venueLatLng(v));
  const pinned = ordered.filter((v) => !v.disabled && venueLatLng(v));
  const distance = legs(ordered.filter((v) => !v.disabled).map((v) => venueLatLng(v))).reduce<number>((a, d) => a + (d ?? 0), 0);

  // Pin venues from their maps link or address. Nominatim allows ~1 request/second.
  const findMissing = async () => {
    setGeo({ done: 0, total: unpinned.length });
    let found = 0;
    try {
      for (let i = 0; i < unpinned.length; i++) {
        const v = unpinned[i];
        let at = coordsFromMapsUrl(v.maps_url);
        if (!at && (v.address || v.name)) {
          if (i > 0) await sleep(1100);
          at = await geocodeAddress([v.name, v.address].filter(Boolean).join(', '));
        }
        if (at) {
          await db.update('venues', v.id, { latitude: at.lat, longitude: at.lng });
          found++;
        }
        setGeo({ done: i + 1, total: unpinned.length });
      }
      fb.toast(found ? `Pinned ${found} of ${unpinned.length}. Check them on the map.` : 'Couldn’t find those addresses — edit each venue and tap the map instead.', found ? 'success' : 'error');
    } catch (e) {
      fb.error(e);
    } finally {
      setGeo(null);
      venues.refetch();
    }
  };

  const saveVenue = async () => {
    if (!editVenue) return;
    const e = validateVenue(editVenue.draft);
    setErrs(e);
    if (hasErrors(e)) return;
     
    const { organiser_notes, challenges: _c, ...patch } = editVenue.draft;
    const ok = await run('venue', async () => {
      await db.update('venues', editVenue.id, {
        ...patch,
        name: patch.name.trim(),
        address: patch.address?.trim() || null,
        maps_url: patch.maps_url?.trim() || null,
        description: patch.description?.trim() || null,
        meeting_instructions: patch.meeting_instructions?.trim() || null,
        arrive_at: patch.arrive_at || null,
        depart_at: patch.depart_at || null,
        bonus_points: patch.bonus_points ?? 0,
      });
      const { error } = await supabase.from('venue_organiser_notes').upsert({ venue_id: editVenue.id, event_id: event.id, notes: organiser_notes ?? '' });
      if (error) throw error;
      return true;
    }, { success: 'Saved' });
    if (ok) setEditVenue(null);
  };

  const saveChallenge = async () => {
    if (!editChallenge) return;
    const cleaned = cleanChallenge(editChallenge.draft);
    const e = validateChallenge(cleaned);
    setErrs(e);
    if (hasErrors(e)) return;
    const ok = await run('challenge', () => rpc('save_challenge', { p_event_id: event.id, p_venue_id: editChallenge.venueId, p_challenge: cleaned }), {
      success: cleaned.id ? 'Updated — points already earned are unchanged' : 'Added',
    });
    if (ok) setEditChallenge(null);
  };

  const renderChallenges = (venueId: string | null) => {
    const cs = all.filter((c) => c.venue_id === venueId);
    const live = cs.filter((c) => !c.archived);
    return (
      <div className="stack-sm">
        {live.length > 0 && (
          <SortableList
            items={live}
            getKey={(c) => c.id}
            label={(c) => c.title}
            onMove={(a, b) => run('reorder-c', () => rpc('reorder_challenges', { p_event_id: event.id, p_challenge_ids: arrayMove(live, a, b).map((c) => c.id) }), { refresh: ['challenges'] })}
            render={(c, _i, handle) => (
              <div className="list-row" style={{ padding: 6 }}>
                {handle}
                <button type="button" onClick={() => { setErrs({}); setEditChallenge({ venueId, draft: challengeToDraft(c, answers.data?.[c.id]) }); }} style={{ all: 'unset', cursor: 'pointer', flex: 1, minWidth: 0 }}>
                  <strong className="truncate" style={{ display: 'block' }}>
                    {c.title}
                  </strong>
                  <span className="xsmall muted row" style={{ gap: 4, flexWrap: 'wrap' }}>
                    <Icon name={CHALLENGE_TYPES[c.type].icon} size={14} /> {CHALLENGE_TYPES[c.type].label} · {c.points + c.bonus_points} {theme.vocab.points}
                    {c.scope === 'team' && ' · team'}
                    {c.requires_approval && ' · reviewed'}
                    {!c.required && ' · optional'}
                  </span>
                </button>
                <Button
                  size="sm"
                  variant="ghost"
                  iconOnly
                  icon="trash"
                  onClick={async () => {
                    const choice = await fb.confirm({
                      title: `Remove “${c.title}”?`,
                      body: 'If anyone has already submitted it, it will be archived instead: hidden from players, with earned points kept.',
                      danger: true,
                      confirmLabel: 'Remove',
                    });
                    if (!choice) return;
                    await run(`del-${c.id}`, async () => {
                      const { error } = await supabase.from('challenges').delete().eq('id', c.id);
                      if (error && (error.code === '23503' || /foreign key/i.test(error.message))) {
                        await rpc('save_challenge', { p_event_id: event.id, p_venue_id: venueId, p_challenge: { ...challengeToDraft(c, answers.data?.[c.id]), archived: true } });
                        fb.toast('Archived — it had submissions, so points are kept');
                      } else if (error) throw error;
                    });
                  }}
                >
                  Remove {c.title}
                </Button>
              </div>
            )}
          />
        )}
        {cs.some((c) => c.archived) && (
          <details>
            <summary className="xsmall muted">{cs.filter((c) => c.archived).length} archived</summary>
            <ul className="list" style={{ marginTop: 6 }}>
              {cs
                .filter((c) => c.archived)
                .map((c) => (
                  <li key={c.id} className="list-row small">
                    <span className="grow">{c.title}</span>
                    <Button size="sm" onClick={() => run(`un-${c.id}`, () => rpc('save_challenge', { p_event_id: event.id, p_venue_id: venueId, p_challenge: { ...challengeToDraft(c, answers.data?.[c.id]), archived: false } }), { success: 'Restored' })}>
                      Restore
                    </Button>
                  </li>
                ))}
            </ul>
          </details>
        )}
        <div className="row-wrap">
          <Button size="sm" icon="plus" disabled={editingFinished} onClick={() => { setErrs({}); setEditChallenge({ venueId, draft: { ...blankChallenge(), requires_approval: event.default_requires_approval } }); }}>
            Add {theme.vocab.challenge.toLowerCase()}
          </Button>
        </div>
      </div>
    );
  };

  return (
    <AdminShell title={theme.vocab.venues}>
      <div className="row-between">
        <h1 className="deco-title">The route</h1>
        <div className="row">
          <Button size="sm" icon="list-checks" onClick={() => setQuick(true)} disabled={editingFinished}>
            Add several
          </Button>
        </div>
      </div>
      {event.status !== 'draft' && event.status !== 'published' && (
        <Banner tone="info">
          Edits apply straight away. Changing points affects future completions only — anything already earned stays as it was. Use Scores to correct earned points.
        </Banner>
      )}
      {ordered.length > 0 && (
        <Card className="stack-sm">
          <div className="row-between">
            <h2 style={{ fontSize: 'var(--fs-lg)' }}>Route map</h2>
            <Button size="sm" variant="ghost" icon={showMap ? 'eye-off' : 'eye'} onClick={() => setShowMap(!showMap)} aria-expanded={showMap}>
              {showMap ? 'Hide' : 'Show'}
            </Button>
          </div>
          {pinned.length > 1 && (
            <p className="small">
              <Icon name="footprints" size={14} /> {formatDistance(distance)} in total · about {walkingMinutes(distance)} min of walking (straight-line estimate)
            </p>
          )}
          {showMap && pinned.length > 0 && <RouteMap stops={stopsFromVenues(ordered)} dark={theme.dark} height={300} />}
          {unpinned.length > 0 && (
            <Banner
              tone="warn"
              icon="map-pin"
              title={`${unpinned.length} not on the map`}
              action={
                <Button size="sm" loading={Boolean(geo)} onClick={findMissing}>
                  {geo ? `${geo.done}/${geo.total}` : 'Find them'}
                </Button>
              }
            >
              {unpinned.map((v) => v.name).join(', ')}. We’ll try their maps links and addresses — or edit a venue to pick it on the map.
            </Banner>
          )}
          {showMap && pinned.length > 0 && <MapCredit />}
        </Card>
      )}
      {ordered.length === 0 ? (
        <EmptyState icon="route" title={`No ${theme.vocab.venues.toLowerCase()} yet`} action={<Button variant="primary" icon="plus" onClick={() => setQuick(true)}>Add {theme.vocab.venues.toLowerCase()}</Button>}>
          Paste a list to add several at once.
        </EmptyState>
      ) : (
        <SortableList
          items={ordered}
          getKey={(v) => v.id}
          label={(v) => v.name}
          disabled={Boolean(busy)}
          onMove={async (a, b) => {
            const ids = arrayMove(ordered, a, b).map((v) => v.id);
            setOrder(ids);
            await run('reorder', () => rpc('reorder_venues', { p_event_id: event.id, p_venue_ids: ids }), { refresh: ['venues'] });
            setOrder(null);
          }}
          render={(v, i, handle) => (
            <Card className="stack-sm" style={{ opacity: v.disabled ? 0.6 : 1 }}>
              <div className="row" style={{ alignItems: 'flex-start' }}>
                {handle}
                <div className="grow" style={{ minWidth: 0 }}>
                  <span className="eyebrow">
                    {theme.vocab.venue} {i + 1}
                  </span>
                  <h3 className="truncate">{v.name}</h3>
                  <div className="row-wrap" style={{ marginTop: 4 }}>
                    <Badge tone={v.status === 'active' ? 'accent' : v.status === 'completed' ? 'success' : v.status === 'skipped' ? 'warn' : 'neutral'} live={v.status === 'active'}>
                      {v.status === 'active' ? 'Open now' : v.status}
                    </Badge>
                    {v.disabled && <Badge tone="warn" icon="eye-off">Disabled</Badge>}
                    {v.bonus_points > 0 && <Badge tone="brass">+{v.bonus_points} sweep</Badge>}
                    {notes.data?.[v.id] && <Badge icon="lock">Notes</Badge>}
                  </div>
                  {v.address && <p className="xsmall muted truncate">{v.address}</p>}
                </div>
              </div>
              <div className="row-wrap">
                <Button size="sm" icon="pencil" onClick={() => { setErrs({}); setEditVenue({ id: v.id, draft: venueToDraft(v, notes.data?.[v.id]) }); }}>
                  Edit
                </Button>
                <Button size="sm" icon="copy" loading={busy === `dup-${v.id}`} onClick={() => run(`dup-${v.id}`, () => rpc('duplicate_venue', { p_venue_id: v.id }), { success: `Duplicated ${v.name} with its ${theme.vocab.challenges.toLowerCase()}` })}>
                  Duplicate
                </Button>
                <Button size="sm" icon={v.disabled ? 'eye' : 'eye-off'} disabled={v.status === 'active'} onClick={() => run(`dis-${v.id}`, () => db.update('venues', v.id, { disabled: !v.disabled }), { success: v.disabled ? 'Back on the route' : 'Hidden from the route' })}>
                  {v.disabled ? 'Enable' : 'Disable'}
                </Button>
                {(v.status === 'upcoming' || v.status === 'skipped') && event.status !== 'draft' && event.status !== 'published' && (
                  <Button size="sm" variant="ghost" onClick={() => run(`skip-${v.id}`, () => rpc('set_venue_state', { p_venue_id: v.id, p_state: v.status === 'skipped' ? 'upcoming' : 'skipped' }))}>
                    {v.status === 'skipped' ? 'Un-skip' : 'Skip for everyone'}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  icon="trash"
                  disabled={v.status === 'active'}
                  onClick={() =>
                    run(`delv-${v.id}`, () => db.remove('venues', v.id), {
                      confirm: { title: `Delete ${v.name}?`, body: `Its ${all.filter((c) => c.venue_id === v.id).length} ${theme.vocab.challenges.toLowerCase()} are deleted too. If anyone has submitted there, disable it instead so their points are kept.`, danger: true, confirmLabel: 'Delete' },
                      success: 'Deleted',
                    })
                  }
                >
                  Delete
                </Button>
              </div>
              <details open={all.filter((c) => c.venue_id === v.id && !c.archived).length <= 3}>
                <summary className="small" style={{ cursor: 'pointer', fontWeight: 700 }}>
                  {all.filter((c) => c.venue_id === v.id && !c.archived).length} {theme.vocab.challenges.toLowerCase()}
                </summary>
                <div style={{ marginTop: 8 }}>{renderChallenges(v.id)}</div>
              </details>
            </Card>
          )}
        />
      )}

      <section className="stack-sm">
        <h2 className="section-title">All-night {theme.vocab.challenges.toLowerCase()}</h2>
        <p className="small muted">Not tied to a {theme.vocab.venue.toLowerCase()} — open throughout the crawl (e.g. bonus spots).</p>
        {renderChallenges(null)}
      </section>

      <Sheet open={quick} onClose={() => setQuick(false)} title={`Add ${theme.vocab.venues.toLowerCase()}`}>
        <QuickAdd
          busy={busy === 'quick'}
          onAdd={async (vs) => {
            const ok = await run('quick', () => rpc('add_venues', { p_event_id: event.id, p_venues: vs }), { success: `Added ${vs.length}` });
            if (ok !== undefined) setQuick(false);
          }}
        />
      </Sheet>

      <Sheet open={Boolean(editVenue)} onClose={() => setEditVenue(null)} title={`Edit ${theme.vocab.venue.toLowerCase()}`}>
        {editVenue && (
          <div className="stack">
            <VenueForm value={editVenue.draft} theme={theme} errors={errs} onChange={(d) => setEditVenue({ ...editVenue, draft: d })} />
            <Button variant="primary" block loading={busy === 'venue'} onClick={saveVenue}>
              Save
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={Boolean(editChallenge)} onClose={() => setEditChallenge(null)} title={editChallenge?.draft.id ? `Edit ${theme.vocab.challenge.toLowerCase()}` : `New ${theme.vocab.challenge.toLowerCase()}`}>
        {editChallenge && (
          <div className="stack">
            {!editChallenge.draft.id && (
              <details>
                <summary className="btn btn--ghost btn--sm" style={{ display: 'inline-flex' }}>
                  <Icon name="sparkles" /> Start from the library
                </summary>
                <ul className="list" style={{ marginTop: 8 }}>
                  {CHALLENGE_LIBRARY.map((lib) => (
                    <li key={lib.title}>
                      <button
                        type="button"
                        className="list-row"
                        style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }}
                        onClick={() => {
                          // eslint-disable-next-line @typescript-eslint/no-unused-vars
                          const { tags, ...c } = lib;
                          setEditChallenge({ ...editChallenge, draft: { ...c } });
                        }}
                      >
                        <Icon name={CHALLENGE_TYPES[lib.type].icon} /> <span className="grow">{lib.title}</span>
                        <span className="xsmall muted">{lib.points} pts</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            {editChallenge.draft.id && event.status !== 'draft' && event.status !== 'published' && (
              <Banner tone="info">Type and team/individual are locked once anyone has submitted. Point changes apply to new completions only.</Banner>
            )}
            <ChallengeForm value={editChallenge.draft} theme={theme} errors={errs} onChange={(d) => setEditChallenge({ ...editChallenge, draft: d })} />
            <Button variant="primary" block loading={busy === 'challenge'} onClick={saveChallenge}>
              Save
            </Button>
          </div>
        )}
      </Sheet>
    </AdminShell>
  );
}
