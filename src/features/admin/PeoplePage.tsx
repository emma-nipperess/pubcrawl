import { useMemo, useState } from 'react';
import { AdminShell } from './AdminRoutes';
import { useAdminAction } from './useAdminAction';
import { useEventCtx } from '@/app/EventRoutes';
import { db, rpc, useGolfScores, useMembers, useParticipation, useTeams, useVenues } from '@/lib/supabase/queries';
import { holePar } from '@/features/golf/golf';
import { Avatar, Badge, Banner, Button, Card, EmptyState, LoadingBlock, NumberInput, Segmented, Select, Sheet, TextInput, Toggle } from '@/components/ui';
import { Icon, TEAM_ICONS } from '@/components/Icon';
import { shuffleIntoTeams, pickTeamForLateJoiner } from '@/features/teams/shuffle';
import { TEAMS_NAMES_FOR, teamColor } from './teamNames';
import type { MemberRow } from '@/lib/supabase/types';

export default function PeoplePage() {
  const { event, theme, isOwner } = useEventCtx();
  const members = useMembers(event.id);
  const teams = useTeams(event.id);
  const venues = useVenues(event.id);
  const participation = useParticipation(event.id);
  const golf = event.game_mode === 'golf';
  const golfScores = useGolfScores(event.id, golf);
  const { run, busy } = useAdminAction(event.id);
  const [tab, setTab] = useState<'teams' | 'people'>(event.play_mode === 'individual' ? 'people' : 'teams');
  const [shuffleOpen, setShuffleOpen] = useState(false);
  const [newTeam, setNewTeam] = useState('');
  const [person, setPerson] = useState<MemberRow | null>(null);
  const [editTeam, setEditTeam] = useState<{ id: string; name: string; color: string; icon: string; max_size: number | null } | null>(null);

  const teamOf = useMemo(() => new Map((teams.data?.links ?? []).map((l) => [l.member_id, l.team_id])), [teams.data]);
  const active = (members.data ?? []).filter((m) => m.status === 'active' && m.is_player);
  const inactive = (members.data ?? []).filter((m) => m.status !== 'active');
  const unassigned = active.filter((m) => !teamOf.get(m.id));
  const tlist = teams.data?.teams ?? [];
  const team = theme.vocab.team.toLowerCase();

  if (members.isLoading || teams.isLoading)
    return (
      <AdminShell title="People">
        <LoadingBlock />
      </AdminShell>
    );

  const assign = (m: MemberRow, teamId: string | null) =>
    run(`as-${m.id}`, () => rpc('assign_member_team', { p_member_id: m.id, p_team_id: teamId }), { refresh: ['teams', 'members', 'leaderboard', 'me'] });

  const autoPlaceUnassigned = () =>
    run('auto', async () => {
      const sizes = tlist.map((t) => ({ id: t.id, size: (teams.data?.links ?? []).filter((l) => l.team_id === t.id).length, maxSize: t.max_size ?? event.team_max_size }));
      for (const m of unassigned) {
        const pick = pickTeamForLateJoiner(sizes);
        if (!pick) throw new Error(`Every ${team} is full — add a ${team} or raise the size limit.`);
        await rpc('assign_member_team', { p_member_id: m.id, p_team_id: pick.id });
        pick.size += 1;
      }
    }, { success: `Placed ${unassigned.length} into the smallest ${team}s` });

  return (
    <AdminShell title="People">
      <h1 className="deco-title">People</h1>
      {event.play_mode !== 'individual' && (
        <Segmented
          legend="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'teams', label: `${theme.vocab.team}s`, icon: 'users' },
            { value: 'people', label: `Everyone (${active.length})`, icon: 'pint' },
          ]}
        />
      )}

      {tab === 'teams' && event.play_mode !== 'individual' && (
        <section className="stack">
          <div className="row-wrap">
            <Button variant="primary" icon="shuffle" onClick={() => setShuffleOpen(true)} disabled={active.length < 2 || event.teams_locked}>
              Shuffle into {team}s
            </Button>
            {unassigned.length > 0 && tlist.length > 0 && (
              <Button icon="user-plus" loading={busy === 'auto'} onClick={autoPlaceUnassigned} disabled={event.teams_locked}>
                Place {unassigned.length} unassigned
              </Button>
            )}
            <Toggle label={`Lock ${team}s`} checked={event.teams_locked} onChange={(v) => run('lock', () => db.update('events', event.id, { teams_locked: v }), { success: v ? 'Teams locked' : 'Teams unlocked' })} />
          </div>
          {unassigned.length > 0 && (
            <Banner tone="warn" title={`${unassigned.length} without a ${team}`}>
              {unassigned.map((m) => m.display_name).join(', ')}
            </Banner>
          )}
          {tlist.length === 0 && <EmptyState icon="users" title={`No ${team}s yet`}>Create some below or use Shuffle to make them automatically.</EmptyState>}
          <div className="md-grid-2 stack">
            {tlist.map((t) => {
              const roster = active.filter((m) => teamOf.get(m.id) === t.id);
              const max = t.max_size ?? event.team_max_size;
              return (
                <Card key={t.id} className="stack-sm" style={{ borderColor: t.color }}>
                  <div className="row">
                    <span className="avatar" style={{ background: t.color }}>
                      <Icon name={t.icon} />
                    </span>
                    <div className="grow">
                      <h3>{t.name}</h3>
                      <span className="xsmall muted">
                        {roster.length}
                        {max ? ` / ${max}` : ''} players
                      </span>
                    </div>
                    <Button size="sm" variant="ghost" iconOnly icon="pencil" onClick={() => setEditTeam({ id: t.id, name: t.name, color: t.color, icon: t.icon, max_size: t.max_size })}>
                      Edit {t.name}
                    </Button>
                  </div>
                  <ul className="list">
                    {roster.map((m) => (
                      <li key={m.id} className="row" style={{ gap: 8 }}>
                        <Avatar name={m.display_name} color={m.avatar_color} icon={m.avatar_icon} size="sm" />
                        <span className="grow truncate">{m.display_name}</span>
                        <select className="select" style={{ minHeight: 40, width: 'auto', padding: '4px 8px' }} aria-label={`Move ${m.display_name}`} value={t.id} disabled={busy === `as-${m.id}`} onChange={(e) => assign(m, e.target.value || null)}>
                          {tlist.map((x) => (
                            <option key={x.id} value={x.id}>
                              {x.name}
                            </option>
                          ))}
                          <option value="">No {team}</option>
                        </select>
                      </li>
                    ))}
                    {roster.length === 0 && <li className="small muted">Empty</li>}
                  </ul>
                  {unassigned.length > 0 && (
                    <select className="select" aria-label={`Add someone to ${t.name}`} value="" onChange={(e) => { const m = unassigned.find((x) => x.id === e.target.value); if (m) assign(m, t.id); }}>
                      <option value="">+ Add unassigned player…</option>
                      {unassigned.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.display_name}
                        </option>
                      ))}
                    </select>
                  )}
                </Card>
              );
            })}
          </div>
          <form
            className="row"
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newTeam.trim()) return;
              const ok = await run('newteam', () => rpc('create_team', { p_event_id: event.id, p_name: newTeam.trim(), p_color: teamColor(event.theme_key, tlist.length), p_icon: TEAM_ICONS[tlist.length % TEAM_ICONS.length] }), { success: `${theme.vocab.team} created` });
              if (ok) setNewTeam('');
            }}
          >
            <div className="grow">
              <TextInput label={`New ${team}`} value={newTeam} maxLength={40} onChange={(e) => setNewTeam(e.target.value)} placeholder={TEAMS_NAMES_FOR(event.theme_key).find((n) => !tlist.some((t) => t.name === n)) ?? ''} />
            </div>
            <Button type="submit" icon="plus" loading={busy === 'newteam'} style={{ alignSelf: 'flex-end' }}>
              Add
            </Button>
          </form>
          <p className="xsmall muted">
            Moving someone keeps every point they already earned with the {team} they were on at the time. They can’t re-earn a {team} challenge their new {team} has already completed.
          </p>
        </section>
      )}

      {tab === 'people' && (
        <section className="stack-sm">
          {active.length === 0 && <EmptyState icon="user-plus" title="Nobody has joined yet">Share the invite link from Invite.</EmptyState>}
          <ul className="list">
            {(members.data ?? [])
              .filter((m) => m.status === 'active')
              .map((m) => {
                const t = tlist.find((x) => x.id === teamOf.get(m.id));
                return (
                  <li key={m.id}>
                    <button type="button" className="list-row" style={{ width: '100%', textAlign: 'left', cursor: 'pointer' }} onClick={() => setPerson(m)}>
                      <Avatar name={m.display_name} color={m.avatar_color} icon={m.avatar_icon} />
                      <span className="grow" style={{ minWidth: 0 }}>
                        <strong className="truncate" style={{ display: 'block' }}>
                          {m.display_name}
                        </strong>
                        <span className="xsmall muted">
                          {m.role !== 'participant' ? (m.role === 'organiser' ? 'Organiser' : 'Co-organiser') : t?.name ?? (event.play_mode === 'individual' ? 'Player' : `No ${team}`)}
                          {m.joined_late ? ' · joined late' : ''}
                          {!m.is_player ? ' · not playing' : ''}
                        </span>
                      </span>
                      <Icon name="chevron-right" />
                    </button>
                  </li>
                );
              })}
          </ul>
          {inactive.length > 0 && (
            <details>
              <summary className="small muted">{inactive.length} left or removed</summary>
              <ul className="list" style={{ marginTop: 6 }}>
                {inactive.map((m) => (
                  <li key={m.id} className="list-row small">
                    <span className="grow">
                      {m.display_name} · {m.status}
                    </span>
                    {m.status === 'removed' && (
                      <Button size="sm" onClick={() => run(`re-${m.id}`, () => rpc('restore_member', { p_member_id: m.id }), { success: 'Restored' })}>
                        Let back in
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      <ShuffleSheet open={shuffleOpen} onClose={() => setShuffleOpen(false)} players={active} existing={tlist} hasPoints={event.status !== 'draft' && event.status !== 'published'} />

      <Sheet open={Boolean(person)} onClose={() => setPerson(null)} title={person?.display_name ?? ''}>
        {person && (
          <div className="stack">
            {event.play_mode !== 'individual' && (
              <Select label={theme.vocab.team} value={teamOf.get(person.id) ?? ''} onChange={(e) => assign(person, e.target.value || null)}>
                <option value="">No {team}</option>
                {tlist.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
            )}
            {(venues.data?.length ?? 0) > 0 && (
              <section className="stack-sm">
                <h3>{golf ? 'Holes' : 'Attendance'}</h3>
                <p className="xsmall muted">
                  Override check-ins and skips. Overridden skips never carry a penalty.{golf ? ' Fix strokes for any started hole — changes are logged.' : ''}
                </p>
                <ul className="list">
                  {venues.data!.filter((v) => !v.disabled).map((v) => {
                    const p = participation.data?.find((x) => x.member_id === person.id && x.venue_id === v.id);
                    const gs = golfScores.data?.find((x) => x.venue_id === v.id && x.member_id === person.id);
                    const par = holePar(v.par, event.golf_default_par);
                    return (
                      <li key={v.id} className="row" style={{ gap: 8 }}>
                        <span className="grow small truncate">
                          {v.position + 1}. {v.name}
                        </span>
                        {golf && (
                          <select
                            className="select"
                            style={{ minHeight: 40, width: 'auto', padding: '4px 8px' }}
                            aria-label={`Strokes at ${v.name} (par ${par})`}
                            value={gs?.strokes ?? ''}
                            disabled={v.status === 'upcoming'}
                            onChange={(e) =>
                              run(`golf-${v.id}`, () => rpc('record_golf_score', { p_venue_id: v.id, p_strokes: e.target.value ? Number(e.target.value) : null, p_member_id: person.id }), {
                                refresh: ['golf', 'leaderboard', 'participation'],
                              })
                            }
                          >
                            <option value="">Par {par}: —</option>
                            {Array.from({ length: par + (event.golf_max_over ?? 3) }, (_, k) => k + 1).map((n) => (
                              <option key={n} value={n}>
                                {n} {n === par ? '(par)' : ''}
                              </option>
                            ))}
                          </select>
                        )}
                        <select
                          className="select"
                          style={{ minHeight: 40, width: 'auto', padding: '4px 8px' }}
                          aria-label={`Attendance at ${v.name}`}
                          value={p?.status ?? ''}
                          onChange={(e) => run(`par-${v.id}`, () => rpc('override_participation', { p_member_id: person.id, p_venue_id: v.id, p_status: e.target.value || null, p_waive_penalty: true }), { refresh: ['participation', 'leaderboard', 'ledger'] })}
                        >
                          <option value="">—</option>
                          <option value="present">Present</option>
                          <option value="skipped">Skipped{p?.skip_reason ? ` (“${p.skip_reason}”)` : ''}</option>
                        </select>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}
            {isOwner && person.role !== 'organiser' && (
              <Button
                icon="shield"
                onClick={() =>
                  run('role', () => rpc('set_member_role', { p_member_id: person.id, p_role: person.role === 'co_organiser' ? 'participant' : 'co_organiser' }), {
                    confirm:
                      person.role === 'co_organiser'
                        ? { title: `Remove ${person.display_name} as co-organiser?` }
                        : { title: `Make ${person.display_name} a co-organiser?`, body: 'They can edit the event, review proof, manage people and correct scores. They can’t delete the event.' },
                    success: 'Role updated',
                  }).then(() => setPerson(null))
                }
              >
                {person.role === 'co_organiser' ? 'Remove co-organiser' : 'Make co-organiser'}
              </Button>
            )}
            {person.role !== 'organiser' && (
              <Button
                variant="danger"
                icon="ban"
                onClick={async () => {
                  const r = await run('remove', () => rpc('remove_member', { p_member_id: person.id, p_reason: null }), {
                    confirm: { title: `Remove ${person.display_name}?`, body: 'They lose access and can’t rejoin unless you let them back in. Points their team already earned are kept.', danger: true, confirmLabel: 'Remove' },
                    success: 'Removed',
                  });
                  if (r !== undefined) setPerson(null);
                }}
              >
                Remove from event
              </Button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={Boolean(editTeam)} onClose={() => setEditTeam(null)} title={`Edit ${team}`}>
        {editTeam && (
          <div className="stack">
            <TextInput label="Name" value={editTeam.name} maxLength={40} onChange={(e) => setEditTeam({ ...editTeam, name: e.target.value })} />
            <label className="field">
              <span className="field__label">Colour</span>
              <input type="color" value={editTeam.color} onChange={(e) => setEditTeam({ ...editTeam, color: e.target.value })} style={{ width: 64, height: 44, border: 0, background: 'none' }} />
            </label>
            <fieldset>
              <legend>Icon</legend>
              <div className="avatar-pick">
                {TEAM_ICONS.map((i) => (
                  <label key={i} style={{ background: editTeam.color }}>
                    <input type="radio" name="ticon" checked={editTeam.icon === i} onChange={() => setEditTeam({ ...editTeam, icon: i })} aria-label={i} />
                    <Icon name={i} />
                  </label>
                ))}
              </div>
            </fieldset>
            <NumberInput label="Max size (blank = event default)" min={1} max={100} value={editTeam.max_size} onValue={(n) => setEditTeam({ ...editTeam, max_size: n })} />
            <Button
              variant="primary"
              block
              loading={busy === 'team'}
              onClick={async () => {
                const ok = await run('team', () => db.update('teams', editTeam.id, { name: editTeam.name.trim(), color: editTeam.color, icon: editTeam.icon, max_size: editTeam.max_size }), { success: 'Saved' });
                if (ok !== undefined) setEditTeam(null);
              }}
            >
              Save
            </Button>
            <Button
              variant="danger"
              icon="trash"
              onClick={async () => {
                const ok = await run('delteam', () => db.remove('teams', editTeam.id), {
                  confirm: { title: `Delete ${editTeam.name}?`, body: 'Only possible before the team has earned anything. Members become unassigned.', danger: true, confirmLabel: 'Delete' },
                  success: 'Deleted',
                });
                if (ok !== undefined) setEditTeam(null);
              }}
            >
              Delete {team}
            </Button>
          </div>
        )}
      </Sheet>
      <p className="xsmall muted">
        <Badge icon="lock">Privacy</Badge> Participants are identified only by the name they chose. No emails or phone numbers are shown here.
      </p>
    </AdminShell>
  );
}

function ShuffleSheet({ open, onClose, players, existing, hasPoints }: { open: boolean; onClose: () => void; players: MemberRow[]; existing: { id: string; name: string; color: string; icon: string }[]; hasPoints: boolean }) {
  const { event, theme } = useEventCtx();
  const { run, busy } = useAdminAction(event.id);
  const [mode, setMode] = useState<'count' | 'size'>('count');
  const [n, setN] = useState<number | null>(Math.max(2, existing.length || Math.round(Math.sqrt(players.length)) || 2));
  const [plan, setPlan] = useState<MemberRow[][] | null>(null);
  const team = theme.vocab.team.toLowerCase();

  const shuffle = () => setPlan(shuffleIntoTeams(players, mode === 'count' ? { teamCount: n ?? 2 } : { teamSize: n ?? 4 }));
  const names = TEAMS_NAMES_FOR(event.theme_key);
  const slot = (i: number) => existing[i] ?? { id: null, name: names[i] ?? `${theme.vocab.team} ${i + 1}`, color: teamColor(event.theme_key, i), icon: TEAM_ICONS[i % TEAM_ICONS.length] };

  return (
    <Sheet open={open} onClose={onClose} title={`Shuffle into ${team}s`}>
      <div className="stack">
        <Segmented
          legend="Split by"
          value={mode}
          onChange={(m) => { setMode(m); setPlan(null); }}
          options={[
            { value: 'count', label: `Number of ${team}s` },
            { value: 'size', label: `${theme.vocab.team} size` },
          ]}
        />
        <NumberInput label={mode === 'count' ? `How many ${team}s?` : 'Players per team (max)'} min={1} max={50} value={n} onValue={(v) => { setN(v); setPlan(null); }} />
        <Button icon="shuffle" variant="secondary" block onClick={shuffle} disabled={!n || players.length < 1}>
          {plan ? 'Reshuffle' : 'Shuffle'} {players.length} players
        </Button>
        {hasPoints && <Banner tone="warn">The crawl has started. Points already earned stay with each player’s previous {team}.</Banner>}
        {plan && (
          <>
            <div className="stack-sm">
              {plan.map((members, i) => {
                const t = slot(i);
                return (
                  <Card key={i} className="card--tight" style={{ borderColor: t.color }}>
                    <strong className="row" style={{ gap: 6 }}>
                      <span className="avatar avatar--sm" style={{ background: t.color }}>
                        <Icon name={t.icon} size={14} />
                      </span>
                      {t.name} · {members.length}
                    </strong>
                    <p className="small">{members.map((m) => m.display_name).join(', ')}</p>
                  </Card>
                );
              })}
            </div>
            <Button
              variant="primary"
              size="lg"
              block
              loading={busy === 'plan'}
              onClick={async () => {
                const ok = await run(
                  'plan',
                  () =>
                    rpc('apply_team_plan', {
                      p_event_id: event.id,
                      p_plan: { teams: plan.map((ms, i) => ({ ...slot(i), member_ids: ms.map((m) => m.id) })), unassign_others: true },
                    }),
                  { success: 'Teams set!', confirm: hasPoints ? { title: 'Apply new teams mid-crawl?', body: 'Everyone’s earned points stay where they are.' } : undefined },
                );
                if (ok !== undefined) {
                  setPlan(null);
                  onClose();
                }
              }}
            >
              Use these {team}s
            </Button>
          </>
        )}
      </div>
    </Sheet>
  );
}
