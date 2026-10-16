-- One-time missions. Preserve completed records and all progression events.
update public.quest_definitions set archived=true where kind='quest' and period<>'one-off';
delete from public.quest_instances where kind='quest' and period<>'one-off' and completed_at is null;
delete from public.quest_definitions d where d.kind='quest' and d.period<>'one-off' and not exists(select 1 from public.quest_instances i where i.definition_id=d.id);
alter table public.quest_definitions add column timeline text check(timeline in ('daily','weekly','monthly','custom'));
alter table public.quest_definitions add column description text not null default '' check(length(description)<=2000);
alter table public.quest_instances add column timeline text check(timeline in ('daily','weekly','monthly','custom'));
alter table public.quest_instances add column description text not null default '' check(length(description)<=2000);
alter table public.quest_instances add column status text check(status in ('active','completed','expired','abandoned'));
alter table public.quest_instances add constraint mission_terms check(timeline is null or (kind='quest' and period='one-off' and ends_at is not null and ends_at>starts_at and due_at=ends_at and status is not null));
create table public.quest_objectives (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
 quest_id uuid not null references public.quest_instances on delete cascade, ordinal integer not null check(ordinal between 1 and 20),
 title text not null check(length(title) between 1 and 120),
 metric text not null check(metric in ('checklist','manual','minutes','workouts','metres','habits','recovery')),
 target numeric not null check(target>0 and target<=10000000 and target<>'NaN'::numeric),
 progress numeric not null default 0 check(progress>=0 and progress<=target),
 activity_kind text check(activity_kind in ('gym','running','cardio','other','reading','study','focus','social','habit','recovery')),
 attribute public.attribute, unique(quest_id,ordinal), check(metric<>'checklist' or target=1),
 check(metric not in ('manual','checklist') or (activity_kind is null and attribute is null))
);
alter table public.quest_objectives enable row level security;
create policy own_objectives on public.quest_objectives for select to authenticated using(user_id=auth.uid());
grant select on public.quest_objectives to authenticated;
create index quest_objectives_owner on public.quest_objectives(user_id,quest_id);
create index quest_active_deadlines on public.quest_instances(ends_at,user_id) where status='active';

create function private.quest_deadline(t timestamptz,tz text,timeline text) returns timestamptz language sql stable set search_path='' as $$
 select ((t at time zone tz)+case timeline when 'daily' then interval '1 day' when 'weekly' then interval '7 days' when 'monthly' then interval '1 month' end) at time zone tz
$$;
revoke all on function private.quest_deadline(timestamptz,text,text) from public,anon,authenticated;

create function private.mission_command(u uuid,action text,payload jsonb) returns void language plpgsql set search_path='' as $$
declare p public.profiles; q public.quest_instances; o jsonb; d uuid; quest_id uuid; objective_id uuid; n integer:=0; due timestamptz;
 t timestamptz:=clock_timestamp(); timeline text; diff text; x integer; pts integer; m text; k text; a public.attribute; target numeric; value numeric;
