import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import type { Snapshot } from '../src/orion/types';

// Real PostgreSQL WASM engine: runs the production migration, not a JS reducer model.
const db = new PGlite();
const A = '10000000-0000-0000-0000-000000000001';
const B = '10000000-0000-0000-0000-000000000002';
before(async () => {
    await db.exec(`create role anon; create role authenticated; create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
      insert into auth.users values ('${A}'),('${B}');`);
    await db.exec(await readFile('supabase/migrations/202610150001_orion.sql', 'utf8'));
    const legacyUser = randomUUID(); await db.query('insert into auth.users values($1)', [legacyUser]);
    await asUser(legacyUser); await snapshot(); await command('quest', { title: 'Existing quest', period: 'daily', metric: 'manual', target: 1, attribute: 'Intellect' });
    const legacyQuest = (await snapshot()).quests[0]!;
    await command('quest_progress', { id: legacyQuest.id, count: 1 });
    const beforeMigration = await snapshot(); await root();
    await db.exec(await readFile('supabase/migrations/202610160001_tasks.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/202610160002_daily_toggles.sql', 'utf8'));
    await db.exec(await readFile('supabase/migrations/202610160003_todos.sql', 'utf8'));
    await asUser(legacyUser); const migrated = await snapshot();
    assert.deepEqual(migrated.profile, beforeMigration.profile);
    assert.deepEqual(migrated.events, beforeMigration.events);
    for (const [key, value] of Object.entries(beforeMigration.quests[0]!)) assert.deepEqual(migrated.quests[0]![key as keyof Snapshot['quests'][number]], value);
    assert.equal(migrated.quests[0]!.difficulty, 'medium'); assert.equal(migrated.quests[0]!.reward_xp, 25); assert.equal(migrated.quests[0]!.penalty_xp, 0);
    await root(); await db.query('delete from auth.users where id=$1', [legacyUser]);
});
after(async () => { await db.close(); });
async function asUser(user: string) { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec('set role authenticated'); }
async function root() { await db.exec('reset role'); }
async function command(action: string, payload: Record<string, unknown>, id = randomUUID()) {
    const r = await db.query<{ result: { personal_record?: boolean } }>('select public.orion_command($1,$2,$3::jsonb) result', [id, action, JSON.stringify(payload)]);
    return r.rows[0]?.result;
}
async function snapshot() { return (await db.query<{ result: Snapshot }>('select public.orion_snapshot() result')).rows[0]!.result; }
const entry = (minutes = 30) => ({ kind: 'reading', title: 'Read', minutes, occurred_at: new Date(Date.now() - 1000).toISOString(), notes: '' });

