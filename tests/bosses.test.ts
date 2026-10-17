import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { bossDeadline, bossHealth } from '../src/orion/bossLogic';
import type { CommandResult, Snapshot } from '../src/orion/types';
const db = new PGlite();
let legacyUser = ''; let legacyId = ''; let legacyXP = 0;
async function root() { await db.exec('reset role'); }
async function asUser(id: string) { await root(); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); }
async function snapshot() { return (await db.query<{ s: Snapshot }>('select public.orion_snapshot() s')).rows[0]!.s; }
async function command(action: string, payload: Record<string, unknown>, id = randomUUID()) {
    return (await db.query<{ r: CommandResult }>('select public.orion_command($1,$2,$3::jsonb) r', [id, action, JSON.stringify(payload)])).rows[0]!.r;
}
async function user() { await root(); const id = randomUUID(); await db.query('insert into auth.users values($1)', [id]); await asUser(id); await snapshot(); return id; }
const check = (title = 'Prepare') => ({ title, metric: 'checklist', target: 1 });
const count = (target = 4) => ({ title: 'Count', metric: 'manual', target });
const reading = (target = 20) => ({ title: 'Read', metric: 'minutes', target, activity_kind: 'reading', attribute: 'Intellect' });
async function boss(extra: Record<string, unknown> = {}, commandId = randomUUID()) {
    const period = String(extra.period ?? 'weekly');
    return command('create_boss', { id: randomUUID(), title: 'The wall', description: 'Make progress', avatar: 'dragon', period, attributes: ['Discipline','Strength'], accepted: true, requirements: [check(),count(),reading()], ...extra },commandId);
}
async function activity(minutes=10,id=randomUUID()) { return command('activity',{ id,kind:'reading',title:'Read',minutes,occurred_at:new Date().toISOString() }); }
async function progress(id:string,requirement_id:string,n:number,cid=randomUUID()) { return command('set_boss_requirement',{id,requirement_id,progress:n},cid); }
before(async () => {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    for (const name of ['202610150001_orion', '202610160001_tasks', '202610160002_daily_toggles', '202610160003_todos', '202610160004_one_time_quests','202610160005_gym_rewards']) await db.exec(await readFile(`supabase/migrations/${name}.sql`, 'utf8'));
    legacyUser=await user(); await command('accept_boss',{id:'first-gate'}); legacyId=(await snapshot()).bosses[0]!.id; legacyXP=(await snapshot()).profile.xp;
    await root(); await db.exec(await readFile('supabase/migrations/202610170001_custom_bosses.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/202610170002_activity_server_clock.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/202610170003_encounter_editing.sql', 'utf8'));
});
after(async () => { await db.close(); });

