-- All mutations serialize on the player's row. Private helpers are never API-callable.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create type public.attribute as enum ('Strength','Endurance','Vitality','Intellect','Discipline','Connection');
create table public.profiles (
 id uuid primary key references auth.users on delete cascade,
 display_name text not null default 'Player' check(length(display_name) between 1 and 60),
 timezone text not null default 'UTC', units text not null default 'metric' check(units in ('metric','imperial')),
 domains text[] not null default '{}', onboarded boolean not null default false,
 xp integer not null default 0 check(xp>=0), attributes jsonb not null default '{"Strength":10,"Endurance":10,"Vitality":10,"Intellect":10,"Discipline":10,"Connection":10}',
 imported boolean not null default false, legacy jsonb, created_at timestamptz not null default now()
);
create table public.activities (
 id uuid primary key, user_id uuid not null references public.profiles on delete cascade,
 kind text not null check(kind in ('gym','running','cardio','other','recovery','reading','study','focus','social','habit')),
 title text not null check(length(title) between 1 and 120), attribute public.attribute not null,
 minutes numeric not null default 0 check(minutes between 0 and 1440), metres numeric not null default 0 check(metres between 0 and 1000000),
 notes text not null default '' check(length(notes)<=5000), occurred_at timestamptz not null,
 recorded_at timestamptz not null default clock_timestamp(), daily_key text,
 base_xp integer not null default 0, base_points integer not null default 0, unique(user_id,daily_key)
);
create index on public.activities(user_id,occurred_at);
create table public.exercises (
 id uuid primary key default gen_random_uuid(), user_id uuid references public.profiles on delete cascade,
 name text not null check(length(name) between 1 and 100), bodyweight boolean not null default false, dumbbell boolean not null default false
);
insert into public.exercises(id,name,bodyweight,dumbbell) values
 ('00000000-0000-0000-0000-000000000001','Incline dumbbell press',false,true),
 ('00000000-0000-0000-0000-000000000002','Barbell squat',false,false),
 ('00000000-0000-0000-0000-000000000003','Deadlift',false,false),
 ('00000000-0000-0000-0000-000000000004','Push-up',true,false),
 ('00000000-0000-0000-0000-000000000005','Pull-up',true,false),
 ('00000000-0000-0000-0000-000000000006','Dumbbell row',false,true),
 ('00000000-0000-0000-0000-000000000007','Bench press',false,false);
create table public.workout_sets (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 activity_id uuid not null references public.activities on delete cascade, exercise_id uuid not null references public.exercises,
 reps integer not null check(reps between 1 and 1000), kg numeric not null check(kg between 0 and 1000), ordinal integer not null
);
create table public.habits (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 name text not null check(length(name) between 1 and 100), archived boolean not null default false
);
create table public.quest_definitions (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 title text not null check(length(title) between 1 and 120), period text not null check(period in ('daily','weekly','monthly')),
 metric text not null check(metric in ('minutes','workouts','metres','habits','recovery','manual')),
 target numeric not null check(target>0 and target<=10000000), attribute public.attribute not null,
 archived boolean not null default false, created_at timestamptz not null default clock_timestamp()
);
create table public.quest_instances (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 definition_id uuid not null references public.quest_definitions, starts_at timestamptz not null, ends_at timestamptz not null,
 title text not null, period text not null, metric text not null, target numeric not null, attribute public.attribute not null,
 progress numeric not null default 0, completed_at timestamptz, unique(definition_id,starts_at)
);
create table public.boss_templates (
 id text primary key, title text not null, hours integer not null check(hours in (24,168)), attributes public.attribute[] not null, objectives jsonb not null
);
insert into public.boss_templates values
 ('first-gate','The first gate',24,array['Strength','Discipline']::public.attribute[], '[{"metric":"workouts","target":1},{"metric":"minutes","target":60}]'),
 ('long-horizon','The long horizon',168,array['Endurance','Vitality']::public.attribute[], '[{"metric":"metres","target":10000},{"metric":"recovery","target":5}]');