test('account isolation, anonymous rejection, no direct progression writes', async () => {
    await asUser(A); await snapshot(); await command('activity', entry());
    await asUser(B); assert.equal((await snapshot()).profile.xp, 0);
    assert.equal((await db.query('select * from public.activities')).rows.length, 0);
    await assert.rejects(db.query('update public.profiles set xp=100000'), /permission denied/);
    await assert.rejects(db.query(`insert into public.activities(id,user_id,kind,title,attribute,occurred_at) values(gen_random_uuid(),'${B}','reading','fake','Intellect',now())`), /permission denied/);
    await assert.rejects(db.query('select private.reward($1,$2,100,$3::jsonb)', [B, 'fake', '{}']), /permission denied/);
    await root(); await db.exec('set role anon'); await assert.rejects(db.query('select public.orion_snapshot()'), /permission denied/); await root();
});
test('duplicate commands award once; corrections reconcile; rollback is atomic', async () => {
    await asUser(B); const id = randomUUID(); const activityId = randomUUID(); const payload = { ...entry(60), id: activityId };
    await Promise.all([command('activity', payload, id), command('activity', payload, id)]);
    assert.equal((await snapshot()).profile.xp, 60);
    await assert.rejects(command('activity', { ...payload, minutes: 90 }, id), /reused/);
    await command('activity', { ...payload, minutes: 10 });
    let s = await snapshot(); assert.equal(s.profile.xp, 10); assert.equal(s.profile.attributes.Intellect, 10);
    await assert.rejects(command('activity', { ...entry(60), kind: 'gym', sets: [{ exercise_id: randomUUID(), reps: 10, kg: 20 }] }), /unavailable/);
    assert.equal((await snapshot()).profile.xp, 10);
    await command('delete_activity', { id: activityId }); s = await snapshot(); assert.equal(s.profile.xp, 0);
});
test('daily completion rewards cannot be replayed with another command ID', async () => {
    await asUser(B); await command('recovery', { target: 'Sleep: 8 hours' }); await command('recovery', { target: 'Sleep: 8 hours' });
    assert.equal((await snapshot()).profile.xp, 10);
});
test('period boundaries handle Monday starts, month ends, and DST', async () => {
    await root();
    const r = await db.query<{ s: string }>(`select private.period_start('2026-03-09T12:00Z','America/New_York','weekly')::text s`);
    assert.equal(new Date(r.rows[0]!.s).toISOString(), '2026-03-09T04:00:00.000Z');
    const m = await db.query<{ s: string }>(`select private.period_start('2026-03-31T12:00Z','Asia/Kolkata','monthly')::text s`);
    assert.equal(new Date(m.rows[0]!.s).toISOString(), '2026-02-28T18:30:00.000Z');
});
test('quests award once, editing definitions and activity does not reopen settled results', async () => {
    await asUser(A); await command('quest', { title: 'Read daily', period: 'daily', metric: 'minutes', target: 30, attribute: 'Intellect' });
    const initial = await snapshot(); const q = initial.quests[0]!; assert.ok(q.completed_at);
    const xp = initial.profile.xp;
    await snapshot(); assert.equal((await snapshot()).profile.xp, xp);
    const defs = await db.query<{ id: string }>('select id from public.quest_definitions');
    await command('edit_quest', { id: defs.rows[0]!.id, title: 'Future', metric: 'minutes', target: 1, attribute: 'Intellect' });
    await command('delete_activity', { id: initial.activities[0]!.id });
    assert.equal((await snapshot()).quests[0]!.completed_at, q.completed_at);
    assert.equal((await snapshot()).profile.xp, xp - 30);
});
test('boss victory is immediate, retry settlement awards exactly once', async () => {
    await asUser(A); await command('accept_boss', { id: 'first-gate' });
    await new Promise(resolve => setTimeout(resolve, 5));
    const before = (await snapshot()).profile.xp;
    await command('activity', { ...entry(60), kind: 'cardio', occurred_at: new Date().toISOString() });
    const s = await snapshot(); assert.equal(s.bosses[0]!.status, 'victory'); assert.equal(s.profile.xp, before + 60 + 250);
    await Promise.all([snapshot(), snapshot()]); assert.equal((await snapshot()).profile.xp, s.profile.xp);
});
test('boss deadline is exclusive, overdue failure floors values, cooldown applies', async () => {
    await asUser(B); await command('accept_boss', { id: 'first-gate' });
    const boss = (await snapshot()).bosses[0]!;
    await root();
    await db.query(`update public.boss_attempts set accepted_at=clock_timestamp()-interval '2 hours',deadline=clock_timestamp()-interval '1 hour' where id=$1`, [boss.id]);
    const b = (await db.query<{ deadline: string }>('select deadline::text from public.boss_attempts where id=$1', [boss.id])).rows[0]!;
    await db.query(`insert into public.activities(id,user_id,kind,title,attribute,minutes,occurred_at,recorded_at) values(gen_random_uuid(),$1,'cardio','Too late','Endurance',60,$2,$2)`, [B, b.deadline]);
    await db.query(`update public.profiles set attributes='{"Strength":1,"Endurance":10,"Vitality":10,"Intellect":10,"Discipline":1,"Connection":10}' where id=$1`, [B]);
    await Promise.all([db.query('select public.orion_expire_bosses()'), db.query('select public.orion_expire_bosses()')]);
    await asUser(B); const s = await snapshot(); assert.equal(s.bosses[0]!.status, 'failure'); assert.equal(s.profile.xp, 0); assert.equal(s.profile.attributes.Strength, 1); assert.equal(s.profile.attributes.Discipline, 1);
    await assert.rejects(command('accept_boss', { id: 'long-horizon' }), /cooldown/);
    assert.equal(s.events.filter(e => e.source === 'boss:' + boss.id).length, 1);
});
test('completed-set personal records and private exercises are isolated', async () => {
    await asUser(A);
    const payload = { ...entry(30), kind: 'gym', sets: [{ exercise_id: '00000000-0000-0000-0000-000000000001', reps: 10, kg: 20 }] };
    assert.equal((await command('activity', payload))?.personal_record, true);
    assert.equal((await command('activity', payload))?.personal_record, false);
    const edited = randomUUID();
    await command('activity', { ...payload, id: edited, sets: [{ ...payload.sets[0], kg: 30 }] });
    assert.equal((await command('activity', { ...payload, id: edited, sets: [{ ...payload.sets[0], kg: 25 }] }))?.personal_record, false);
    await command('exercise', { name: 'My private lift', bodyweight: false });
    await asUser(B); assert.equal((await db.query("select * from public.exercises where name='My private lift'")).rows.length, 0);
});
test('one-time legacy import preserves XP and raw history without replaying rewards', async () => {
    await asUser(B); const before = (await snapshot()).profile.xp;
    await command('quest', { title: 'No replay', period: 'daily', metric: 'minutes', target: 45, attribute: 'Strength' });
    const save = { player: { xp: 300 }, workouts: [{ type: 'strength', duration: 45, date: new Date().toISOString(), notes: 'Old' }], habits: [{ name: 'Read' }], achievements: ['first_workout'] };
    await command('import', { save }); const s = await snapshot(); assert.equal(s.profile.xp, before + 300);
    await assert.rejects(command('import', { save }), /already imported/);
    const result = await db.query<{ result: { legacy: unknown } }>('select public.orion_export() result');
    assert.deepEqual(result.rows[0]!.result.legacy, save);
    assert.equal((await db.query('select * from public.workout_sets')).rows.length, 0);
    const imported = (await db.query<{ id: string }>("select id from public.activities where recorded_at<='2000-01-01'")).rows[0]!;
    await command('activity', { ...entry(90), kind: 'gym', id: imported.id, sets: [] });
    assert.equal((await snapshot()).profile.xp, before + 300);
});
for (const [boundary, offset, expected] of [['before', "- interval '1 microsecond'", 'victory'], ['at', '', 'failure'], ['after', "+ interval '1 microsecond'", 'failure']] as const) {
    test(`boss activity recorded ${boundary} deadline; cron resolves without an open app`, async () => {
        await root(); const user = randomUUID(); await db.query('insert into auth.users values($1)', [user]);
        await asUser(user); await snapshot(); await command('accept_boss', { id: 'first-gate' });
        await root();
        await db.query(`update public.boss_attempts set accepted_at=clock_timestamp()-interval '2 hours',deadline=clock_timestamp()-interval '1 hour' where user_id=$1`, [user]);
        await db.query(`insert into public.activities(id,user_id,kind,title,attribute,minutes,occurred_at,recorded_at) select gen_random_uuid(),user_id,'cardio','Boundary','Endurance',60,deadline ${offset},deadline ${offset} from public.boss_attempts where user_id=$1`, [user]);
        await db.query('select public.orion_expire_bosses()'); await asUser(user);
        assert.equal((await snapshot()).bosses[0]!.status, expected);
    });
}
test('seven-day victory and failure apply the exact two-attribute rewards and penalties', async () => {
    for (const won of [true, false]) {
        await root(); const user = randomUUID(); await db.query('insert into auth.users values($1)', [user]);
        await asUser(user); await snapshot(); await command('accept_boss', { id: 'long-horizon' });
        await root();
        await db.query(`update public.profiles set xp=500,attributes=jsonb_set(jsonb_set(attributes,'{Endurance}','20'),'{Vitality}','20') where id=$1`, [user]);
        await db.query(`update public.boss_attempts set accepted_at=clock_timestamp()-interval '8 days',deadline=clock_timestamp()-interval '1 day' where user_id=$1`, [user]);
        if (won) {
            await db.query(`insert into public.activities(id,user_id,kind,title,attribute,minutes,metres,occurred_at,recorded_at) values(gen_random_uuid(),$1,'running','Run','Endurance',60,10000,now()-interval '2 days',now()-interval '2 days')`, [user]);
            for (let i = 2; i <= 6; i++) await db.query(`insert into public.activities(id,user_id,kind,title,attribute,occurred_at,recorded_at) values(gen_random_uuid(),$1,'recovery','Sleep','Vitality',now()-make_interval(days=>$2),now()-make_interval(days=>$2))`, [user, i]);
        }
        await db.query('select public.orion_expire_bosses()'); await asUser(user); const s = await snapshot();
        assert.equal(s.profile.xp, won ? 1500 : 250); assert.equal(s.profile.attributes.Endurance, won ? 35 : 15); assert.equal(s.profile.attributes.Vitality, won ? 35 : 15);
    }
});
test('invalid legacy import rolls back and account deletion cascades private records', async () => {
    await root(); const user = randomUUID(); await db.query('insert into auth.users values($1)', [user]); await asUser(user); await snapshot();
    await assert.rejects(command('import', { save: { player: { xp: 99 }, workouts: [], habits: [], achievements: [{}] } }), /Invalid legacy/);
    assert.equal((await snapshot()).profile.xp, 0);
    await command('habit', { name: 'Read' });
    await command('activity', entry());
    await command('quest', { title: 'Read', period: 'weekly', target: 60, metric: 'minutes', attribute: 'Intellect' });
    await command('exercise', { name: 'Private', bodyweight: true });
    await command('delete_account', { confirmation: 'DELETE' });
    await root();
    for (const table of ['profiles', 'activities', 'habits', 'quest_definitions', 'quest_instances', 'progression_events', 'commands', 'exercises']) {
        assert.equal((await db.query(`select * from public.${table} where ${table === 'profiles' ? 'id' : 'user_id'}=$1`, [user])).rows.length, 0);
    }
});

