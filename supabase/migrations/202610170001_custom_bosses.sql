-- Custom encounters retain accepted terms and confirmed progress in each attempt.
drop index public.one_active_boss;
alter table public.boss_attempts alter column template_id drop not null;
alter table public.boss_attempts add column period text check(period in ('daily','weekly','monthly','yearly'));
alter table public.boss_attempts add column description text not null default '' check(length(description)<=2000);
alter table public.boss_attempts add column avatar text not null default 'dragon' check(avatar in ('dragon','guardian','knight','spectral'));
alter table public.boss_attempts add column victory_xp integer;
alter table public.boss_attempts add column failure_xp integer;
alter table public.boss_attempts add column victory_points integer;
alter table public.boss_attempts add column failure_points integer;
alter table public.boss_attempts add column requirements jsonb not null default '[]';
alter table public.boss_attempts add column remaining_health numeric not null default 100 check(remaining_health between 0 and 100);
update public.boss_attempts set period=case hours when 24 then 'daily' else 'weekly' end,
 victory_xp=case hours when 24 then 250 else 1000 end,failure_xp=case hours when 24 then 75 else 250 end,
 victory_points=case hours when 24 then 5 else 15 end,failure_points=case hours when 24 then 2 else 5 end;
alter table public.boss_attempts alter column period set not null;
alter table public.boss_attempts alter column victory_xp set not null;
alter table public.boss_attempts alter column failure_xp set not null;
alter table public.boss_attempts alter column victory_points set not null;
alter table public.boss_attempts alter column failure_points set not null;
-- Defaults are filled for older template acceptance by the insert trigger below.
alter table public.quest_instances add column completed_eligible_at timestamptz;
update public.quest_instances set completed_eligible_at=completed_at where completed_at is not null;
alter table public.quest_objectives add column satisfied_at timestamptz;
update public.quest_objectives set satisfied_at=q.completed_at from public.quest_instances q where q.id=quest_id and quest_objectives.progress>=quest_objectives.target;
alter table public.activities add column contribution_at timestamptz;
update public.activities set contribution_at=recorded_at;
alter table public.activities alter column contribution_at set default clock_timestamp();
alter table public.activities alter column contribution_at set not null;

create function private.activity_contribution_time() returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.kind,new.attribute,new.minutes,new.metres,new.occurred_at) is distinct from row(old.kind,old.attribute,old.minutes,old.metres,old.occurred_at) then new.contribution_at:=clock_timestamp(); end if;
 return new;
end $$;
create trigger activity_contribution_time before update on public.activities for each row execute function private.activity_contribution_time();
create function private.objective_satisfied_time() returns trigger language plpgsql set search_path='' as $$
begin
 if new.metric in ('manual','checklist') and new.progress is distinct from old.progress then
  new.satisfied_at:=case when new.progress>=new.target then clock_timestamp() else null end;
 end if;
 return new;
end $$;
create trigger objective_satisfied_time before update on public.quest_objectives for each row execute function private.objective_satisfied_time();

-- Legacy manual quests also record when they became eligible, independently of reads.
create function private.legacy_quest_eligible_time() returns trigger language plpgsql set search_path='' as $$
begin
 if new.kind='quest' and new.timeline is null and new.metric='manual' and new.completed_at is null and new.progress>=new.target and old.progress<old.target then new.completed_eligible_at:=clock_timestamp(); end if;
 return new;
end $$;
create trigger legacy_quest_eligible_time before update on public.quest_instances for each row execute function private.legacy_quest_eligible_time();

create function private.boss_deadline(t timestamptz,tz text,period text) returns timestamptz language sql stable set search_path='' as $$
 select ((t at time zone tz)+case period when 'daily' then interval '1 day' when 'weekly' then interval '7 days' when 'monthly' then interval '1 month' when 'yearly' then interval '1 year' end) at time zone tz
$$;
-- Shared activity evaluation returns the first eligible instant at which the target was reached.
create function private.objective_activity(u uuid,m text,k text,a public.attribute,s timestamptz,e timestamptz,target numeric)
returns table(progress numeric,eligible_at timestamptz) language sql stable set search_path='' as $$
 with contributions as (
 select greatest(v.recorded_at,v.contribution_at,v.occurred_at) t,
 case m when 'minutes' then v.minutes when 'metres' then case when v.kind='running' then v.metres else 0 end
 when 'workouts' then case when v.kind in ('gym','running','cardio','other') then 1 else 0 end
 when 'habits' then case when v.kind='habit' then 1 else 0 end when 'recovery' then case when v.kind='recovery' then 1 else 0 end else 0 end n
 from public.activities v where v.user_id=u and v.occurred_at>=s and v.occurred_at<e and v.recorded_at>=s and v.recorded_at<e
 and v.recorded_at>'2000-01-01' and v.contribution_at<e and (k is null or v.kind=k) and (a is null or v.attribute=a)
 ), cumulative as (select t,sum(n) over(order by t) n from contributions)
 select least(target,coalesce(max(n),0)),min(t) filter(where n>=target) from cumulative