test('migration preserves legacy attempts, restrictions and rewards while allowing multiple bosses',async()=>{
 await asUser(legacyUser); let s=await snapshot(); assert.equal(s.bosses[0]!.id,legacyId); assert.equal(s.profile.xp,legacyXP); assert.equal(s.bosses[0]!.requirements!.length,2);
 await assert.rejects(command('accept_boss',{id:'first-gate'}),/already attempted/);
 await command('accept_boss',{id:'long-horizon'}); await boss(); s=await snapshot(); assert.equal(s.bosses.filter(b=>b.status==='active').length,3);
});
test('mixed requirements have equal HP shares, correct upward, and victory rewards exactly once',async()=>{
 await user(); await boss(); let s=await snapshot(); const b=s.bosses[0]!; const rs=b.requirements!;
 await progress(b.id,rs[0]!.id,1); await progress(b.id,rs[1]!.id,2); const aid=randomUUID(); await activity(10,aid);
 s=await snapshot(); assert.equal(bossHealth(s.bosses[0]!,s),34); assert.equal(s.bosses[0]!.status,'active');
 await progress(b.id,rs[0]!.id,0); await activity(5,aid); s=await snapshot(); assert.equal(bossHealth(s.bosses[0]!,s),75);
 await command('delete_activity',{id:aid}); assert.equal(bossHealth((await snapshot()).bosses[0]!,await snapshot()),84);
 await activity(20); await progress(b.id,rs[0]!.id,1); const cid=randomUUID(); await progress(b.id,rs[1]!.id,4,cid); await progress(b.id,rs[1]!.id,4,cid);
 s=await snapshot(); assert.equal(s.bosses[0]!.status,'victory'); assert.equal(s.bosses[0]!.remaining_health,0); assert.equal(s.events.filter(e=>e.source===`boss:${b.id}`).length,1);
 assert.equal(s.events.find(e=>e.source===`boss:${b.id}`)!.xp,1000); assert.equal(s.profile.attributes.Strength,25);
 await assert.rejects(progress(b.id,rs[1]!.id,3),/unavailable/); await assert.rejects(progress(b.id,rs[1]!.id,3,cid),/reused/);
});
async function quest(objectives: Record<string,unknown>[]=[check(),reading()]) { await command('create_quest',{title:'Read and prepare',timeline:'weekly',difficulty:'medium',attribute:'Intellect',objectives}); return (await snapshot()).quests[0]!; }
test('linked quests retain prior partial progress and rewards; one quest supports several bosses',async()=>{
 await user(); const q=await quest(); await command('set_quest_objective',{id:q.id,objective_id:q.objectives![0]!.id,progress:1}); await activity(10);
 const req={title:'Finish quest',metric:'quest',quest_id:q.id,target:1}; await boss({requirements:[req]}); await boss({requirements:[req]});
 let s=await snapshot(); assert.equal(s.bosses.length,2); assert.equal(bossHealth(s.bosses[0]!,s),25);
 await activity(10); s=await snapshot(); assert.ok(s.bosses.every(b=>b.status==='victory')); assert.equal(s.events.filter(e=>e.source.startsWith('boss:')).length,2); assert.equal(s.events.filter(e=>e.source===`quest:${q.id}`).length,1);
 await assert.rejects(boss({requirements:[req]}),/active quest/);
});
test('abandoned links fail without immediate boss penalties; abandonment floors losses and cooldown preserves other bosses',async()=>{
 const owner=await user(); const q=await quest(); await boss({requirements:[{title:'Quest',metric:'quest',target:1,quest_id:q.id}]}); const first=(await snapshot()).bosses[0]!; await boss({requirements:[count()]}); const second=(await snapshot()).bosses.find(b=>b.id!==first.id)!;
 await command('abandon_quest',{id:q.id}); let s=await snapshot(); assert.equal(s.bosses.find(b=>b.id===first.id)!.requirements![0]!.failed,true); assert.equal(s.profile.xp,0); assert.ok(s.bosses.every(b=>b.status==='active'));
 await command('abandon_boss',{id:first.id}); await assert.rejects(boss(),/cooldown/); s=await snapshot(); assert.equal(s.profile.xp,0); assert.equal(s.profile.attributes.Strength,5);
 await progress(second.id,second.requirements![0]!.id,4); assert.equal((await snapshot()).bosses.find(b=>b.id===second.id)!.status,'victory');
 await user(); await assert.rejects(progress(second.id,second.requirements![0]!.id,1),/unavailable/); await assert.rejects(command('edit_boss',{id:first.id,title:'Other'}),/unavailable/);
 await asUser(owner); await assert.rejects(db.query('update public.boss_attempts set remaining_health=0'),/permission denied/);
});
test('accepted terms are immutable; text and avatar are editable; invalid requirements roll back',async()=>{
 await user(); const q=await quest(); const link={title:'Quest',metric:'quest',target:1,quest_id:q.id};
 for(const requirements of [[],Array.from({length:21},()=>check()),[link,link],[{...reading(),activity_kind:'gym'}],[{...reading(),target:'NaN'}],[{...count(),target:1.5}]]) await assert.rejects(boss({requirements}));
 await assert.rejects(boss({accepted:false}),/Accept/); await assert.rejects(boss({attributes:[]}),/attributes/); await assert.rejects(boss({attributes:['Strength','Strength']}),/attributes/);
 await boss(); const b=(await snapshot()).bosses[0]!; await assert.rejects(command('edit_boss',{id:b.id,title:'Cheat',requirements:[]}),/fixed/);
 await command('edit_boss',{id:b.id,title:'A new name',description:'Text',avatar:'spectral'}); let s=await snapshot(); assert.equal(s.bosses[0]!.title,'A new name'); assert.equal(s.bosses[0]!.avatar,'spectral'); assert.equal(s.bosses[0]!.deadline,b.deadline);
 await assert.rejects(progress(b.id,b.requirements![0]!.id,2),/invalid progress/);
 assert.equal((await snapshot()).bosses.length,1);
});
test('period stakes and timezone deadlines handle DST, leap years and month ends',async()=>{
 await root();
 for(const [t,tz,p,expected] of [
 ['2026-03-07T17:00:00Z','America/New_York','daily','2026-03-08T16:00:00.000Z'],
 ['2026-01-31T17:00:00Z','America/New_York','monthly','2026-02-28T17:00:00.000Z'],
 ['2024-02-29T17:00:00Z','America/New_York','yearly','2025-02-28T17:00:00.000Z'],
 ['2026-10-31T05:30:00Z','America/New_York','daily','2026-11-01T06:30:00.000Z'],
 ['2026-03-07T07:30:00Z','America/New_York','daily','2026-03-08T07:30:00.000Z'],
 ] as const){ const r=await db.query<{d:string}>('select private.boss_deadline($1,$2,$3)::text d',[t,tz,p]); assert.equal(new Date(r.rows[0]!.d).toISOString(),expected); assert.equal(bossDeadline(t,tz,p),expected); }
 for(const [period,x,fx,pts,fp] of [['daily',250,75,5,2],['weekly',1000,250,15,5],['monthly',3000,750,30,10],['yearly',12000,3000,100,25]] as const){
  await user(); await boss({period,requirements:[check()]}); let b=(await snapshot()).bosses[0]!;
  assert.equal(b.failure_xp,fx); assert.equal(b.failure_points,fp); await progress(b.id,b.requirements![0]!.id,1);
  let s=await snapshot(); assert.equal(s.profile.xp,x); assert.equal(s.profile.attributes.Strength,10+pts);
 }
});
test('delayed cron settles eligible linked quest before boss, excluding deadline and late contributions',async()=>{
 for(const at of ['before','at','after'] as const){
  const owner=await user(); const q=await quest(); await command('set_quest_objective',{id:q.id,objective_id:q.objectives![0]!.id,progress:1});
  await boss({requirements:[{title:'Quest',metric:'quest',target:1,quest_id:q.id}]}); const b=(await snapshot()).bosses[0]!;
  await root();
  // Set a past interval; move the manual eligibility and inject activity as if no browser had opened since recording.
  await db.query("update public.quest_instances set starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 minute',due_at=clock_timestamp()-interval '1 minute' where id=$1",[q.id]);
  await db.query("update public.quest_objectives set satisfied_at=clock_timestamp()-interval '90 minutes' where quest_id=$1 and metric='checklist'",[q.id]);
  await db.query("update public.boss_attempts set accepted_at=clock_timestamp()-interval '2 hours',deadline=clock_timestamp()-interval '30 minutes' where id=$1",[b.id]);
  const delta=at==='before'?"-interval '1 second'":at==='after'?"+interval '1 second'":'';
  await db.query(`insert into public.activities(id,user_id,kind,title,attribute,minutes,occurred_at,recorded_at,contribution_at) select gen_random_uuid(),user_id,'reading','Read','Intellect',20,deadline${delta},deadline${delta},deadline${delta} from public.boss_attempts where id=$1`,[b.id]);
  await db.exec('select public.orion_expire_bosses()'); await asUser(owner); const s=await snapshot();
  assert.equal(s.quests[0]!.status,'completed'); assert.equal(s.bosses[0]!.status,at==='before'?'victory':'failure'); assert.equal(s.bosses[0]!.remaining_health,at==='before'?0:50);
  assert.equal(s.events.filter(e=>e.source===`boss:${b.id}`).length,1);
 }
});

