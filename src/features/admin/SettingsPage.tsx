import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AdminShell } from './AdminRoutes';
import { useAdminAction } from './useAdminAction';
import { useEventCtx } from '@/app/EventRoutes';
import { db, rpc, useChallenges, useAnswers, useVenues, useVenueNotes, useTeams } from '@/lib/supabase/queries';
import { supabase } from '@/lib/supabase/client';
import { Banner, Button, Card, TextInput } from '@/components/ui';
import { CustomThemeFields, DetailsFields, GameModeFields, RulesFields, ThemePicker, type EventForm } from '@/features/events/EventSettingsForm';
import { getTheme } from '@/features/themes/themes';
import { hasErrors, validateEvent } from '@/lib/validation/forms';
import { useAuth } from '@/lib/auth';
import { forgetEvent } from '@/lib/recent';
import { checkFile } from '@/lib/media/validate';
import { processImage } from '@/lib/media/process';
import { publicAssetUrl, uploadWithRetry } from '@/lib/media/upload';
import type { TemplatePayload } from '@/lib/supabase/types';

const EDITABLE: (keyof EventForm)[] = [
  'name', 'description', 'event_date', 'start_time', 'end_time', 'timezone', 'start_location', 'meeting_instructions', 'theme_key', 'theme_custom',
  'organiser_name', 'capacity', 'visibility', 'require_code', 'allow_late_join', 'join_open', 'play_mode', 'team_selection', 'allow_self_teams',
  'team_max_size', 'teams_locked', 'allow_skip', 'skip_policy', 'skip_penalty', 'allow_any_venue', 'challenges_visible_early',
  'default_requires_approval', 'show_others_submissions', 'leaderboard_visible', 'provisional_scoring', 'allow_partial_points', 'tie_break', 'media_retention_days',
  'game_mode', 'golf_default_par', 'golf_max_over',
];

