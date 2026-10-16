import { ATTRIBUTES } from './types';
import type { Attribute, Command, Snapshot } from './types';
import type { IconName } from './GameIcon';
import { levelFor, rankFor } from './logic';
import type { RewardSound } from './sounds';
export interface RewardItem { id: string; title: string; icon: IconName; sound?: RewardSound; milestone?: boolean }
export interface RewardPresentation {
    id: string; returnFocus?: HTMLElement; mode: 'reward' | 'milestone' | 'correction' | 'recap'; items: RewardItem[];
    xp: number; attributes: Partial<Record<Attribute, number>>; summary: string;
    level: number; rank: string; eventIds: string[];
}
export interface FeedbackOrigin { command?: Command; personalRecord?: boolean; personalRecordCommandId?: string; returnFocus?: HTMLElement }
export function feedbackForUpdate(before: Snapshot | null, after: Snapshot, origin: FeedbackOrigin = {}): RewardPresentation | null {
    if (!before) return null;
    const known = new Set(before.events.map(e => e.id));
    const fresh = after.events.filter(e => !known.has(e.id)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const xp = after.profile.xp - before.profile.xp;
    const attributes: Partial<Record<Attribute, number>> = {};
    for (const attribute of ATTRIBUTES) { const delta = after.profile.attributes[attribute] - before.profile.attributes[attribute]; if (delta) attributes[attribute] = delta; }
    if (!fresh.length && !xp && !Object.keys(attributes).length) return null;
    const items: RewardItem[] = [];
    const milestones: RewardItem[] = [];
    for (const event of fresh) {
        const source = event.source; const id = source.split(':')[1];
        if (source.startsWith('boss:')) {
            const item: RewardItem = { id: event.id, title: event.xp > 0 ? `Victory: ${after.bosses.find(b => b.id === id)?.title ?? 'Boss defeated'}` : 'Boss mission failed', icon: 'boss', sound: event.xp > 0 ? 'bossVictory' : 'bossFailure', milestone: event.xp > 0 };
            (item.milestone ? milestones : items).push(item);
        } else if (source.startsWith('quest:') && event.xp > 0) {
            const quest = after.quests.find(q => q.id === id); const late = Boolean(quest?.penalty_xp);
            const milestone = Boolean(quest?.timeline && !late);
            const item: RewardItem = { id: event.id, title: late ? `Completed late: ${quest?.title ?? 'Quest'}` : milestone ? `Quest complete: ${quest?.title}` : quest?.title ?? 'Quest complete', icon: late ? 'loss' : 'quest', sound: late ? 'loss' : 'questComplete', ...(milestone ? { milestone: true } : {}) };
            (milestone ? milestones : items).push(item);
        }
        else if (source.startsWith('todo:') && event.xp > 0) {
            const todo = after.quests.find(q => q.id === id); const late = Boolean(todo?.penalty_xp || Object.values(event.attributes).some(delta => delta < 0));
            items.push({ id: event.id, title: late ? `Completed late: ${todo?.title ?? 'Todo'}` : todo?.title ?? 'Todo complete', icon: late ? 'loss' : 'todo', sound: late ? 'loss' : 'todoComplete' });
        }
        else if (source.startsWith('habit:') && event.xp > 0) items.push({ id: event.id, title: after.habits.find(h => h.id === id)?.name ?? 'Habit complete', icon: 'Discipline', sound: 'habitDone' });
        else if (source.startsWith('recovery:') && event.xp > 0) items.push({ id: event.id, title: source.slice(9).replace(/:\d{4}-\d{2}-\d{2}.*$/, ''), icon: 'Vitality', sound: 'recoveryComplete' });
        else if (source.startsWith('activity:')) {
            const newActivity = after.activities.find(a => !before.activities.some(old => old.id === a.id));
            if (newActivity || event.xp > 0) {
                const kind = newActivity?.kind ?? origin.command?.payload.kind;
                const training = ['gym', 'running', 'cardio', 'other'].includes(String(kind));
                items.push({ id: event.id, title: newActivity?.title ?? (typeof origin.command?.payload.title === 'string' ? origin.command.payload.title : 'Activity logged'), icon: training ? 'training' : 'journal', sound: training ? 'trainingComplete' : 'success' });
            }
        } else if (source.startsWith('quest-late:') && !fresh.some(e => e.source === `quest:${id}`)) items.push({ id: event.id, title: 'Late completion adjustment', icon: 'loss', sound: 'loss' });
    }
    const recordCommandId = origin.personalRecordCommandId ?? origin.command?.id;
    if (origin.personalRecord && fresh.some(e => recordCommandId ? e.source === `activity:${recordCommandId}` : e.source.startsWith('activity:'))) {
        const activity = after.activities.find(a => a.id === origin.command?.payload.id);
        const reward = activity?.reward_details;
        const records = reward?.records ?? [];
        if (reward?.base_xp !== undefined && reward.pr_xp !== undefined) items.push({ id: `breakdown:${recordCommandId}`, title: `Workout: ${reward.base_xp} XP + ${reward.pr_xp} PR XP`, icon: 'training' });
        if (records.length) for (const [index, record] of records.entries()) milestones.push({ id: `record:${recordCommandId}:${record.exercise_id}`, title: `New personal record: ${record.exercise_name}`, icon: 'star', ...(index === 0 ? { sound: 'achievement' as const } : {}), milestone: true });
        else milestones.push({ id: `record:${origin.command?.id ?? fresh[0]!.id}`, title: 'New personal record', icon: 'star', sound: 'achievement', milestone: true });
    }
    const level = levelFor(after.profile.xp); const oldLevel = levelFor(before.profile.xp); const rank = rankFor(level);
    const earned = items.some(item => item.sound !== 'loss' && item.sound !== 'bossFailure') || milestones.length > 0;
    if (level > oldLevel && earned) milestones.push({ id: `level:${level}`, title: `Level ${level} reached`, icon: 'orbit', sound: 'levelUp', milestone: true });
    if (rank !== rankFor(oldLevel) && level > oldLevel && earned) milestones.push({ id: `rank:${rank}`, title: `Rank ${rank} unlocked`, icon: 'character', sound: 'rankUp', milestone: true });
    const summary = [`${xp > 0 ? '+' : ''}${xp} XP`, ...Object.entries(attributes).map(([a, n]) => `${n > 0 ? '+' : ''}${n} ${a}`)].join(' · ') + ' confirmed';
    const mode = !origin.command ? 'recap' : milestones.length ? 'milestone' : earned ? 'reward' : 'correction';
    return { id: fresh.map(e => e.id).join('|') || `${origin.command?.id ?? after.server_time}:delta`, mode,
        returnFocus: origin.returnFocus, items: [...items, ...milestones], xp, attributes, summary, level, rank, eventIds: fresh.map(e => e.id) };
}
