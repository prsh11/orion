import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Run only against an isolated, migrated local Supabase database. Separate
// connections are required to test PostgreSQL row-lock contention honestly.
test('PostgreSQL: concurrent commands and expiry apply rewards once', { skip: !process.env.ORION_TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.ORION_TEST_DATABASE_URL, max: 4 });
    const user = randomUUID();
    const id = randomUUID();
    let payload = '';
    try {
        await pool.query('insert into auth.users(id) values($1)', [user]);
        await pool.query('insert into public.profiles(id) values($1)', [user]);
        const setup = await pool.connect();
        try {
            await setup.query('begin'); await setup.query("select set_config('request.jwt.claim.sub',$1,true)", [user]); await setup.query('set local role authenticated');
            await setup.query('select public.orion_command($1,$2,$3::jsonb)', [randomUUID(), 'create_quest', JSON.stringify({ title: 'Concurrent quest', timeline: 'daily', attribute: 'Intellect', objectives: [{ title: 'Read', metric: 'minutes', target: 30 }] })]);
            await setup.query('commit');
        } finally { setup.release(); }
        payload = JSON.stringify({ kind: 'reading', title: 'Concurrent read', minutes: 30, occurred_at: new Date().toISOString() });
        const run = async () => {
            const c = await pool.connect();
            try {
                await c.query('begin');
                await c.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
                await c.query('set local role authenticated');
                await c.query('select public.orion_command($1,$2,$3::jsonb)', [id, 'activity', payload]);
                await c.query('commit');
            } catch (error) { await c.query('rollback'); throw error; }
            finally { c.release(); }
        };
        await Promise.all([run(), run(), run()]);
        assert.equal((await pool.query('select xp from public.profiles where id=$1', [user])).rows[0].xp, 55);
        assert.equal((await pool.query("select count(*)::int n from public.progression_events where user_id=$1 and source like 'quest:%'", [user])).rows[0].n, 1);
        await pool.query(`insert into public.boss_attempts(user_id,template_id,title,hours,attributes,objectives,accepted_at,deadline,period_start)
          select $1,id,title,hours,attributes,objectives,now()-interval '2 days',now()-interval '1 day',now()-interval '2 days' from public.boss_templates where id='first-gate'`, [user]);
        await Promise.all([pool.query('select public.orion_expire_bosses()'), pool.query('select public.orion_expire_bosses()'), run()]);
        assert.equal((await pool.query('select xp from public.profiles where id=$1', [user])).rows[0].xp, 0);
        assert.equal((await pool.query("select count(*)::int n from public.progression_events where user_id=$1 and source like 'boss:%'", [user])).rows[0].n, 1);
    } finally {
        await pool.query('delete from auth.users where id=$1', [user]);
        await pool.end();
    }
});

test('PostgreSQL: concurrent objective completion and expiry settle exactly once', { skip: !process.env.ORION_TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.ORION_TEST_DATABASE_URL, max: 4 });
    const user = randomUUID();
    const run = async (id: string, action: string, payload: Record<string, unknown>) => {
        const connection = await pool.connect();
        try {
            await connection.query('begin');
            await connection.query("select set_config('request.jwt.claim.sub',$1,true)", [user]);
            await connection.query('set local role authenticated');
            await connection.query('select public.orion_command($1,$2,$3::jsonb)', [id, action, JSON.stringify(payload)]);
            await connection.query('commit');
        } catch (error) { await connection.query('rollback'); throw error; }
        finally { connection.release(); }
    };
    try {
        await pool.query('insert into auth.users(id) values($1)', [user]);
        await run(randomUUID(), 'create_quest', { title: 'Concurrent achievement', timeline: 'weekly', attribute: 'Intellect', objectives: [{ title: 'Finish', metric: 'checklist', target: 1 }] });
        const quest = (await pool.query('select id from public.quest_instances where user_id=$1', [user])).rows[0];
        const objective = (await pool.query('select id from public.quest_objectives where quest_id=$1', [quest.id])).rows[0];
        const results = await Promise.allSettled([run(randomUUID(), 'set_quest_objective', { id: quest.id, objective_id: objective.id, progress: 1 }), run(randomUUID(), 'set_quest_objective', { id: quest.id, objective_id: objective.id, progress: 1 }), pool.query('select public.orion_expire_bosses()')]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 2);
        assert.equal((await pool.query('select xp from public.profiles where id=$1', [user])).rows[0].xp, 100);
        assert.equal((await pool.query('select count(*)::int n from public.progression_events where user_id=$1', [user])).rows[0].n, 1);
    } finally { await pool.query('delete from auth.users where id=$1', [user]); await pool.end(); }
});

