export const ATTRIBUTES = ['Strength', 'Endurance', 'Vitality', 'Intellect', 'Discipline', 'Connection'] as const;
export type Attribute = typeof ATTRIBUTES[number];
export type Kind = 'gym' | 'running' | 'cardio' | 'other' | 'reading' | 'study' | 'focus' | 'social' | 'habit' | 'recovery';
export type Difficulty = 'easy' | 'medium' | 'hard';
export type Period = 'one-off' | 'daily' | 'weekly' | 'monthly';
export type Metric = 'minutes' | 'workouts' | 'metres' | 'habits' | 'recovery' | 'manual';
export interface Profile {
    id: string; display_name: string; timezone: string; units: 'metric' | 'imperial';
    domains: string[]; onboarded: boolean; xp: number; attributes: Record<Attribute, number>; imported: boolean;
}
export interface Activity {
    id: string; kind: Kind; title: string; attribute: Attribute; minutes: number; metres: number;
    notes: string; occurred_at: string; recorded_at: string; daily_key: string | null; base_xp: number; base_points: number;
    contribution_at?: string; reward_version?: 1 | 2; reward_details?: Partial<ActivityReward>;
}
export interface Exercise { id: string; name: string; bodyweight: boolean; dumbbell: boolean }
export interface WorkoutSet { id: string; activity_id: string; exercise_id: string; reps: number; kg: number; ordinal: number }
export interface Habit { id: string; name: string; archived: boolean }
export interface TodoOutcome { revision: number; difficulty: Difficulty; due_at: string | null; planned_on: string | null; completed_at: string; undone_at: string | null; reward_xp: number; reward_points: number; penalty_xp: number; penalty_points: number; attribute: Attribute | null; applied_xp: number; applied_points: number }
export interface QuestDefinition { kind: 'quest' | 'todo'; planned_on: string | null; id: string; title: string; period: Period; metric: Metric; target: number; attribute: Attribute | null; archived: boolean; difficulty: Difficulty; due_at: string | null }
export type QuestTimeline = 'daily' | 'weekly' | 'monthly' | 'custom';
export type QuestStatus = 'active' | 'completed' | 'expired' | 'abandoned';
export type QuestMetric = Metric | 'checklist';
export interface QuestObjective { satisfied_at?: string | null; id: string; title: string; ordinal: number; metric: QuestMetric; target: number; progress: number; activity_kind: Kind | null; attribute: Attribute | null }
export interface Quest extends QuestDefinition { edit_revision?: number; revised_at?: string | null; completed_eligible_at?: string | null; timeline?: QuestTimeline | null; description?: string; status?: QuestStatus | null; objectives?: QuestObjective[]; completion_revision: number; applied_xp: number; applied_points: number; completion_history: TodoOutcome[]; definition_id: string; starts_at: string; ends_at: string | null; reward_xp: number; reward_points: number; penalty_xp: number; penalty_points: number; progress: number; completed_at: string | null }
export interface Objective { metric: Exclude<Metric, 'manual'>; target: number }
export interface BossTemplate { id: string; title: string; hours: number; attributes: Attribute[]; objectives: Objective[] }
export type BossPeriod = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type BossAvatar = 'dragon' | 'guardian' | 'knight' | 'spectral';
export interface BossRequirement { id: string; title: string; metric: QuestMetric | 'quest'; target: number; progress: number; activity_kind?: Kind | null; attribute?: Attribute | null; quest_id?: string | null; failed: boolean }
export interface Boss extends BossTemplate {
    edit_revision?: number; revised_at?: string | null; period?: BossPeriod; description?: string; avatar?: BossAvatar; requirements?: BossRequirement[]; remaining_health?: number;
    victory_xp?: number; failure_xp?: number; victory_points?: number; failure_points?: number;
    template_id: string | null; accepted_at: string; deadline: string; status: 'active' | 'victory' | 'failure'; resolved_at: string | null;
}
export interface ProgressEvent { id: string; source: string; xp: number; attributes: Partial<Record<Attribute, number>>; created_at: string }
export interface Snapshot {
    profile: Profile; activities: Activity[]; sets: WorkoutSet[]; exercises: Exercise[]; habits: Habit[];
    quests: Quest[]; definitions: QuestDefinition[]; bosses: Boss[]; templates: BossTemplate[]; events: ProgressEvent[]; server_time: string; legacy_achievements?: string[];
}
export interface Command { id: string; action: string; payload: Record<string, unknown> }
export interface PersonalRecord { exercise_id: string; exercise_name: string }
export interface ActivityReward { base_xp: number; pr_xp: number; strength: number; records: PersonalRecord[] }
export interface CommandResult { reward?: ActivityReward; saved?: boolean; personal_record?: boolean; deleted?: boolean }
