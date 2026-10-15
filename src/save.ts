import { QUEST_TEMPLATES, WORKOUT_TYPES } from './gameData';
import type { Activity, GameState, Habit, LifeStats, Workout, WorkoutType } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
function isNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}
function isWorkoutType(value: unknown): value is WorkoutType {
    return WORKOUT_TYPES.some(workout => workout.value === value);
}
function isWorkout(value: unknown): value is Workout {
    return isRecord(value) && isNumber(value.id) && isWorkoutType(value.type)
        && isNumber(value.duration) && typeof value.notes === 'string' && typeof value.date === 'string';
}
function isHabit(value: unknown): value is Habit {
    return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string'
        && typeof value.icon === 'string' && typeof value.completedToday === 'boolean';
}
function isActivity(value: unknown): value is Activity {
    return isRecord(value) && isNumber(value.id) && typeof value.text === 'string'
        && typeof value.icon === 'string' && typeof value.time === 'string';
}
function isLifeStats(value: unknown): value is LifeStats {
    return isRecord(value) && isNumber(value.water) && isNumber(value.sleep)
        && isNumber(value.mindfulness) && isNumber(value.meals);
}
function isArrayOf<T>(value: unknown, check: (item: unknown) => item is T): value is T[] {
    return Array.isArray(value) && value.every((item: unknown) => check(item));
}
function isString(value: unknown): value is string {
    return typeof value === 'string';
}

// JSON drops quest check functions. Reattach the current templates when loading saves.
export function parseSave(raw: string): GameState | null {
    const saved: unknown = JSON.parse(raw);
    if (!isRecord(saved) || !isRecord(saved.player)) return null;
    const player = saved.player;
    if (!isNumber(player.xp) || !isNumber(player.streak)
        || !(player.lastActiveDate === null || typeof player.lastActiveDate === 'string')
        || !isArrayOf(saved.workouts, isWorkout) || !isArrayOf(saved.habits, isHabit)
        || !isLifeStats(saved.lifeStats) || typeof saved.lifeStatsDate !== 'string'
        || !isArrayOf(saved.achievements, isString) || !isArrayOf(saved.quests, isRecord)
        || typeof saved.questsDate !== 'string' || !isNumber(saved.questsCompleted)
        || !isArrayOf(saved.activityFeed, isActivity) || !isNumber(saved.totalXp)
        || !isNumber(saved.totalWorkouts) || !isNumber(saved.totalMinutes)) return null;
    const quests = saved.quests.flatMap(quest => {
        const template = QUEST_TEMPLATES.find(candidate => candidate.id === quest.id);
        return template && typeof quest.completed === 'boolean'
            ? [{ ...template, completed: quest.completed }] : [];
    });
    return {
        player: {
            xp: player.xp, streak: player.streak, lastActiveDate: player.lastActiveDate,
            ...(isNumber(player.prevLevel) ? { prevLevel: player.prevLevel } : {}),
        },
        workouts: saved.workouts, habits: saved.habits, lifeStats: saved.lifeStats,
        lifeStatsDate: saved.lifeStatsDate, achievements: saved.achievements,
        quests, questsDate: saved.questsDate, questsCompleted: saved.questsCompleted,
        activityFeed: saved.activityFeed, totalXp: saved.totalXp,
        totalWorkouts: saved.totalWorkouts, totalMinutes: saved.totalMinutes,
        pendingAchievement: null, pendingLevelUp: null,
    };
}
