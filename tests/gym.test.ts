import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { gymReward } from '../src/orion/trainingLogic';
import { feedbackForUpdate } from '../src/orion/feedback';
import type { CommandResult, Snapshot } from '../src/orion/types';

const db = new PGlite();
const E = '00000000-0000-0000-0000-000000000001';
let legacyUser = ''; let legacyId = ''; let legacyXP = 0;
async function root() { await db.exec('reset role'); }
async function asUser(id: string) { await root(); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); }
async function snapshot() { return (await db.query<{ s: Snapshot }>('select public.orion_snapshot() s')).rows[0]!.s; }
async function command(action: string, payload: Record<string, unknown>, id = randomUUID()) {
    return (await db.query<{ r: CommandResult }>('select public.orion_command($1,$2,$3::jsonb) r', [id, action, JSON.stringify(payload)])).rows[0]!.r;
}
async function user() { await root(); const id = randomUUID(); await db.query('insert into auth.users values($1)', [id]); await asUser(id); await snapshot(); return id; }
const set = (reps = 10, kg = 20, exercise_id = E) => ({ exercise_id, reps, kg });
const workout = (sets = [set()], extra: Record<string, unknown> = {}) => ({ id: randomUUID(), kind: 'gym', title: 'Workout', minutes: 0, metres: 0, occurred_at: new Date().toISOString(), sets, ...extra });
before(async () => {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    for (const name of ['202610150001_orion', '202610160001_tasks', '202610160002_daily_toggles', '202610160003_todos', '202610160004_one_time_quests']) await db.exec(await readFile(`supabase/migrations/${name}.sql`, 'utf8'));
    legacyUser = await user(); legacyId = randomUUID();
    await command('activity', workout([set()], { id: legacyId, minutes: 30 })); legacyXP = (await snapshot()).profile.xp;
    await root(); await db.exec(await readFile('supabase/migrations/202610160005_gym_rewards.sql', 'utf8'));
});
after(async () => { await db.close(); });

