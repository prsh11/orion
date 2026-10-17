-- Explicit revisions replace active terms, preserve acceptance/progress, and recalculate rewards.
-- Resolved outcomes remain final; command retries still use the profile-serialized command ledger.
alter table public.quest_instances add column edit_revision integer not null default 0;
alter table public.quest_instances add column revised_at timestamptz;
alter table public.boss_attempts add column edit_revision integer not null default 0;
alter table public.boss_attempts add column revised_at timestamptz;

create function private.revision_goals(u uuid, goals jsonb, previous jsonb, boss boolean) returns jsonb
language plpgsql set search_path='' as $$
declare r jsonb; old jsonb; result jsonb:='[]'; ids uuid[]:='{}'; links uuid[]:='{}';
 gid uuid; qid uuid; m text; k text; a public.attribute; n numeric; progress numeric; satisfied timestamptz;
begin
 if jsonb_typeof(goals) is distinct from 'array' then raise exception 'Add 1 to 20 goals'; end if;
 if jsonb_array_length(goals) not between 1 and 20 then raise exception 'Add 1 to 20 goals'; end if;
 for r in select * from jsonb_array_elements(goals) loop
  if jsonb_typeof(r) is distinct from 'object' or r-'id'-'title'-'metric'-'target'-'activity_kind'-'attribute'-'quest_id'<>'{}'::jsonb then raise exception 'Invalid goal'; end if;
  old:=null; gid:=null;
  if r ? 'id' then
   gid:=(r->>'id')::uuid;
   select v into old from jsonb_array_elements(previous) v where v->>'id'=gid::text;
   if old is null then raise exception 'Goal unavailable'; end if;
  else gid:=gen_random_uuid(); end if;
  if gid=any(ids) then raise exception 'A goal can appear only once'; end if;
  ids:=array_append(ids,gid);
  if r->>'title' is null or length(trim(r->>'title')) not between 1 and 120 then raise exception 'Give each goal a title'; end if;
  m:=r->>'metric'; k:=nullif(r->>'activity_kind',''); a:=nullif(r->>'attribute','')::public.attribute;
  n:=(r->>'target')::numeric; qid:=null;
  if m='quest' and boss then
   qid:=(r->>'quest_id')::uuid;
   if qid is null or qid=any(links) or not exists(select 1 from public.quest_instances q where q.id=qid and q.user_id=u and q.kind='quest'
    and (exists(select 1 from jsonb_array_elements(previous) v where v->>'quest_id'=qid::text)
     or (q.completed_at is null and not q.archived and (q.status='active' or q.status is null) and (q.ends_at is null or q.ends_at>clock_timestamp())))) then raise exception 'Link each active quest at most once'; end if;
   links:=array_append(links,qid); n:=1; k:=null; a:=null;
  else
   if m is null or m not in ('manual','checklist','minutes','workouts','metres','habits','recovery') or r->>'quest_id' is not null then raise exception 'Choose a valid goal'; end if;
   if n is null or n='NaN'::numeric or n<=0 or n>10000000 or (m='checklist' and n<>1) or (m in ('manual','workouts','habits','recovery') and n<>trunc(n)) then raise exception 'Choose a valid target'; end if;
   if m in ('manual','checklist') and (k is not null or a is not null) then raise exception 'Manual goals cannot have activity filters'; end if;
   if k is not null and k not in ('gym','running','cardio','other','reading','study','focus','social','habit','recovery') then raise exception 'Choose an activity filter'; end if;
   if (m='workouts' and k is not null and k not in ('gym','running','cardio','other')) or (m='metres' and k is not null and k<>'running') or (m='habits' and k is not null and k<>'habit') or (m='recovery' and k is not null and k<>'recovery') then raise exception 'Activity filter does not match this metric'; end if;
   if a is not null and not exists(select 1 from (values ('gym','Strength'),('running','Endurance'),('cardio','Endurance'),('other','Discipline'),('reading','Intellect'),('study','Intellect'),('focus','Discipline'),('social','Connection'),('habit','Discipline'),('recovery','Vitality')) v(kind,attr)
    where v.attr=a::text and (k is null or v.kind=k) and (m<>'metres' or v.kind='running') and (m<>'workouts' or v.kind in ('gym','running','cardio','other')) and (m<>'habits' or v.kind='habit') and (m<>'recovery' or v.kind='recovery')) then raise exception 'Attribute filter does not match this activity'; end if;
  end if;
  progress:=0; satisfied:=null;
  if m in ('manual','checklist') and old->>'metric'=m then
   progress:=least(n,(old->>'progress')::numeric);
   if progress>=n then satisfied:=case when (old->>'target')::numeric=n then coalesce((old->>'satisfied_at')::timestamptz,clock_timestamp()) else clock_timestamp() end; end if;
  end if;
  result:=result||jsonb_build_array(jsonb_build_object('id',gid,'title',trim(r->>'title'),'metric',m,'target',n,'progress',progress,'activity_kind',k,'attribute',a,'quest_id',qid,'satisfied_at',satisfied,'failed',false));
 end loop;
 return result;
