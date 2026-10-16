import { test } from 'node:test';
import assert from 'node:assert/strict';
import { feedbackForUpdate } from '../src/orion/feedback';
import { threshold } from '../src/orion/logic';
import type { Command, Snapshot } from '../src/orion/types';
const command: Command = { id: 'command', action: 'activity', payload: { kind: 'gym', title: 'Evening training' } };
function snapshot(xp = 0): Snapshot {
    return { profile: { id: 'player', display_name: 'Ari', timezone: 'UTC', units: 'metric', onboarded: true, imported: false, domains: [], xp, attributes: { Strength: 10, Endurance: 10, Vitality: 10, Intellect: 10, Discipline: 10, Connection: 10 } }, activities: [], sets: [], exercises: [], habits: [], quests: [], definitions: [], bosses: [], templates: [], events: [], server_time: '2026-10-16T12:00:00Z' };
}
test('rewards use actual profile deltas and repeated snapshots never replay', () => {
    const before = snapshot(100); const after = snapshot(110);
    after.profile.attributes.Strength = 11;
    after.events = [{ id: 'earned', source: 'activity:command', xp: 999, attributes: { Strength: 99 }, created_at: after.server_time }];
    const reward = feedbackForUpdate(before, after, { command })!;
    assert.equal(reward.xp, 10); assert.deepEqual(reward.attributes, { Strength: 1 });
    assert.equal(reward.summary, '+10 XP · +1 Strength confirmed'); assert.equal(reward.mode, 'reward');
    assert.equal(reward.items[0]!.sound, 'trainingComplete'); assert.deepEqual(reward.eventIds, ['earned']);
    assert.equal(feedbackForUpdate(null, after, { command }), null);
    assert.equal(feedbackForUpdate(after, after, { command, personalRecord: true }), null);
});
test('simultaneous quest, boss, record, level and rank rewards have one ordered presentation', () => {
    const before = snapshot(threshold(10) - 1); const after = snapshot(threshold(10) + 10);
    after.events = ['activity:command', 'quest:first', 'quest:second', 'boss:won'].map((source, i) => ({ id: String(i), source, xp: 10, attributes: {}, created_at: after.server_time }));
    const reward = feedbackForUpdate(before, after, { command, personalRecord: true })!;
    assert.equal(reward.mode, 'milestone'); assert.equal(reward.rank, 'D'); assert.equal(reward.level, 10);
    assert.deepEqual(reward.items.map(item => item.sound), ['trainingComplete', 'questComplete', 'questComplete', 'bossVictory', 'achievement', 'levelUp', 'rankUp']);
    assert.equal(reward.items.filter(item => item.milestone).length, 4);
    assert.equal(feedbackForUpdate(before, after)!.mode, 'recap');
});
test('undo and corrections never earn milestones, even when an attribute increases', () => {
    const before = snapshot(25); const after = snapshot(0); after.profile.attributes.Discipline = 11;
    after.events = [{ id: 'undo', source: 'todo-undo:todo:2', xp: -25, attributes: { Discipline: 1 }, created_at: after.server_time }];
    const reward = feedbackForUpdate(before, after, { command })!;
    assert.equal(reward.mode, 'correction'); assert.equal(reward.items.length, 0);
    assert.equal(reward.summary, '-25 XP · +1 Discipline confirmed');
});
test('late todos and boss failure use loss feedback; floors do not invent losses', () => {
    const before = snapshot(10); const after = snapshot(28);
    before.profile.attributes.Discipline = 1; after.profile.attributes.Discipline = 1;
    after.events = [{ id: 'late', source: 'todo:todo:1', xp: 18, attributes: { Discipline: -1 }, created_at: after.server_time }];
    const reward = feedbackForUpdate(before, after, { command })!;
    assert.equal(reward.mode, 'correction'); assert.deepEqual(reward.attributes, {}); assert.equal(reward.items[0]!.sound, 'loss');
    const failure = snapshot(0); failure.events = [{ id: 'failed', source: 'boss:failed', xp: -75, attributes: {}, created_at: after.server_time }];
    assert.equal(feedbackForUpdate(before, failure, { command })!.items[0]!.sound, 'bossFailure');
});
test('zero-XP new activity still gets feedback but historical personal records do not replay', () => {
    const before = snapshot(); const after = snapshot();
    after.activities = [{ id: 'new', kind: 'reading', title: 'One page', attribute: 'Intellect', minutes: 2, metres: 0, notes: '', occurred_at: after.server_time, recorded_at: after.server_time, daily_key: null, base_xp: 0, base_points: 0 }];
    after.events = [{ id: 'read', source: 'activity:read', xp: 0, attributes: {}, created_at: after.server_time }];
    assert.equal(feedbackForUpdate(before, after, { command })!.items[0]!.title, 'One page');
    assert.equal(feedbackForUpdate(after, after, { command, personalRecord: true }), null);
});

test('a replayed personal record result cannot celebrate an unrelated activity', () => {
    const before = snapshot(100); const after = snapshot(110);
    after.events = [{ id: 'other', source: 'activity:other-command', xp: 10, attributes: {}, created_at: after.server_time }];
    assert.equal(feedbackForUpdate(before, after, { command, personalRecord: true })!.items.some(item => item.sound === 'achievement'), false);
});