begin
 select * into p from public.profiles where id=u;
 if action='create_quest' then
  if payload-'id'-'title'-'description'-'timeline'-'difficulty'-'attribute'-'due_local'-'objectives'<>'{}'::jsonb then raise exception 'Unknown quest field'; end if;
  timeline:=payload->>'timeline'; diff:=coalesce(payload->>'difficulty','medium');
  if timeline is null or timeline not in ('daily','weekly','monthly','custom') then raise exception 'Choose a timeline'; end if;
  if diff not in ('easy','medium','hard') then raise exception 'Choose a difficulty'; end if;
  if timeline='custom' then due:=(payload->>'due_local')::timestamp at time zone p.timezone;
  else due:=private.quest_deadline(t,p.timezone,timeline); end if;
  if due is null or not isfinite(due) or due<=t then raise exception 'Deadline must be in the future'; end if;
  if jsonb_typeof(payload->'objectives') is distinct from 'array' then raise exception 'Add 1 to 20 objectives'; end if;
  if jsonb_array_length(payload->'objectives') not between 1 and 20 then raise exception 'Add 1 to 20 objectives'; end if;
  a:=(payload->>'attribute')::public.attribute;
  if a is null then raise exception 'Choose a reward attribute'; end if;
  select terms.x,terms.n into x,pts from private.quest_terms(case when timeline='custom' then 'one-off' else timeline end,diff) terms;
  insert into public.quest_definitions(id,user_id,title,period,metric,target,attribute,difficulty,due_at,timeline,description)
   values(coalesce((payload->>'id')::uuid,gen_random_uuid()),u,trim(payload->>'title'),'one-off','manual',jsonb_array_length(payload->'objectives'),a,diff,due,timeline,coalesce(trim(payload->>'description'),'')) returning id into d;
  insert into public.quest_instances(user_id,definition_id,title,period,metric,target,attribute,difficulty,starts_at,ends_at,due_at,reward_xp,reward_points,timeline,description,status)
   values(u,d,trim(payload->>'title'),'one-off','manual',jsonb_array_length(payload->'objectives'),a,diff,t,due,due,x,pts,timeline,coalesce(trim(payload->>'description'),''),'active') returning id into quest_id;
  for o in select * from jsonb_array_elements(payload->'objectives') loop
   if jsonb_typeof(o) is distinct from 'object' or o-'title'-'metric'-'target'-'activity_kind'-'attribute'<>'{}'::jsonb then raise exception 'Invalid objective'; end if;
   n:=n+1; m:=o->>'metric'; k:=nullif(o->>'activity_kind',''); a:=nullif(o->>'attribute','')::public.attribute;
   target:=(o->>'target')::numeric;
   if m in ('checklist','manual') and (k is not null or a is not null) then raise exception 'Manual objectives cannot have activity filters'; end if;
   if (m='workouts' and k is not null and k not in ('gym','running','cardio','other')) or (m='metres' and k is not null and k<>'running') or (m='habits' and k is not null and k<>'habit') or (m='recovery' and k is not null and k<>'recovery') then raise exception 'Activity filter does not match this metric'; end if;
   if m in ('manual','workouts','habits','recovery') and target<>trunc(target) then raise exception 'Counts must be whole numbers'; end if;
   -- Filter pairs must describe an activity the tracker can actually produce.
   if a is not null and not exists(select 1 from (values ('gym','Strength'),('running','Endurance'),('cardio','Endurance'),('other','Discipline'),('reading','Intellect'),('study','Intellect'),('focus','Discipline'),('social','Connection'),('habit','Discipline'),('recovery','Vitality')) v(kind,attr)
    where v.attr=a::text and (k is null or v.kind=k) and (m<>'metres' or v.kind='running') and (m<>'workouts' or v.kind in ('gym','running','cardio','other')) and (m<>'habits' or v.kind='habit') and (m<>'recovery' or v.kind='recovery')) then raise exception 'Attribute filter does not match this activity'; end if;
   insert into public.quest_objectives(user_id,quest_id,ordinal,title,metric,target,activity_kind,attribute)
    values(u,quest_id,n,trim(o->>'title'),m,target,k,a);
  end loop;
  return;
 end if;
 select inst.* into q from public.quest_instances inst where inst.id=(payload->>'id')::uuid and inst.user_id=u and inst.timeline is not null;
 if not found then raise exception 'Quest unavailable'; end if;
 if action='edit_mission' then
  if payload-'id'-'title'-'description'<>'{}'::jsonb then raise exception 'Accepted quest terms are fixed'; end if;
  update public.quest_instances set title=trim(payload->>'title'),description=coalesce(trim(payload->>'description'),description) where id=q.id;
  update public.quest_definitions set title=trim(payload->>'title'),description=coalesce(trim(payload->>'description'),description) where id=q.definition_id;
 elsif action='abandon_quest' then
  if q.status<>'active' or t>=q.ends_at then raise exception 'Quest unavailable'; end if;
  update public.quest_instances set status='abandoned',archived=true where id=q.id;
  update public.quest_definitions set archived=true where id=q.definition_id;
 elsif action='set_quest_objective' then
  if q.status<>'active' or t>=q.ends_at then raise exception 'Quest unavailable'; end if;
  objective_id:=(payload->>'objective_id')::uuid;
  value:=(payload->>'progress')::numeric;
  if value is null or value='NaN'::numeric or value<0 or value<>trunc(value) then raise exception 'Choose valid objective progress'; end if;
  update public.quest_objectives oo set progress=value where oo.id=objective_id and oo.quest_id=q.id and oo.user_id=u and oo.metric in ('manual','checklist') and value<=oo.target;
  if not found then raise exception 'Objective unavailable or invalid progress'; end if;
 else raise exception 'Unknown quest command'; end if;