test('custom failures apply exact frozen stakes and preserve resolved progress',async()=>{
 for(const [period,loss,points] of [['daily',75,2],['weekly',250,5],['monthly',750,10],['yearly',3000,25]] as const){
  const owner=await user(); await root(); await db.query("update public.profiles set xp=5000,attributes=jsonb_build_object('Strength',200,'Endurance',200,'Vitality',200,'Intellect',200,'Discipline',200,'Connection',200) where id=$1",[owner]); await asUser(owner);
  await boss({period,requirements:[count()]}); const b=(await snapshot()).bosses[0]!; await progress(b.id,b.requirements![0]!.id,2); await command('abandon_boss',{id:b.id});
  let s=await snapshot(); assert.equal(s.profile.xp,5000-loss); assert.equal(s.profile.attributes.Strength,200-points); assert.equal(s.bosses[0]!.remaining_health,50);
  await command('edit_boss',{id:b.id,title:'Remember this',avatar:'knight'}); s=await snapshot(); assert.equal(s.bosses[0]!.remaining_health,50); assert.equal(s.events.filter(e=>e.source===`boss:${b.id}`).length,1);
 }
});
test('direct activity filters, all automatic metrics and unchecked daily items recalculate active health',async()=>{
 await user(); await activity(10);
 await boss({requirements:[count(),reading(20),{title:'Run',metric:'metres',target:1000,activity_kind:'running'}, {title:'Workout',metric:'workouts',target:1}, {title:'Habit',metric:'habits',target:1}, {title:'Recover',metric:'recovery',target:1}]});
 let b=(await snapshot()).bosses[0]!; assert.equal(b.requirements![1]!.progress,0);
 await command('activity',{kind:'running',title:'Run',minutes:10,metres:1000,occurred_at:new Date().toISOString()});
 await command('habit',{name:'Read'}); const h=(await snapshot()).habits[0]!; await command('complete_habit',{id:h.id}); await command('recovery',{target:'Water: 2 litres'}); await activity(10);
 b=(await snapshot()).bosses[0]!; assert.deepEqual(b.requirements!.map(r=>r.progress),[0,10,1000,1,1,1]);
 const health=b.remaining_health!; await command('complete_habit',{id:h.id,completed:false}); await command('recovery',{target:'Water: 2 litres',completed:false}); b=(await snapshot()).bosses[0]!; assert.ok(b.remaining_health!>health); assert.equal(b.requirements![4]!.progress,0); assert.equal(b.requirements![5]!.progress,0);
});
test('expired links are visibly failed and cannot be newly linked; later activity never changes settled bosses',async()=>{
 const owner=await user(); const q=await quest(); const link={title:'Quest',metric:'quest',target:1,quest_id:q.id}; await boss({requirements:[link]});
 await root(); await db.query("update public.quest_instances set starts_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour',due_at=clock_timestamp()-interval '1 hour' where id=$1",[q.id]); await asUser(owner);
 let s=await snapshot(); assert.equal(s.bosses[0]!.requirements![0]!.failed,true); assert.equal(s.bosses[0]!.status,'active'); await assert.rejects(boss({requirements:[link]}),/active quest/);
 const b=s.bosses[0]!; await root(); await db.query("update public.boss_attempts set deadline=clock_timestamp()-interval '1 second' where id=$1",[b.id]); await asUser(owner); s=await snapshot(); assert.equal(s.bosses[0]!.status,'failure'); const frozen=s.bosses[0]!.requirements;
 await activity(20); assert.deepEqual((await snapshot()).bosses[0]!.requirements,frozen);
});
test('exclusive direct deadlines exclude late recording and corrections, and creation retries keep one encounter',async()=>{
 for(const scenario of ['eligible','recorded-at','corrected-after'] as const){
  const owner=await user(); await boss({requirements:[reading(10)]}); const b=(await snapshot()).bosses[0]!; await root();
  await db.query("update public.boss_attempts set accepted_at=clock_timestamp()-interval '2 hours',deadline=clock_timestamp()-interval '1 hour' where id=$1",[b.id]);
  const recorded=scenario==='recorded-at'?"deadline":"deadline-interval '1 second'"; const contribution=scenario==='corrected-after'?"deadline+interval '1 second'":recorded;
  await db.query(`insert into public.activities(id,user_id,kind,title,attribute,minutes,occurred_at,recorded_at,contribution_at) select gen_random_uuid(),user_id,'reading','Read','Intellect',10,deadline-interval '1 second',${recorded},${contribution} from public.boss_attempts where id=$1`,[b.id]);
  await db.exec('select public.orion_expire_bosses()'); await asUser(owner); assert.equal((await snapshot()).bosses[0]!.status,scenario==='eligible'?'victory':'failure');
 }
 await user(); const cid=randomUUID(); const payload={id:randomUUID(),title:'Once',avatar:'guardian',period:'weekly',attributes:['Strength'],accepted:true,requirements:[check()]};
 await command('create_boss',payload,cid); await command('create_boss',payload,cid); assert.equal((await snapshot()).bosses.length,1);
 await assert.rejects(command('create_boss',{...payload,title:'Different'},cid),/reused/);
});

