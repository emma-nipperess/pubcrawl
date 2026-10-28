import { useState } from 'react';
import type { VenueDraft } from '@/lib/supabase/types';
import { NumberInput, TextArea, TextInput } from '@/components/ui';
import { Icon } from '@/components/Icon';
import type { Errors } from '@/lib/validation/forms';
import type { ThemeDef } from '@/features/themes/themes';

export function VenueForm({ value, onChange, errors, theme }: { value: VenueDraft; onChange: (v: VenueDraft) => void; errors?: Errors; theme: ThemeDef }) {
  const set = <K extends keyof VenueDraft>(k: K, v: VenueDraft[K]) => onChange({ ...value, [k]: v });
  const [more, setMore] = useState(false);
  return (
    <div className="stack">
      <TextInput label={`${theme.vocab.venue} name`} value={value.name} maxLength={80} onChange={(e) => set('name', e.target.value)} error={errors?.name} placeholder="The Red Lion" />
      <TextInput label="Address" value={value.address ?? ''} maxLength={200} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" placeholder="12 High Street" />
      <TextInput
        label="Maps link (optional)"
        hint="Paste a Google Maps or Apple Maps share link. Otherwise we link to a search for the address."
        type="url"
        inputMode="url"
        value={value.maps_url ?? ''}
        onChange={(e) => set('maps_url', e.target.value)}
        error={errors?.maps_url}
        placeholder="https://maps.app.goo.gl/…"
      />
      <div className="grid-2">
        <TextInput label="Arrive" type="time" value={value.arrive_at ?? ''} onChange={(e) => set('arrive_at', e.target.value || null)} />
        <TextInput label="Leave" type="time" value={value.depart_at ?? ''} onChange={(e) => set('depart_at', e.target.value || null)} />
      </div>
      <button type="button" className="btn btn--ghost btn--sm" aria-expanded={more} onClick={() => setMore(!more)} style={{ alignSelf: 'flex-start' }}>
        <Icon name={more ? 'chevron-down' : 'chevron-right'} /> More details
      </button>
      {more && (
        <div className="stack card card--muted">
          <TextArea label="Description" rows={2} maxLength={1000} value={value.description ?? ''} onChange={(e) => set('description', e.target.value)} />
          <TextArea label="Meeting instructions" rows={2} maxLength={500} value={value.meeting_instructions ?? ''} onChange={(e) => set('meeting_instructions', e.target.value)} placeholder="Upstairs, by the dartboard" />
          <div className="grid-2">
            <NumberInput label="Duration (min)" min={1} max={720} value={value.duration_minutes ?? null} onValue={(n) => set('duration_minutes', n)} error={errors?.duration_minutes} />
            <NumberInput label="Time limit (min)" min={1} max={720} value={value.time_limit_minutes ?? null} onValue={(n) => set('time_limit_minutes', n)} hint="Closes challenges" />
          </div>
          <div className="grid-2">
            <NumberInput
              label="Clean-sweep bonus"
              hint="For finishing every required challenge here"
              min={0}
              max={1000}
              value={value.bonus_points ?? 0}
              onValue={(n) => set('bonus_points', n ?? 0)}
              error={errors?.bonus_points}
            />
            {theme.golfCard && <NumberInput label="Par" hint="Shown on the scorecard" min={0} max={10000} value={value.par ?? null} onValue={(n) => set('par', n)} />}
          </div>
          <div className="grid-2">
            <NumberInput label="Latitude" value={value.latitude ?? null} onValue={(n) => set('latitude', n)} error={errors?.latitude} />
            <NumberInput label="Longitude" value={value.longitude ?? null} onValue={(n) => set('longitude', n)} error={errors?.longitude} />
          </div>
          <label className="field">
            <span className="field__label">Accent colour</span>
            <input type="color" value={value.accent_color ?? '#f2a93b'} onChange={(e) => set('accent_color', e.target.value)} style={{ width: 64, height: 44, border: 0, background: 'none' }} />
          </label>
          <TextArea
            label={
              <>
                <Icon name="lock" size={14} /> Organiser-only notes
              </>
            }
            hint="Never shown to participants."
            rows={2}
            maxLength={2000}
            value={value.organiser_notes ?? ''}
            onChange={(e) => set('organiser_notes', e.target.value)}
          />
        </div>
      )}
    </div>
  );
}
