import { useReducer, useEffect } from 'react';
import type { ReactNode } from 'react';
import type { Activity, GameAction, GameState } from './types';
import { GameContext } from './gameContext';
import { getToday, getYesterday } from './dates';
import { parseSave } from './save';
import { ACHIEVEMENTS, QUEST_TEMPLATES, DEFAULT_HABITS, getLevelInfo } from './gameData';

const STORAGE_KEY = 'fitquest-save-v1';

function loadState() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
            const parsed = parseSave(raw);
            if (!parsed) return null;
            // Reset daily stats if new day
            if (parsed.lifeStatsDate !== getToday()) {
                parsed.lifeStats = { water: 0, sleep: 0, mindfulness: 0, meals: 0 };
                parsed.lifeStatsDate = getToday();
                parsed.habits = parsed.habits.map(h => ({ ...h, completedToday: false }));
                parsed.quests = generateQuests();
                parsed.questsDate = getToday();
            }
            return parsed;
        }
    } catch {
        // Corrupted save — start fresh
    }
    return null;
}

function generateQuests() {
    const shuffled = [...QUEST_TEMPLATES].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, 3).map(q => ({ ...q, completed: false }));
}

function defaultState(): GameState {
    return {
        player: { xp: 0, streak: 0, lastActiveDate: null },
        pendingAchievement: null,
        pendingLevelUp: null,
        workouts: [],
        habits: DEFAULT_HABITS.map((h, i) => ({
            id: `habit_${i}`,
            name: h.name,
            icon: h.icon,
            completedToday: false,
        })),
        lifeStats: { water: 0, sleep: 0, mindfulness: 0, meals: 0 },
        lifeStatsDate: getToday(),
        achievements: [],
        quests: generateQuests(),
        questsDate: getToday(),
        questsCompleted: 0,
        activityFeed: [],
        totalXp: 0,
        totalWorkouts: 0,
        totalMinutes: 0,
    };
}

function addActivity(feed: Activity[], text: string, icon: string) {
    return [{ id: Date.now() + Math.random(), text, icon, time: new Date().toISOString() }, ...feed].slice(0, 20);
}

function checkAchievements(state: GameState) {
    const newUnlocks = [];
    for (const ach of ACHIEVEMENTS) {
        if (!state.achievements.includes(ach.id) && ach.check(state)) {
            newUnlocks.push(ach.id);
        }
    }
    return newUnlocks;
}

