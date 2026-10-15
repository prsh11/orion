import AudioFX from '../audio';
import { levelFor } from './logic';
import type { Snapshot } from './types';

export type RewardSound = 'levelUp' | 'bossVictory' | 'bossFailure' | 'questComplete' | 'achievement' | 'habitDone' | 'counterUp' | 'success';

// One cue per confirmed update keeps simultaneous rewards from overlapping.
// Initial loads and repeated snapshots never replay historical rewards.
export function soundForUpdate(before: Snapshot | null, after: Snapshot, personalRecord = false): RewardSound | null {
    if (!before) return null;
    const known = new Set(before.events.map(event => event.id));
    const events = after.events.filter(event => !known.has(event.id));
    if (!events.length) return null;
    if (events.some(event => event.source.startsWith('boss:') && event.xp < 0)) return 'bossFailure';
    if (levelFor(after.profile.xp) > levelFor(before.profile.xp)) return 'levelUp';
    if (events.some(event => event.source.startsWith('boss:') && event.xp > 0)) return 'bossVictory';
    if (events.some(event => event.source.startsWith('quest:') && event.xp > 0)) return 'questComplete';
    if (personalRecord) return 'achievement';
    if (events.some(event => event.source.startsWith('habit:') && event.xp > 0)) return 'habitDone';
    if (events.some(event => event.source.startsWith('recovery:') && event.xp > 0)) return 'counterUp';
    return events.some(event => event.source.startsWith('activity:') && event.xp > 0) ? 'success' : null;
}

export function playSnapshotSound(before: Snapshot | null, after: Snapshot, personalRecord = false) {
    const sound = soundForUpdate(before, after, personalRecord);
    if (sound) AudioFX[sound]();
}
