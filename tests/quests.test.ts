import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { feedbackForUpdate } from '../src/orion/feedback';
import type { Snapshot } from '../src/orion/types';
const db = new PGlite();
let migrationUser = ''; let completedId = ''; let xpBefore = 0; let legacyOneOff = '';
async function root() { await db.exec('reset role'); }
async function asUser(id: string) { await root(); await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]); await db.exec('set role authenticated'); }
async function user() { await root(); const id = randomUUID(); await db.query('insert into auth.users values($1)', [id]); await asUser(id); await snapshot(); return id; }
async function command(action: string, payload: Record<string, unknown>, id = randomUUID()) { return db.query('select public.orion_command($1,$2,$3::jsonb)', [id, action, JSON.stringify(payload)]); }
async function snapshot() { return (await db.query<{ s: Snapshot }>('select public.orion_snapshot() s')).rows[0]!.s; }
const manual = (title = 'Pack your kit') => ({ title, metric: 'checklist', target: 1 });
const mission = (extra: Record<string, unknown> = {}) => ({ title: 'Build momentum', timeline: 'weekly', difficulty: 'medium', attribute: 'Discipline', objectives: [manual()], ...extra });
const activity = (kind = 'reading', minutes = 10) => ({ kind, title: 'Fresh activity', minutes, metres: 1000, occurred_at: new Date().toISOString() });
before(async () => {
    await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    for (const name of ['202610150001_orion', '202610160001_tasks', '202610160002_daily_toggles', '202610160003_todos']) await db.exec(await readFile(`supabase/migrations/${name}.sql`, 'utf8'));
    migrationUser = await user();
    await command('quest', { title: 'Completed recurring', period: 'daily', metric: 'manual', target: 1, attribute: 'Intellect' });
    completedId = (await snapshot()).quests[0]!.id;
    await command('quest_progress', { id: completedId, count: 1 });
    await command('quest', { title: 'Unfinished recurring', period: 'weekly', metric: 'manual', target: 2, attribute: 'Strength' });
    await command('quest', { title: 'Existing one-off', period: 'one-off', metric: 'manual', target: 1, attribute: 'Intellect' });
    legacyOneOff = (await snapshot()).quests.find(q => q.title === 'Existing one-off')!.id;
    xpBefore = (await snapshot()).profile.xp;
    await root(); await db.exec(await readFile('supabase/migrations/202610160004_one_time_quests.sql', 'utf8'));
});
after(async () => { await db.close(); });
test('migration removes unfinished recurrence, retains earned history and disables recurrence', async () => {
    await asUser(migrationUser); const s = await snapshot();
    assert.equal(s.profile.xp, xpBefore); assert.equal(s.quests.length, 2); assert.ok(s.quests.some(q => q.id === completedId));
    assert.equal(s.events.filter(e => e.source === `quest:${completedId}`).length, 1);
    assert.ok(s.definitions.filter(d => d.period !== 'one-off').every(d => d.archived));
    await assert.rejects(command('quest', { title: 'Old client', period: 'daily' }), /one-time quest/);
    assert.equal((await snapshot()).quests.length, 2);
    await command('quest_progress', { id: legacyOneOff, count: 1 });
    assert.ok((await snapshot()).quests.find(q => q.id === legacyOneOff)!.completed_at);
});
test('mixed independent objectives settle once, and retry cannot replay rewards', async () => {
    await user(); const id = randomUUID();
    await command('create_quest', mission({ objectives: [manual(), { title: 'Read', metric: 'minutes', target: 10, activity_kind: 'reading' }, { title: 'Any minutes', metric: 'minutes', target: 10 }] }), id);
    await command('create_quest', mission({ objectives: [manual(), { title: 'Read', metric: 'minutes', target: 10, activity_kind: 'reading' }, { title: 'Any minutes', metric: 'minutes', target: 10 }] }), id);
    let q = (await snapshot()).quests[0]!; assert.equal(q.objectives!.length, 3); assert.equal(q.reward_xp, 100);
    await command('activity', activity()); q = (await snapshot()).quests[0]!;
    assert.equal(q.progress, 2); assert.equal(q.status, 'active');
    const payload = { id: q.id, objective_id: q.objectives![0]!.id, progress: 1 }; const cid = randomUUID();
    await command('set_quest_objective', payload, cid); await command('set_quest_objective', payload, cid);
    const s = await snapshot(); assert.equal(s.quests[0]!.status, 'completed'); assert.equal(s.profile.xp, 110); assert.equal(s.profile.attributes.Discipline, 13);
    assert.equal(s.events.filter(e => e.source === `quest:${q.id}`).length, 1);
    await assert.rejects(command('set_quest_objective', { ...payload, progress: 0 }), /unavailable/);
    await assert.rejects(command('set_quest_objective', { ...payload, progress: 0 }, cid), /reused/);
    const exported = (await db.query<{ s: Snapshot }>('select public.orion_export() s')).rows[0]!.s;
    assert.equal(exported.quests[0]!.objectives!.length, 3);
});
test('filters, pre-acceptance activity and edits affect only active matching progress', async () => {
    await user(); await command('activity', activity());
    await command('create_quest', mission({ objectives: [manual(), { title: 'Read', metric: 'minutes', target: 30, activity_kind: 'reading', attribute: 'Intellect' }] }));
    let q = (await snapshot()).quests[0]!; assert.equal(q.objectives![1]!.progress, 0);
    await command('activity', activity('study', 30)); assert.equal((await snapshot()).quests[0]!.objectives![1]!.progress, 0);
    const aid = randomUUID(); const payload = { ...activity(), id: aid };
    await command('activity', payload); assert.equal((await snapshot()).quests[0]!.objectives![1]!.progress, 10);
    await command('activity', { ...payload, minutes: 20 }); assert.equal((await snapshot()).quests[0]!.objectives![1]!.progress, 20);
    await command('delete_activity', { id: aid }); assert.equal((await snapshot()).quests[0]!.objectives![1]!.progress, 0);
    await command('activity', { ...activity(), occurred_at: '2000-01-01T00:00:00Z' });
    q = (await snapshot()).quests[0]!; assert.equal(q.objectives![1]!.progress, 0);
});
test('ownership, accepted terms, objective validation and legacy bypasses are enforced', async () => {
    const owner = await user(); await command('create_quest', mission()); const q = (await snapshot()).quests[0]!;
    for (const [action, payload] of [['quest_progress', { id: q.id, count: 1 }], ['edit_quest', { id: q.definition_id, title: 'Bypass' }], ['archive_quest', { id: q.definition_id }]] as const) await assert.rejects(command(action, payload), /unavailable|mission commands/);
    await assert.rejects(command('edit_mission', { id: q.id, title: 'Cheat', difficulty: 'hard' }), /fixed/);
    await assert.rejects(command('set_quest_objective', { id: q.id, objective_id: q.objectives![0]!.id, progress: 2 }), /invalid progress/);
    await assert.rejects(db.query('update public.quest_objectives set progress=1'), /permission denied/);
    await user(); assert.equal((await db.query('select * from public.quest_objectives')).rows.length, 0);
    await assert.rejects(command('set_quest_objective', { id: q.id, objective_id: q.objectives![0]!.id, progress: 1 }), /unavailable/);
    await asUser(owner); await command('edit_mission', { id: q.id, title: 'Corrected', description: 'New text' });
    assert.equal((await snapshot()).quests[0]!.description, 'New text');
    for (const objectives of [[], Array.from({ length: 21 }, () => manual()), [{ title: 'Bad', metric: 'workouts', target: 1, activity_kind: 'reading' }], [{ title: 'Bad', metric: 'minutes', target: 1, activity_kind: 'reading', attribute: 'Strength' }], [{ title: 'Bad', metric: 'manual', target: 1.5 }], [{ title: 'Bad', metric: 'checklist', target: 2 }]]) await assert.rejects(command('create_quest', mission({ objectives })));
    assert.equal((await snapshot()).quests.length, 1);
    await command('abandon_quest', { id: q.id }); assert.equal((await snapshot()).quests[0]!.status, 'abandoned'); assert.equal((await snapshot()).profile.xp, 0);
});
test('deadline helper preserves wall time across DST and clamps month ends; custom deadlines use profile timezone', async () => {
    await root();
    const r = await db.query<{ d: string; w: string; m: string }>(`select private.quest_deadline('2026-03-07T17:00Z','America/New_York','daily')::text d, private.quest_deadline('2026-03-07T17:00Z','America/New_York','weekly')::text w, private.quest_deadline('2026-01-31T17:00Z','America/New_York','monthly')::text m`);
    assert.equal(new Date(r.rows[0]!.d).toISOString(), '2026-03-08T16:00:00.000Z');
    assert.equal(new Date(r.rows[0]!.w).toISOString(), '2026-03-14T16:00:00.000Z');
    assert.equal(new Date(r.rows[0]!.m).toISOString(), '2026-02-28T17:00:00.000Z');
    await user(); await command('profile', { display_name: 'Ari', timezone: 'Asia/Kolkata', units: 'metric', domains: [] });
    await command('create_quest', mission({ timeline: 'custom', due_local: '2099-01-01T12:00' }));
    assert.equal(new Date((await snapshot()).quests[0]!.ends_at!).toISOString(), '2099-01-01T06:30:00.000Z');
    assert.equal((await snapshot()).quests[0]!.reward_xp, 25);
    await assert.rejects(command('create_quest', mission({ timeline: 'custom', due_local: '2000-01-01T00:00' })), /future/);
});
test('expiry is exclusive, settles eligible automatic progress first, and cron applies no penalty', async () => {
    const owner = await user();
    await command('create_quest', mission({ objectives: [{ title: 'Read', metric: 'minutes', target: 10 }] }));
    const q = (await snapshot()).quests[0]!;
    await root();
    await db.query("update public.quest_instances set starts_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()-interval '1 minute',due_at=clock_timestamp()-interval '1 minute' where id=$1", [q.id]);
    // Both occurrence and recording must be inside the accepted interval.
    await db.query(`insert into public.activities(id,user_id,kind,title,attribute,minutes,occurred_at,recorded_at) select gen_random_uuid(),user_id,'reading','At boundary','Intellect',10,ends_at,ends_at from public.quest_instances where id=$1`, [q.id]);
    await db.exec('select public.orion_expire_bosses()'); await asUser(owner);
    assert.equal((await snapshot()).quests[0]!.status, 'expired'); assert.equal((await snapshot()).profile.xp, 0);
    await assert.rejects(command('set_quest_objective', { id: q.id, objective_id: q.objectives![0]!.id, progress: 1 }), /unavailable/);
    // A final eligible activity can settle on cron even when no client was open.
    await command('create_quest', mission({ objectives: [{ title: 'Read', metric: 'minutes', target: 10 }] }));
    const fresh = (await snapshot()).quests.find(i => i.status === 'active')!;
    await root(); await db.query("update public.quest_instances set starts_at=clock_timestamp()-interval '1 hour',ends_at=clock_timestamp()-interval '1 minute',due_at=clock_timestamp()-interval '1 minute' where id=$1", [fresh.id]);
    await db.query(`insert into public.activities(id,user_id,kind,title,attribute,minutes,occurred_at,recorded_at) select gen_random_uuid(),user_id,'reading','Eligible','Intellect',10,starts_at+interval '1 minute',starts_at+interval '1 minute' from public.quest_instances where id=$1`, [fresh.id]);
    await db.exec('select public.orion_expire_bosses()'); await asUser(owner);
    assert.equal((await snapshot()).quests.find(i => i.id === fresh.id)!.status, 'completed'); assert.equal((await snapshot()).profile.xp, 100);
});
test('existing one-off quests, todos and bosses remain compatible after migration', async () => {
    await user(); await command('todo', { title: 'Groceries' }); let s = await snapshot();
    await command('set_todo_completed', { id: s.quests[0]!.id, completed: true }); assert.equal((await snapshot()).profile.xp, 25);
    await command('accept_boss', { id: 'first-gate' }); s = await snapshot(); assert.equal(s.bosses[0]!.status, 'active');
});

