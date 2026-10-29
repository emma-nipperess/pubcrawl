import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useFeedback } from '@/components/feedback';
import { rpc } from '@/lib/supabase/queries';
import type { EventRow, GolfScoreRow, VenueRow } from '@/lib/supabase/types';
import { GOLF_SAFETY, holePar, holeResult } from './golf';

/**
 * Record your strokes for a hole. Big − / + buttons for one-handed use in a
 * busy pub; nothing is saved until "Save score", and it can be changed while
 * the hole is open.
 */
export function GolfHoleCard({ event, venue, score, canRecord, closedReason }: { event: EventRow; venue: VenueRow; score?: GolfScoreRow; canRecord: boolean; closedReason?: string }) {
  const par = holePar(venue.par, event.golf_default_par ?? 3);
  const max = par + (event.golf_max_over ?? 3);
  const [n, setN] = useState(score?.strokes ?? par);
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const fb = useFeedback();
  useEffect(() => setN(score?.strokes ?? par), [score?.strokes, par]);
  const res = holeResult(n, par);
  const changed = n !== score?.strokes;

  const save = async () => {
    setBusy(true);
    try {
      await rpc('record_golf_score', { p_venue_id: venue.id, p_strokes: n });
      ['golf', 'leaderboard', 'participation'].forEach((k) => qc.invalidateQueries({ queryKey: [k, event.id] }));
      fb.toast(`${res.label} — ${n} on a par ${par}`, 'success');
    } catch (e) {
      fb.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="stack-sm" aria-labelledby={`golf-${venue.id}`}>
      <div className="row-between">
        <h2 id={`golf-${venue.id}`} style={{ fontSize: 'var(--fs-lg)' }}>
          Your score
        </h2>
        <Badge tone="brass" icon="flag">
          Par {par} · max {max}
        </Badge>
      </div>
      {venue.drink && (
        <p className="row" style={{ gap: 8 }}>
          <Icon name="beer" /> <strong>{venue.drink}</strong>
        </p>
      )}
      <p className="xsmall muted">Count your sips to finish it — that’s your strokes. Fewer is better.</p>
      {canRecord ? (
        <>
          <div className="row" style={{ justifyContent: 'center', gap: 'var(--s-5)' }}>
            <Button size="lg" iconOnly icon="minus" onClick={() => setN((x) => Math.max(1, x - 1))} disabled={n <= 1 || busy} style={{ width: 64, minHeight: 64 }}>
              One fewer stroke
            </Button>
            <div className="center" aria-live="polite">
              <div className="score-big" style={{ fontSize: '3.2rem', lineHeight: 1 }}>
                {n}
              </div>
              <span className={`badge badge--${res.tone === 'neutral' ? 'brass' : res.tone}`}>{res.label}</span>
            </div>
            <Button size="lg" iconOnly icon="plus" onClick={() => setN((x) => Math.min(max, x + 1))} disabled={n >= max || busy} style={{ width: 64, minHeight: 64 }}>
              One more stroke
            </Button>
          </div>
          <Button variant="primary" size="lg" block icon="check" loading={busy} disabled={!changed && Boolean(score)} onClick={save}>
            {score ? (changed ? 'Update score' : `Saved: ${score.strokes}`) : 'Save score'}
          </Button>
        </>
      ) : score ? (
        <p className="row" style={{ gap: 8 }}>
          <span className="score-big">{score.strokes}</span>
          <span className={`badge badge--${holeResult(score.strokes, par).tone === 'neutral' ? 'brass' : holeResult(score.strokes, par).tone}`}>{holeResult(score.strokes, par).label}</span>
        </p>
      ) : (
        <p className="small muted">{closedReason ?? 'Scores open when this hole starts.'}</p>
      )}
      <p className="xsmall">
        <Icon name="shield" size={12} /> {GOLF_SAFETY}
      </p>
    </Card>
  );
}
