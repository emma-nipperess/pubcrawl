import { useState } from 'react';
import { Button } from '@/components/ui';
import { coordsFromMapsUrl, geocodeAddress, venueLatLng } from '@/features/map/geo';
import { PinPicker } from '@/features/map/LazyMap';
import type { VenueDraft } from '@/lib/supabase/types';
import { NumberInput, TextArea, TextInput } from '@/components/ui';
import { Icon } from '@/components/Icon';
import type { Errors } from '@/lib/validation/forms';
import type { ThemeDef } from '@/features/themes/themes';

export function VenueForm({ value, onChange, errors, theme, golf, defaultPar = 3 }: { value: VenueDraft; onChange: (v: VenueDraft) => void; errors?: Errors; theme: ThemeDef; golf?: boolean; defaultPar?: number }) {
  const set = <K extends keyof VenueDraft>(k: K, v: VenueDraft[K]) => onChange({ ...value, [k]: v });
  const [more, setMore] = useState(false);
  const [picking, setPicking] = useState(false);
  const [finding, setFinding] = useState(false);
  const [locMsg, setLocMsg] = useState<string>();
  const at = venueLatLng(value);

  const find = async () => {
    setFinding(true);
    setLocMsg(undefined);
    try {
      const hit = await geocodeAddress([value.name, value.address].filter(Boolean).join(', '));
      if (hit) {
        onChange({ ...value, latitude: hit.lat, longitude: hit.lng });
        setLocMsg(`Found: ${hit.label}. Check the pin and drag it if needed.`);
        setPicking(true);
      } else setLocMsg('No match — try a fuller address, or tap the map to place it.');
    } catch (e) {
      setLocMsg((e as Error).message);
    } finally {
      setFinding(false);
    }
  };
  return (
    <div className="stack">
      <TextInput label={`${theme.vocab.venue} name`} value={value.name} maxLength={80} onChange={(e) => set('name', e.target.value)} error={errors?.name} placeholder="The Red Lion" />
      {golf && (
        <div className="grid-2">
          <TextInput label="Drink for this hole" value={value.drink ?? ''} maxLength={120} onChange={(e) => set('drink', e.target.value)} placeholder="Pint or soft drink" hint="Say a soft-drink option is fine." />
          <NumberInput label="Par (strokes)" min={1} max={20} value={value.par ?? null} onValue={(n) => set('par', n)} placeholder={String(defaultPar)} hint={`Blank = ${defaultPar}`} />
        </div>
      )}
      <TextInput label="Address" value={value.address ?? ''} maxLength={200} onChange={(e) => set('address', e.target.value)} autoComplete="street-address" placeholder="12 High Street" />
      <TextInput
        label="Maps link (optional)"
        hint="Paste a Google Maps or Apple Maps share link. Otherwise we link to a search for the address."
        type="url"
        inputMode="url"
        value={value.maps_url ?? ''}
        onChange={(e) => {
          const url = e.target.value;
          const c = !venueLatLng(value) ? coordsFromMapsUrl(url) : null;
          onChange({ ...value, maps_url: url, ...(c ? { latitude: c.lat, longitude: c.lng } : {}) });
          if (c) setLocMsg('Pinned from the link.');
        }}
        error={errors?.maps_url}
        placeholder="https://maps.app.goo.gl/…"
      />
      <fieldset className="stack-sm">
        <legend>On the route map</legend>
        <div className="row-wrap">
          <span className={`badge ${at ? 'badge--success' : ''}`}>
            <Icon name="map-pin" size={14} /> {at ? `${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}` : 'Not pinned yet'}
          </span>
          <Button size="sm" icon="target" loading={finding} disabled={!value.address && !value.name} onClick={find}>
            Find from address
          </Button>
          <Button size="sm" variant="ghost" icon="map-pin" onClick={() => setPicking(!picking)} aria-expanded={picking}>
            {picking ? 'Hide map' : at ? 'Adjust on map' : 'Pick on map'}
          </Button>
          {at && (
            <Button size="sm" variant="ghost" icon="x" onClick={() => onChange({ ...value, latitude: null, longitude: null })}>
              Clear
            </Button>
          )}
        </div>
        {locMsg && (
          <p className="xsmall" role="status">
            {locMsg}
          </p>
        )}
        {picking && (
          <>
            <PinPicker value={at} dark={theme.dark} onChange={(p) => onChange({ ...value, latitude: p.lat, longitude: p.lng })} />
            <p className="xsmall muted">Tap the map to drop the pin, drag it to fine-tune. Address search uses OpenStreetMap’s free Nominatim service.</p>
          </>
        )}
      </fieldset>
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