$$;

create or replace function private.sync_quests(u uuid) returns void language plpgsql set search_path='' as $$
declare q public.quest_instances; o public.quest_objectives; n numeric; done integer; eligible timestamptz; t timestamptz:=clock_timestamp(); begin
 perform 1 from public.profiles where id=u for update;
 perform private.sync_legacy_quests(u);
 for q in select * from public.quest_instances where user_id=u and completed_at is not null and completed_eligible_at is null loop
  if q.timeline is null and q.metric<>'manual' then
   select v.eligible_at into eligible from private.objective_activity(u,q.metric,null,q.attribute,q.starts_at,coalesce(q.ends_at,'infinity'),q.target) v;
  else eligible:=q.completed_at; end if;
  update public.quest_instances set completed_eligible_at=coalesce(eligible,q.completed_at) where id=q.id;
 end loop;
 for q in select * from public.quest_instances where user_id=u and status='active' and timeline is not null loop
  for o in select * from public.quest_objectives where quest_id=q.id and metric not in ('manual','checklist') loop
   select v.progress,v.eligible_at into n,eligible from private.objective_activity(u,o.metric,o.activity_kind,o.attribute,q.starts_at,q.ends_at,o.target) v;
   update public.quest_objectives set progress=n,satisfied_at=eligible where id=o.id;
  end loop;
  select count(*) filter(where progress>=target),max(satisfied_at) into done,eligible from public.quest_objectives where quest_id=q.id;
  update public.quest_instances set progress=done where id=q.id;
  if done=q.target then
   update public.quest_instances set status='completed',completed_at=t,completed_eligible_at=eligible where id=q.id;
   perform private.reward(u,'quest:'||q.id,q.reward_xp,jsonb_build_object(q.attribute,q.reward_points));
  elsif t>=q.ends_at then update public.quest_instances set status='expired' where id=q.id;
  end if;
 end loop;
end $$;

create function private.boss_defaults() returns trigger language plpgsql set search_path='' as $$
declare o jsonb; rows jsonb:='[]'; begin
 if new.template_id is not null then
  new.period:=case new.hours when 24 then 'daily' else 'weekly' end;
  new.victory_xp:=case new.hours when 24 then 250 else 1000 end; new.failure_xp:=case new.hours when 24 then 75 else 250 end;
  new.victory_points:=case new.hours when 24 then 5 else 15 end; new.failure_points:=case new.hours when 24 then 2 else 5 end;
  for o in select * from jsonb_array_elements(new.objectives) loop
   rows:=rows||jsonb_build_array(o||jsonb_build_object('id',gen_random_uuid(),'title',o->>'metric','progress',0,'failed',false));
  end loop;
  new.requirements:=rows;
 end if;
 return new;
end $$;
create trigger boss_defaults before insert on public.boss_attempts for each row execute function private.boss_defaults();
-- Preserve the available legacy progress; resolved encounters stay frozen from this migration onward.
update public.boss_attempts b set requirements=(select jsonb_agg(o||jsonb_build_object('id',gen_random_uuid(),'title',o->>'metric',
 'progress',case when b.status='victory' then (o->>'target')::numeric else least((o->>'target')::numeric,private.metric(b.user_id,o->>'metric',null,b.accepted_at,b.deadline,b.accepted_at)) end,'failed',false)) from jsonb_array_elements(b.objectives) o);
update public.boss_attempts b set remaining_health=case when status='victory' then 0 else (select 100*(1-avg((r->>'progress')::numeric/(r->>'target')::numeric)) from jsonb_array_elements(requirements) r) end;

create or replace function private.finish_boss(b public.boss_attempts,won boolean) returns void language plpgsql set search_path='' as $$
declare attrs jsonb; begin
 update public.boss_attempts set status=case when won then 'victory' else 'failure' end,resolved_at=clock_timestamp(),remaining_health=case when won then 0 else remaining_health end where id=b.id and status='active';
 if not found then return; end if;
 select jsonb_object_agg(a,case when won then b.victory_points else -b.failure_points end) into attrs from unnest(b.attributes) a;
 perform private.reward(b.user_id,'boss:'||b.id,case when won then b.victory_xp else -b.failure_xp end,attrs);