export default function SettingsPage() {
  const { event, member, isOwner } = useEventCtx();
  const { user } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { run, busy, fb } = useAdminAction(event.id);
  const [form, setForm] = useState<EventForm>(() => ({ ...event, organiser_plays: member?.is_player ?? false }));
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const [copyName, setCopyName] = useState(`${event.name} (again)`);
  const coverRef = useRef<HTMLInputElement>(null);
  const venues = useVenues(event.id);
  const challenges = useChallenges(event.id);
  const answers = useAnswers(event.id, true);
  const notes = useVenueNotes(event.id, true);
  const teams = useTeams(event.id);
  const theme = getTheme(form.theme_key);

  // pick up remote changes (e.g. a co-organiser) when nothing is being edited
  const dirty = EDITABLE.some((k) => JSON.stringify(form[k] ?? null) !== JSON.stringify(event[k as keyof typeof event] ?? null)) || form.organiser_plays !== member?.is_player;
  useEffect(() => {
    if (!dirty) setForm({ ...event, organiser_plays: member?.is_player ?? false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event, member?.is_player]);

  const save = async () => {
    const e = validateEvent(form);
    setErrors(e);
    if (hasErrors(e)) {
      fb.toast(Object.values(e).find(Boolean)!, 'error');
      return;
    }
    const patch: Record<string, unknown> = {};
    for (const k of EDITABLE) patch[k] = form[k] ?? null;
    patch.name = String(form.name).trim();
    await run('save', async () => {
      await db.update('events', event.id, patch);
      if (member && form.organiser_plays !== member.is_player) await db.update('event_members', member.id, { is_player: form.organiser_plays });
    }, { success: 'Saved. Existing players and scores are untouched.' });
  };

  const uploadCover = async (file: File | undefined) => {
    if (!file) return;
    const head = new Uint8Array(await file.slice(0, 64).arrayBuffer());
    const check = checkFile(head, file.size, 'photo');
    if (!check.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(check.mime!)) {
      fb.toast(check.error ?? 'Use a JPEG, PNG or WebP image for the cover.', 'error');
      return;
    }
    await run('cover', async () => {
      const p = await processImage(file, check.mime!);
      const path = `${event.id}/cover-${crypto.randomUUID().slice(0, 8)}.${p.mime === 'image/png' ? 'png' : 'jpg'}`;
      if (p.blob.size > 5 * 1024 * 1024) throw new Error('Cover images must be under 5 MB.');
      await uploadWithRetry('event-assets', path, p.blob, p.mime);
      const old = event.cover_path;
      await db.update('events', event.id, { cover_path: path });
      if (old) await supabase.storage.from('event-assets').remove([old]);
    }, { success: 'Cover updated' });
  };

  const saveTemplate = () =>
    run('tpl', async () => {
      const payload: TemplatePayload = {
        event: {
          ...Object.fromEntries(EDITABLE.filter((k) => !['name', 'event_date', 'join_open', 'teams_locked'].includes(k)).map((k) => [k, event[k as keyof typeof event]])),
          team_names: (teams.data?.teams ?? []).map((t) => ({ name: t.name, color: t.color, icon: t.icon })),
        },
        venues: (venues.data ?? []).map((v) => ({
          name: v.name, address: v.address, maps_url: v.maps_url, latitude: v.latitude, longitude: v.longitude, description: v.description,
          meeting_instructions: v.meeting_instructions, arrive_at: v.arrive_at, depart_at: v.depart_at, duration_minutes: v.duration_minutes,
          accent_color: v.accent_color, par: v.par, drink: v.drink, bonus_points: v.bonus_points, time_limit_minutes: v.time_limit_minutes, organiser_notes: notes.data?.[v.id] ?? null,
          challenges: (challenges.data ?? [])
            .filter((c) => c.venue_id === v.id && !c.archived)
            .map((c) => {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { id, event_id, venue_id, archived, position, ...rest } = c;
              return { ...rest, correct_choice: answers.data?.[c.id]?.correct_choice ?? null, accepted_answers: answers.data?.[c.id]?.accepted_answers ?? null };
            }),
        })),
      };
      await db.insert('event_templates', { owner_id: user!.id, name: event.name, description: event.description, theme_key: event.theme_key, payload });
      qc.invalidateQueries({ queryKey: ['templates'] });
    }, { success: 'Saved to your templates — use it from “Create a crawl”', refresh: [] });

  const purgeMedia = () =>
    run('purge', async () => {
      const paths = await rpc<string[]>('event_proof_objects', { p_event_id: event.id });
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await supabase.storage.from('proof').remove(paths.slice(i, i + 100));
        if (error) throw error;
      }
      await rpc('forget_event_media', { p_event_id: event.id });
      fb.toast(`Deleted ${paths.length} files`, 'success');
    }, {
      confirm: { title: 'Delete all photos & videos?', body: 'Every proof file for this event is permanently deleted. Scores and results stay.', danger: true, confirmLabel: 'Delete media', typeToConfirm: 'DELETE' },
    });

  const deleteEvent = async () => {
    const ok = await fb.confirm({
      title: `Delete ${event.name} forever?`,
      body: 'All venues, challenges, teams, players, submissions, scores and media are permanently deleted. This cannot be undone.',
      danger: true,
      confirmLabel: 'Delete event',
      typeToConfirm: 'DELETE',
    });
    if (!ok) return;
    await run('delete', async () => {
      const paths = [...(await rpc<string[]>('event_proof_objects', { p_event_id: event.id }))];
      for (let i = 0; i < paths.length; i += 100) {
        const { error } = await supabase.storage.from('proof').remove(paths.slice(i, i + 100));
        if (error) throw error;
      }
      const assets = await rpc<string[]>('event_asset_objects', { p_event_id: event.id });
      if (assets.length) await supabase.storage.from('event-assets').remove(assets);
      await db.remove('events', event.id);
      forgetEvent(event.id);
      await qc.invalidateQueries();
      nav('/me', { replace: true });
    }, { refresh: [] });
  };

  const locked = event.status === 'archived';

  return (
    <AdminShell title="Settings">
      <h1 className="deco-title">Settings</h1>
      {locked && <Banner tone="info">This event is archived and read-only.</Banner>}
      <fieldset disabled={locked} className="stack-lg">
        <Card className="stack">
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>Game type</h2>
          <GameModeFields value={form} onChange={setForm} started={event.status !== 'draft' && event.status !== 'published'} />
        </Card>
        <Card className="stack">
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>Details</h2>
          <DetailsFields value={form} onChange={setForm} errors={errors} />
        </Card>
        <Card className="stack">
          <h2 style={{ fontSize: 'var(--fs-lg)' }}>Theme</h2>
          <ThemePicker value={form.theme_key ?? 'classic'} onChange={(k) => setForm({ ...form, theme_key: k })} />
          {form.theme_key === 'custom' && <CustomThemeFields value={form.theme_custom ?? {}} onChange={(c) => setForm({ ...form, theme_custom: c })} />}
          <p className="xsmall muted">Changing theme only changes the look and words — your venues and challenges stay as they are.</p>
          <div className="stack-sm">
            <strong>Cover image</strong>
            {event.cover_path && <img src={publicAssetUrl(event.cover_path) ?? ''} alt="Current cover" style={{ borderRadius: 12, maxHeight: 160, objectFit: 'cover' }} loading="lazy" />}
            <p className="xsmall muted">Public image (anyone with its link can see it) — don’t use photos of people who haven’t agreed. JPEG/PNG/WebP, under 5 MB.</p>
            <div className="row-wrap">
              <Button size="sm" icon="upload" loading={busy === 'cover'} onClick={() => coverRef.current?.click()}>
                {event.cover_path ? 'Replace cover' : 'Add cover'}
              </Button>
              {event.cover_path && (
                <Button size="sm" variant="ghost" icon="trash" onClick={() => run('uncover', async () => { await supabase.storage.from('event-assets').remove([event.cover_path!]); await db.update('events', event.id, { cover_path: null }); })}>
                  Remove
                </Button>
              )}
            </div>
            <input ref={coverRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => uploadCover(e.target.files?.[0])} />
          </div>
        </Card>
        <Card>
          <RulesFields value={form} onChange={setForm} errors={errors} theme={theme} live />
        </Card>
      </fieldset>
      {!locked && (
        <div className="sticky-actions with-nav">
          <Button variant="primary" block loading={busy === 'save'} disabled={!dirty} onClick={save}>
            {dirty ? 'Save changes' : 'All saved'}
          </Button>
        </div>
      )}

      <Card className="stack-sm">
        <h2 style={{ fontSize: 'var(--fs-lg)' }}>Reuse</h2>
        <TextInput label="Name for the copy" value={copyName} maxLength={80} onChange={(e) => setCopyName(e.target.value)} />
        <Button
          icon="copy"
          loading={busy === 'dup'}
          onClick={async () => {
            const id = await run('dup', () => rpc<string>('duplicate_event', { p_event_id: event.id, p_name: copyName }), { success: 'Copied into a new draft (no players or scores)', refresh: [] });
            if (id) nav(`/e/${id}/admin`);
          }}
        >
          Duplicate as a new draft
        </Button>
        <Button icon="download" loading={busy === 'tpl'} onClick={saveTemplate}>
          Save as a template
        </Button>
      </Card>

      <Card className="stack-sm" style={{ borderColor: 'var(--c-danger)' }}>
        <h2 style={{ fontSize: 'var(--fs-lg)', color: 'var(--c-danger)' }}>Data & deletion</h2>
        <p className="small">
          Photos and videos should be deleted {event.media_retention_days} days after the event. Deleting media keeps scores and results.
        </p>
        <Button variant="danger" icon="trash" loading={busy === 'purge'} onClick={purgeMedia}>
          Delete all photos & videos
        </Button>
        {isOwner ? (
          <Button variant="danger" icon="trash" loading={busy === 'delete'} onClick={deleteEvent}>
            Delete this event
          </Button>
        ) : (
          <p className="xsmall muted">Only the owner can delete the event.</p>
        )}
      </Card>
    </AdminShell>
  );
}
