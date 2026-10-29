import type { EventRow, GolfPerson, GolfScoreRow } from '@/lib/supabase/types';
import type { VenueProgressItem } from '@/features/venues/progress';
import { Card } from '@/components/ui';
import { formatToPar, holePar, holeResult } from './golf';

/**
 * Classic hole-by-hole golf scorecard. The totals shown come from the
 * database leaderboard; the per-hole cells mirror its rules for display.
 */
export function GolfCard({ event, progress, scores, memberId, row }: { event: EventRow; progress: VenueProgressItem[]; scores: GolfScoreRow[]; memberId: string; row?: GolfPerson }) {
  const holes = progress.filter((p) => p.state !== 'disabled' && p.state !== 'group_skipped');
  const cell = (p: VenueProgressItem) => {
    const par = holePar(p.venue.par, event.golf_default_par);
    const s = scores.find((x) => x.venue_id === p.venue.id && x.member_id === memberId);
    if (s) return { text: String(s.strokes), title: holeResult(s.strokes, par).label, diff: s.strokes - par };
    if (p.state === 'before_join') return { text: '', title: 'Before you joined' };
    if (p.venue.status === 'completed' && event.skip_policy !== 'none') return { text: String(par + (event.golf_max_over ?? 3)), title: 'Not recorded — pick-up score', diff: (event.golf_max_over ?? 3), pickup: true };
    if (p.state === 'skipped' || p.state === 'missed') return { text: '–', title: 'Not counted' };
    return { text: '', title: p.state === 'active' ? 'Now playing' : 'To play' };
  };
  const parTotal = holes.reduce((a, p) => a + holePar(p.venue.par, event.golf_default_par), 0);
  return (
    <>
      <div className="grid-2">
        <Card className="center">
          <span className="eyebrow">To par</span>
          <div className="score-big" style={{ fontSize: 'var(--fs-3xl)' }}>
            {formatToPar(row?.to_par)}
          </div>
          <span className="small muted">{row?.thru ? `Thru ${row.thru}` : 'Yet to tee off'}</span>
        </Card>
        <Card className="stack-sm">
          <div className="row-between small">
            <span className="muted">Strokes</span>
            <strong className="num">{row?.strokes ?? 0}</strong>
          </div>
          <div className="row-between small">
            <span className="muted">Par played</span>
            <strong className="num">{row?.par ?? 0}</strong>
          </div>
          <div className="row-between small">
            <span className="muted">Bonuses</span>
            <strong className="num">{row?.adjustment ? (row.adjustment > 0 ? `−${row.adjustment}` : `+${-row.adjustment}`) : '0'}</strong>
          </div>
          <div className="row-between small">
            <span className="muted">Course par</span>
            <strong className="num">{parTotal}</strong>
          </div>
        </Card>
      </div>
      <div style={{ overflowX: 'auto' }} className="card" tabIndex={0} aria-label="Golf scorecard">
        <table className="scorecard-golf">
          <caption className="sr-only">Strokes by hole</caption>
          <thead>
            <tr>
              <th scope="col">Hole</th>
              {holes.map((_, i) => (
                <th key={i} scope="col">
                  {i + 1}
                </th>
              ))}
              <th scope="col">Tot</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Par</th>
              {holes.map((p) => (
                <td key={p.venue.id}>{holePar(p.venue.par, event.golf_default_par)}</td>
              ))}
              <td>{parTotal}</td>
            </tr>
            <tr>
              <th scope="row">Score</th>
              {holes.map((p) => {
                const c = cell(p);
                return (
                  <td key={p.venue.id} title={c.title} className={[p.state === 'active' ? 'is-current' : '', c.diff != null && c.diff < 0 ? 'golf-under' : '', c.pickup ? 'golf-pickup' : ''].join(' ')}>
                    {c.text}
                    <span className="sr-only"> {c.title}</span>
                  </td>
                );
              })}
              <td>
                <strong>{row?.strokes ?? 0}</strong>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <ol className="list">
        {holes.map((p, i) => {
          const c = cell(p);
          return (
            <li key={p.venue.id} className="list-row">
              <span className="rank" style={{ fontSize: 'var(--fs-md)' }}>
                {i + 1}
              </span>
              <span className="grow" style={{ minWidth: 0 }}>
                <strong className="truncate" style={{ display: 'block' }}>
                  {p.venue.name}
                </strong>
                <span className="xsmall muted">
                  Par {holePar(p.venue.par, event.golf_default_par)}
                  {p.venue.drink ? ` · ${p.venue.drink}` : ''} · {c.title}
                </span>
              </span>
              <span className="num" style={{ fontWeight: 800 }}>
                {c.text}
              </span>
            </li>
          );
        })}
      </ol>
    </>
  );
}
