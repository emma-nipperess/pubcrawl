import { useState } from 'react';
import { AdminShell } from './AdminRoutes';
import { useAdminAction } from './useAdminAction';
import { useEventCtx } from '@/app/EventRoutes';
import { rpc, useAdjustments, useAudit, useLeaderboard, useMembers, useTeams } from '@/lib/supabase/queries';
import { Banner, Button, Card, EmptyState, NumberInput, Segmented, Select, TextInput } from '@/components/ui';
import { LeaderboardList } from '@/features/leaderboard/LeaderboardList';
import { toCsv, downloadText } from '@/lib/csv';
import { timeAgo } from '@/lib/format';

interface ExportRow {
  name: string;
  role: string;
  team: string | null;
  status: string;
  joined_late: boolean;
  venues_present: number;
  venues_skipped: number;
  challenges_completed: number;
  points: number;
  bonus: number;
  penalties: number;
  adjustments: number;
  total: number | null;
  rank: number | null;
}

export default function ScoresPage() {
  const { event, theme } = useEventCtx();
  const board = useLeaderboard(event.id);
  const members = useMembers(event.id);
  const teams = useTeams(event.id);
  const adjustments = useAdjustments(event.id, true);
  const audit = useAudit(event.id, true);
  const { run, busy } = useAdminAction(event.id);
  const [target, setTarget] = useState<'member' | 'team'>('member');
  const [who, setWho] = useState('');
  const [mode, setMode] = useState<'delta' | 'total'>('delta');
  const [value, setValue] = useState<number | null>(null);
  const [reason, setReason] = useState('');
  const nameOf = (m?: string | null, t?: string | null) =>
    m ? members.data?.find((x) => x.id === m)?.display_name ?? 'Player' : teams.data?.teams.find((x) => x.id === t)?.name ?? 'Team';
  const current =
    target === 'member' ? board.data?.individuals.find((r) => r.member_id === who)?.confirmed : board.data?.teams.find((r) => r.team_id === who)?.confirmed;

  const exportCsv = () =>
    run('export', async () => {
      const out = await rpc<{ individuals: ExportRow[]; teams: { name: string; size: number; confirmed: number; completed: number; rank: number; tied: boolean }[] }>('get_results_export', { p_event_id: event.id });
      const slug = event.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
      downloadText(
        `${slug}-players.csv`,
        toCsv(
          ['Rank', 'Name', 'Team', 'Role', 'Status', 'Joined late', 'Venues attended', 'Venues skipped', 'Challenges completed', 'Points', 'Bonus', 'Penalties', 'Adjustments', 'Confirmed total'],
          out.individuals.map((r) => [r.rank ?? '', r.name, r.team ?? '', r.role, r.status, r.joined_late ? 'yes' : 'no', r.venues_present, r.venues_skipped, r.challenges_completed, r.points, r.bonus, r.penalties, r.adjustments, r.total ?? 0]),
        ),
      );
      if (out.teams?.length) {
        downloadText(`${slug}-teams.csv`, toCsv(['Rank', 'Team', 'Players', 'Challenges completed', 'Confirmed total', 'Tied'], out.teams.map((t) => [t.rank, t.name, t.size, t.completed, t.confirmed, t.tied ? 'yes' : 'no'])));
      }
    }, { success: 'Exported', refresh: [] });

  return (
    <AdminShell title="Scores">
      <h1 className="deco-title">Scores</h1>
      <Button variant="secondary" icon="download" loading={busy === 'export'} onClick={exportCsv}>
        Export results (CSV)
      </Button>
      <p className="xsmall muted">Includes names, teams, attendance, completed challenges and confirmed scores. No emails, user IDs or photo links.</p>

      <Card className="stack">
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>Correct a score</h2>
        <p className="small muted">Every correction is logged with the old and new total, your reason, who made it and when. Players can see corrections to their own score.</p>
        <Segmented
          legend="For"
          value={target}
          onChange={(v) => { setTarget(v); setWho(''); }}
          options={[
            { value: 'member', label: 'A player' },
            ...(event.play_mode !== 'individual' ? [{ value: 'team' as const, label: `A ${theme.vocab.team.toLowerCase()}` }] : []),
          ]}
        />
        <Select label={target === 'member' ? 'Player' : theme.vocab.team} value={who} onChange={(e) => setWho(e.target.value)}>
          <option value="">Choose…</option>
          {target === 'member'
            ? members.data?.filter((m) => m.status === 'active' && m.is_player).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.display_name}
                </option>
              ))
            : teams.data?.teams.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
        </Select>
        {who && <p className="small">Current confirmed total: <strong>{current ?? 0}</strong></p>}
        <Segmented
          legend="Change by"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'delta', label: 'Add / subtract' },
            { value: 'total', label: 'Set new total' },
          ]}
        />
        <NumberInput label={mode === 'delta' ? 'Points (negative to subtract)' : 'New total'} min={-10000} max={10000} value={value} onValue={setValue} />
        <TextInput label="Reason (required)" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Missed a photo during the network outage" />
        <Button
          variant="primary"
          disabled={!who || value == null || reason.trim().length < 3}
          loading={busy === 'adjust'}
          onClick={async () => {
            const ok = await run(
              'adjust',
              () =>
                rpc('adjust_score', {
                  p_event_id: event.id,
                  p_member_id: target === 'member' ? who : null,
                  p_team_id: target === 'team' ? who : null,
                  p_reason: reason.trim(),
                  p_delta: mode === 'delta' ? value : null,
                  p_new_total: mode === 'total' ? value : null,
                }),
              {
                confirm: { title: 'Apply this correction?', body: mode === 'delta' ? `${value! > 0 ? '+' : ''}${value} for ${nameOf(target === 'member' ? who : null, who)}.` : `Set ${nameOf(target === 'member' ? who : null, who)} to ${value}.` },
                success: 'Score corrected',
              },
            );
            if (ok) {
              setValue(null);
              setReason('');
            }
          }}
        >
          Apply correction
        </Button>
      </Card>

      <section className="stack-sm">
        <h2 className="section-title">Corrections log</h2>
        {(adjustments.data ?? []).length === 0 ? (
          <EmptyState icon="list-checks" title="No corrections" />
        ) : (
          <ul className="list">
            {adjustments.data!.map((a) => (
              <li key={a.id} className="list-row small">
                <span className="grow">
                  <strong>{nameOf(a.member_id, a.team_id)}</strong>: {a.original_value} → {a.new_value} ({a.delta > 0 ? '+' : ''}
                  {a.delta})
                  <span className="xsmall muted" style={{ display: 'block' }}>
                    “{a.reason}” · by {members.data?.find((m) => m.user_id === a.actor_id)?.display_name ?? 'organiser'} · {new Date(a.created_at).toLocaleString()}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {board.data && board.data.teams.length > 0 && (
        <section className="stack-sm">
          <h2 className="section-title">{theme.vocab.team} standings</h2>
          <LeaderboardList rows={board.data.teams.map((t) => ({ id: t.team_id, name: t.name, color: t.color, icon: t.icon, score: t.score, confirmed: t.confirmed, pending: t.pending, rank: t.rank, tied: t.tied, mine: false }))} unit={theme.vocab.points} provisional={board.data.provisional_scoring} />
        </section>
      )}

      <section className="stack-sm">
        <h2 className="section-title">Activity log</h2>
        <Banner tone="info">Organiser-only. Records joins, status changes, reviews, team moves and corrections.</Banner>
        <ul className="list">
          {(audit.data ?? []).slice(0, 50).map((a) => (
            <li key={a.id} className="list-row xsmall">
              <span className="grow">
                <strong>{a.action}</strong> · {members.data?.find((m) => m.user_id === a.actor_id)?.display_name ?? 'system'}
              </span>
              <span className="muted">{timeAgo(a.created_at)}</span>
            </li>
          ))}
        </ul>
      </section>
    </AdminShell>
  );
}
