import type { Boss } from './types';
import { useOrion } from './context';
import { bossHealth } from './bossLogic';
import GameIcon from './GameIcon';

export function BossTerms({ stakes, attributes }: { stakes: { victory_xp: number; failure_xp: number; victory_points: number; failure_points: number }; attributes: readonly string[] }) {
    return <div className="boss-terms"><p className="boss-stakes-victory"><GameIcon name="star" /><span>Victory: +{stakes.victory_xp.toLocaleString()} XP, +{stakes.victory_points} in each of {attributes.join(' and ')}.</span></p><p className="boss-stakes-failure"><GameIcon name="loss" /><span>Failure: −{stakes.failure_xp.toLocaleString()} XP, −{stakes.failure_points} in each of {attributes.join(' and ')}.</span></p></div>;
}
export function BossHealth({ boss }: { boss: Boss }) {
    const { data } = useOrion();
    if (!data) return null;
    const hp = bossHealth(boss, data);
    return <div className="boss-health" data-outcome={boss.status}><div className="boss-health-label"><strong>{hp} / 100 HP</strong><span>{boss.status === 'active' ? 'Remaining health' : boss.status === 'victory' ? 'Defeated' : 'Encounter failed'}</span></div><div className="boss-health-track"><meter min={0} max={100} value={hp} aria-label={`${boss.title}: ${hp} HP remaining`} /></div></div>;
}
