-- Development seed data. Safe to run repeatedly; only touches rows with the
-- fixed demo ids below and refuses to run if those ids belong to real data.
-- Run locally (e.g. `supabase db reset`) — never against production.
do $$
declare
  v_owner uuid := '00000000-0000-4000-a000-00000000d001';
  v_p1 uuid := '00000000-0000-4000-a000-00000000d002';
  v_p2 uuid := '00000000-0000-4000-a000-00000000d003';
  v_event uuid;
begin
  if exists (select 1 from public.events where name = 'Demo Pub Golf' and owner_id <> v_owner) then
    raise notice 'Seed skipped: a non-demo event already uses the demo name';
    return;
  end if;
  insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at)
  values (v_owner, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now()),
         (v_p1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now()),
         (v_p2, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', true, now(), now())
  on conflict (id) do nothing;

  delete from public.events where owner_id = v_owner and name = 'Demo Pub Golf';

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_event := public.create_event(
    '{"name":"Demo Pub Golf","organiser_name":"Demo Organiser","theme_key":"classic","play_mode":"both","team_selection":"self","team_names":[{"name":"Fore Play","color":"#1d6644"},{"name":"The Mulligans","color":"#c2311c"}]}'::jsonb,
    '[{"name":"Hole 1 — The Clubhouse","par":20,"challenges":[{"title":"Team photo","type":"photo","scope":"team","points":10},{"title":"Golf trivia","type":"multiple_choice","points":5,"choices":["Birdie","Robin"],"correct_choice":0}]},
      {"name":"Hole 2 — The Fairway","bonus_points":5,"challenges":[{"title":"Tick when done","type":"checkbox","points":5}]}]'::jsonb);
  perform public.set_event_status(v_event, 'published');
  perform set_config('request.jwt.claim.sub', v_p1::text, true);
  perform public.join_event((select code from public.event_invites where event_id = v_event), null, 'Alex', '#2A9D8F', 'star', null);
  perform set_config('request.jwt.claim.sub', v_p2::text, true);
  perform public.join_event((select code from public.event_invites where event_id = v_event), null, 'Sam', '#F4A261', 'rocket', null);
  perform set_config('request.jwt.claim.sub', '', true);
  raise notice 'Seeded Demo Pub Golf with invite code %', (select code from public.event_invites where event_id = v_event);
end;
$$;