create table public.boss_attempts (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 template_id text not null references public.boss_templates, title text not null, hours integer not null,
 attributes public.attribute[] not null, objectives jsonb not null, accepted_at timestamptz not null, deadline timestamptz not null,
 period_start timestamptz not null, status text not null default 'active' check(status in ('active','victory','failure')), resolved_at timestamptz,
 unique(user_id,template_id,period_start)
);
create unique index one_active_boss on public.boss_attempts(user_id) where status='active';
create table public.progression_events (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 source text not null, xp integer not null, attributes jsonb not null, created_at timestamptz not null default clock_timestamp(), unique(user_id,source)
);
create table public.commands (
 user_id uuid not null references public.profiles on delete cascade, id uuid not null,
 action text not null, payload jsonb not null, result jsonb not null default '{}', created_at timestamptz not null default clock_timestamp(), primary key(user_id,id)
);
do $$ declare t text; begin
 foreach t in array array['profiles','activities','workout_sets','habits','quest_definitions','quest_instances','boss_attempts','progression_events','commands'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from anon, authenticated',t);
  execute format('grant select on public.%I to authenticated',t);
  execute format('create policy own_records on public.%I for select to authenticated using (%s = (select auth.uid()))',t,case when t='profiles' then 'id' else 'user_id' end);
 end loop;
end $$;
alter table public.exercises enable row level security;
alter table public.boss_templates enable row level security;
revoke all on public.exercises, public.boss_templates from anon,authenticated;
grant select on public.exercises, public.boss_templates to authenticated;
create policy exercise_read on public.exercises for select to authenticated using(user_id is null or user_id=(select auth.uid()));
create policy boss_read on public.boss_templates for select to authenticated using(true);

create function private.period_start(t timestamptz, tz text, p text) returns timestamptz language sql stable set search_path='' as $$
 select date_trunc(case p when 'daily' then 'day' when 'weekly' then 'week' else 'month' end,t at time zone tz) at time zone tz
$$;
create function private.reward(u uuid, src text, x integer, attrs jsonb) returns void language plpgsql set search_path='' as $$
declare a text; n integer; begin
 insert into public.progression_events(user_id,source,xp,attributes) values(u,src,x,attrs) on conflict do nothing;
 if not found then return; end if;
 update public.profiles set xp=greatest(0,xp+x) where id=u;
 for a,n in select key,value::integer from jsonb_each_text(attrs) loop
  update public.profiles set attributes=jsonb_set(attributes,array[a],to_jsonb(greatest(1,(attributes->>a)::integer+n))) where id=u;
 end loop;
end $$;
create function private.metric(u uuid, m text, a public.attribute, s timestamptz, e timestamptz, recorded_after timestamptz default null) returns numeric language sql stable set search_path='' as $$
 select coalesce(sum(case m when 'minutes' then minutes when 'workouts' then case when kind in ('gym','running','cardio','other') then 1 else 0 end when 'metres' then metres when 'habits' then case when kind='habit' then 1 else 0 end when 'recovery' then case when kind='recovery' then 1 else 0 end else 0 end),0)
 from public.activities where user_id=u and occurred_at>=s and occurred_at<e and recorded_at>'2000-01-01'
 and (a is null or attribute=a) and (recorded_after is null or (recorded_at>=recorded_after and recorded_at<e))
$$;
create function private.sync_quests(u uuid) returns void language plpgsql set search_path='' as $$
declare q public.quest_definitions; i public.quest_instances; tz text; s timestamp; e timestamptz; n numeric; begin
 select timezone into tz from public.profiles where id=u;
 for q in select * from public.quest_definitions where user_id=u and not archived loop
  for s in select generate_series(private.period_start(q.created_at,tz,q.period) at time zone tz,private.period_start(clock_timestamp(),tz,q.period) at time zone tz,case q.period when 'daily' then interval '1 day' when 'weekly' then interval '1 week' else interval '1 month' end) loop
   e := (s+case q.period when 'daily' then interval '1 day' when 'weekly' then interval '1 week' else interval '1 month' end) at time zone tz;
   if not exists(select 1 from public.quest_instances where definition_id=q.id and starts_at<e and ends_at>(s at time zone tz)) then
    insert into public.quest_instances(user_id,definition_id,starts_at,ends_at,title,period,metric,target,attribute)
    values(u,q.id,s at time zone tz,e,q.title,q.period,q.metric,q.target,q.attribute) on conflict do nothing;
   end if;
  end loop;
 end loop;
 for i in select * from public.quest_instances where user_id=u and completed_at is null and starts_at<=clock_timestamp() and ends_at>clock_timestamp() loop
  n := case when i.metric='manual' then i.progress else private.metric(u,i.metric,i.attribute,i.starts_at,i.ends_at) end;
  update public.quest_instances set progress=n where id=i.id;
  if n>=i.target then
   update public.quest_instances set completed_at=clock_timestamp() where id=i.id;
   perform private.reward(u,'quest:'||i.id,case i.period when 'daily' then 25 when 'weekly' then 100 else 300 end,
    jsonb_build_object(i.attribute,case i.period when 'daily' then 1 when 'weekly' then 3 else 8 end));
  end if;
 end loop;
end $$;
create function private.finish_boss(b public.boss_attempts, won boolean) returns void language plpgsql set search_path='' as $$
declare x integer; n integer; attrs jsonb; begin
 update public.boss_attempts set status=case when won then 'victory' else 'failure' end,resolved_at=clock_timestamp() where id=b.id and status='active';
 if not found then return; end if;
 x:=case when b.hours=24 then case when won then 250 else -75 end else case when won then 1000 else -250 end end;
 n:=case when b.hours=24 then case when won then 5 else -2 end else case when won then 15 else -5 end end;
 select jsonb_object_agg(a,n) into attrs from unnest(b.attributes) a;
 perform private.reward(b.user_id,'boss:'||b.id,x,attrs);
end $$;
create function private.settle_boss(u uuid) returns void language plpgsql set search_path='' as $$
declare b public.boss_attempts; o jsonb; won boolean; begin
 perform 1 from public.profiles where id=u for update;
 for b in select * from public.boss_attempts where user_id=u and status='active' for update loop
  won:=true;
  for o in select * from jsonb_array_elements(b.objectives) loop
   if private.metric(u,o->>'metric',null,b.accepted_at,b.deadline,b.accepted_at)<(o->>'target')::numeric then won:=false; end if;
  end loop;
  if won or clock_timestamp()>=b.deadline then perform private.finish_boss(b,won); end if;
 end loop;
end $$;
create function public.orion_expire_bosses() returns void language plpgsql security definer set search_path='' as $$
declare u uuid; begin
 for u in select distinct user_id from public.boss_attempts where status='active' and deadline<=clock_timestamp() order by user_id loop
  perform private.settle_boss(u);
 end loop;
end $$;
revoke all on function public.orion_expire_bosses() from public,anon,authenticated;

create function public.orion_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb; begin
 if u is null then raise exception 'Sign in to continue'; end if;
 insert into public.profiles(id) values(u) on conflict do nothing;
 perform 1 from public.profiles where id=u for update;
 perform private.settle_boss(u); perform private.sync_quests(u);
 select jsonb_build_object(
 'profile',(select to_jsonb(p)-'legacy' from public.profiles p where id=u),
 'activities',coalesce((select jsonb_agg(a order by occurred_at desc) from public.activities a where user_id=u),'[]'),
 'sets',coalesce((select jsonb_agg(s) from public.workout_sets s where user_id=u),'[]'),
 'exercises',coalesce((select jsonb_agg(e order by name) from public.exercises e where user_id=u or user_id is null),'[]'),
 'habits',coalesce((select jsonb_agg(h) from public.habits h where user_id=u),'[]'),
 'quests',coalesce((select jsonb_agg(q order by ends_at desc) from public.quest_instances q where user_id=u),'[]'),
 'definitions',coalesce((select jsonb_agg(q) from public.quest_definitions q where user_id=u),'[]'),
 'bosses',coalesce((select jsonb_agg(b order by accepted_at desc) from public.boss_attempts b where user_id=u),'[]'),
 'templates',(select jsonb_agg(t) from public.boss_templates t),
 'events',coalesce((select jsonb_agg(e order by created_at desc) from public.progression_events e where user_id=u),'[]'),
 'legacy_achievements',coalesce((select legacy->'achievements' from public.profiles where id=u),'[]'),
 'server_time',clock_timestamp()) into result;
 return result;
end $$;
revoke all on function public.orion_snapshot() from public,anon;
grant execute on function public.orion_snapshot() to authenticated;

create function public.orion_command(command_id uuid, action text, payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.profiles; prev public.activities; b public.boss_attempts; t public.boss_templates;
 cid public.commands; k text; atime timestamptz; attr public.attribute; x integer; pts integer; oldx integer:=0; oldpts integer:=0;
 eid uuid; sid uuid; setrow jsonb; ex public.exercises; ord integer:=0; best numeric; pr boolean:=false;
 dt text; dk text; result jsonb; j jsonb; attrs jsonb; failure_time timestamptz; raw jsonb; prior_bests jsonb;
begin
 if u is null then raise exception 'Sign in to continue'; end if;
 if command_id is null or payload is null or jsonb_typeof(payload)<>'object' then raise exception 'Invalid command'; end if;
 insert into public.profiles(id) values(u) on conflict do nothing;
 select * into p from public.profiles where id=u for update;
 select * into cid from public.commands where user_id=u and id=command_id;
 if found then
  if cid.action<>action or cid.payload<>payload then raise exception 'Command ID reused with different content'; end if;
  return cid.result;
 end if;
 perform private.settle_boss(u); perform private.sync_quests(u);
 if action='profile' then
  if not exists(select 1 from pg_timezone_names where name=payload->>'timezone') then raise exception 'Choose a valid timezone'; end if;
  update public.profiles set display_name=trim(payload->>'display_name'),timezone=payload->>'timezone',units=payload->>'units',
   domains=array(select jsonb_array_elements_text(payload->'domains')),onboarded=true where id=u;
 elsif action='activity' then
  sid:=coalesce((payload->>'id')::uuid,gen_random_uuid());
  select * into prev from public.activities where id=sid;
  if found then
   if prev.user_id<>u then raise exception 'Activity unavailable'; end if;
   if prev.kind in ('habit','recovery') then raise exception 'Daily completions are final'; end if;
   oldx:=prev.base_xp; oldpts:=prev.base_points;
  end if;
  k:=payload->>'kind'; atime:=(payload->>'occurred_at')::timestamptz;
  if atime is null or atime>clock_timestamp() then raise exception 'Activity date must be in the past'; end if;
  attr:=case k when 'gym' then 'Strength' when 'running' then 'Endurance' when 'cardio' then 'Endurance' when 'reading' then 'Intellect' when 'study' then 'Intellect' when 'social' then 'Connection' when 'recovery' then 'Vitality' else 'Discipline' end;
  if k in ('habit','recovery') then raise exception 'Use daily completion'; end if;
  if coalesce((payload->>'minutes')::numeric,0)<=0 then raise exception 'Enter a positive duration'; end if;
  if k='running' and coalesce((payload->>'metres')::numeric,0)<=0 then raise exception 'Enter a positive distance'; end if;
  x:=least(60,floor((payload->>'minutes')::numeric/10)::integer*10); pts:=least(3,floor((payload->>'minutes')::numeric/30)::integer);
  if prev.id is not null and prev.recorded_at<='2000-01-01' then x:=0; pts:=0; end if;
  insert into public.activities(id,user_id,kind,title,attribute,minutes,metres,notes,occurred_at,base_xp,base_points)
   values(sid,u,k,trim(payload->>'title'),attr,(payload->>'minutes')::numeric,coalesce((payload->>'metres')::numeric,0),coalesce(payload->>'notes',''),atime,x,pts)
   on conflict(id) do update set kind=excluded.kind,title=excluded.title,attribute=excluded.attribute,minutes=excluded.minutes,metres=excluded.metres,notes=excluded.notes,occurred_at=excluded.occurred_at,base_xp=x,base_points=pts;
  attrs:=jsonb_build_object(attr,pts);
  if prev.id is not null then attrs:=jsonb_set(attrs,array[prev.attribute::text],to_jsonb(coalesce((attrs->>prev.attribute::text)::integer,0)-oldpts)); end if;
  perform private.reward(u,'activity:'||command_id,x-oldx,attrs);
  select coalesce(jsonb_object_agg(exercise_id,kg),'{}') into prior_bests from (select exercise_id,max(kg) kg from public.workout_sets where user_id=u group by exercise_id) bests;
  delete from public.workout_sets where activity_id=sid;
  if k='gym' then
   if jsonb_array_length(coalesce(payload->'sets','[]'))=0 and (prev.id is null or prev.recorded_at>'2000-01-01') then raise exception 'Add at least one completed set'; end if;
   for setrow in select * from jsonb_array_elements(payload->'sets') loop
    eid:=(setrow->>'exercise_id')::uuid;
    select * into ex from public.exercises where id=eid and (user_id=u or user_id is null);
    if not found then raise exception 'Exercise unavailable'; end if;
    best:=coalesce((prior_bests->>eid::text)::numeric,0);
    if (setrow->>'kg')::numeric>best then pr:=true; end if;
    ord:=ord+1;
    insert into public.workout_sets(user_id,activity_id,exercise_id,reps,kg,ordinal) values(u,sid,eid,(setrow->>'reps')::integer,(setrow->>'kg')::numeric,ord);
   end loop;
  end if;
 elsif action='delete_activity' then
  select * into prev from public.activities where id=(payload->>'id')::uuid and user_id=u for update;
  if not found or prev.kind in ('habit','recovery') then raise exception 'Activity unavailable'; end if;
  perform private.reward(u,'correction:'||command_id,-prev.base_xp,jsonb_build_object(prev.attribute,-prev.base_points));
  delete from public.activities where id=prev.id;
 elsif action='exercise' then
  insert into public.exercises(user_id,name,bodyweight,dumbbell) values(u,trim(payload->>'name'),coalesce((payload->>'bodyweight')::boolean,false),coalesce((payload->>'dumbbell')::boolean,false));
 elsif action='habit' then
  insert into public.habits(user_id,name) values(u,trim(payload->>'name'));
 elsif action='archive_habit' then
  update public.habits set archived=true where id=(payload->>'id')::uuid and user_id=u;
 elsif action='complete_habit' or action='recovery' then
  dt:=(clock_timestamp() at time zone p.timezone)::date::text;
  if action='complete_habit' then
   select name into k from public.habits where id=(payload->>'id')::uuid and user_id=u and not archived;
   if not found then raise exception 'Habit unavailable'; end if;
   dk:='habit:'||(payload->>'id')||':'||dt; attr:='Discipline'; x:=5;
  else
   k:=payload->>'target';
   if k not in ('Water: 2 litres','Sleep: 8 hours','Mindfulness: 10 minutes','Balanced meals: 3') then raise exception 'Unknown recovery target'; end if;
   dk:='recovery:'||k||':'||dt; attr:='Vitality'; x:=10;
  end if;
  insert into public.activities(id,user_id,kind,title,attribute,occurred_at,daily_key,base_xp,base_points)
  values(gen_random_uuid(),u,case action when 'recovery' then 'recovery' else 'habit' end,k,attr,clock_timestamp(),dk,x,1) on conflict(user_id,daily_key) do nothing;
  if found then perform private.reward(u,dk,x,jsonb_build_object(attr,1)); end if;
 elsif action='quest' then
  insert into public.quest_definitions(user_id,title,period,metric,target,attribute) values(u,trim(payload->>'title'),payload->>'period',payload->>'metric',(payload->>'target')::numeric,(payload->>'attribute')::public.attribute);
 elsif action='archive_quest' then
  update public.quest_definitions set archived=true where id=(payload->>'id')::uuid and user_id=u;
 elsif action='edit_quest' then
  -- Existing instances are immutable snapshots. Changes apply to future periods.
  update public.quest_definitions set title=trim(payload->>'title'),metric=payload->>'metric',target=(payload->>'target')::numeric,attribute=(payload->>'attribute')::public.attribute
   where id=(payload->>'id')::uuid and user_id=u and not archived;
  if not found then raise exception 'Quest unavailable'; end if;
 elsif action='quest_progress' then
  if (payload->>'count')::numeric<=0 then raise exception 'Enter a positive count'; end if;
  update public.quest_instances set progress=least(target,progress+(payload->>'count')::numeric) where id=(payload->>'id')::uuid and user_id=u and metric='manual' and completed_at is null and starts_at<=clock_timestamp() and ends_at>clock_timestamp();
  if not found then raise exception 'Quest unavailable'; end if;
 elsif action='accept_boss' then
  if exists(select 1 from public.boss_attempts where user_id=u and status='active') then raise exception 'Finish your active mission before accepting another'; end if;
  select * into t from public.boss_templates where id=payload->>'id';
  if not found then raise exception 'Boss unavailable'; end if;
  select max(resolved_at) into failure_time from public.boss_attempts where user_id=u and status='failure';
  if failure_time+interval '24 hours'>clock_timestamp() then raise exception 'A 24-hour cooldown follows failure'; end if;
  if exists(select 1 from public.boss_attempts where user_id=u and template_id=t.id and accepted_at>=private.period_start(clock_timestamp(),p.timezone,case t.hours when 24 then 'daily' else 'weekly' end)) then raise exception 'You already attempted this mission this period'; end if;
  atime:=clock_timestamp();
  insert into public.boss_attempts(user_id,template_id,title,hours,attributes,objectives,accepted_at,deadline,period_start)
   values(u,t.id,t.title,t.hours,t.attributes,t.objectives,atime,atime+make_interval(hours=>t.hours),private.period_start(atime,p.timezone,case t.hours when 24 then 'daily' else 'weekly' end));
 elsif action='abandon_boss' then
  select * into b from public.boss_attempts where user_id=u and id=(payload->>'id')::uuid and status='active' for update;
  if not found then raise exception 'Boss unavailable'; end if;
  perform private.finish_boss(b,false);
 elsif action='import' then
  if p.imported then raise exception 'Legacy save already imported'; end if;
  raw:=payload->'save';
  if jsonb_typeof(raw) is distinct from 'object' or jsonb_typeof(raw->'player') is distinct from 'object' or jsonb_typeof(raw->'workouts') is distinct from 'array' or jsonb_typeof(raw->'habits') is distinct from 'array' or jsonb_typeof(raw->'achievements') is distinct from 'array' then raise exception 'Invalid legacy save'; end if;
  if exists(select 1 from jsonb_array_elements(raw->'achievements') v where jsonb_typeof(v)<>'string') then raise exception 'Invalid legacy achievements'; end if;
  x:=(raw->'player'->>'xp')::integer;
  if x is null or x<0 or x>100000000 then raise exception 'Invalid legacy XP'; end if;
  perform private.reward(u,'legacy-import',x,'{}');
  for j in select * from jsonb_array_elements(raw->'workouts') loop
   k:=case j->>'type' when 'strength' then 'gym' when 'cardio' then 'cardio' else 'other' end;
   insert into public.activities(id,user_id,kind,title,attribute,minutes,notes,occurred_at,recorded_at)
   values(gen_random_uuid(),u,k,'Imported '||(j->>'type'),case when k='gym' then 'Strength'::public.attribute when k='cardio' then 'Endurance'::public.attribute else 'Discipline'::public.attribute end,(j->>'duration')::numeric,coalesce(j->>'notes',''),(j->>'date')::timestamptz,'1970-01-01');
  end loop;
  for j in select * from jsonb_array_elements(raw->'habits') loop
   insert into public.habits(user_id,name) values(u,j->>'name');
  end loop;
  update public.profiles set imported=true,legacy=raw where id=u;
 elsif action='delete_account' then
  if payload->>'confirmation'<>'DELETE' then raise exception 'Type DELETE to confirm'; end if;
  delete from auth.users where id=u;
  return '{"deleted":true}';
 else raise exception 'Unknown command'; end if;
 perform private.sync_quests(u); perform private.settle_boss(u);
 result:=jsonb_build_object('saved',true,'personal_record',pr);
 insert into public.commands(user_id,id,action,payload,result) values(u,command_id,action,payload,result);
 return result;
end $$;
revoke all on function public.orion_command(uuid,text,jsonb) from public,anon;
grant execute on function public.orion_command(uuid,text,jsonb) to authenticated;
create function public.orion_export() returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'Sign in to continue'; end if;
 return public.orion_snapshot() || jsonb_build_object('legacy',(select legacy from public.profiles where id=auth.uid()),'commands',coalesce((select jsonb_agg(c order by created_at) from public.commands c where user_id=auth.uid()),'[]'));
end $$;
revoke all on function public.orion_export() from public,anon;
grant execute on function public.orion_export() to authenticated;
revoke all on all functions in schema private from public,anon,authenticated;
