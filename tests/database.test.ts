import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';

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
});
after(async () => { await db.close(); });
async function asUser(user: string) { await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]); await db.exec('set role authenticated'); }
async function root() { await db.exec('reset role'); }
async function command(action: string, payload: Record<string, unknown>, id = randomUUID()) {
    const r = await db.query<{ result: { personal_record?: boolean } }>('select public.orion_command($1,$2,$3::jsonb) result', [id, action, JSON.stringify(payload)]);
    return r.rows[0]?.result;
}
async function snapshot() { return (await db.query<{ result: { profile: { xp: number; attributes: Record<string, number> }; quests: { id: string; completed_at: string | null; starts_at: string; ends_at: string }[]; activities: { id: string }[]; bosses: { id: string; status: string }[]; events: { source: string }[] } }>('select public.orion_snapshot() result')).rows[0]!.result; }
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
