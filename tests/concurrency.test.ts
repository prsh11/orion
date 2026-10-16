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
    const payload = JSON.stringify({ kind: 'reading', title: 'Concurrent read', minutes: 30, occurred_at: new Date(Date.now() - 1000).toISOString() });
    try {
        await pool.query('insert into auth.users(id) values($1)', [user]);
        await pool.query('insert into public.profiles(id) values($1)', [user]);
        await pool.query(`insert into public.quest_definitions(user_id,title,period,metric,target,attribute) values($1,'Concurrent quest','daily','minutes',30,'Intellect')`, [user]);
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

test('PostgreSQL: concurrent late task completion awards and penalizes exactly once', { skip: !process.env.ORION_TEST_DATABASE_URL }, async () => {
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
        await run(randomUUID(), 'quest', { title: 'Concurrent task', period: 'one-off', metric: 'manual', target: 1, attribute: 'Intellect' });
        const quest = (await pool.query('select id from public.quest_instances where user_id=$1', [user])).rows[0];
        await pool.query("update public.quest_instances set due_at=clock_timestamp()-interval '1 second' where id=$1", [quest.id]);
        const results = await Promise.allSettled([run(randomUUID(), 'quest_progress', { id: quest.id, count: 1 }), run(randomUUID(), 'quest_progress', { id: quest.id, count: 1 })]);
        assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
        assert.equal((await pool.query('select xp from public.profiles where id=$1', [user])).rows[0].xp, 18);
        assert.equal((await pool.query('select count(*)::int n from public.progression_events where user_id=$1', [user])).rows[0].n, 2);
    } finally { await pool.query('delete from auth.users where id=$1', [user]); await pool.end(); }
});
