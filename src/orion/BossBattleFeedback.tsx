import type { CSSProperties } from 'react';
import BossPortrait from './BossPortrait';
import GameIcon from './GameIcon';
import type { BossImpact } from './feedback';
import { formatBossDamage } from './bossLogic';

export default function BossBattleFeedback({ impact, hero = false }: { impact: BossImpact; hero?: boolean }) {
    const restored = impact.damage < 0;
    return <section className={`battle-feedback ${hero ? 'battle-hero' : ''} ${impact.defeated ? 'battle-victory' : restored ? 'battle-restored' : 'battle-hit'}`} aria-label={`${impact.title}: ${impact.defeated ? 'defeated' : restored ? 'health restored' : 'damage confirmed'}`}>
        <div className="battle-stage" aria-hidden="true">
            <div className="battle-sigil" />
            <div className="battle-enemy"><BossPortrait avatar={impact.avatar} /></div>
            {!restored && <><div className="battle-slash" /><div className="battle-sparks">{Array.from({ length: 8 }, (_, i) => <i key={i} style={{ '--spark-angle': `${i * 45}deg` } as CSSProperties} />)}</div></>}
            {hero && <div className="battle-seal"><GameIcon name="boss" /><span>Defeated</span></div>}
        </div>
        <div className="battle-report">
            <div className="battle-report-heading"><span>{impact.defeated ? 'Final blow' : restored ? 'Health restored' : 'Damage dealt'}</span><strong>{formatBossDamage(impact.damage)} <small>HP</small></strong></div>
            <p className="battle-boss-name">{impact.title}</p>
            <div className="battle-health" role="meter" aria-label={`${impact.title} remaining health`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.ceil(impact.after)} style={{ '--hp-before': `${impact.before}%`, '--hp-after': `${impact.after}%` } as CSSProperties}><span className="battle-health-trail" /><span className="battle-health-fill" /></div>
            <div className="battle-health-label"><span>{Math.ceil(impact.before)} → {Math.ceil(impact.after)} HP</span><span>{impact.defeated ? 'Encounter complete' : `${Math.ceil(impact.after)} / 100 remaining`}</span></div>
        </div>
    </section>;
}