end $$;

create or replace function private.settle_boss(u uuid) returns void language plpgsql set search_path='' as $$
declare b public.boss_attempts; r jsonb; rows jsonb; q public.quest_instances; o public.quest_objectives;
 n numeric; fraction numeric; total numeric; won boolean; failed boolean; begin
 perform 1 from public.profiles where id=u for update;
 perform private.sync_quests(u);
 for b in select * from public.boss_attempts where user_id=u and status='active' for update loop
  rows:='[]'; total:=0; won:=true;
  for r in select * from jsonb_array_elements(b.requirements) loop
   failed:=false;
   if r->>'metric'='quest' then
    select * into q from public.quest_instances where id=(r->>'quest_id')::uuid and user_id=u;
    n:=0;
    if q.completed_at is not null and q.completed_eligible_at<b.deadline then n:=1;
    else
     failed:=q.id is null or coalesce(q.status in ('expired','abandoned'),false) or q.archived or q.completed_at is not null;
     if q.timeline is not null then
      for o in select * from public.quest_objectives where quest_id=q.id loop
       if o.metric in ('manual','checklist') then
        fraction:=case when o.satisfied_at>=b.deadline then 0 else least(1,o.progress/o.target) end;
       else select v.progress/o.target into fraction from private.objective_activity(u,o.metric,o.activity_kind,o.attribute,q.starts_at,least(q.ends_at,b.deadline),o.target) v;
       end if;
       n:=n+fraction;
      end loop;
      select n/nullif(count(*),0) into n from public.quest_objectives where quest_id=q.id;
     elsif q.id is null then n:=0;
     elsif q.metric='manual' then n:=least(1,q.progress/q.target);
     else select v.progress/q.target into n from private.objective_activity(u,q.metric,null,q.attribute,q.starts_at,least(coalesce(q.ends_at,'infinity'),b.deadline),q.target) v; end if;
     -- Full progress cannot defeat a boss until the linked quest qualifies.
     n:=least(coalesce(n,0),0.999999);
    end if;
   elsif r->>'metric' in ('manual','checklist') then n:=(r->>'progress')::numeric;
   else select v.progress into n from private.objective_activity(u,r->>'metric',r->>'activity_kind',(r->>'attribute')::public.attribute,b.accepted_at,b.deadline,(r->>'target')::numeric) v;
   end if;
   fraction:=greatest(0,least(1,n/(r->>'target')::numeric)); total:=total+fraction;
   if fraction<1 or failed then won:=false; end if;
   rows:=rows||jsonb_build_array(r||jsonb_build_object('progress',n,'failed',failed));
  end loop;
  update public.boss_attempts set requirements=rows,remaining_health=greatest(0,100*(1-total/jsonb_array_length(rows))) where id=b.id;
  if won or clock_timestamp()>=b.deadline then perform private.finish_boss(b,won); end if;
 end loop;
end $$;

create function private.boss_command(u uuid,action text,payload jsonb) returns void language plpgsql set search_path='' as $$
declare p public.profiles; b public.boss_attempts; q public.quest_instances; r jsonb; rows jsonb:='[]'; attrs public.attribute[];
 period text; due timestamptz; t timestamptz:=clock_timestamp(); n numeric; m text; k text; a public.attribute; ids uuid[]:='{}'; qid uuid; x integer; fx integer; pts integer; fp integer;