test('Zelda: a qualifying 20 km run completes a 20 km boss requirement',async()=>{
 await user(); await boss({title:'Zelda',requirements:[{title:'Run 20 km',metric:'metres',target:20000,activity_kind:'running',attribute:'Endurance'}]});
 const before=await snapshot(); const b=before.bosses[0]!; assert.equal(b.requirements![0]!.progress,0);
 await command('activity',{kind:'running',title:'20 km run',minutes:120,metres:20000,occurred_at:new Date().toISOString()});
 const after=await snapshot(); assert.equal(after.activities[0]!.metres,20000); assert.equal(after.bosses[0]!.requirements![0]!.progress,20000); assert.equal(after.bosses[0]!.status,'victory');
});

test('default-time runs ignore a slow or fast browser clock and retries freeze the saved instant',async()=>{
 for(const offset of [-240000,240000]){
  await user();await boss({title:'Zelda',requirements:[check(),{title:'Run 20 km',metric:'metres',target:20000,activity_kind:'running',attribute:'Endurance'}]});
  const b=(await snapshot()).bosses[0]!;await progress(b.id,b.requirements![0]!.id,1);
  const payload={id:randomUUID(),kind:'running',title:'Run',minutes:30,metres:20000,time_mode:'now',occurred_at:new Date(Date.now()+offset).toISOString()};const cid=randomUUID();
  await command('activity',payload,cid);let s=await snapshot();const a=s.activities[0]!;
  assert.equal(s.bosses[0]!.status,'victory');assert.equal(s.bosses[0]!.requirements![1]!.progress,20000);
  assert.ok(Date.parse(a.occurred_at)>=Date.parse(b.accepted_at));assert.ok(Date.parse(a.occurred_at)<=Date.parse(a.recorded_at));
  const xp=s.profile.xp;await command('activity',payload,cid);s=await snapshot();assert.equal(s.activities.length,1);assert.equal(s.activities[0]!.occurred_at,a.occurred_at);assert.equal(s.profile.xp,xp);assert.equal(s.events.filter(e=>e.source===`boss:${b.id}`).length,1);
 }
});
test('explicit earlier runs remain excluded; correcting to the original logging instant settles Zelda without another base reward',async()=>{
 await user();await boss({title:'Zelda',requirements:[{title:'Run 20 km',metric:'metres',target:20000,activity_kind:'running',attribute:'Endurance'}]});
 const b=(await snapshot()).bosses[0]!;const payload={id:randomUUID(),kind:'running',title:'Run',minutes:30,metres:20000,time_mode:'custom',occurred_at:new Date(Date.now()-240000).toISOString()};
 await command('activity',payload);let s=await snapshot();const a=s.activities[0]!;assert.equal(s.bosses[0]!.status,'active');assert.equal(s.bosses[0]!.requirements![0]!.progress,0);assert.equal(s.profile.xp,30);assert.equal(Date.parse(a.occurred_at),Date.parse(payload.occurred_at));
 await command('activity',{...payload,occurred_at:a.recorded_at});s=await snapshot();assert.equal(s.activities.length,1);assert.equal(s.bosses[0]!.status,'victory');assert.equal(s.profile.xp,1030);assert.equal(s.events.filter(e=>e.source===`boss:${b.id}`).length,1);
 await assert.rejects(command('activity',{...payload,time_mode:'invalid'}),/time mode/);
});

