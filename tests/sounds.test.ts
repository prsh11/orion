import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundsForUpdate } from '../src/orion/sounds';
import type { Snapshot } from '../src/orion/types';

function snapshot(xp = 0): Snapshot {
    return {
        profile: { id: 'player', display_name: 'Player', timezone: 'UTC', units: 'metric', onboarded: true, imported: false, domains: [], xp, attributes: { Strength: 10, Endurance: 10, Vitality: 10, Intellect: 10, Discipline: 10, Connection: 10 } },
        activities: [], sets: [], exercises: [], habits: [], quests: [], definitions: [], bosses: [], templates: [], events: [], server_time: new Date().toISOString(),
    };
}
test('confirmed reward types select distinct cues; simultaneous level rewards also play', () => {
    for (const [source, xp, expected] of [
        ['activity:1', 30, 'success'], ['habit:1', 5, 'habitDone'], ['recovery:1', 10, 'counterUp'],
        ['quest:1', 25, 'questComplete'], ['boss:1', 250, 'bossVictory'], ['boss:1', -75, 'bossFailure'],
    ] as const) {
        const before = snapshot(100000);
        const after = snapshot(100000 + xp);
        after.events = [{ id: 'new', source, xp, attributes: {}, created_at: after.server_time }];
        assert.deepEqual(soundsForUpdate(before, after), [expected]);
    }
    const before = snapshot(90); const after = snapshot(120);
    after.events = [{ id: 'new', source: 'activity:1', xp: 30, attributes: {}, created_at: after.server_time }];
    assert.deepEqual(soundsForUpdate(before, after), ['success', 'levelUp']);
});
test('initial loads, retries, non-reward saves and corrections are silent', () => {
    const before = snapshot(); const after = snapshot();
    assert.deepEqual(soundsForUpdate(null, after), []);
    assert.deepEqual(soundsForUpdate(before, after, true), []);
    after.events = [{ id: 'new', source: 'correction:1', xp: -30, attributes: {}, created_at: after.server_time }];
    assert.deepEqual(soundsForUpdate(before, after), []);
    assert.deepEqual(soundsForUpdate(after, after, true), []);
    after.events = [{ id: 'record', source: 'activity:1', xp: 0, attributes: {}, created_at: after.server_time }];
    assert.deepEqual(soundsForUpdate(before, after, true), ['achievement']);
});

test('every simultaneous completion is retained, including repeated quest cues', () => {
    const before = snapshot(90); const after = snapshot(500);
    after.events = ['activity:1', 'habit:1', 'recovery:1', 'quest:1', 'quest:2', 'boss:1'].map((source, i) => ({ id: String(i), source, xp: 10, attributes: {}, created_at: after.server_time }));
    assert.deepEqual(soundsForUpdate(before, after, true), ['success', 'habitDone', 'counterUp', 'questComplete', 'questComplete', 'bossVictory', 'achievement', 'levelUp']);
    assert.deepEqual(soundsForUpdate(after, after, true), []);
});

test('a completed activity below the XP threshold still plays its completion cue', () => {
    const before = snapshot(); const after = snapshot();
    after.activities = [{ id: 'new', kind: 'reading', title: 'Read', minutes: 5, metres: 0, notes: '', attribute: 'Intellect', occurred_at: after.server_time, recorded_at: after.server_time, daily_key: null, base_xp: 0, base_points: 0 }];
    after.events = [{ id: 'new-event', source: 'activity:1', xp: 0, attributes: {}, created_at: after.server_time }];
    assert.deepEqual(soundsForUpdate(before, after), ['success']);
});