begin
 select * into p from public.profiles where id=u;
 if action='create_boss' then
  if payload-'id'-'title'-'description'-'avatar'-'period'-'attributes'-'requirements'-'accepted'<>'{}'::jsonb then raise exception 'Unknown boss field'; end if;
  if payload->'accepted' is distinct from 'true'::jsonb then raise exception 'Accept the frozen requirements, deadline and stakes'; end if;
  if exists(select 1 from public.boss_attempts where user_id=u and status='failure' and resolved_at+interval '24 hours'>t) then raise exception 'A 24-hour cooldown follows failure'; end if;
  period:=payload->>'period';
  if period is null or period not in ('daily','weekly','monthly','yearly') then raise exception 'Choose a boss period'; end if;
  -- Acceptance and calendar boundaries are authoritative server time.
  due:=private.boss_deadline(t,p.timezone,period);
  if jsonb_typeof(payload->'attributes') is distinct from 'array' then raise exception 'Choose one or two attributes'; end if;
  select array_agg(v::public.attribute) into attrs from jsonb_array_elements_text(payload->'attributes') v;
  if coalesce(cardinality(attrs),0) not between 1 and 2 or (select count(distinct v) from unnest(attrs) v)<>cardinality(attrs) then raise exception 'Choose one or two distinct attributes'; end if;
  if jsonb_typeof(payload->'requirements') is distinct from 'array' then raise exception 'Add 1 to 20 requirements'; end if;
  if jsonb_array_length(payload->'requirements') not between 1 and 20 then raise exception 'Add 1 to 20 requirements'; end if;
  for r in select * from jsonb_array_elements(payload->'requirements') loop
   if jsonb_typeof(r) is distinct from 'object' or r-'title'-'metric'-'target'-'quest_id'-'activity_kind'-'attribute'<>'{}'::jsonb then raise exception 'Invalid requirement'; end if;
   m:=r->>'metric'; k:=nullif(r->>'activity_kind',''); a:=nullif(r->>'attribute','')::public.attribute;
   n:=(r->>'target')::numeric;
   if length(trim(r->>'title')) not between 1 and 120 or r->>'title' is null then raise exception 'Give each requirement a title'; end if;
   if m='quest' then
    qid:=(r->>'quest_id')::uuid;
    select * into q from public.quest_instances where id=qid and user_id=u and kind='quest' and completed_at is null and not archived and (status='active' or status is null) and (ends_at is null or ends_at>t);
    if not found or qid=any(ids) then raise exception 'Link each active quest at most once'; end if;
    ids:=array_append(ids,qid); n:=1; k:=null; a:=null;
   else
    if m is null or m not in ('manual','checklist','minutes','workouts','metres','habits','recovery') or r->>'quest_id' is not null then raise exception 'Choose a valid requirement'; end if;
    if n is null or n='NaN'::numeric or n<=0 or n>10000000 or (m='checklist' and n<>1) or (m in ('manual','workouts','habits','recovery') and n<>trunc(n)) then raise exception 'Choose a valid target'; end if;
    if m in ('manual','checklist') and (k is not null or a is not null) then raise exception 'Manual requirements cannot have activity filters'; end if;
    if k is not null and k not in ('gym','running','cardio','other','reading','study','focus','social','habit','recovery') then raise exception 'Choose an activity filter'; end if;
    if (m='workouts' and k is not null and k not in ('gym','running','cardio','other')) or (m='metres' and k is not null and k<>'running') or (m='habits' and k is not null and k<>'habit') or (m='recovery' and k is not null and k<>'recovery') then raise exception 'Activity filter does not match this metric'; end if;
    if a is not null and not exists(select 1 from (values ('gym','Strength'),('running','Endurance'),('cardio','Endurance'),('other','Discipline'),('reading','Intellect'),('study','Intellect'),('focus','Discipline'),('social','Connection'),('habit','Discipline'),('recovery','Vitality')) v(kind,attr)
     where v.attr=a::text and (k is null or v.kind=k) and (m<>'metres' or v.kind='running') and (m<>'workouts' or v.kind in ('gym','running','cardio','other')) and (m<>'habits' or v.kind='habit') and (m<>'recovery' or v.kind='recovery')) then raise exception 'Attribute filter does not match this activity'; end if;
   end if;
   rows:=rows||jsonb_build_array(jsonb_build_object('id',gen_random_uuid(),'title',trim(r->>'title'),'metric',m,'target',n,'progress',0,'activity_kind',k,'attribute',a,'quest_id',case when m='quest' then qid else null end,'failed',false));
  end loop;
  select v.x,v.fx,v.pts,v.fp into x,fx,pts,fp from (values ('daily',250,75,5,2),('weekly',1000,250,15,5),('monthly',3000,750,30,10),('yearly',12000,3000,100,25)) v(p,x,fx,pts,fp) where v.p=period;
  insert into public.boss_attempts(id,user_id,title,description,avatar,period,hours,attributes,objectives,requirements,accepted_at,deadline,period_start,victory_xp,failure_xp,victory_points,failure_points)
   values(coalesce((payload->>'id')::uuid,gen_random_uuid()),u,trim(payload->>'title'),coalesce(trim(payload->>'description'),''),payload->>'avatar',period,extract(epoch from due-t)::integer/3600,attrs,'[]',rows,t,due,t,x,fx,pts,fp);
  return;
 end if;
 select * into b from public.boss_attempts where id=(payload->>'id')::uuid and user_id=u;
 if not found then raise exception 'Boss unavailable'; end if;
 if action='edit_boss' then
  if payload-'id'-'title'-'description'-'avatar'<>'{}'::jsonb then raise exception 'Accepted boss terms are fixed'; end if;
  update public.boss_attempts set title=trim(payload->>'title'),description=coalesce(trim(payload->>'description'),description),avatar=coalesce(payload->>'avatar',avatar) where id=b.id;
 elsif action='set_boss_requirement' then
  if b.status<>'active' or t>=b.deadline then raise exception 'Boss unavailable'; end if;
  if payload-'id'-'requirement_id'-'progress'<>'{}'::jsonb then raise exception 'Accepted boss terms are fixed'; end if;
  n:=(payload->>'progress')::numeric;
  if n is null or n='NaN'::numeric or n<0 or n<>trunc(n) then raise exception 'Choose valid requirement progress'; end if;
  if not exists(select 1 from jsonb_array_elements(b.requirements) v where v->>'id'=payload->>'requirement_id' and v->>'metric' in ('manual','checklist') and n<=(v->>'target')::numeric) then raise exception 'Requirement unavailable or invalid progress'; end if;
  select jsonb_agg(case when v->>'id'=payload->>'requirement_id' then v||jsonb_build_object('progress',n) else v end) into rows from jsonb_array_elements(b.requirements) v;
  update public.boss_attempts set requirements=rows where id=b.id;
 else raise exception 'Unknown boss command'; end if;
