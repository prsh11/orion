import { attributeFor } from './logic';
import type { Attribute, Kind, Quest, QuestMetric, QuestStatus } from './types';
export const questMetrics: Record<QuestMetric, string> = { checklist: 'Checklist item', manual: 'Manual count', minutes: 'Activity minutes', workouts: 'Workouts', metres: 'Running distance', habits: 'Habit completions', recovery: 'Recovery completions' };
export const activityKinds: Kind[] = ['gym', 'running', 'cardio', 'other', 'reading', 'study', 'focus', 'social', 'habit', 'recovery'];
export function matchingKinds(metric: QuestMetric, attribute: Attribute | '' = '') {
    return activityKinds.filter(kind => (!attribute || attributeFor(kind) === attribute) && (metric === 'minutes' || metric === 'workouts' && ['gym', 'running', 'cardio', 'other'].includes(kind) || metric === 'metres' && kind === 'running' || metric === 'habits' && kind === 'habit' || metric === 'recovery' && kind === 'recovery'));
}
export function questStatus(q: Quest, now: string): QuestStatus {
    if (q.completed_at) return 'completed';
    if (q.archived || q.status === 'abandoned') return 'abandoned';
    if (q.status === 'expired' || (q.timeline || q.period !== 'one-off') && q.ends_at !== null && q.ends_at <= now) return 'expired';
    return 'active';
}
export function questSummary(q: Quest) {
    return q.timeline ? `${q.progress} of ${q.target} objectives` : `${q.progress} of ${q.target}`;
}
