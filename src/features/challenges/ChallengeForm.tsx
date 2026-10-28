import { useState } from 'react';
import type { ChallengeDraft, ChallengeType } from '@/lib/supabase/types';
import { Button, NumberInput, Segmented, Select, TextArea, TextInput, Toggle } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { CHALLENGE_TYPES } from './meta';
import { validateChallenge, type Errors } from '@/lib/validation/forms';
import type { ThemeDef } from '@/features/themes/themes';

export function blankChallenge(): ChallengeDraft {
  return { title: '', type: 'photo', points: 10, scope: 'individual', required: true, max_attempts: 1 };
}

/**
 * Editor for one challenge. Used by the create wizard (local state) and the
 * admin screens (saved via save_challenge). `locked` disables fields that
 * can't change once submissions exist.
 */
export function ChallengeForm({
  value,
  onChange,
  theme,
  errors,
  locked,
  showAdvancedInitially,
}: {
  value: ChallengeDraft;
  onChange: (c: ChallengeDraft) => void;
  theme: ThemeDef;
  errors?: Errors;
  locked?: boolean;
  showAdvancedInitially?: boolean;
}) {
  const set = <K extends keyof ChallengeDraft>(k: K, v: ChallengeDraft[K]) => onChange({ ...value, [k]: v });
  const [adv, setAdv] = useState(Boolean(showAdvancedInitially));
  const isTeam = value.type === 'team' || value.scope === 'team';
  const choices = value.choices ?? ['', ''];

  return (
    <div className="stack">
      <TextInput label="Title" value={value.title} maxLength={100} onChange={(e) => set('title', e.target.value)} error={errors?.title} placeholder="e.g. Team group photo" />
      <TextArea label="Instructions" value={value.description ?? ''} maxLength={1500} rows={3} onChange={(e) => set('description', e.target.value)} placeholder="What do players need to do?" />

      <fieldset disabled={locked}>
        <legend>Type{locked && ' (locked — submissions exist)'}</legend>
        <div className="seg">
          {(Object.keys(CHALLENGE_TYPES) as ChallengeType[]).map((t) => (
            <label key={t}>
              <input
                type="radio"
                name="ctype"
                checked={value.type === t}
                onChange={() =>
                  onChange({
                    ...value,
                    type: t,
                    scope: t === 'team' ? 'team' : value.scope,
                    required: t === 'bonus' ? false : value.required,
                    choices: t === 'multiple_choice' ? value.choices ?? ['', '', ''] : value.choices,
                  })
                }
              />
              <Icon name={CHALLENGE_TYPES[t].icon} size={16} />
              {CHALLENGE_TYPES[t].label}
            </label>
          ))}
        </div>
        <p className="field__hint" style={{ marginTop: 6 }}>
          {CHALLENGE_TYPES[value.type].hint}
        </p>
      </fieldset>

      {value.type === 'multiple_choice' && (
        <fieldset className="stack-sm">
          <legend>Options — tap the circle for the right answer</legend>
          {choices.map((ch, i) => (
            <div key={i} className="row">
              <input
                type="radio"
                name="correct"
                aria-label={`Option ${i + 1} is correct`}
                checked={value.correct_choice === i}
                onChange={() => set('correct_choice', i)}
                style={{ width: 22, height: 22 }}
              />
              <input
                className="input"
                value={ch}
                maxLength={80}
                aria-label={`Option ${i + 1}`}
                onChange={(e) => set('choices', choices.map((x, j) => (j === i ? e.target.value : x)))}
              />
              <Button
                variant="ghost"
                iconOnly
                icon="x"
                disabled={choices.length <= 2}
                onClick={() =>
                  onChange({
                    ...value,
                    choices: choices.filter((_, j) => j !== i),
                    correct_choice: value.correct_choice == null ? null : value.correct_choice === i ? null : value.correct_choice > i ? value.correct_choice - 1 : value.correct_choice,
                  })
                }
              >
                Remove option {i + 1}
              </Button>
            </div>
          ))}
          {errors?.choices && <span className="field__error">{errors.choices}</span>}
          {errors?.correct_choice && <span className="field__error">{errors.correct_choice}</span>}
          {choices.length < 8 && (
            <Button size="sm" icon="plus" onClick={() => set('choices', [...choices, ''])}>
              Add option
            </Button>
          )}
          <p className="field__hint">With a correct answer set, answers are marked instantly. Leave it unset to review answers yourself.</p>
        </fieldset>
      )}

      {value.type === 'text' && (
        <>
          <TextInput label="Answer prompt" value={value.text_prompt ?? ''} maxLength={300} onChange={(e) => set('text_prompt', e.target.value)} placeholder="e.g. Your answer" />
          <TextInput
            label="Accepted answers (optional)"
            hint="Comma separated. Matching answers score instantly (case-insensitive). Leave blank to approve by hand or accept any answer."
            value={(value.accepted_answers ?? []).join(', ')}
            onChange={(e) =>
              set(
                'accepted_answers',
                e.target.value
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </>
      )}

      <div className="grid-2">
        <NumberInput label={theme.vocab.points === 'pts' ? 'Points' : `Points (${theme.vocab.points})`} min={0} max={1000} value={value.points} onValue={(n) => set('points', n ?? 0)} error={errors?.points} />
        <NumberInput label="Bonus points" min={0} max={1000} value={value.bonus_points ?? 0} onValue={(n) => set('bonus_points', n ?? 0)} hint="Extra on top" />
      </div>

      {value.type !== 'team' && (
        <Segmented
          legend="Who completes it?"
          value={value.scope ?? 'individual'}
          onChange={(v) => !locked && set('scope', v)}
          options={[
            { value: 'individual', label: 'Each player', icon: 'pint' },
            { value: 'team', label: `Once per ${theme.vocab.team.toLowerCase()}`, icon: 'users' },
          ]}
        />
      )}
      {isTeam && (
        <Select
          label="Team reward"
          value={value.team_award_mode ?? 'team_only'}
          onChange={(e) => set('team_award_mode', e.target.value as ChallengeDraft['team_award_mode'])}
          hint="The team total is never multiplied by team size."
        >
          <option value="team_only">Team score only</option>
          <option value="team_and_members">Team score + each member’s individual score</option>
        </Select>
      )}

      <Toggle label="Required" hint="Counts towards completion. Optional challenges are pure bonus." checked={value.required ?? true} onChange={(v) => set('required', v)} disabled={value.type === 'bonus'} />
      <Toggle
        label="Organiser approves before it scores"
        checked={value.type === 'verified' || Boolean(value.requires_approval)}
        disabled={value.type === 'verified'}
        onChange={(v) => set('requires_approval', v)}
      />

      <button type="button" className="btn btn--ghost btn--sm" aria-expanded={adv} onClick={() => setAdv(!adv)} style={{ alignSelf: 'flex-start' }}>
        <Icon name={adv ? 'chevron-down' : 'chevron-right'} /> More options
      </button>
      {adv && (
        <div className="stack card card--muted">
          {!['photo', 'video', 'photo_or_video'].includes(value.type) && (
            <>
              <Select label="Optional photo/video proof" value={value.proof_media ?? 'none'} onChange={(e) => set('proof_media', e.target.value as ChallengeDraft['proof_media'])}>
                <option value="none">No media</option>
                <option value="photo">Photo</option>
                <option value="video">Video</option>
                <option value="either">Photo or video</option>
              </Select>
              {(value.proof_media ?? 'none') !== 'none' && <Toggle label="Media is mandatory" checked={Boolean(value.media_required)} onChange={(v) => set('media_required', v)} />}
            </>
          )}
          {value.type !== 'text' && (
            <TextInput label="Ask for a text note (optional)" value={value.text_prompt ?? ''} maxLength={300} onChange={(e) => set('text_prompt', e.target.value)} placeholder="e.g. Who did it?" />
          )}
          <div className="grid-2">
            <NumberInput label="Max attempts" min={1} max={20} value={value.max_attempts ?? 1} onValue={(n) => set('max_attempts', n ?? 1)} error={errors?.max_attempts} />
            <NumberInput label="Penalty if wrong" min={0} max={1000} value={value.penalty_points ?? 0} onValue={(n) => set('penalty_points', n ?? 0)} hint="Only on rejected/wrong answers" />
          </div>
          <NumberInput label="Time limit (minutes after the venue opens)" min={1} max={720} value={value.time_limit_minutes ?? null} onValue={(n) => set('time_limit_minutes', n)} placeholder="No limit" />
          <Toggle label="Repeatable" hint="Can be completed more than once (each earns points)." checked={Boolean(value.repeatable)} onChange={(v) => set('repeatable', v)} />
          {isTeam && (
            <Toggle
              label="Whole team must take part"
              hint="Goes to the organiser to confirm everyone was involved."
              checked={Boolean(value.all_members_required)}
              onChange={(v) => set('all_members_required', v)}
            />
          )}
          <Select label="When can players see it?" value={value.reveal ?? 'with_venue'} onChange={(e) => set('reveal', e.target.value as ChallengeDraft['reveal'])}>
            <option value="with_venue">When its {theme.vocab.venue.toLowerCase()} opens</option>
            <option value="always">Always visible</option>
            <option value="at_time">At a set time</option>
          </Select>
          {value.reveal === 'at_time' && (
            <TextInput
              label="Reveal at"
              type="datetime-local"
              value={value.reveal_at ? toLocalInput(value.reveal_at) : ''}
              onChange={(e) => set('reveal_at', e.target.value ? new Date(e.target.value).toISOString() : null)}
              error={errors?.reveal_at}
            />
          )}
          <TextArea label="Rules" rows={2} maxLength={1000} value={value.rules ?? ''} onChange={(e) => set('rules', e.target.value)} />
          <TextArea label="Safety note" rows={2} maxLength={500} value={value.safety_notes ?? ''} onChange={(e) => set('safety_notes', e.target.value)} placeholder="e.g. Ask before photographing strangers." />
        </div>
      )}
    </div>
  );
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function cleanChallenge(c: ChallengeDraft): ChallengeDraft {
  return {
    ...c,
    title: c.title.trim(),
    choices: c.type === 'multiple_choice' ? (c.choices ?? []).map((x) => x.trim()).filter(Boolean) : null,
    correct_choice: c.type === 'multiple_choice' ? c.correct_choice ?? null : null,
  };
}

export { validateChallenge };