function reduceAction(state: GameState, action: GameAction): GameState {
    switch (action.type) {
        case 'LOG_WORKOUT': {
            const { workoutType, duration, notes } = action;
            const today = getToday();
            const newWorkout = {
                id: Date.now(),
                type: workoutType,
                duration,
                notes,
                date: new Date().toISOString(),
            };
            const xpGained = 20 + Math.floor(duration / 10) * 5;
            const newXp = state.player.xp + xpGained;
            const newTotalXp = state.totalXp + xpGained;
            const newTotalWorkouts = state.totalWorkouts + 1;
            const newTotalMinutes = state.totalMinutes + duration;

            // Streak logic
            let newStreak = state.player.streak;
            let streakBonus = 0;
            if (state.player.lastActiveDate !== today) {
                if (state.player.lastActiveDate === getYesterday()) {
                    newStreak = state.player.streak + 1;
                } else if (state.player.lastActiveDate === null) {
                    newStreak = 1;
                } else {
                    newStreak = 1;
                }
                streakBonus = newStreak >= 3 ? newStreak * 2 : 0;
            }

            const label = workoutType.charAt(0).toUpperCase() + workoutType.slice(1);
            let newState: GameState = {
                ...state,
                player: { xp: newXp + streakBonus, streak: newStreak, lastActiveDate: today },
                workouts: [newWorkout, ...state.workouts],
                totalXp: newTotalXp + streakBonus,
                totalWorkouts: newTotalWorkouts,
                totalMinutes: newTotalMinutes,
                activityFeed: addActivity(state.activityFeed, `${label} — ${duration}min`, '🏋️'),
            };

            // Check quests
            const workoutsToday = newState.workouts.filter(w => w.date.slice(0, 10) === today).length;
            const workoutMinutesToday = newState.workouts
                .filter(w => w.date.slice(0, 10) === today)
                .reduce((sum, w) => sum + w.duration, 0);
            const questUpdates = newState.quests.map(q => {
                if (!q.completed && q.check({ ...newState, workoutsToday, workoutMinutesToday })) {
                    return { ...q, completed: true };
                }
                return q;
            });
            const completedQuests = questUpdates.filter(q => q.completed && !newState.quests.find(o => o.id === q.id && o.completed));
            if (completedQuests.length > 0) {
                const questXp = completedQuests.reduce((s, q) => s + q.xp, 0);
                newState = {
                    ...newState,
                    quests: questUpdates,
                    questsCompleted: newState.questsCompleted + completedQuests.length,
                    player: { ...newState.player, xp: newState.player.xp + questXp },
                    totalXp: newState.totalXp + questXp,
                };
            }

            // Check achievements
            const newAchievements = checkAchievements(newState);
            if (newAchievements.length > 0) {
                newState = {
                    ...newState,
                    achievements: [...newState.achievements, ...newAchievements],
                };
            }

            return newState;
        }

        case 'TOGGLE_HABIT': {
            const habit = state.habits.find(h => h.id === action.id);
            if (!habit) return state;
            const wasCompleted = habit.completedToday;
            const newHabits = state.habits.map(h =>
                h.id === action.id ? { ...h, completedToday: !h.completedToday } : h
            );
            const xpGained = wasCompleted ? -5 : 5;
            let newState: GameState = {
                ...state,
                habits: newHabits,
                player: { ...state.player, xp: Math.max(0, state.player.xp + xpGained) },
                totalXp: Math.max(0, state.totalXp + xpGained),
                activityFeed: wasCompleted
                    ? state.activityFeed
                    : addActivity(state.activityFeed, `Habit: ${habit.name}`, habit.icon),
            };
            const newAchievements = checkAchievements(newState);
            if (newAchievements.length > 0) {
                newState = { ...newState, achievements: [...newState.achievements, ...newAchievements] };
            }
            return newState;
        }

        case 'ADD_HABIT': {
            const newHabit = {
                id: `habit_${Date.now()}`,
                name: action.name,
                icon: action.icon || '📌',
                completedToday: false,
            };
            return { ...state, habits: [...state.habits, newHabit] };
        }

        case 'DELETE_HABIT': {
            return { ...state, habits: state.habits.filter(h => h.id !== action.id) };
        }

        case 'UPDATE_LIFE': {
            const { field, delta } = action;
            const current = state.lifeStats[field] || 0;
            const newVal = Math.max(0, current + delta);
            const xpGained = delta > 0 ? Math.ceil(delta) : 0;
            let newState: GameState = {
                ...state,
                lifeStats: { ...state.lifeStats, [field]: newVal },
                player: { ...state.player, xp: state.player.xp + xpGained },
                totalXp: state.totalXp + xpGained,
            };
            const newAchievements = checkAchievements(newState);
            if (newAchievements.length > 0) {
                newState = { ...newState, achievements: [...newState.achievements, ...newAchievements] };
            }
            return newState;
        }

        case 'RESET_LIFE': {
            return {
                ...state,
                lifeStats: { water: 0, sleep: 0, mindfulness: 0, meals: 0 },
                lifeStatsDate: getToday(),
            };
        }

        case 'REROLL_QUESTS': {
            return { ...state, quests: generateQuests(), questsDate: getToday() };
        }

        case 'DISMISS_ACHIEVEMENT': {
            return { ...state, pendingAchievement: null };
        }

        case 'DISMISS_LEVELUP': {
            return { ...state, pendingLevelUp: null, player: { ...state.player, prevLevel: getLevelInfo(state.player.xp).current.level } };
        }

        default:
            return state;
    }
}

function reducer(state: GameState, action: GameAction): GameState {
    const updated = reduceAction(state, action);
    if (updated === state) return state;
    const currentLevel = getLevelInfo(updated.player.xp).current.level;
    const previousLevel = getLevelInfo(state.player.xp).current.level;
    const newAchievement = updated.achievements.find(id => !state.achievements.includes(id));
    return {
        ...updated,
        pendingAchievement: newAchievement ?? updated.pendingAchievement,
        pendingLevelUp: currentLevel > previousLevel ? currentLevel : updated.pendingLevelUp,
    };
}

export function GameProvider({ children }: { children: ReactNode }) {
    const [state, dispatch] = useReducer(reducer, undefined, () => loadState() ?? defaultState());
    useEffect(() => {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }, [state]);
    const { current, next } = getLevelInfo(state.player.xp);
    return (
        <GameContext.Provider value={{ state, dispatch, level: current.level, nextLevel: next }}>
            {children}
        </GameContext.Provider>
    );
}
