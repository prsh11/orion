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
async function quest() { await command('create_quest',{title:'Read and prepare',timeline:'weekly',difficulty:'medium',attribute:'Intellect',objectives:[check(),reading()]}); return (await snapshot()).quests[0]!; }
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