async function taskUser() {
    await root(); const user = randomUUID(); await db.query('insert into auth.users values($1)', [user]);
    await asUser(user); await snapshot(); return user;
}
const task = (extra: Record<string, unknown> = {}) => ({ title: 'My task', period: 'one-off', difficulty: 'medium', metric: 'manual', target: 1, attribute: 'Intellect', ...extra });
test('all task schedules and difficulties award their exact frozen terms once', async () => {
    for (const [period, rewards] of Object.entries({ 'one-off': [[15, 1], [25, 1], [50, 2]], daily: [[15, 1], [25, 1], [50, 2]], weekly: [[50, 2], [100, 3], [200, 6]], monthly: [[150, 4], [300, 8], [600, 16]] })) {
        for (const [index, difficulty] of ['easy', 'medium', 'hard'].entries()) {
            await taskUser(); await command('quest', task({ period, difficulty, target: 2 }));
            const q = (await snapshot()).quests[0]!;
            await command('quest_progress', { id: q.id, count: 1 }); assert.equal((await snapshot()).profile.xp, 0);
            const id = randomUUID(); await command('quest_progress', { id: q.id, count: 1 }, id);
            await command('quest_progress', { id: q.id, count: 1 }, id);
            await assert.rejects(command('quest_progress', { id: q.id, count: 1 }), /unavailable/);
            const s = await snapshot(); assert.equal(s.profile.xp, rewards[index]![0]); assert.equal(s.profile.attributes.Intellect, 10 + rewards[index]![1]!);
        }
    }
});
test('deadline conversion, late settlement, idempotency, immutable terms and exports', async () => {
    const user = await taskUser();
    await command('profile', { display_name: 'Task player', timezone: 'Asia/Kolkata', units: 'metric', domains: [] });
    await assert.rejects(command('quest', task({ due_local: '2000-01-01T12:00' })), /future/);
    await command('quest', task({ due_local: '2099-01-01T12:00' }));
    const q = (await snapshot()).quests[0]!;
    let row = (await db.query<{ definition_id: string; due_at: string }>('select definition_id,due_at::text from public.quest_instances where id=$1', [q.id])).rows[0]!;
    assert.equal(new Date(row.due_at).toISOString(), '2099-01-01T06:30:00.000Z');
    await command('profile', { display_name: 'Task player', timezone: 'UTC', units: 'metric', domains: [] });
    row = (await db.query<typeof row>('select definition_id,due_at::text from public.quest_instances where id=$1', [q.id])).rows[0]!;
    assert.equal(new Date(row.due_at).toISOString(), '2099-01-01T06:30:00.000Z');
    await assert.rejects(command('edit_quest', { id: row.definition_id, title: 'Changed', target: 100 }), /fixed/);
    await command('edit_quest', { id: row.definition_id, title: 'Corrected title' });
    await root(); await db.query("update public.quest_instances set due_at=clock_timestamp()-interval '1 day' where id=$1", [q.id]);
    await asUser(user); assert.equal((await snapshot()).profile.xp, 0);
    const id = randomUUID(); await command('quest_progress', { id: q.id, count: 1 }, id); await command('quest_progress', { id: q.id, count: 1 }, id);
    const s = await snapshot(); assert.equal(s.profile.xp, 18); assert.equal(s.profile.attributes.Intellect, 10);
    const result = (await db.query<{ result: { quests: { reward_xp: number; penalty_xp: number; penalty_points: number }[] } }>('select public.orion_export() result')).rows[0]!.result;
    assert.equal(result.quests[0]!.reward_xp, 25); assert.equal(result.quests[0]!.penalty_xp, 7); assert.equal(result.quests[0]!.penalty_points, 1);
    await root();
    for (const [offset, expected] of [["- interval '1 microsecond'", 0], ['', 7], ["+ interval '1 microsecond'", 7]] as const) {
        const r = await db.query<{ n: number }>(`select private.quest_late_penalty(25,'2026-01-01Z','2026-01-01Z'::timestamptz ${offset}) n`);
        assert.equal(r.rows[0]!.n, expected);
    }
});
test('undated tasks persist; archived tasks cannot reward; accounts cannot complete each other’s tasks', async () => {
    const user = await taskUser(); await command('quest', task()); const q = (await snapshot()).quests[0]!;
    await root(); await db.query("update public.quest_instances set starts_at=clock_timestamp()-interval '2 years' where id=$1", [q.id]);
    await asUser(user); assert.equal((await snapshot()).quests[0]!.completed_at, null);
    await taskUser(); await assert.rejects(command('quest_progress', { id: q.id, count: 1 }), /unavailable/);
    await asUser(user); const d = (await db.query<{ definition_id: string }>('select definition_id from public.quest_instances where id=$1', [q.id])).rows[0]!;
    await command('archive_quest', { id: d.definition_id });
    await assert.rejects(command('quest_progress', { id: q.id, count: 1 }), /unavailable/); assert.equal((await snapshot()).profile.xp, 0);
});
test('one-off automatic progress excludes earlier occurrence, earlier recording and imported activity', async () => {
    const user = await taskUser(); await command('activity', entry(30));
    await command('quest', task({ metric: 'minutes', target: 30 })); const q = (await snapshot()).quests[0]!;
    assert.equal(q.completed_at, null);
    await command('activity', entry(30)); assert.equal((await snapshot()).quests[0]!.completed_at, null);
    await root();
    await db.query(`insert into public.activities(id,user_id,kind,title,attribute,minutes,occurred_at,recorded_at) values(gen_random_uuid(),$1,'reading','Imported','Intellect',30,clock_timestamp(),'1970-01-01')`, [user]);
    await asUser(user); assert.equal((await snapshot()).quests[0]!.completed_at, null);
    await new Promise(resolve => setTimeout(resolve, 5));
    await command('activity', { ...entry(30), occurred_at: new Date().toISOString() });
    assert.ok((await snapshot()).quests[0]!.completed_at);
});
test('recurring resets retain old instances and edits affect only future terms', async () => {
    for (const period of ['daily', 'weekly', 'monthly']) {
        const user = await taskUser(); await command('quest', task({ period })); const q = (await snapshot()).quests[0]!;
        const d = (await db.query<{ definition_id: string }>('select definition_id from public.quest_instances where id=$1', [q.id])).rows[0]!;
        await command('edit_quest', { id: d.definition_id, title: 'Future hard', metric: 'manual', target: 2, attribute: 'Strength', difficulty: 'hard' });
        await root(); await db.query("update public.quest_definitions set created_at=created_at-interval '2 months' where id=$1", [d.definition_id]);
        await db.query("update public.quest_instances set starts_at=starts_at-interval '3 months',ends_at=ends_at-interval '3 months' where id=$1", [q.id]);
        await asUser(user); const s = await snapshot(); const old = s.quests.find(i => i.id === q.id)!;
        assert.equal(old.completed_at, null); assert.ok(s.quests.length > 1); assert.equal(s.profile.xp, 0);
        const terms = await db.query<{ reward_xp: number; target: number }>('select reward_xp,target from public.quest_instances where id=$1', [q.id]);
        assert.equal(Number(terms.rows[0]!.target), 1);
        await assert.rejects(command('quest_progress', { id: old.id, count: 1 }), /unavailable/);
    }
});

