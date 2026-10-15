import { test } from 'node:test';
import assert from 'node:assert/strict';
import { soundForUpdate } from '../src/orion/sounds';
import type { Snapshot } from '../src/orion/types';

function snapshot(xp = 0): Snapshot {
    return {
        profile: { id: 'player', display_name: 'Player', timezone: 'UTC', units: 'metric', onboarded: true, imported: false, domains: [], xp, attributes: { Strength: 10, Endurance: 10, Vitality: 10, Intellect: 10, Discipline: 10, Connection: 10 } },
        activities: [], sets: [], exercises: [], habits: [], quests: [], definitions: [], bosses: [], templates: [], events: [], server_time: new Date().toISOString(),
    };
}
test('confirmed reward types select distinct cues; simultaneous level rewards take priority', () => {
    for (const [source, xp, expected] of [
        ['activity:1', 30, 'success'], ['habit:1', 5, 'habitDone'], ['recovery:1', 10, 'counterUp'],
        ['quest:1', 25, 'questComplete'], ['boss:1', 250, 'bossVictory'], ['boss:1', -75, 'bossFailure'],
    ] as const) {
        const before = snapshot(100000);
        const after = snapshot(100000 + xp);
        after.events = [{ id: 'new', source, xp, attributes: {}, created_at: after.server_time }];
        assert.equal(soundForUpdate(before, after), expected);
    }
    const before = snapshot(90); const after = snapshot(120);
    after.events = [{ id: 'new', source: 'activity:1', xp: 30, attributes: {}, created_at: after.server_time }];
    assert.equal(soundForUpdate(before, after), 'levelUp');
});
test('initial loads, retries, non-reward saves and corrections are silent', () => {
    const before = snapshot(); const after = snapshot();
    assert.equal(soundForUpdate(null, after), null);
    assert.equal(soundForUpdate(before, after, true), null);
    after.events = [{ id: 'new', source: 'correction:1', xp: -30, attributes: {}, created_at: after.server_time }];
    assert.equal(soundForUpdate(before, after), null);
    assert.equal(soundForUpdate(after, after, true), null);
    after.events = [{ id: 'record', source: 'activity:1', xp: 0, attributes: {}, created_at: after.server_time }];
    assert.equal(soundForUpdate(before, after, true), 'achievement');
});
