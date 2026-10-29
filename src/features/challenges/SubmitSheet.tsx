import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, Banner, Button, Sheet, TextArea, TextInput } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { useFeedback } from '@/components/feedback';
import { MediaPicker, type PickedFile } from '@/features/media/MediaPicker';
import { useAuth } from '@/lib/auth';
import { rpc } from '@/lib/supabase/queries';
import { supabase } from '@/lib/supabase/client';
import { uploadWithRetry } from '@/lib/media/upload';
import { proofPath, type Accept } from '@/lib/media/validate';
import type { ChallengeRow, SubmissionRow } from '@/lib/supabase/types';
import { CHALLENGE_TYPES, SUBMISSION_STATUS } from './meta';
import type { ThemeDef } from '@/features/themes/themes';

interface Draft {
  submissionId: string;
  text: string;
  choice: number | null;
  caption: string;
}

const draftKey = (cid: string) => `roundhouse-sub-${cid}`;

function loadDraft(cid: string): Draft {
  try {
    const d = JSON.parse(sessionStorage.getItem(draftKey(cid)) ?? 'null') as Draft | null;
    if (d?.submissionId) return d;
  } catch {
    /* ignore */
  }
  return { submissionId: crypto.randomUUID(), text: '', choice: null, caption: '' };
}

/**
 * Complete a challenge. The submission id is generated once and kept in
 * sessionStorage, so retries after a dropped connection (or a double tap) are
 * idempotent on the server. Files upload first (with progress + retry), then
 * a single RPC validates everything and records the attempt.
 */