test('migration keeps historical rewards and correction rules; history supplies PR baseline', async () => {
    await asUser(legacyUser); let s = await snapshot(); assert.equal(s.profile.xp, legacyXP); assert.equal(s.activities[0]!.reward_version, 1);
    await command('activity', workout([set(20, 30)], { id: legacyId, minutes: 30 }));
    s = await snapshot(); assert.equal(s.profile.xp, legacyXP); assert.equal(s.activities[0]!.base_xp, 30);
    const result = await command('activity', workout([set(20, 31)])); assert.equal(result.reward!.pr_xp, 25);
});
test('gym rewards use real sets and capped reps, never duration; baseline is unrewarded', async () => {
    await user(); const payload = workout(Array.from({ length: 8 }, () => set()));
    const result = await command('activity', payload); const s = await snapshot();
    assert.equal(result.personal_record, false); assert.equal(result.reward!.base_xp, 40); assert.equal(result.reward!.strength, 2);
    assert.equal(s.profile.xp, 40); assert.equal(s.activities[0]!.minutes, 0); assert.equal(s.activities[0]!.reward_version, 2);
    assert.deepEqual(gymReward(payload.sets), { xp: 40, points: 2 });
    const id = randomUUID(); const high = workout(Array.from({ length: 20 }, () => set(1000)), { minutes: 1440 });
    const capped = await command('activity', high, id); assert.equal(capped.reward!.base_xp, 60); assert.equal(capped.reward!.strength, 3); assert.equal(capped.reward!.pr_xp, 25);
    assert.deepEqual(gymReward(high.sets), { xp: 60, points: 3 });
    assert.equal((await snapshot()).activities.find(a => a.id === high.id)!.minutes, 0);
});
test('per-set rounding and invalid inputs cannot fabricate rewards or partial sets', async () => {
    await user();
    assert.deepEqual(gymReward([set(1), set(4), set(5), set(19), set(20), set(21)]), { xp: 30, points: 1 });
    await command('activity', workout([set(1), set(4), set(5), set(19), set(20), set(21)]));
    assert.equal((await snapshot()).profile.xp, 30);
    const before = await snapshot();
    for (const sets of [[], [set(0)], [set(1001)], [set(2, -1)], [set(2, 1001)], [set(10, 20, randomUUID())]]) await assert.rejects(command('activity', workout(sets)));
    const after = await snapshot(); assert.equal(after.profile.xp, before.profile.xp); assert.deepEqual(after.sets, before.sets);
    await assert.rejects(db.query('select private.save_activity($1,$2,$3::jsonb)', [before.profile.id, randomUUID(), '{}']), /permission denied/);
});
test('weight and same-weight rep records award once per exercise; first exercise establishes baseline', async () => {
    await user(); await command('activity', workout([set(10, 20)]));
    let r = await command('activity', workout([set(11, 20), set(12, 20), set(10, 21)]));
    assert.equal(r.personal_record, true); assert.equal(r.reward!.pr_xp, 25); assert.equal(r.reward!.records.length, 1);
    r = await command('activity', workout([set(10, 19)])); assert.equal(r.personal_record, false); assert.equal(r.reward!.pr_xp, 0, 'a new lower weight is not a rep record');
    r = await command('activity', workout([set(12, 20)])); assert.equal(r.reward!.pr_xp, 0, 'equal performance does not qualify');
});
test('zero added weight supports bodyweight rep PRs and exercises/accounts stay isolated', async () => {
    const account = await user(); await command('exercise', { name: 'Bodyweight move', bodyweight: true });
    const exercise = (await snapshot()).exercises.find(e => e.name === 'Bodyweight move')!;
    await command('activity', workout([set(5, 0, exercise.id)]));
    const r = await command('activity', workout([set(6, 0, exercise.id)])); assert.equal(r.reward!.pr_xp, 25);
    await user(); await assert.rejects(command('activity', workout([set(7, 0, exercise.id)])), /unavailable/);
    const first = await command('activity', workout([set(20, 100)])); assert.equal(first.personal_record, false);
    await asUser(account); assert.equal((await snapshot()).sets.length, 2);
});
test('PR bonus is capped separately; duplicates and concurrent equal performances award once', async () => {
    await user(); const exercises = (await snapshot()).exercises.slice(0, 4);
    await command('activity', workout(exercises.map(e => set(10, 20, e.id))));
    const payload = workout(exercises.map(e => set(10, 21, e.id))); const id = randomUUID();
    const r = await command('activity', payload, id); assert.equal(r.reward!.pr_xp, 75); assert.equal(r.reward!.records.length, 4);
    const before = await snapshot(); assert.deepEqual(await command('activity', payload, id), r); assert.equal((await snapshot()).profile.xp, before.profile.xp);
    await assert.rejects(command('activity', { ...payload, title: 'Different' }, id), /reused/);
    const results = await Promise.all([command('activity', workout([set(10, 30, exercises[0]!.id)])), command('activity', workout([set(10, 30, exercises[0]!.id)]))]);
    assert.equal(results.filter(r => r.personal_record).length, 1);
});
test('corrections cannot mint PR bonuses, can revoke and restore original entitlement, deletion reverses total', async () => {
    await user(); const baseline = workout(); await command('activity', baseline);
    const original = workout([set(10, 21)]); await command('activity', original);
    assert.equal((await snapshot()).profile.xp, 35);
    let r = await command('activity', { ...original, sets: [set(10, 20)] }); assert.equal(r.personal_record, false); assert.equal(r.reward!.pr_xp, 0); assert.equal((await snapshot()).profile.xp, 10);
    r = await command('activity', original); assert.equal(r.reward!.pr_xp, 25); assert.equal(r.personal_record, false); assert.equal((await snapshot()).profile.xp, 35);
    await command('activity', { ...baseline, sets: [set(10, 100)] }); assert.equal((await snapshot()).profile.xp, 35, 'editing baseline cannot grant new bonus');
    await command('delete_activity', { id: original.id }); assert.equal((await snapshot()).profile.xp, 5);
});
test('gym counts toward workouts but zero minutes cannot complete minute objectives; running still settles distance', async () => {
    await user();
    await command('create_quest', { title: 'Gym goal', timeline: 'monthly', difficulty: 'medium', attribute: 'Strength', objectives: [{ title: 'One workout', metric: 'workouts', target: 1, activity_kind: 'gym' }, { title: 'Minutes', metric: 'minutes', target: 10, activity_kind: 'gym' }] });
    await command('activity', workout()); let q = (await snapshot()).quests[0]!; assert.equal(q.objectives![0]!.progress, 1); assert.equal(q.objectives![1]!.progress, 0);
    await command('create_quest', { title: 'Run 20 km', timeline: 'monthly', difficulty: 'medium', attribute: 'Endurance', objectives: [{ title: 'Distance', metric: 'metres', target: 20000, activity_kind: 'running' }] });
    await command('activity', workout([], { kind: 'running', minutes: 30, metres: 20000 }));
    q = (await snapshot()).quests.find(q => q.title === 'Run 20 km')!; assert.equal(q.status, 'completed');
});
test('confirmed PR feedback contains exercise and breakdown; refresh and retries do not replay', async () => {
    await user(); await command('activity', workout()); const before = await snapshot();
    const payload = workout([set(11)]); const id = randomUUID(); const r = await command('activity', payload, id); const after = await snapshot();
    const origin = { command: { id, action: 'activity', payload }, personalRecord: r.personal_record };
    const feedback = feedbackForUpdate(before, after, origin)!; assert.equal(feedback.mode, 'milestone');
    assert.ok(feedback.items.some(i => i.title.startsWith('New personal record: '))); assert.ok(feedback.items.some(i => i.title === 'Workout: 5 XP + 25 PR XP'));
    assert.equal(feedbackForUpdate(after, after, origin), null);
    assert.equal(feedbackForUpdate(before, after)!.mode, 'recap');
});


test('legacy imports stay unrewarded and duration-based historical kinds remain correctable', async () => {
    await user();
    await command('import', { save: { player: { xp: 300 }, workouts: [{ type: 'strength', duration: 45, date: new Date().toISOString(), notes: 'Old' }], habits: [], achievements: [] } });
    let s = await snapshot(); const imported = s.activities[0]!; assert.equal(imported.reward_version, 1); assert.equal(imported.minutes, 45);
    await command('activity', workout([], { id: imported.id, minutes: 45 }));
    s = await snapshot(); assert.equal(s.profile.xp, 300); assert.equal(s.activities[0]!.base_xp, 0); assert.equal(s.activities[0]!.minutes, 45);
    const cardio = workout([], { kind: 'cardio', minutes: 30 }); await command('activity', cardio);
    assert.equal((await snapshot()).profile.xp, 330);
    await command('activity', { ...cardio, minutes: 60 }); assert.equal((await snapshot()).profile.xp, 360);
    await assert.rejects(command('activity', { ...cardio, minutes: 0 }), /duration/);
});