function goalPayload(r: { id: string; title: string; metric: string; target: number; activity_kind?: string | null; attribute?: string | null; quest_id?: string | null }) {
 return {id:r.id,title:r.title,metric:r.metric,target:r.target,activity_kind:r.activity_kind??null,attribute:r.attribute??null,...(r.metric==='quest'?{quest_id:r.quest_id}: {})};
}
async function reviseBoss(extra: Record<string,unknown>={},cid=randomUUID()) {
 const b=(await snapshot()).bosses[0]!;
 return command('revise_boss',{id:b.id,revision:b.edit_revision??0,accepted:true,title:b.title,description:b.description,avatar:b.avatar,period:b.period,attributes:b.attributes,requirements:b.requirements!.map(goalPayload),...extra},cid);
}
async function reviseQuest(extra: Record<string,unknown>={},cid=randomUUID()) {
 const q=(await snapshot()).quests.find(q=>q.timeline)!;
 return command('revise_quest',{id:q.id,revision:q.edit_revision??0,accepted:true,title:q.title,description:q.description,timeline:q.timeline,difficulty:q.difficulty,attribute:q.attribute,objectives:q.objectives!.map(goalPayload),...extra},cid);
}
test('boss edits add missing goals, retain progress and acceptance, and recalculate health and frozen stakes',async()=>{
 await user();await boss({requirements:[count(4),reading(20)]});let s=await snapshot();const b=s.bosses[0]!;
 await progress(b.id,b.requirements![0]!.id,2);await activity(10);s=await snapshot();
 await reviseBoss({title:'A revised encounter',avatar:'spectral',period:'monthly',attributes:['Intellect'],requirements:[...s.bosses[0]!.requirements!.map(goalPayload),check('Forgotten task')]});
 s=await snapshot();const edited=s.bosses[0]!;assert.equal(edited.title,'A revised encounter');assert.equal(edited.accepted_at,b.accepted_at);assert.equal(edited.edit_revision,1);assert.equal(edited.victory_xp,3000);assert.equal(edited.failure_xp,750);assert.equal(edited.victory_points,30);assert.equal(edited.failure_points,10);assert.deepEqual(edited.attributes,['Intellect']);
 assert.equal(edited.requirements!.length,3);assert.equal(edited.requirements![0]!.progress,2);assert.equal(edited.requirements![1]!.progress,10);assert.equal(bossHealth(edited,s),67);assert.equal(s.profile.xp,10);
 assert.ok(Math.abs(Date.parse(edited.deadline)-Date.parse(bossDeadline(b.accepted_at,s.profile.timezone,'monthly')!))<1000);
});
test('quest edits preserve objective IDs and progress, accept extra subparts and recalculate rewards',async()=>{
 await user();await quest([count(4),reading(20)]);let s=await snapshot();const q=s.quests[0]!;
 await command('set_quest_objective',{id:q.id,objective_id:q.objectives![0]!.id,progress:2});await activity(10);s=await snapshot();
 await reviseQuest({title:'A fuller quest',timeline:'monthly',difficulty:'hard',attribute:'Connection',objectives:[...s.quests[0]!.objectives!.map(goalPayload),check('Forgotten subpart')]});
 s=await snapshot();const edited=s.quests[0]!;assert.equal(edited.title,'A fuller quest');assert.equal(edited.edit_revision,1);assert.equal(edited.starts_at,q.starts_at);assert.equal(edited.objectives!.length,3);assert.equal(edited.objectives![0]!.id,q.objectives![0]!.id);assert.equal(edited.objectives![0]!.progress,2);assert.equal(edited.objectives![1]!.progress,10);assert.equal(edited.reward_xp,600);assert.equal(edited.reward_points,16);assert.equal(edited.attribute,'Connection');assert.equal(edited.status,'active');
});
test('revisions reject stale versions, invalid links, foreign goal IDs and invalid dates atomically',async()=>{
 const owner=await user();await boss({requirements:[count()]});let s=await snapshot();const b=s.bosses[0]!;const cid=randomUUID();
 const payload={id:b.id,revision:0,accepted:true,title:'Revised',description:'',avatar:'knight',period:'yearly',attributes:['Discipline'],requirements:b.requirements!.map(goalPayload)};
 await command('revise_boss',payload,cid);await command('revise_boss',payload,cid);assert.equal((await snapshot()).bosses[0]!.edit_revision,1);
 await assert.rejects(command('revise_boss',payload),/changed/);await assert.rejects(command('revise_boss',{...payload,title:'Mismatch'},cid),/reused/);
 await assert.rejects(reviseBoss({accepted:false}),/Review and accept/);
 await assert.rejects(reviseBoss({requirements:[{...count(),id:randomUUID()}]}),/Goal unavailable/);
 await assert.rejects(reviseBoss({requirements:[{title:'Missing link',metric:'quest',target:1,quest_id:randomUUID()}]}),/Link each active quest/);
 await assert.rejects(reviseBoss({requirements:[{...reading(),activity_kind:'running'}]}),/Attribute filter/);
 assert.equal((await snapshot()).bosses[0]!.edit_revision,1);
 await user();await assert.rejects(command('revise_boss',{...payload,revision:1}),/Only active/);await asUser(owner);
 await quest([check()]);await assert.rejects(reviseQuest({timeline:'custom',deadline:'2020-01-01T00:00:00Z'}),/future/);await assert.rejects(reviseQuest({objectives:[]}),/1 to 20/);
});
test('reducing targets can settle a quest and linked boss once using recalculated rewards; resolved terms remain final',async()=>{
 await user();await quest([count(4)]);let s=await snapshot();const q=s.quests[0]!;await command('set_quest_objective',{id:q.id,objective_id:q.objectives![0]!.id,progress:2});
 await boss({requirements:[{title:'Linked achievement',metric:'quest',target:1,quest_id:q.id}]});
 await reviseQuest({difficulty:'hard',objectives:[{...goalPayload(q.objectives![0]!),target:2}]});s=await snapshot();
 assert.equal(s.quests[0]!.status,'completed');assert.equal(s.bosses[0]!.status,'victory');assert.ok(Date.parse(s.quests[0]!.completed_eligible_at!)>=Date.parse(s.quests[0]!.revised_at!));
 const xp=s.profile.xp;await assert.rejects(reviseQuest({difficulty:'easy'}),/Only active/);await assert.rejects(reviseBoss({period:'daily'}),/Only active/);s=await snapshot();assert.equal(s.profile.xp,xp);assert.equal(s.events.filter(e=>e.source===`quest:${q.id}`).length,1);assert.equal(s.events.filter(e=>e.source===`boss:${s.bosses[0]!.id}`).length,1);
});