test('every automatic metric completes one-off tasks from new matching activity only', async () => {
    for (const [metric, attribute, kind, target] of [['minutes', 'Intellect', 'reading', 30], ['workouts', 'Endurance', 'cardio', 1], ['metres', 'Endurance', 'running', 1000], ['habits', 'Discipline', 'habit', 1], ['recovery', 'Vitality', 'recovery', 1]] as const) {
        await taskUser(); await command('quest', task({ metric, attribute, target }));
        const q = (await snapshot()).quests[0]!;
        await new Promise(resolve => setTimeout(resolve, 5));
        if (kind === 'recovery') await command('recovery', { target: 'Sleep: 8 hours' });
        else if (kind === 'habit') {
            await command('habit', { name: 'My habit' }); const h = (await db.query<{ id: string }>('select id from public.habits')).rows[0]!;
            await command('complete_habit', { id: h.id });
        } else await command('activity', { kind, title: 'New activity', minutes: 30, metres: 1000, occurred_at: new Date().toISOString() });
        assert.ok((await snapshot()).quests.find(i => i.id === q.id)!.completed_at, metric);
    }
});

test('daily recovery and habit toggles reverse and restore base rewards without duplicates', async () => {
    const user = await taskUser();
    await command('habit', { name: 'Toggle habit' });
    const habit = (await snapshot()).habits[0]!;
    for (const [action, payload, xp, attribute] of [['recovery', { target: 'Water: 2 litres' }, 10, 'Vitality'], ['complete_habit', { id: habit.id }, 5, 'Discipline']] as const) {
        const initial = await snapshot();
        const complete = { ...payload, completed: true }; const undo = { ...payload, completed: false };
        await command(action, complete); await command(action, complete);
        assert.equal((await snapshot()).profile.xp, initial.profile.xp + xp);
        const undoId = randomUUID(); await command(action, undo, undoId); await command(action, undo, undoId); await command(action, undo);
        assert.equal((await snapshot()).profile.xp, initial.profile.xp);
        assert.equal((await snapshot()).profile.attributes[attribute], initial.profile.attributes[attribute]);
        const redoId = randomUUID(); await command(action, complete, redoId); await command(action, complete, redoId);
        assert.equal((await snapshot()).profile.xp, initial.profile.xp + xp);
        await command(action, undo, undoId); // An old retry cannot undo a newer completion.
        assert.equal((await snapshot()).profile.xp, initial.profile.xp + xp);
        await assert.rejects(command(action, { ...payload, completed: 'false' }), /completion state/);
        await taskUser(); await command('recovery', { target: 'Water: 2 litres', completed: false });
        assert.equal((await snapshot()).profile.xp, 0);
        await asUser(user); assert.equal((await snapshot()).profile.xp, initial.profile.xp + xp);
        await command(action, undo);
    }
});
test('unchecking daily activity recalculates open quests and preserves settled rewards', async () => {
    await taskUser();
    await command('quest', task({ metric: 'recovery', attribute: 'Vitality', target: 2 }));
    await command('recovery', { target: 'Water: 2 litres' });
    assert.equal((await snapshot()).quests[0]!.progress, 1);
    await command('recovery', { target: 'Water: 2 litres', completed: false });
    assert.equal((await snapshot()).quests[0]!.progress, 0);
    await command('recovery', { target: 'Water: 2 litres' });
    await command('recovery', { target: 'Sleep: 8 hours' });
    const settled = await snapshot(); assert.ok(settled.quests[0]!.completed_at);
    await command('recovery', { target: 'Water: 2 litres', completed: false });
    const undone = await snapshot(); assert.equal(undone.profile.xp, settled.profile.xp - 10);
    assert.equal(undone.quests[0]!.completed_at, settled.quests[0]!.completed_at);
});

