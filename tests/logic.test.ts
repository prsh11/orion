import { test } from 'node:test';
import assert from 'node:assert/strict';
import { baseReward, bestWeight, dayKey, deadlineInput, fromKg, fromMetres, levelFor, pace, questReward, rankFor, threshold, toKg, toMetres, volume } from '../src/orion/logic';
import { parseSave } from '../src/save';

test('level thresholds and ranks include exact floored boundaries and reductions', () => {
    for (let level = 2; level < 200; level++) {
        assert.equal(levelFor(threshold(level)), level);
        assert.equal(levelFor(threshold(level) - 1), level - 1);
    }
    assert.equal(levelFor(0), 1);
    assert.equal(rankFor(levelFor(threshold(10))), 'D');
    assert.equal(rankFor(levelFor(threshold(10) - 75)), 'E');
    assert.deepEqual([1, 10, 25, 40, 60, 80].map(rankFor), ['E', 'D', 'C', 'B', 'A', 'S']);
});
test('activity and period rewards respect completed blocks and caps', () => {
    assert.deepEqual([9, 10, 29, 30, 60, 90, 1440].map(baseReward), [{ xp: 0, points: 0 }, { xp: 10, points: 0 }, { xp: 20, points: 0 }, { xp: 30, points: 1 }, { xp: 60, points: 2 }, { xp: 60, points: 3 }, { xp: 60, points: 3 }]);
    assert.deepEqual(['daily', 'weekly', 'monthly'].map(p => questReward(p as 'daily' | 'weekly' | 'monthly')), [{ xp: 25, points: 1 }, { xp: 100, points: 3 }, { xp: 300, points: 8 }]);
});
test('canonical units round trip and pace carries seconds', () => {
    assert.ok(Math.abs(fromKg(toKg(135, true), true) - 135) < 1e-9);
    assert.equal(fromMetres(toMetres(5, true), true), 5);
    assert.equal(toMetres(1, false), 1000);
    assert.equal(pace(30, 5000, false), '6:00 /km');
    assert.equal(pace(5.999, 1000, false), '6:00 /km');
    assert.equal(pace(10, 0, true), '—');
});
test('completed dumbbell sets count both weights in volume', () => {
    const sets = [{ id: 's', exercise_id: 'e', activity_id: 'a', reps: 10, kg: 20, ordinal: 1 }];
    assert.equal(volume(sets, [{ id: 'e', name: 'Press', dumbbell: true, bodyweight: false }]), 400);
    assert.equal(bestWeight(sets, 'e'), 20);
    assert.equal(bestWeight(sets, 'unknown'), 0);
});
test('calendar dates follow the profile timezone across UTC midnight', () => {
    assert.equal(dayKey('2026-10-15T00:00:00Z', 'America/Los_Angeles'), '2026-10-14');
    assert.equal(dayKey('2026-10-15T00:00:00Z', 'Asia/Kolkata'), '2026-10-15');
});
test('legacy parser rejects malformed data and restores template functions', () => {
    assert.equal(parseSave('{"player": {"xp": 10}}'), null);
    assert.equal(parseSave('{broken'), null);
    const save = { player: { xp: 123, streak: 2, lastActiveDate: null }, workouts: [], habits: [], lifeStats: { water: 0, sleep: 0, meals: 0, mindfulness: 0 }, lifeStatsDate: '2026-10-15', achievements: ['first_workout'], quests: [], questsDate: '2026-10-15', questsCompleted: 0, activityFeed: [], totalXp: 123, totalWorkouts: 0, totalMinutes: 0 };
    assert.equal(parseSave(JSON.stringify(save))?.player.xp, 123);
});

test('deadline form values use the profile timezone across date and DST boundaries', () => {
    assert.equal(deadlineInput(null, 'UTC'), '');
    assert.equal(deadlineInput('2026-10-15T23:30:00Z', 'Asia/Kolkata'), '2026-10-16T05:00');
    assert.equal(deadlineInput('2026-03-08T06:30:00Z', 'America/New_York'), '2026-03-08T01:30');
    assert.equal(deadlineInput('2026-03-08T07:30:00Z', 'America/New_York'), '2026-03-08T03:30');
});