test('revisions clamp counts, reset changed types, retain existing completed links and reject new completed links',async()=>{
 await user();const q=await quest([check()]);await boss({requirements:[count(4),reading(20),{title:'Linked quest',metric:'quest',target:1,quest_id:q.id}]});
 let s=await snapshot();const b=s.bosses[0]!;await progress(b.id,b.requirements![0]!.id,3);await activity(10);
 await command('set_quest_objective',{id:q.id,objective_id:q.objectives![0]!.id,progress:1});
 s=await snapshot();assert.equal(s.bosses[0]!.status,'active');
 await reviseBoss({requirements:s.bosses[0]!.requirements!.map((r,i)=>i===0?{...goalPayload(r),target:2}:goalPayload(r))});s=await snapshot();assert.equal(s.bosses[0]!.requirements![0]!.progress,2);assert.equal(s.bosses[0]!.requirements![2]!.progress,1);
 await assert.rejects(reviseBoss({requirements:[...s.bosses[0]!.requirements!.map(goalPayload),{title:'Again',metric:'quest',target:1,quest_id:q.id}]}),/Link each active quest/);
 await boss({title:'Different boss',requirements:[count()]});const other=(await snapshot()).bosses.find(v=>v.title==='Different boss')!;
 await assert.rejects(command('revise_boss',{id:other.id,revision:0,accepted:true,title:other.title,description:'',avatar:'knight',period:'weekly',attributes:['Strength'],requirements:[{title:'Completed quest',metric:'quest',target:1,quest_id:q.id}]}),/Link each active quest/);
 await reviseBoss({id:b.id,revision:1,requirements:[{...goalPayload(s.bosses.find(v=>v.id===b.id)!.requirements![0]!),metric:'checklist',target:1},reading(20)]});
 const revised=(await snapshot()).bosses.find(v=>v.id===b.id)!;assert.equal(revised.requirements![0]!.progress,0);
});
test('expired encounters cannot be revived by editing and unchanged timelines keep their frozen UTC deadline',async()=>{
 const u=await user();await quest([check()]);await boss({requirements:[count()]});let s=await snapshot();const q=s.quests[0]!;const b=s.bosses[0]!;
 await command('profile',{display_name:'Editor',timezone:'America/New_York',units:'metric',domains:[]});
 await reviseQuest({title:'Same deadline'});await reviseBoss({title:'Same deadline'});s=await snapshot();assert.equal(s.quests[0]!.ends_at,q.ends_at);assert.equal(s.bosses[0]!.deadline,b.deadline);
 await root();await db.query("update public.quest_instances set starts_at=statement_timestamp()-interval '2 days',ends_at=statement_timestamp()-interval '1 second',due_at=statement_timestamp()-interval '1 second' where id=$1",[q.id]);await db.query("update public.boss_attempts set deadline=clock_timestamp()-interval '1 second' where id=$1",[b.id]);await asUser(u);
 await assert.rejects(reviseQuest({timeline:'monthly'}),/Only active/);await assert.rejects(reviseBoss({period:'yearly'}),/Only active/);
});

test('active legacy one-off quests can gain structured subparts without losing manual progress',async()=>{
 const u=await user();const definition=randomUUID();await root();await db.query("insert into public.quest_definitions(id,user_id,title,period,metric,target,attribute,difficulty) values($1,$2,'Legacy goal','one-off','manual',4,'Discipline','medium')",[definition,u]);await asUser(u);
 let s=await snapshot();const q=s.quests[0]!;await command('quest_progress',{id:q.id,count:2});
 await command('revise_quest',{id:q.id,revision:0,accepted:true,title:'Legacy goal with subparts',description:'Expanded',timeline:'custom',deadline:new Date(Date.now()+86400000).toISOString(),difficulty:'hard',attribute:'Intellect',objectives:[{id:q.id,title:'Original count',metric:'manual',target:4},check('New subpart')]});
 s=await snapshot();assert.equal(s.quests[0]!.timeline,'custom');assert.equal(s.quests[0]!.objectives![0]!.progress,2);assert.equal(s.quests[0]!.objectives![1]!.progress,0);assert.equal(s.quests[0]!.reward_xp,50);assert.equal(s.quests[0]!.status,'active');
});
