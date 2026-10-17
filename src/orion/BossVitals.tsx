import type { Boss } from './types';
import { useOrion } from './context';
import { bossHealth } from './bossLogic';

export function BossTerms({ stakes, attributes }: { stakes: { victory_xp: number; failure_xp: number; victory_points: number; failure_points: number }; attributes: readonly string[] }) {
    return <div className="boss-terms"><p>Victory: +{stakes.victory_xp.toLocaleString()} XP, +{stakes.victory_points} in each of {attributes.join(' and ')}.</p><p>Failure: −{stakes.failure_xp.toLocaleString()} XP, −{stakes.failure_points} in each of {attributes.join(' and ')}.</p></div>;
}
export function BossHealth({ boss }: { boss: Boss }) {
    const { data } = useOrion();
    if (!data) return null;
    const hp = bossHealth(boss, data);
    return <div className="boss-health"><div><strong>{hp} / 100 HP</strong><span>{boss.status === 'active' ? 'Remaining health' : boss.status === 'victory' ? 'Defeated' : 'Encounter failed'}</span></div><meter min={0} max={100} value={hp} aria-label={`${boss.title}: ${hp} HP remaining`} /></div>;
}
