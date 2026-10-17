import type { WorkoutSet } from './types';

/** Display estimate only; PostgreSQL owns confirmed awards. */
export function gymReward(sets: { reps: number }[]) {
    const reps = sets.map(s => Number.isFinite(s.reps) && s.reps >= 1 ? Math.min(Math.floor(s.reps), 20) : 0);
    return { xp: Math.min(60, reps.reduce((sum, n) => sum + (n ? 3 + Math.floor(n / 5) : 0), 0)),
        points: Math.min(3, Math.floor(reps.reduce((sum, n) => sum + n, 0) / 40)) };
}

export function exerciseSets(sets: WorkoutSet[], activityId: string, exerciseId: string) {
    return sets.filter(s => s.activity_id === activityId && s.exercise_id === exerciseId).sort((a, b) => a.ordinal - b.ordinal);
}