const newTodo = (extra: Record<string, unknown> = {}) => ({ title: 'Get groceries', ...extra });
async function latestTodo() { return (await snapshot()).quests.find(q => q.kind === 'todo')!; }
test('todos default to today and medium, never auto-complete, and all difficulties award optional attributes', async () => {
    for (const [difficulty, xp] of [['easy', 15], ['medium', 25], ['hard', 50]] as const) {
        for (const attribute of [null, 'Discipline']) {
            await taskUser(); await command('todo', newTodo({ difficulty, attribute }));
            const q = await latestTodo(); assert.equal(q.kind, 'todo'); assert.equal(q.attribute, attribute);
            assert.equal(q.reward_xp, xp); assert.equal(q.reward_points, attribute ? 1 : 0); assert.equal(q.completed_at, null);
            assert.equal(q.period, 'one-off'); assert.equal(q.metric, 'manual'); assert.equal(q.target, 1); assert.equal(q.ends_at, null);
            const id = randomUUID(); const payload = { id: q.id, completed: true };
            await command('set_todo_completed', payload, id); await command('set_todo_completed', payload, id); await command('set_todo_completed', payload);
            let s = await snapshot(); assert.equal(s.profile.xp, xp); assert.equal(s.profile.attributes.Discipline, attribute ? 11 : 10);
            await assert.rejects(command('set_todo_completed', { ...payload, completed: false }, id), /reused/);
            await command('set_todo_completed', { id: q.id, completed: false });
            s = await snapshot(); assert.equal(s.profile.xp, 0); assert.equal(s.profile.attributes.Discipline, 10);
            assert.ok((await latestTodo()).completion_history[0]!.undone_at);
            await command('set_todo_completed', payload); await command('set_todo_completed', { id: q.id, completed: false });
            assert.equal((await snapshot()).profile.xp, 0);
        }
    }
    await taskUser(); await command('todo', newTodo()); const q = await latestTodo();
    assert.equal(q.difficulty, 'medium'); assert.equal(q.attribute, null); assert.equal(q.due_at, null); assert.equal(q.planned_on, new Date().toISOString().slice(0, 10));
    await assert.rejects(command('todo', newTodo({ planned_on: 'infinity' })), /planned date/);
    await assert.rejects(command('todo', newTodo({ difficulty: 'extreme' })), /constraint/);
});
test('late todos award reduced XP and an actual attribute loss, undone without attribute-floor exploits', async () => {
    for (const [difficulty, xp, penalty] of [['easy', 15, 4], ['medium', 25, 7], ['hard', 50, 13]] as const) {
        for (const startingPoints of [1, 10]) {
            const user = await taskUser(); await command('todo', newTodo({ difficulty, attribute: 'Discipline', due_local: '2099-01-01T12:00' }));
            const q = await latestTodo(); await root();
            await db.query("update public.quest_instances set due_at=clock_timestamp()-interval '1 day' where id=$1", [q.id]);
            await db.query("update public.profiles set attributes=jsonb_set(attributes,'{Discipline}',to_jsonb($2::integer)) where id=$1", [user, startingPoints]);
            await asUser(user); assert.equal((await snapshot()).profile.xp, 0); // Passing a deadline alone never penalizes.
            await command('set_todo_completed', { id: q.id, completed: true });
            let s = await snapshot(); assert.equal(s.profile.xp, xp - penalty); assert.equal(s.profile.attributes.Discipline, Math.max(1, startingPoints - 1));
            let completed = await latestTodo(); assert.equal(completed.penalty_xp, penalty); assert.equal(completed.penalty_points, 1);
            assert.equal(completed.completion_history[0]!.reward_points, 0); assert.equal(completed.applied_points, startingPoints === 1 ? 0 : -1);
            const undoId = randomUUID(); await command('set_todo_completed', { id: q.id, completed: false }, undoId);
            s = await snapshot(); assert.equal(s.profile.xp, 0); assert.equal(s.profile.attributes.Discipline, startingPoints);
            await command('set_todo_completed', { id: q.id, completed: true });
            await command('set_todo_completed', { id: q.id, completed: false }, undoId);
            completed = await latestTodo(); assert.ok(completed.completed_at); assert.equal(completed.completion_history.length, 2);
        }
    }
    const user = await taskUser(); await command('todo', newTodo()); const q = await latestTodo();
    await root(); await db.query("update public.quest_instances set due_at=clock_timestamp()-interval '1 hour' where id=$1", [q.id]);
    await asUser(user); await command('set_todo_completed', { id: q.id, completed: true });
    assert.equal((await snapshot()).profile.xp, 18); assert.equal((await latestTodo()).penalty_points, 0);
});
test('todo editing, profile timezone conversion, archiving and legacy-command guards', async () => {
    const user = await taskUser();
    await command('profile', { display_name: 'Todo player', timezone: 'Asia/Kolkata', units: 'metric', domains: [] });
    await assert.rejects(command('todo', newTodo({ due_local: '2000-01-01T12:00' })), /future/);
    await command('todo', newTodo({ due_local: '2099-01-01T12:00', planned_on: '2099-01-01' }));
    const q = await latestTodo(); assert.equal(new Date(q.due_at!).toISOString(), '2099-01-01T06:30:00.000Z');
    await command('edit_todo', { id: q.id, title: 'Buy groceries', difficulty: 'hard', attribute: 'Vitality', planned_on: '2098-12-31' });
    const edited = await latestTodo(); assert.equal(edited.reward_xp, 50); assert.equal(edited.attribute, 'Vitality'); assert.equal(edited.planned_on, '2098-12-31'); assert.equal(edited.due_at, q.due_at);
    for (const action of ['quest_progress', 'archive_quest', 'edit_quest']) await assert.rejects(command(action, { id: action === 'quest_progress' ? q.id : q.definition_id, count: 1, title: 'Bypass' }), /todo commands/);
    await command('profile', { display_name: 'Todo player', timezone: 'UTC', units: 'metric', domains: [] }); assert.equal((await latestTodo()).due_at, q.due_at);
    await taskUser(); await assert.rejects(command('set_todo_completed', { id: q.id, completed: true }), /unavailable/);
    await assert.rejects(command('edit_todo', { id: q.id, title: 'Other account' }), /unavailable/);
    await asUser(user); await command('set_todo_completed', { id: q.id, completed: true });
    await assert.rejects(command('edit_todo', { id: q.id, title: 'Changed', difficulty: 'easy' }), /Only title/);
    await command('edit_todo', { id: q.id, title: 'Corrected' });
    await command('set_todo_completed', { id: q.id, completed: false });
    await root(); await db.query("update public.quest_instances set due_at=clock_timestamp()-interval '1 hour' where id=$1", [q.id]);
    await asUser(user); await assert.rejects(command('edit_todo', { id: q.id, title: 'Remove due', due_local: null }), /Only title/);
    await command('edit_todo', { id: q.id, title: 'Overdue correction' });
    await command('archive_todo', { id: q.id }); await assert.rejects(command('set_todo_completed', { id: q.id, completed: true }), /unavailable/);
    const exported = (await db.query<{ result: Snapshot }>('select public.orion_export() result')).rows[0]!.result;
    assert.equal(exported.quests[0]!.completion_history.length, 1); assert.equal(exported.quests[0]!.archived, true);
});

