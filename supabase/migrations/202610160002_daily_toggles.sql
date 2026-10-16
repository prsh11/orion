-- Daily checkboxes are desired-state commands, serialized and retried like other mutations.
-- Undo reverses only base rewards; settled quest and boss outcomes remain final.
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
  atime:=null;
  if nullif(payload->>'due_local','') is not null then
   if payload->>'period'<>'one-off' then raise exception 'Only one-off tasks have deadlines'; end if;
   atime:=(payload->>'due_local')::timestamp at time zone p.timezone;
   if not isfinite(atime) or atime<=clock_timestamp() then raise exception 'Deadline must be in the future'; end if;
  end if;
  insert into public.quest_definitions(user_id,title,period,metric,target,attribute,difficulty,due_at)
  values(u,trim(payload->>'title'),payload->>'period',payload->>'metric',(payload->>'target')::numeric,(payload->>'attribute')::public.attribute,coalesce(payload->>'difficulty','medium'),atime);
 elsif action='archive_quest' then
  update public.quest_definitions set archived=true where id=(payload->>'id')::uuid and user_id=u;
  update public.quest_instances set archived=true where definition_id=(payload->>'id')::uuid and user_id=u and period='one-off';
 elsif action='edit_quest' then
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
   where id=(payload->>'id')::uuid and user_id=u and metric='manual' and completed_at is null and not archived and starts_at<=clock_timestamp() and (period='one-off' or ends_at>clock_timestamp());
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
