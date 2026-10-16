import AudioFX from '../audio';
import { feedbackForUpdate } from './feedback';
import type { Snapshot } from './types';
export type RewardSound = 'success' | 'todoComplete' | 'habitDone' | 'recoveryComplete' | 'trainingComplete' | 'questComplete' | 'bossVictory' | 'bossFailure' | 'achievement' | 'levelUp' | 'rankUp' | 'loss' | 'counterUp';
export const soundDuration: Record<RewardSound, number> = { success: 500, todoComplete: 400, habitDone: 650, recoveryComplete: 800, trainingComplete: 650, questComplete: 800, bossVictory: 1100, bossFailure: 800, achievement: 1000, levelUp: 1500, rankUp: 1800, loss: 450, counterUp: 250 };
export function soundsForUpdate(before: Snapshot | null, after: Snapshot, personalRecord = false): RewardSound[] {
    return feedbackForUpdate(before, after, { personalRecord })?.items.flatMap(item => item.sound ? [item.sound] : []) ?? [];
}
export function playRewardSounds(sounds: RewardSound[]) {
    AudioFX.stop();
    AudioFX.enqueue(sounds.map(sound => ({ play: () => AudioFX[sound](), duration: soundDuration[sound] })));
}