end $$;

create function private.revise_encounter(u uuid, action text, payload jsonb) returns void
language plpgsql set search_path='' as $$
declare q public.quest_instances; b public.boss_attempts; p public.profiles; old jsonb; goals jsonb; g jsonb;
 t timestamptz:=clock_timestamp(); due timestamptz; selected_period text; diff text; a public.attribute; attrs public.attribute[];
 x integer; pts integer; fx integer; fp integer; n integer:=0;
begin
 if payload->'accepted' is distinct from 'true'::jsonb then raise exception 'Review and accept the revised goals and rewards'; end if;
 if payload->>'title' is null or length(trim(payload->>'title')) not between 1 and 120 then raise exception 'Give this encounter a title'; end if;
 if length(coalesce(payload->>'description',''))>2000 then raise exception 'Description is too long'; end if;
 select * into p from public.profiles where id=u;
 if action='revise_quest' then
  if payload-'id'-'revision'-'accepted'-'title'-'description'-'timeline'-'difficulty'-'attribute'-'deadline'-'objectives'<>'{}'::jsonb then raise exception 'Unknown quest field'; end if;
  select * into q from public.quest_instances where id=(payload->>'id')::uuid and user_id=u and kind='quest';
  if not found or q.completed_at is not null or q.archived or coalesce(q.status,'active')<>'active' or (q.ends_at is not null and q.ends_at<=t) then raise exception 'Only active quests can change goals and rewards'; end if;
  if (payload->>'revision')::integer is distinct from q.edit_revision then raise exception 'This quest changed. Reopen the editor to use its latest version'; end if;
  selected_period:=payload->>'timeline'; diff:=payload->>'difficulty'; a:=(payload->>'attribute')::public.attribute;
  if selected_period is null or selected_period not in ('daily','weekly','monthly','custom') or diff is null or diff not in ('easy','medium','hard') or a is null then raise exception 'Choose timeline, difficulty and reward attribute'; end if;
  due:=case when selected_period='custom' then (payload->>'deadline')::timestamptz when selected_period=q.timeline then q.ends_at else private.quest_deadline(q.starts_at,p.timezone,selected_period) end;
  if due is null or not isfinite(due) or due<=t then raise exception 'Deadline must be in the future; choose a longer timeline or custom deadline'; end if;
  select coalesce(jsonb_agg(to_jsonb(o)),'[]') into old from public.quest_objectives o where quest_id=q.id;
  if q.timeline is null then old:=jsonb_build_array(jsonb_build_object('id',q.id,'metric',q.metric,'target',q.target,'progress',q.progress,'satisfied_at',q.completed_eligible_at)); end if;
  goals:=private.revision_goals(u,payload->'objectives',old,false);
  select terms.x,terms.n into x,pts from private.quest_terms(case when selected_period='custom' then 'one-off' else selected_period end,diff) terms;
  delete from public.quest_objectives where quest_id=q.id;
  for g in select * from jsonb_array_elements(goals) loop
   n:=n+1;
   insert into public.quest_objectives(id,user_id,quest_id,ordinal,title,metric,target,progress,activity_kind,attribute,satisfied_at)
    values((g->>'id')::uuid,u,q.id,n,g->>'title',g->>'metric',(g->>'target')::numeric,(g->>'progress')::numeric,g->>'activity_kind',(g->>'attribute')::public.attribute,(g->>'satisfied_at')::timestamptz);
  end loop;
  update public.quest_instances set title=trim(payload->>'title'),description=coalesce(trim(payload->>'description'),''),timeline=selected_period,difficulty=diff,attribute=a,
   ends_at=due,due_at=due,target=n,metric='manual',period='one-off',reward_xp=x,reward_points=pts,status='active',edit_revision=edit_revision+1,revised_at=t where id=q.id;
  update public.quest_definitions set title=trim(payload->>'title'),description=coalesce(trim(payload->>'description'),''),timeline=selected_period,difficulty=diff,attribute=a,
   due_at=due,target=n,metric='manual',period='one-off' where id=q.definition_id;
 elsif action='revise_boss' then
  if payload-'id'-'revision'-'accepted'-'title'-'description'-'avatar'-'period'-'attributes'-'requirements'<>'{}'::jsonb then raise exception 'Unknown boss field'; end if;
  select * into b from public.boss_attempts where id=(payload->>'id')::uuid and user_id=u;
  if not found or b.status<>'active' or b.deadline<=t then raise exception 'Only active bosses can change goals and stakes'; end if;
  if (payload->>'revision')::integer is distinct from b.edit_revision then raise exception 'This boss changed. Reopen the editor to use its latest version'; end if;
  selected_period:=payload->>'period';
  if selected_period is null or selected_period not in ('daily','weekly','monthly','yearly') then raise exception 'Choose a boss period'; end if;
  if payload->>'avatar' is null or payload->>'avatar' not in ('dragon','guardian','knight','spectral') then raise exception 'Choose a boss avatar'; end if;
  due:=case when selected_period=b.period then b.deadline else private.boss_deadline(b.accepted_at,p.timezone,selected_period) end;
  if not isfinite(due) or due<=t then raise exception 'Deadline must be in the future; choose a longer period'; end if;
  if jsonb_typeof(payload->'attributes') is distinct from 'array' then raise exception 'Choose one or two attributes'; end if;
  select array_agg(v::public.attribute) into attrs from jsonb_array_elements_text(payload->'attributes') v;
  if coalesce(cardinality(attrs),0) not between 1 and 2 or (select count(distinct v) from unnest(attrs) v)<>cardinality(attrs) then raise exception 'Choose one or two distinct attributes'; end if;
  goals:=private.revision_goals(u,payload->'requirements',b.requirements,true);
  select v.x,v.fx,v.pts,v.fp into x,fx,pts,fp from (values ('daily',250,75,5,2),('weekly',1000,250,15,5),('monthly',3000,750,30,10),('yearly',12000,3000,100,25)) v(p,x,fx,pts,fp) where v.p=selected_period;
  update public.boss_attempts set title=trim(payload->>'title'),description=coalesce(trim(payload->>'description'),''),avatar=payload->>'avatar',period=selected_period,
   hours=extract(epoch from due-accepted_at)::integer/3600,deadline=due,attributes=attrs,requirements=goals,objectives='[]',
   victory_xp=x,failure_xp=fx,victory_points=pts,failure_points=fp,edit_revision=edit_revision+1,revised_at=t where id=b.id;
 else raise exception 'Unknown revision'; end if;
end $$;
revoke all on function private.revision_goals(uuid,jsonb,jsonb,boolean), private.revise_encounter(uuid,text,jsonb) from public,anon,authenticated;

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
   update public.quest_instances set status='completed',completed_at=t,completed_eligible_at=greatest(eligible,coalesce(q.revised_at,q.starts_at)) where id=q.id;
   perform private.reward(u,'quest:'||q.id,q.reward_xp,jsonb_build_object(q.attribute,q.reward_points));
  elsif t>=q.ends_at then update public.quest_instances set status='expired' where id=q.id;
  end if;
 end loop;
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
 if action in ('revise_quest','revise_boss') then
  perform private.revise_encounter(u,action,payload);
 elsif action in ('create_boss','edit_boss','set_boss_requirement') then
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



revoke all on function public.orion_command(uuid,text,jsonb) from public,anon;
grant execute on function public.orion_command(uuid,text,jsonb) to authenticated;