end $$;
revoke all on function private.mission_command(uuid,text,jsonb) from public,anon,authenticated;
create or replace function private.sync_legacy_quests(u uuid) returns void language plpgsql set search_path='' as $$
declare q public.quest_definitions; i public.quest_instances; n numeric; completed timestamptz; px integer; pp integer; begin
 for q in select * from public.quest_definitions where user_id=u and kind='quest' and period='one-off' and timeline is null and not archived loop
   insert into public.quest_instances(user_id,definition_id,starts_at,ends_at,title,period,metric,target,attribute,difficulty,due_at,reward_xp,reward_points)
   select u,q.id,q.created_at,null,q.title,q.period,q.metric,q.target,q.attribute,q.difficulty,q.due_at,terms.x,terms.n from private.quest_terms(q.period,q.difficulty) terms on conflict do nothing;

 end loop;
 for i in select * from public.quest_instances where user_id=u and kind='quest' and timeline is null and completed_at is null and starts_at<=clock_timestamp() and not archived and (period='one-off' or ends_at>clock_timestamp()) loop
  n := case when i.metric='manual' then i.progress else private.metric(u,i.metric,i.attribute,i.starts_at,coalesce(i.ends_at,'infinity'::timestamptz),case when i.period='one-off' then i.starts_at else null end) end;
  update public.quest_instances set progress=n where id=i.id;
  if n>=i.target then
   completed:=clock_timestamp();
   px:=case when i.period='one-off' then private.quest_late_penalty(i.reward_xp,i.due_at,completed) else 0 end;
   pp:=case when px>0 then 1 else 0 end;
   update public.quest_instances set completed_at=completed,penalty_xp=px,penalty_points=pp where id=i.id;
   perform private.reward(u,'quest:'||i.id,i.reward_xp,jsonb_build_object(i.attribute,i.reward_points));
   if px>0 then perform private.reward(u,'quest-late:'||i.id,-px,jsonb_build_object(i.attribute,-pp)); end if;
  end if;
 end loop;
end $$;


revoke all on function private.sync_legacy_quests(uuid) from public,anon,authenticated;
create or replace function private.sync_quests(u uuid) returns void language plpgsql set search_path='' as $$
declare q public.quest_instances; o public.quest_objectives; n numeric; done integer; t timestamptz:=clock_timestamp(); begin
 perform 1 from public.profiles where id=u for update;
 perform private.sync_legacy_quests(u);
 for q in select * from public.quest_instances where user_id=u and status='active' and timeline is not null loop
  for o in select * from public.quest_objectives where quest_id=q.id and metric not in ('manual','checklist') loop
   select coalesce(sum(case o.metric when 'minutes' then a.minutes when 'metres' then case when a.kind='running' then a.metres else 0 end when 'workouts' then case when a.kind in ('gym','running','cardio','other') then 1 else 0 end when 'habits' then case when a.kind='habit' then 1 else 0 end when 'recovery' then case when a.kind='recovery' then 1 else 0 end else 0 end),0) into n
    from public.activities a where a.user_id=u and a.occurred_at>=q.starts_at and a.occurred_at<q.ends_at and a.recorded_at>=q.starts_at and a.recorded_at<q.ends_at and a.recorded_at>'2000-01-01'
    and (o.activity_kind is null or a.kind=o.activity_kind) and (o.attribute is null or a.attribute=o.attribute);
   update public.quest_objectives set progress=least(target,n) where id=o.id;
  end loop;
  select count(*) filter(where progress>=target) into done from public.quest_objectives where quest_id=q.id;
  update public.quest_instances set progress=done where id=q.id;
  -- completed_at records settlement time; eligibility is decided by accepted activity timestamps.
  if done=q.target then
   update public.quest_instances set status='completed',completed_at=t where id=q.id;
   perform private.reward(u,'quest:'||q.id,q.reward_xp,jsonb_build_object(q.attribute,q.reward_points));
  elsif t>=q.ends_at then update public.quest_instances set status='expired' where id=q.id;
  end if;
 end loop;