test('todo completion is manual and rechecking after a deadline uses a new recorded outcome', async () => {
    const user = await taskUser(); await command('todo', newTodo({ attribute: 'Vitality', due_local: '2099-01-01T12:00' }));
    const q = await latestTodo(); await command('recovery', { target: 'Water: 2 litres' });
    assert.equal((await latestTodo()).completed_at, null);
    await command('set_todo_completed', { id: q.id, completed: true });
    let completed = await latestTodo(); assert.equal(completed.applied_xp, 25); assert.equal(completed.applied_points, 1);
    await command('set_todo_completed', { id: q.id, completed: false });
    await root(); await db.query("update public.quest_instances set due_at=clock_timestamp()-interval '1 second' where id=$1", [q.id]);
    await asUser(user); await command('set_todo_completed', { id: q.id, completed: true });
    completed = await latestTodo(); assert.equal(completed.applied_xp, 18); assert.equal(completed.applied_points, -1);
    assert.equal(completed.completion_history.length, 2); assert.ok(completed.completion_history[0]!.undone_at);
    assert.equal(completed.completion_history[0]!.reward_points, 1); assert.equal(completed.completion_history[1]!.reward_points, 0);
    assert.equal(completed.completion_history[1]!.penalty_xp, 7);
    await assert.rejects(command('set_todo_completed', { id: q.id, completed: null }), /completion state/);
});
