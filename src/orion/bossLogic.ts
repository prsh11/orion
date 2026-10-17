import type { Boss, BossPeriod, BossRequirement, Snapshot } from './types';
import { bossActivities, dateTimeInput, dateTimeInstant, metric } from './logic';
export const bossStakes = {
    daily: { victory_xp: 250, failure_xp: 75, victory_points: 5, failure_points: 2 },
    weekly: { victory_xp: 1000, failure_xp: 250, victory_points: 15, failure_points: 5 },
    monthly: { victory_xp: 3000, failure_xp: 750, victory_points: 30, failure_points: 10 },
    yearly: { victory_xp: 12000, failure_xp: 3000, victory_points: 100, failure_points: 25 },
} as const;
export function stakesFor(boss: Boss) {
    const defaults = bossStakes[boss.period ?? (boss.hours === 24 ? 'daily' : 'weekly')];
    return { victory_xp: boss.victory_xp ?? defaults.victory_xp, failure_xp: boss.failure_xp ?? defaults.failure_xp,
        victory_points: boss.victory_points ?? defaults.victory_points, failure_points: boss.failure_points ?? defaults.failure_points };
}
export function requirementsFor(boss: Boss, data: Snapshot): BossRequirement[] {
    return boss.requirements ?? boss.objectives.map((o, i) => ({ ...o, id: String(i), title: o.metric, progress: Math.min(o.target, metric(bossActivities(data.activities, boss.accepted_at, boss.deadline), o.metric)), failed: false }));
}
export function bossHealth(boss: Boss, data: Snapshot) {
    if (boss.status === 'victory') return 0;
    const requirements = requirementsFor(boss, data);
    const health = boss.remaining_health ?? 100 * (1 - requirements.reduce((n, r) => n + Math.min(1, Math.max(0, r.progress / r.target)), 0) / Math.max(1, requirements.length));
    return Math.max(1, Math.ceil(health));
}
/** Estimate the calendar deadline for review; PostgreSQL freezes the actual acceptance deadline. */
export function bossDeadline(instant: string, timezone: string, period: BossPeriod) {
    const local = dateTimeInput(instant, timezone);
    const date = new Date(`${local}Z`);
    if (period === 'daily' || period === 'weekly') date.setUTCDate(date.getUTCDate() + (period === 'daily' ? 1 : 7));
    else {
        const day = date.getUTCDate(); date.setUTCDate(1);
        if (period === 'monthly') date.setUTCMonth(date.getUTCMonth() + 1); else date.setUTCFullYear(date.getUTCFullYear() + 1);
        const end = new Date(date); end.setUTCMonth(end.getUTCMonth() + 1, 0);
        date.setUTCDate(Math.min(day, end.getUTCDate()));
    }
    // PostgreSQL resolves nonexistent/repeated local times with the standard-time offset.
    let result = dateTimeInstant(date.toISOString().slice(0, 19), timezone);
    if (!result) {
        const before = new Date(date.getTime() - 86400000).toISOString().slice(0, 19);
        const beforeInstant = dateTimeInstant(before, timezone);
        if (beforeInstant) result = new Date(Date.parse(beforeInstant) + 86400000).toISOString();
    } else {
        const later = new Date(Date.parse(result) + 3600000).toISOString();
        if (dateTimeInput(later, timezone) === date.toISOString().slice(0, 19)) result = later;
    }
    return result;
}
