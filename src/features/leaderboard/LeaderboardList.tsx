import { Icon } from '@/components/Icon';
import { rankLabel, type Movement } from './rank';

export interface BoardRow {
  id: string;
  name: string;
  color: string;
  icon: string;
  score: number;
  confirmed: number;
  pending: number;
  rank: number;
  tied: boolean;
  mine: boolean;
  sub?: string;
}

export function LeaderboardList({ rows, moves, unit, provisional }: { rows: BoardRow[]; moves?: Map<string, Movement>; unit: string; provisional: boolean }) {
  return (
    <ol className="list" aria-label="Rankings">
      {rows.map((r) => {
        const m = moves?.get(r.id);
        return (
          <li key={r.id} className={['list-row', r.mine && 'list-row--me'].filter(Boolean).join(' ')} aria-current={r.mine ? 'true' : undefined}>
            <span className={`rank ${r.rank === 1 ? 'rank--1' : ''}`} aria-label={`${r.tied ? 'Tied ' : ''}${r.rank}${r.rank === 1 ? 'st' : r.rank === 2 ? 'nd' : r.rank === 3 ? 'rd' : 'th'} place`}>
              {rankLabel(r.rank, r.tied)}
            </span>
            <span className="avatar avatar--sm" style={{ background: r.color }} aria-hidden="true">
              <Icon name={r.icon} size={15} />
            </span>
            <span className="grow" style={{ minWidth: 0 }}>
              <strong className="truncate" style={{ display: 'block' }}>
                {r.name}
                {r.mine && <span className="sr-only"> (you)</span>}
              </strong>
              {r.sub && <span className="xsmall muted">{r.sub}</span>}
            </span>
            {m && m.kind !== 'same' && (
              <span className={`rank-move rank-move--${m.kind === 'down' ? 'down' : 'up'}`} aria-label={m.kind === 'new' ? 'New' : `${m.kind === 'up' ? 'Up' : 'Down'} ${m.by}`}>
                {m.kind === 'new' ? 'NEW' : (
                  <>
                    <Icon name={m.kind === 'up' ? 'arrow-up' : 'arrow-down'} size={14} />
                    {m.by}
                  </>
                )}
              </span>
            )}
            <span className="center" style={{ minWidth: 56 }}>
              <span className="score-big" style={{ fontSize: 'var(--fs-lg)' }}>
                {r.score}
              </span>
              <span className="xsmall muted" style={{ display: 'block' }}>
                {r.pending > 0 ? (provisional ? `incl. ${r.pending} provisional` : `+${r.pending} pending`) : unit}
              </span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}