test('all timeline difficulties retain their displayed frozen rewards', async () => {
    for (const [timeline, rewards] of [['daily', [[15, 1], [25, 1], [50, 2]]], ['weekly', [[50, 2], [100, 3], [200, 6]]], ['monthly', [[150, 4], [300, 8], [600, 16]]]] as const) {
        for (const [index, difficulty] of ['easy', 'medium', 'hard'].entries()) {
            await user(); await command('create_quest', mission({ timeline, difficulty }));
            const q = (await snapshot()).quests[0]!;
            assert.equal(q.reward_xp, rewards[index]![0]); assert.equal(q.reward_points, rewards[index]![1]);
            await command('set_quest_objective', { id: q.id, objective_id: q.objectives![0]!.id, progress: 1 });
            assert.equal((await snapshot()).profile.xp, rewards[index]![0]);
        }
    }
});
test('all automatic metrics count new matching activity and manual counts support correction', async () => {
    for (const metric of ['minutes', 'workouts', 'metres', 'habits', 'recovery']) {
        await user(); await command('create_quest', mission({ objectives: [{ title: 'Track', metric, target: 1 }, { title: 'Count', metric: 'manual', target: 3 }] }));
        const q = (await snapshot()).quests[0]!;
        const count = q.objectives![1]!;
        await command('set_quest_objective', { id: q.id, objective_id: count.id, progress: 2 });
        await command('set_quest_objective', { id: q.id, objective_id: count.id, progress: 0 });
        assert.equal((await snapshot()).quests[0]!.objectives![1]!.progress, 0);
        if (metric === 'recovery') await command('recovery', { target: 'Water: 2 litres' });
        else if (metric === 'habits') {
            await command('habit', { name: 'Read' }); const h = (await snapshot()).habits[0]!; await command('complete_habit', { id: h.id });
        } else await command('activity', activity(metric === 'minutes' ? 'reading' : 'running'));
        assert.equal((await snapshot()).quests[0]!.objectives![0]!.progress, 1);
        await command('set_quest_objective', { id: q.id, objective_id: count.id, progress: 3 });
        assert.equal((await snapshot()).quests[0]!.status, 'completed');
    }
});