end $$;

create or replace function public.orion_command(command_id uuid, action text, payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); p public.profiles; prev public.activities; b public.boss_attempts; t public.boss_templates;
 cid public.commands; k text; atime timestamptz; attr public.attribute; x integer; pts integer;
 sid uuid; pr boolean:=false;
 dt text; dk text; result jsonb; j jsonb; attrs jsonb; failure_time timestamptz; raw jsonb;
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
 perform private.sync_quests(u); perform private.settle_boss(u);
 if action in ('archive_quest','edit_quest') and exists(select 1 from public.quest_definitions where id=(payload->>'id')::uuid and user_id=u and kind='todo') then raise exception 'Use todo commands'; end if;
 if action='quest_progress' and exists(select 1 from public.quest_instances where id=(payload->>'id')::uuid and user_id=u and kind='todo') then raise exception 'Use todo commands'; end if;
 if action in ('create_boss','edit_boss','set_boss_requirement') then
  perform private.boss_command(u,action,payload);
 elsif action in ('create_quest','set_quest_objective','edit_mission','abandon_quest') then
  perform private.mission_command(u,action,payload);
 elsif action in ('todo','edit_todo','set_todo_completed','archive_todo') then
  perform private.todo_command(u,action,payload);
 elsif action='profile' then
  if not exists(select 1 from pg_timezone_names where name=payload->>'timezone') then raise exception 'Choose a valid timezone'; end if;
  update public.profiles set display_name=trim(payload->>'display_name'),timezone=payload->>'timezone',units=payload->>'units',
   domains=array(select jsonb_array_elements_text(payload->'domains')),onboarded=true where id=u;
 elsif action='activity' then
  j:=private.save_activity(u,command_id,payload);
  pr:=coalesce((j->>'personal_record')::boolean,false);
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
   insert into public.activities(id,user_id,kind,title,attribute,minutes,notes,occurred_at,recorded_at,reward_version)
   values(gen_random_uuid(),u,k,'Imported '||(j->>'type'),case when k='gym' then 'Strength'::public.attribute when k='cardio' then 'Endurance'::public.attribute else 'Discipline'::public.attribute end,(j->>'duration')::numeric,coalesce(j->>'notes',''),(j->>'date')::timestamptz,'1970-01-01',1);
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
 if action='activity' then result:=result||j; end if;
 insert into public.commands(user_id,id,action,payload,result) values(u,command_id,action,payload,result);
 return result;
end $$;


create or replace function public.orion_snapshot() returns jsonb language plpgsql security definer set search_path='' as $$
declare u uuid:=auth.uid(); result jsonb; begin
 if u is null then raise exception 'Sign in to continue'; end if;
 insert into public.profiles(id) values(u) on conflict do nothing;
 perform 1 from public.profiles where id=u for update;
 perform private.sync_quests(u); perform private.settle_boss(u);
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
  perform private.sync_quests(u); perform private.settle_boss(u);
 end loop;
end $$;
revoke all on function public.orion_expire_bosses() from public,anon,authenticated;

-- Private entry points must never be callable by browser roles.
revoke all on function private.legacy_quest_eligible_time(),private.activity_contribution_time(),private.objective_satisfied_time(),private.boss_defaults(),private.boss_deadline(timestamptz,text,text),private.objective_activity(uuid,text,text,public.attribute,timestamptz,timestamptz,numeric),private.boss_command(uuid,text,jsonb) from public,anon,authenticated;
alter table public.boss_attempts add constraint boss_title_length check(length(trim(title)) between 1 and 120);
