export interface Level { level: number; title: string; xpRequired: number }
export interface LifeStats { water: number; sleep: number; mindfulness: number; meals: number }
export type WorkoutType = 'strength' | 'cardio' | 'hiit' | 'yoga' | 'sports' | 'other';
export interface Workout { id: number; type: WorkoutType; duration: number; notes: string; date: string }
export interface Habit { id: string; name: string; icon: string; completedToday: boolean }
export interface Activity { id: number; text: string; icon: string; time: string }
export interface QuestTemplate { id: string; text: string; xp: number; check: (state: QuestCheckState) => boolean }
export interface Quest extends QuestTemplate { completed: boolean }
export interface GameState {
    player: { xp: number; streak: number; lastActiveDate: string | null; prevLevel?: number };
    workouts: Workout[];
    habits: Habit[];
    lifeStats: LifeStats;
    lifeStatsDate: string;
    achievements: string[];
    quests: Quest[];
    questsDate: string;
    questsCompleted: number;
    activityFeed: Activity[];
    totalXp: number;
    totalWorkouts: number;
    totalMinutes: number;
    pendingAchievement: string | null;
    pendingLevelUp: number | null;
}
export type QuestCheckState = GameState & { workoutsToday: number; workoutMinutesToday: number };
export interface Achievement { id: string; name: string; desc: string; icon: string; check: (state: GameState) => boolean }
export type GameAction =
    | { type: 'LOG_WORKOUT'; workoutType: WorkoutType; duration: number; notes: string }
    | { type: 'TOGGLE_HABIT' | 'DELETE_HABIT'; id: string }
    | { type: 'ADD_HABIT'; name: string; icon?: string }
    | { type: 'UPDATE_LIFE'; field: keyof LifeStats; delta: number }
    | { type: 'RESET_LIFE' | 'REROLL_QUESTS' | 'DISMISS_ACHIEVEMENT' | 'DISMISS_LEVELUP' };
