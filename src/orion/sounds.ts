import AudioFX from '../audio';
import { levelFor } from './logic';
import type { Snapshot } from './types';

export type RewardSound = 'levelUp' | 'bossVictory' | 'bossFailure' | 'questComplete' | 'achievement' | 'habitDone' | 'counterUp' | 'success';

// Keep every completion, including multiple quests triggered by one activity.
// Initial loads and repeated snapshots never replay historical rewards.
export function soundsForUpdate(before: Snapshot | null, after: Snapshot, personalRecord = false): RewardSound[] {
    if (!before) return [];
    const known = new Set(before.events.map(event => event.id));
    const events = after.events.filter(event => !known.has(event.id)).sort((a, b) => a.created_at.localeCompare(b.created_at));
    if (!events.length) return [];
    const sounds: RewardSound[] = [];
    const newActivity = after.activities.some(activity => !before.activities.some(old => old.id === activity.id));
    for (const event of events) {
        if (event.source.startsWith('boss:')) sounds.push(event.xp > 0 ? 'bossVictory' : 'bossFailure');
        else if (event.source.startsWith('quest:') && event.xp > 0) sounds.push('questComplete');
        else if (event.source.startsWith('habit:') && event.xp > 0) sounds.push('habitDone');
        else if (event.source.startsWith('recovery:') && event.xp > 0) sounds.push('counterUp');
        else if (event.source.startsWith('activity:') && (event.xp > 0 || (event.xp === 0 && newActivity))) sounds.push('success');
    }
    if (personalRecord) sounds.push('achievement');
    if (levelFor(after.profile.xp) > levelFor(before.profile.xp)) sounds.push('levelUp');
    return sounds;
}

const duration: Record<RewardSound, number> = { success: 450, habitDone: 450, counterUp: 200, questComplete: 750, bossVictory: 1100, bossFailure: 800, achievement: 900, levelUp: 1400 };
export function playSnapshotSound(before: Snapshot | null, after: Snapshot, personalRecord = false) {
    AudioFX.enqueue(soundsForUpdate(before, after, personalRecord).map(sound => ({ play: () => AudioFX[sound](), duration: duration[sound] })));
}