test('PostgreSQL: concurrent todo completion and undo apply each outcome once', { skip: !process.env.ORION_TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.ORION_TEST_DATABASE_URL, max: 4 });
    const user = randomUUID();
    const run = async (id: string, action: string, payload: Record<string, unknown>) => {
        const c = await pool.connect();
        try {
            await c.query('begin'); await c.query("select set_config('request.jwt.claim.sub',$1,true)", [user]); await c.query('set local role authenticated');
            await c.query('select public.orion_command($1,$2,$3::jsonb)', [id, action, JSON.stringify(payload)]); await c.query('commit');
        } catch (error) { await c.query('rollback'); throw error; }
        finally { c.release(); }
    };
    try {
        await pool.query('insert into auth.users(id) values($1)', [user]);
        await run(randomUUID(), 'todo', { title: 'Concurrent groceries', attribute: 'Discipline' });
        const q = (await pool.query("select id from public.quest_instances where user_id=$1 and kind='todo'", [user])).rows[0];
        await pool.query("update public.quest_instances set due_at=clock_timestamp()-interval '1 second' where id=$1", [q.id]);
        await Promise.all([run(randomUUID(), 'set_todo_completed', { id: q.id, completed: true }), run(randomUUID(), 'set_todo_completed', { id: q.id, completed: true })]);
        assert.equal((await pool.query('select xp from public.profiles where id=$1', [user])).rows[0].xp, 18);
        const undoId = randomUUID();
        await Promise.all([run(undoId, 'set_todo_completed', { id: q.id, completed: false }), run(undoId, 'set_todo_completed', { id: q.id, completed: false })]);
        const p = (await pool.query('select xp,attributes from public.profiles where id=$1', [user])).rows[0];
        assert.equal(p.xp, 0); assert.equal(p.attributes.Discipline, 10);
        assert.equal((await pool.query('select count(*)::int n from public.progression_events where user_id=$1', [user])).rows[0].n, 2);
    } finally { await pool.query('delete from auth.users where id=$1', [user]); await pool.end(); }
});


test('PostgreSQL: concurrent equal gym PRs grant one bonus and retries keep the original result', { skip: !process.env.ORION_TEST_DATABASE_URL }, async () => {
    const pool = new pg.Pool({ connectionString: process.env.ORION_TEST_DATABASE_URL, max: 4 });
    const user = randomUUID(); const exercise_id = '00000000-0000-0000-0000-000000000001';
    const payload = (kg: number) => ({ id: randomUUID(), kind: 'gym', title: 'Concurrent lift', minutes: 0, occurred_at: new Date().toISOString(), sets: [{ exercise_id, reps: 10, kg }] });
    const run = async (id: string, content: ReturnType<typeof payload>) => {
        const connection = await pool.connect();
        try {
            await connection.query('begin'); await connection.query("select set_config('request.jwt.claim.sub',$1,true)", [user]); await connection.query('set local role authenticated');
            const result = await connection.query<{ r: { personal_record: boolean } }>("select public.orion_command($1,'activity',$2::jsonb) r", [id, JSON.stringify(content)]);
            await connection.query('commit'); return result.rows[0]!.r;
        } catch (error) { await connection.query('rollback'); throw error; }
        finally { connection.release(); }
    };
    try {
        await pool.query('insert into auth.users(id) values($1)', [user]);
        await run(randomUUID(), payload(20));
        const id = randomUUID(); const lift = payload(21);
        const results = await Promise.all([run(id, lift), run(randomUUID(), payload(21))]);
        assert.equal(results.filter(r => r.personal_record).length, 1);
        assert.deepEqual(await run(id, lift), results[0]);
        assert.equal((await pool.query('select xp from public.profiles where id=$1', [user])).rows[0].xp, 40);
    } finally { await pool.query('delete from auth.users where id=$1', [user]); await pool.end(); }
});
