import type { Activity, Attribute, Difficulty, Exercise, Kind, Metric, Period, WorkoutSet } from './types';

export const threshold = (level: number) => Math.floor(100 * (level - 1) ** 1.5);
export function levelFor(xp: number) {
    let level = Math.floor((Math.max(0, xp) / 100) ** (2 / 3)) + 1;
    while (threshold(level + 1) <= xp) level++;
    return level;
}
export const rankFor = (level: number) => level >= 80 ? 'S' : level >= 60 ? 'A' : level >= 40 ? 'B' : level >= 25 ? 'C' : level >= 10 ? 'D' : 'E';
export const baseReward = (minutes: number) => ({ xp: Math.min(60, Math.floor(minutes / 10) * 10), points: Math.min(3, Math.floor(minutes / 30)) });
export const questReward = (period: Period, difficulty: Difficulty = 'medium') => {
    const base = { xp: { 'one-off': 25, daily: 25, weekly: 100, monthly: 300 }[period], points: { 'one-off': 1, daily: 1, weekly: 3, monthly: 8 }[period] };
    if (difficulty === 'medium') return base;
    return difficulty === 'hard' ? { xp: base.xp * 2, points: base.points * 2 } : { xp: period === 'one-off' || period === 'daily' ? 15 : base.xp / 2, points: period === 'weekly' ? 2 : period === 'monthly' ? 4 : 1 };
};
export const attributeFor = (kind: Kind): Attribute => ({ gym: 'Strength', running: 'Endurance', cardio: 'Endurance', other: 'Discipline', reading: 'Intellect', study: 'Intellect', focus: 'Discipline', social: 'Connection', habit: 'Discipline', recovery: 'Vitality' } as const)[kind];
export const toKg = (weight: number, imperial: boolean) => imperial ? weight / 2.20462262185 : weight;
export const fromKg = (kg: number, imperial: boolean) => imperial ? kg * 2.20462262185 : kg;
export const toMetres = (distance: number, imperial: boolean) => distance * (imperial ? 1609.344 : 1000);
export const fromMetres = (metres: number, imperial: boolean) => metres / (imperial ? 1609.344 : 1000);
export function pace(minutes: number, metres: number, imperial: boolean) {
    if (metres <= 0) return '—';
    const seconds = Math.round(minutes * 60 / fromMetres(metres, imperial));
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')} /${imperial ? 'mi' : 'km'}`;
}
export function volume(sets: WorkoutSet[], exercises: Exercise[]) {
    return sets.reduce((sum, s) => sum + s.reps * s.kg * (exercises.find(e => e.id === s.exercise_id)?.dumbbell ? 2 : 1), 0);
}
export const bestWeight = (sets: WorkoutSet[], exerciseId: string) => Math.max(0, ...sets.filter(s => s.exercise_id === exerciseId).map(s => s.kg));
export function dayKey(time: string | Date, timezone: string) {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(time));
}
export function metric(activities: Activity[], type: Metric) {
    return activities.reduce((n, a) => n + (type === 'minutes' ? a.minutes : type === 'metres' ? a.metres : type === 'workouts' ? Number(['gym', 'running', 'cardio', 'other'].includes(a.kind)) : type === 'habits' ? Number(a.kind === 'habit') : type === 'recovery' ? Number(a.kind === 'recovery') : 0), 0);
}
export const metricLabel: Record<Metric, string> = { minutes: 'activity minutes', workouts: 'workouts', metres: 'metres run', habits: 'habit completions', recovery: 'recovery targets', manual: 'manual count' };
export function bossActivities(activities: Activity[], accepted: string, deadline: string) {
    return activities.filter(a => a.occurred_at >= accepted && a.occurred_at < deadline && a.recorded_at >= accepted && a.recorded_at < deadline);
}
