import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dashboardQuestProgress, metricProgress, remainingTime } from '../src/orion/dashboardLogic';
import type { Quest } from '../src/orion/types';

function quest(): Quest {
    return { id: 'quest', definition_id: 'definition', title: 'An expedition', kind: 'quest', planned_on: null, period: 'one-off', timeline: 'monthly', status: 'active', metric: 'manual', target: 2, progress: 0, attribute: 'Endurance', archived: false, difficulty: 'medium', starts_at: '2026-10-16T00:00:00Z', ends_at: '2026-11-16T00:00:00Z', due_at: '2026-11-16T00:00:00Z', completed_at: null, reward_xp: 300, reward_points: 8, penalty_xp: 0, penalty_points: 0, completion_revision: 0, completion_history: [], applied_xp: 0, applied_points: 0, objectives: [
        { id: 'distance', ordinal: 1, title: 'Run', metric: 'metres', target: 20000, progress: 10000, activity_kind: 'running', attribute: null },
        { id: 'kit', ordinal: 2, title: 'Prepare kit', metric: 'checklist', target: 1, progress: 0, activity_kind: null, attribute: null },
    ] };
}

test('dashboard progress gives mixed-unit objectives equal weight without changing confirmed completion', () => {
    const q = quest();
    assert.deepEqual(dashboardQuestProgress(q, false), { fraction: .25, label: '0 / 2 objectives · 25%' });
    assert.equal(q.progress, 0);
    q.objectives![1]!.progress = 1; q.progress = 1;
    assert.deepEqual(dashboardQuestProgress(q, false), { fraction: .75, label: '1 / 2 objectives · 75%' });
    q.objectives = [q.objectives![0]!];
    assert.deepEqual(dashboardQuestProgress(q, false), { fraction: .5, label: '10 / 20 km' });
    assert.equal(metricProgress('metres', 1609.344, 3218.688, true), '1 / 2 mi');
    q.objectives[0]!.progress = 25000;
    assert.equal(dashboardQuestProgress(q, false).fraction, 1);
});

test('legacy progress and deadline rounding remain informative at the deadline', () => {
    const q = quest(); q.timeline = null; q.target = 20; q.progress = 5;
    assert.equal(dashboardQuestProgress(q, false).fraction, .25);
    const now = Date.parse('2026-10-16T12:00:00Z');
    assert.equal(remainingTime('2026-10-16T12:00:01Z', now), '1m left');
    assert.equal(remainingTime('2026-10-16T13:30:00Z', now), '1h 30m left');
    assert.equal(remainingTime('2026-10-18T13:00:00Z', now), '2d 1h left');
    assert.equal(remainingTime('2026-10-16T12:00:00Z', now), 'Deadline reached');
});