end $$;
revoke all on function private.sync_quests(uuid) from public,anon,authenticated;
create or replace function public.orion_command(command_id uuid, action text, payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
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
 if action in ('archive_quest','edit_quest') and exists(select 1 from public.quest_definitions where id=(payload->>'id')::uuid and user_id=u and kind='todo') then raise exception 'Use todo commands'; end if;
 if action='quest_progress' and exists(select 1 from public.quest_instances where id=(payload->>'id')::uuid and user_id=u and kind='todo') then raise exception 'Use todo commands'; end if;
 if action in ('create_quest','set_quest_objective','edit_mission','abandon_quest') then
  perform private.mission_command(u,action,payload);
 elsif action in ('todo','edit_todo','set_todo_completed','archive_todo') then
  perform private.todo_command(u,action,payload);
 elsif action='profile' then
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
  if payload ? 'completed' and jsonb_typeof(payload->'completed')<>'boolean' then raise exception 'Choose a completion state'; end if;
  if coalesce((payload->>'completed')::boolean,true) then
   sid:=gen_random_uuid();
   insert into public.activities(id,user_id,kind,title,attribute,occurred_at,daily_key,base_xp,base_points)
   values(sid,u,case action when 'recovery' then 'recovery' else 'habit' end,k,attr,clock_timestamp(),dk,x,1) on conflict(user_id,daily_key) do nothing;
   if found then perform private.reward(u,dk||':'||sid,x,jsonb_build_object(attr,1)); end if;
  else
   delete from public.activities where user_id=u and daily_key=dk returning * into prev;
   if found then perform private.reward(u,'daily-undo:'||prev.id,-prev.base_xp,jsonb_build_object(prev.attribute,-prev.base_points)); end if;
  end if;
 elsif action='quest' then
  raise exception 'Create a one-time quest with objectives';
 elsif action='archive_quest' then
  if exists(select 1 from public.quest_definitions where id=(payload->>'id')::uuid and user_id=u and timeline is not null) then raise exception 'Use mission commands'; end if;
  update public.quest_definitions set archived=true where id=(payload->>'id')::uuid and user_id=u;
  update public.quest_instances set archived=true where definition_id=(payload->>'id')::uuid and user_id=u and period='one-off';
 elsif action='edit_quest' then
  if exists(select 1 from public.quest_definitions where id=(payload->>'id')::uuid and user_id=u and timeline is not null) then raise exception 'Use mission commands'; end if;
  if exists(select 1 from public.quest_definitions where id=(payload->>'id')::uuid and user_id=u and period='one-off' and not archived) then
   if payload - 'id' - 'title' <> '{}'::jsonb then raise exception 'One-off task terms are fixed'; end if;
   update public.quest_definitions set title=trim(payload->>'title') where id=(payload->>'id')::uuid and user_id=u;
   update public.quest_instances set title=trim(payload->>'title') where definition_id=(payload->>'id')::uuid and user_id=u;
  else
   update public.quest_definitions set title=trim(payload->>'title'),metric=payload->>'metric',target=(payload->>'target')::numeric,attribute=(payload->>'attribute')::public.attribute,difficulty=coalesce(payload->>'difficulty',difficulty)
    where id=(payload->>'id')::uuid and user_id=u and not archived;
   if not found then raise exception 'Quest unavailable'; end if;
  end if;
 elsif action='quest_progress' then
  if (payload->>'count')::numeric is null or (payload->>'count')::numeric<=0 or (payload->>'count')::numeric>10000000 then raise exception 'Enter a positive count'; end if;
  update public.quest_instances set progress=least(target,progress+(payload->>'count')::numeric)
   where id=(payload->>'id')::uuid and user_id=u and timeline is null and metric='manual' and completed_at is null and not archived and starts_at<=clock_timestamp() and (period='one-off' or ends_at>clock_timestamp());
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

create or replace function public.orion_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
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
 'quests',coalesce((select jsonb_agg(to_jsonb(q)||jsonb_build_object('objectives',coalesce((select jsonb_agg(o order by ordinal) from public.quest_objectives o where o.quest_id=q.id),'[]'::jsonb)) order by ends_at desc) from public.quest_instances q where user_id=u),'[]'),
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


-- Keep the established cron entrypoint; settle quests even without an open client.
create or replace function public.orion_expire_bosses() returns void language plpgsql security definer set search_path='' as $$
declare u uuid; begin
 for u in select user_id from public.boss_attempts where status='active' and deadline<=clock_timestamp()
 union select user_id from public.quest_instances where status='active' and ends_at<=clock_timestamp() order by user_id loop
  perform 1 from public.profiles where id=u for update;
  perform private.settle_boss(u); perform private.sync_quests(u);
 end loop;
end $$;
revoke all on function public.orion_expire_bosses() from public,anon,authenticated;
