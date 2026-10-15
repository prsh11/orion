import type { Achievement, Level, QuestTemplate, WorkoutType } from './types';

// ===== Game Data: Achievements, Quests, Levels =====

export const LEVELS: [Level, ...Level[]] = [
    { level: 1, title: "Rookie", xpRequired: 0 },
    { level: 2, title: "Beginner", xpRequired: 100 },
    { level: 3, title: "Active", xpRequired: 250 },
    { level: 4, title: "Committed", xpRequired: 500 },
    { level: 5, title: "Dedicated", xpRequired: 800 },
    { level: 6, title: "Disciplined", xpRequired: 1200 },
    { level: 7, title: "Warrior", xpRequired: 1700 },
    { level: 8, title: "Elite", xpRequired: 2300 },
    { level: 9, title: "Master", xpRequired: 3000 },
    { level: 10, title: "Champion", xpRequired: 4000 },
    { level: 11, title: "Legend", xpRequired: 5500 },
    { level: 12, title: "Mythic", xpRequired: 7500 },
    { level: 13, title: "Immortal", xpRequired: 10000 },
];

export function getLevelInfo(xp: number) {
    let current = LEVELS[0];
    let next: Level | null = null;
    for (const [i, level] of LEVELS.entries()) {
        if (xp >= level.xpRequired) {
            current = level;
            next = LEVELS[i + 1] || null;
        }
    }
    return { current, next };
}

export const WORKOUT_TYPES: { value: WorkoutType; label: string; icon: string }[] = [
    { value: 'strength', label: 'Strength Training', icon: '🏋️' },
    { value: 'cardio', label: 'Cardio', icon: '🏃' },
    { value: 'hiit', label: 'HIIT', icon: '🔥' },
    { value: 'yoga', label: 'Yoga / Mobility', icon: '🧘' },
    { value: 'sports', label: 'Sports', icon: '⚽' },
    { value: 'other', label: 'Other', icon: '💪' },
];

export const ACHIEVEMENTS: Achievement[] = [
    { id: 'first_workout', name: 'First Steps', desc: 'Log your first workout', icon: '🎯', check: (s) => s.totalWorkouts >= 1 },
    { id: 'workout_5', name: 'Getting Strong', desc: 'Log 5 workouts', icon: '💪', check: (s) => s.totalWorkouts >= 5 },
    { id: 'workout_10', name: 'Dedicated', desc: 'Log 10 workouts', icon: '🏋️', check: (s) => s.totalWorkouts >= 10 },
    { id: 'workout_25', name: 'Beast Mode', desc: 'Log 25 workouts', icon: '🦍', check: (s) => s.totalWorkouts >= 25 },
    { id: 'workout_50', name: 'Unstoppable', desc: 'Log 50 workouts', icon: '🚀', check: (s) => s.totalWorkouts >= 50 },
    { id: 'streak_3', name: 'On Fire', desc: '3 day streak', icon: '🔥', check: (s) => s.player.streak >= 3 },
    { id: 'streak_7', name: 'Unstoppable', desc: '7 day streak', icon: '⚡', check: (s) => s.player.streak >= 7 },
    { id: 'streak_14', name: 'Relentless', desc: '14 day streak', icon: '💎', check: (s) => s.player.streak >= 14 },
    { id: 'streak_30', name: 'Legendary', desc: '30 day streak', icon: '👑', check: (s) => s.player.streak >= 30 },
    { id: 'level_5', name: 'Rising Star', desc: 'Reach level 5', icon: '⭐', check: (s) => getLevelInfo(s.player.xp).current.level >= 5 },
    { id: 'level_10', name: 'Elite', desc: 'Reach level 10', icon: '🏆', check: (s) => getLevelInfo(s.player.xp).current.level >= 10 },
    { id: 'level_13', name: 'Transcendent', desc: 'Reach max level', icon: '🌟', check: (s) => getLevelInfo(s.player.xp).current.level >= 13 },
    { id: 'early_bird', name: 'Early Bird', desc: 'Log a workout before 8am', icon: '🌅', check: (s) => s.workouts.some(w => new Date(w.date).getHours() < 8) },
    { id: 'night_owl', name: 'Night Owl', desc: 'Log a workout after 9pm', icon: '🦉', check: (s) => s.workouts.some(w => new Date(w.date).getHours() >= 21) },
    { id: 'habit_master', name: 'Habit Master', desc: 'Complete all habits in a day', icon: '✅', check: (s) => s.habits.length > 0 && s.habits.every(h => h.completedToday) },
    { id: 'hydrated', name: 'Hydrated', desc: 'Drink 8 glasses of water in a day', icon: '💧', check: (s) => s.lifeStats.water >= 8 },
    { id: 'zen_master', name: 'Zen Master', desc: '30 min mindfulness in a day', icon: '🧘', check: (s) => s.lifeStats.mindfulness >= 30 },
    { id: 'clean_eater', name: 'Clean Eater', desc: '3 healthy meals in a day', icon: '🥗', check: (s) => s.lifeStats.meals >= 3 },
    { id: 'quest_1', name: 'Quest Hunter', desc: 'Complete your first quest', icon: '⚔️', check: (s) => s.questsCompleted >= 1 },
    { id: 'quest_10', name: 'Quest Master', desc: 'Complete 10 quests', icon: '🗡️', check: (s) => s.questsCompleted >= 10 },
];

export const QUEST_TEMPLATES: QuestTemplate[] = [
    { id: 'workout_1', text: 'Complete 1 workout', xp: 30, check: (s) => s.workoutsToday >= 1 },
    { id: 'workout_2', text: 'Complete 2 workouts', xp: 50, check: (s) => s.workoutsToday >= 2 },
    { id: 'water_4', text: 'Drink 4 glasses of water', xp: 20, check: (s) => s.lifeStats.water >= 4 },
    { id: 'water_8', text: 'Drink 8 glasses of water', xp: 35, check: (s) => s.lifeStats.water >= 8 },
    { id: 'sleep_7', text: 'Get 7+ hours of sleep', xp: 25, check: (s) => s.lifeStats.sleep >= 7 },
    { id: 'mindfulness_10', text: '10 min mindfulness', xp: 20, check: (s) => s.lifeStats.mindfulness >= 10 },
    { id: 'meals_2', text: 'Eat 2 healthy meals', xp: 20, check: (s) => s.lifeStats.meals >= 2 },
    { id: 'habit_1', text: 'Complete 1 habit', xp: 15, check: (s) => s.habits.some(h => h.completedToday) },
    { id: 'habit_2', text: 'Complete 2 habits', xp: 25, check: (s) => s.habits.filter(h => h.completedToday).length >= 2 },
    { id: 'workout_30min', text: 'Workout 30+ minutes total', xp: 30, check: (s) => s.workoutMinutesToday >= 30 },
];

export const DEFAULT_HABITS = [
    { name: 'Morning stretch', icon: '🤸' },
    { name: 'Read 10 pages', icon: '📚' },
    { name: 'No junk food', icon: '🚫' },
    { name: 'Take vitamins', icon: '💊' },
];