test('monthly 20 km running quest completes on the final cumulative run and rewards exactly once', async () => {
    await user();
    await command('activity', { ...activity('running', 30), metres: 20000 });
    await command('create_quest', mission({ title: 'Run 20 km this month', timeline: 'monthly', attribute: 'Endurance', objectives: [{ title: 'Run 20 km', metric: 'metres', target: 20000, activity_kind: 'running', attribute: 'Endurance' }] }));
    let before = await snapshot(); const questId = before.quests[0]!.id;
    assert.equal(before.quests[0]!.objectives![0]!.progress, 0, 'a run before acceptance must not count');
    for (const metres of [5000, 7500]) {
        await command('activity', { ...activity('running', 30), metres });
    }
    before = await snapshot();
    assert.equal(before.quests[0]!.objectives![0]!.progress, 12500);
    assert.equal(before.quests[0]!.status, 'active');
    const payload = { ...activity('running', 30), metres: 7500 }; const cid = randomUUID();
    await command('activity', payload, cid);
    const after = await snapshot(); const quest = after.quests.find(q => q.id === questId)!;
    assert.equal(quest.objectives![0]!.progress, 20000);
    assert.equal(quest.status, 'completed'); assert.ok(quest.completed_at);
    assert.equal(after.profile.xp - before.profile.xp, 30 + quest.reward_xp);
    assert.equal(after.profile.attributes.Endurance - before.profile.attributes.Endurance, 1 + quest.reward_points);
    assert.equal(after.events.filter(e => e.source === `quest:${questId}`).length, 1);
    const presentation = feedbackForUpdate(before, after, { command: { id: cid, action: 'activity', payload } })!;
    assert.equal(presentation.mode, 'milestone');
    assert.ok(presentation.items.some(item => item.title === 'Quest complete: Run 20 km this month' && item.sound === 'questComplete' && item.milestone));
    await command('activity', payload, cid);
    const replay = await snapshot();
    assert.equal(replay.profile.xp, after.profile.xp);
    assert.equal(feedbackForUpdate(after, replay, { command: { id: cid, action: 'activity', payload } }), null);
});
