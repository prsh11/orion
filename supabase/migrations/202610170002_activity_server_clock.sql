-- Fix default-time entries being excluded when the browser clock trails the server.
-- Historical records and rewards are not rewritten. Command retries keep their first result.
create or replace function private.save_activity(u uuid, command_id uuid, payload jsonb) returns jsonb
language plpgsql set search_path='' as $$
declare
 prev public.activities; sid uuid:=coalesce((payload->>'id')::uuid,gen_random_uuid());
 k text:=payload->>'kind'; atime timestamptz;
 attr public.attribute; mins numeric; x integer; pts integer; base integer; bonus integer:=0;
 oldx integer:=0; oldpts integer:=0; version integer:=2; attrs jsonb; details jsonb:='{}';
 row jsonb; ex public.exercises; ord integer:=0; baselines jsonb:='{}'; eligible jsonb:='{}';
 baseline jsonb; records jsonb:='[]'; best numeric; qualifies boolean;
 exercise record;
begin
 if payload ? 'time_mode' and (payload->>'time_mode' is null or payload->>'time_mode' not in ('now','custom')) then raise exception 'Choose a valid activity time mode'; end if;
 -- Default-time entries use the same clock as acceptance, recording and deadlines.
 -- Legacy clients and explicit historical corrections retain their supplied instant.
 atime:=case when payload->>'time_mode'='now' then clock_timestamp() else (payload->>'occurred_at')::timestamptz end;
 select * into prev from public.activities where id=sid;
 if found then
  if prev.user_id<>u then raise exception 'Activity unavailable'; end if;
  if prev.kind in ('habit','recovery') then raise exception 'Daily completions are final'; end if;
  oldx:=prev.base_xp; oldpts:=prev.base_points; version:=prev.reward_version;
 end if;
 if k is null or k not in ('gym','running','cardio','other','reading','study','focus','social') then raise exception 'Choose an activity'; end if;
 if atime is null or not isfinite(atime) or atime>clock_timestamp() then raise exception 'Activity date must be in the past'; end if;
 attr:=case k when 'gym' then 'Strength' when 'running' then 'Endurance' when 'cardio' then 'Endurance' when 'reading' then 'Intellect' when 'study' then 'Intellect' when 'social' then 'Connection' else 'Discipline' end;
 mins:=case when k='gym' and version=2 then 0 else (payload->>'minutes')::numeric end;
 if mins is null or mins='NaN'::numeric or mins<0 or mins>1440 or (mins=0 and not(k='gym' and version=2)) then raise exception 'Enter a positive duration'; end if;
 if k='running' and coalesce((payload->>'metres')::numeric,0)<=0 then raise exception 'Enter a positive distance'; end if;
 if k='gym' then
  if jsonb_typeof(payload->'sets') is distinct from 'array' then raise exception 'Add at least one completed set'; end if;
  if jsonb_array_length(payload->'sets')=0 and (prev.id is null or prev.recorded_at>'2000-01-01') then raise exception 'Add at least one completed set'; end if;
  if jsonb_array_length(payload->'sets')>999 then raise exception 'Too many sets'; end if;
  if prev.id is null then
   -- Compare with the confirmed history before this workout, never earlier sets in this payload.
   for exercise in select distinct (v->>'exercise_id')::uuid id from jsonb_array_elements(payload->'sets') v loop
    select max(s.kg) into best from public.workout_sets s where s.user_id=u and s.exercise_id=exercise.id;
    if best is not null then
     select jsonb_build_object('max_kg',best,'weights',jsonb_agg(jsonb_build_object('kg',b.kg,'reps',b.reps))) into baseline
      from (select s.kg,max(s.reps) reps from public.workout_sets s where s.user_id=u and s.exercise_id=exercise.id group by s.kg) b;
     baselines:=jsonb_set(baselines,array[exercise.id::text],baseline);
    end if;
   end loop;
  else baselines:=coalesce(prev.reward_details->'pr_baselines','{}'); end if;
 end if;
 -- Insert first to satisfy set foreign keys. All changes roll back on validation failure.
 insert into public.activities(id,user_id,kind,title,attribute,minutes,metres,notes,occurred_at,base_xp,base_points,reward_version)
 values(sid,u,k,trim(payload->>'title'),attr,mins,coalesce((payload->>'metres')::numeric,0),coalesce(payload->>'notes',''),atime,0,0,version)
 on conflict(id) do update set kind=excluded.kind,title=excluded.title,attribute=excluded.attribute,minutes=excluded.minutes,metres=excluded.metres,notes=excluded.notes,occurred_at=excluded.occurred_at;
 delete from public.workout_sets where activity_id=sid;
 if k='gym' then
  for row in select * from jsonb_array_elements(payload->'sets') loop
   select * into ex from public.exercises where id=(row->>'exercise_id')::uuid and (user_id=u or user_id is null);
   if not found then raise exception 'Exercise unavailable'; end if;
   ord:=ord+1;
   insert into public.workout_sets(user_id,activity_id,exercise_id,reps,kg,ordinal)
    values(u,sid,ex.id,(row->>'reps')::integer,(row->>'kg')::numeric,ord);
  end loop;
 end if;
 if k='gym' and version=2 then
  select least(60,coalesce(sum(3+floor(least(s.reps,20)/5.0)),0))::integer,
   least(3,floor(coalesce(sum(least(s.reps,20)),0)/40.0))::integer into base,pts
   from public.workout_sets s where activity_id=sid;
  for exercise in select distinct s.exercise_id id from public.workout_sets s where s.activity_id=sid order by s.exercise_id loop
   baseline:=baselines->exercise.id::text; qualifies:=false;
   if baseline is not null then
    select exists(select 1 from public.workout_sets s where s.activity_id=sid and s.exercise_id=exercise.id
     and (s.kg>(baseline->>'max_kg')::numeric or exists(select 1 from jsonb_array_elements(baseline->'weights') w where (w->>'kg')::numeric=s.kg and s.reps>(w->>'reps')::integer))) into qualifies;
    -- Retain original eligibility even if a correction temporarily removes the qualifying set.
    if prev.id is not null or qualifies then eligible:=jsonb_set(eligible,array[exercise.id::text],baseline); end if;
    if qualifies then
     records:=records||jsonb_build_array(jsonb_build_object('exercise_id',exercise.id,'exercise_name',(select name from public.exercises where id=exercise.id)));
    end if;
   end if;
  end loop;
  -- Keep eligibility for removed exercises so restoring the original performance can restore its bonus.
  if prev.id is not null then eligible:=baselines; end if;
  bonus:=least(75,jsonb_array_length(records)*25);
  x:=base+bonus;
  details:=jsonb_build_object('base_xp',base,'pr_xp',bonus,'strength',pts,'records',records,'pr_baselines',eligible);
 else
  x:=least(60,floor(mins/10)::integer*10); pts:=least(3,floor(mins/30)::integer);
  -- Preserve the entitlement if a correction temporarily changes activity kind.
  if prev.id is not null then details:=jsonb_build_object('pr_baselines',coalesce(prev.reward_details->'pr_baselines','{}')); end if;
 end if;
 if prev.id is not null and prev.recorded_at<='2000-01-01' then x:=0; pts:=0; bonus:=0; records:='[]'; end if;
 update public.activities set base_xp=x,base_points=pts,reward_details=details where id=sid;
 attrs:=jsonb_build_object(attr,pts);
 if prev.id is not null then attrs:=jsonb_set(attrs,array[prev.attribute::text],to_jsonb(coalesce((attrs->>prev.attribute::text)::integer,0)-oldpts)); end if;
 perform private.reward(u,'activity:'||command_id,x-oldx,attrs);
 return jsonb_build_object('personal_record',prev.id is null and bonus>0,'reward',jsonb_build_object('base_xp',x-bonus,'pr_xp',bonus,'strength',pts,'records',records));
end $$;
revoke all on function private.save_activity(uuid,uuid,jsonb) from public,anon,authenticated;