export function SubmitSheet({
  challenge,
  open,
  onClose,
  eventId,
  theme,
  latest,
  attemptsUsed,
  golf,
}: {
  challenge: ChallengeRow | null;
  open: boolean;
  onClose: () => void;
  eventId: string;
  theme: ThemeDef;
  latest?: SubmissionRow;
  attemptsUsed: number;
  golf?: boolean;
}) {
  const { user } = useAuth();
  const fb = useFeedback();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [files, setFiles] = useState<PickedFile[]>([]);
  const [phase, setPhase] = useState<'idle' | 'uploading' | 'saving' | 'done' | 'error'>('idle');
  const [error, setError] = useState<string>();
  const [result, setResult] = useState<SubmissionRow | null>(null);
  const lock = useRef(false);

  useEffect(() => {
    if (open && challenge) {
      setDraft(loadDraft(challenge.id));
      setFiles([]);
      setPhase('idle');
      setError(undefined);
      setResult(null);
    }
  }, [open, challenge]);

  useEffect(() => {
    if (challenge && draft && phase !== 'done') sessionStorage.setItem(draftKey(challenge.id), JSON.stringify(draft));
  }, [draft, challenge, phase]);

  if (!challenge || !draft) return <Sheet open={false} onClose={onClose} title="">{null}</Sheet>;

  const c = challenge;
  const accept: Accept | null = c.proof_media === 'none' ? null : c.proof_media === 'either' ? 'either' : c.proof_media;
  const busy = phase === 'uploading' || phase === 'saving';
  // in pub golf every challenge point takes a stroke off
  const reward = (n: number) => (golf ? `−${n} ${n === 1 ? 'stroke' : 'strokes'}` : `+${n} ${theme.vocab.points}`);
  const set = (p: Partial<Draft>) => setDraft((d) => (d ? { ...d, ...p } : d));

  const missing =
    (c.media_required && files.length === 0 && 'Add your proof first.') ||
    (c.text_required && !draft.text.trim() && 'Add your answer first.') ||
    (c.type === 'multiple_choice' && draft.choice == null && 'Pick an answer.') ||
    null;

  const submit = async () => {
    if (lock.current || !user) return;
    if (missing) {
      setError(missing);
      return;
    }
    lock.current = true;
    setError(undefined);
    try {
      // 1) upload anything not yet uploaded (kept across retries)
      const current = [...files];
      if (current.some((f) => f.status !== 'uploaded')) setPhase('uploading');
      for (let i = 0; i < current.length; i++) {
        const f = current[i];
        if (f.status === 'uploaded') continue;
        const path = f.path ?? proofPath(eventId, user.id, draft.submissionId, f.mime);
        const thumbPath = f.thumb ? f.thumbPath ?? path.replace(/\.[a-z0-9]+$/, '-thumb.jpg') : undefined;
        const update = (patch: Partial<PickedFile>) => {
          current[i] = { ...current[i], ...patch };
          setFiles((prev) => prev.map((x) => (x.key === f.key ? { ...x, ...patch } : x)));
        };
        update({ status: 'uploading', progress: 0, path, thumbPath, error: undefined });
        try {
          await uploadWithRetry('proof', path, f.blob, f.mime, (p) => update({ progress: p * (f.thumb ? 0.92 : 1) }));
          if (f.thumb && thumbPath) {
            try {
              await uploadWithRetry('proof', thumbPath, f.thumb, 'image/jpeg');
            } catch {
              update({ thumbPath: undefined }); // thumbnails are optional
            }
          }
          update({ status: 'uploaded', progress: 1 });
        } catch (e) {
          update({ status: 'error', error: (e as Error).message });
          throw e;
        }
      }
      // 2) record the submission (idempotent on submissionId)
      setPhase('saving');
      const media = current.map((f) => ({ path: f.path, thumb_path: f.thumbPath ?? null, kind: f.kind, width: f.width ?? null, height: f.height ?? null, duration_ms: f.durationMs ?? null }));
      const row = await rpc<SubmissionRow>('submit_challenge', {
        p_submission_id: draft.submissionId,
        p_challenge_id: c.id,
        p_text: draft.text.trim() || null,
        p_choice: draft.choice,
        p_caption: draft.caption.trim() || null,
        p_media: media,
      });
      sessionStorage.removeItem(draftKey(c.id));
      setResult(row);
      setPhase('done');
      ['submissions', 'ledger', 'leaderboard', 'participation', 'achievements', 'feed'].forEach((k) => qc.invalidateQueries({ queryKey: [k, eventId] }));
      if (row.status === 'approved') fb.toast(`${reward(row.points_awarded + row.bonus_awarded)}!`, 'success');
    } catch (e) {
      setPhase('error');
      const msg = (e as Error).message;
      setError(msg);
      // a definitive refusal (not a network blip) means this id can't be reused
      if (/already completed|No attempts left|not open|skipped|Time is up|revealed|paused|not playing/i.test(msg)) {
        await cleanupUploads(files);
        sessionStorage.removeItem(draftKey(c.id));
        setDraft((d) => (d ? { ...d, submissionId: crypto.randomUUID() } : d));
      }
    } finally {
      lock.current = false;
    }
  };

  /** Remove orphaned uploads for a submission that will never be recorded. */
  const cleanupUploads = async (list: PickedFile[]) => {
    const paths = list.flatMap((f) => [f.path, f.thumbPath]).filter((p): p is string => Boolean(p));
    if (paths.length) await supabase.storage.from('proof').remove(paths).catch(() => undefined);
  };

  const close = async () => {
    if (busy) return;
    if (phase !== 'done' && files.some((f) => f.status === 'uploaded')) {
      // keep server tidy: unattached uploads are deleted when abandoning
      const ok = await fb.confirm({ title: 'Discard this attempt?', body: 'Your uploaded photo/video will be deleted.', confirmLabel: 'Discard', danger: true });
      if (!ok) return;
      await cleanupUploads(files);
      sessionStorage.removeItem(draftKey(c.id));
    }
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title={c.title}>
      {phase === 'done' && result ? (
        <div className="stack center" role="status">
          <span className="empty__icon" style={{ margin: '0 auto', width: 84, height: 84 }}>
            <Icon name={result.status === 'approved' ? 'check' : result.status === 'pending' ? 'hourglass' : 'x'} size={40} />
          </span>
          <h3>
            {result.status === 'approved'
              ? `Nice! ${reward(result.points_awarded + result.bonus_awarded)}`
              : result.status === 'pending'
                ? 'Sent for review'
                : result.is_correct === false
                  ? 'Not quite!'
                  : SUBMISSION_STATUS[result.status].label}
          </h3>
          <p className="muted">
            {result.status === 'pending'
              ? `An organiser will check it soon. Points are added once it’s approved${c.penalty_points ? '' : ''}.`
              : result.status === 'rejected' && result.penalty_awarded
                ? `${golf ? `+${result.penalty_awarded} strokes` : `−${result.penalty_awarded} ${theme.vocab.points}`}. ${c.max_attempts - attemptsUsed - 1 > 0 ? 'You can try again.' : ''}`
                : result.status === 'rejected'
                  ? c.max_attempts - attemptsUsed - 1 > 0
                    ? 'You can try again.'
                    : 'No attempts left on this one.'
                  : ''}
          </p>
          <Button variant="primary" block onClick={onClose}>
            Back to {theme.vocab.challenges.toLowerCase()}
          </Button>
        </div>
      ) : (
        <div className="stack">
          <div className="row-wrap">
            <Badge icon={CHALLENGE_TYPES[c.type].icon}>{CHALLENGE_TYPES[c.type].label}</Badge>
            <Badge tone="brass">
              {golf ? reward(c.points + c.bonus_points) : `${c.points + c.bonus_points} ${theme.vocab.points}`}
            </Badge>
            {c.scope === 'team' && <Badge icon="users">{theme.vocab.team}</Badge>}
            {c.requires_approval && <Badge icon="badge-check">Reviewed</Badge>}
            {c.max_attempts > 1 && <Badge>{c.max_attempts - attemptsUsed} attempts left</Badge>}
          </div>
          {c.description && <p className="prewrap">{c.description}</p>}
          {c.rules && <p className="small muted prewrap">{c.rules}</p>}
          {c.safety_notes && (
            <Banner tone="info" icon="shield">
              {c.safety_notes}
            </Banner>
          )}
          {c.scope === 'team' && <p className="small muted">One completion counts for your whole {theme.vocab.team.toLowerCase()}.</p>}
          {latest?.status === 'resubmit' && (
            <Banner tone="info" title="The organiser asked for another go">
              {latest.review_note}
            </Banner>
          )}
          {latest?.status === 'rejected' && latest.review_note && (
            <Banner tone="warn" title="Last attempt wasn’t accepted">
              {latest.review_note}
            </Banner>
          )}

          {c.type === 'multiple_choice' && c.choices && (
            <fieldset disabled={busy}>
              <legend>Your answer</legend>
              <div className="stack-sm">
                {c.choices.map((opt, i) => (
                  <label key={i} className="option-card">
                    <input type="radio" name="mc" checked={draft.choice === i} onChange={() => set({ choice: i })} />
                    <div className="card card--tight card--flat">
                      <strong>{String.fromCharCode(65 + i)}.</strong> {opt}
                    </div>
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          {accept && (
            <MediaPicker
              accept={accept}
              files={files}
              onChange={(fn) => setFiles(fn)}
              onError={(m) => fb.toast(m, 'error')}
              disabled={busy}
              max={1}
            />
          )}

          {(c.type === 'text' || c.text_prompt) && c.type !== 'multiple_choice' && (
            <TextArea
              label={c.text_prompt || 'Your answer'}
              value={draft.text}
              maxLength={1000}
              rows={3}
              disabled={busy}
              onChange={(e) => set({ text: e.target.value })}
              hint={c.text_required ? undefined : 'Optional'}
            />
          )}
          {accept && <TextInput label="Caption (optional)" value={draft.caption} maxLength={280} disabled={busy} onChange={(e) => set({ caption: e.target.value })} />}

          {error && (
            <Banner tone="danger" title={phase === 'error' ? 'Not submitted yet' : undefined}>
              {error}
              {phase === 'error' && files.some((f) => f.status === 'uploaded') && <span className="xsmall"> Your uploads are saved — just retry.</span>}
            </Banner>
          )}

          <Button variant="primary" size="lg" block loading={busy} onClick={submit} icon={phase === 'error' ? 'refresh' : c.type === 'checkbox' || c.type === 'team' ? 'check' : 'upload'}>
            {phase === 'uploading'
              ? 'Uploading…'
              : phase === 'saving'
                ? 'Submitting…'
                : phase === 'error'
                  ? 'Retry'
                  : c.type === 'checkbox' || (c.type === 'team' && !accept) || c.type === 'verified' || c.type === 'custom' || c.type === 'bonus'
                    ? c.type === 'verified'
                      ? 'Ask organiser to verify'
                      : 'Mark as done'
                    : 'Submit'}
          </Button>
          {c.type === 'checkbox' && !c.requires_approval && <p className="xsmall muted center">Honour system — scores straight away.</p>}
        </div>
      )}
    </Sheet>
  );
}
