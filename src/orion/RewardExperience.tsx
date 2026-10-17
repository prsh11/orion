import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { useOrion } from './context';
import { useExperience } from './experience';
import GameIcon, { RankBadge } from './GameIcon';
import { playRewardSounds, soundDuration } from './sounds';
import AudioFX from '../audio';
import BossBattleFeedback from './BossBattleFeedback';
import type { RewardPresentation } from './feedback';
import type { Attribute } from './types';

function RewardDetails({ reward }: { reward: RewardPresentation }) {
    if (!reward.xp && !Object.keys(reward.attributes).length && reward.bossImpacts?.length) return null;
    return <><div className={`reward-xp ${reward.xp < 0 ? 'is-loss' : ''}`} aria-hidden="true">{reward.xp > 0 ? '+' : ''}{reward.xp}<span> XP</span></div>
        <div className="reward-attributes" aria-hidden="true">{Object.entries(reward.attributes).map(([attribute, delta]) => <span key={attribute} className={delta < 0 ? 'is-loss' : ''}><GameIcon name={attribute as Attribute} />{delta > 0 ? '+' : ''}{delta} {attribute}</span>)}</div></>;
}
function BossImpacts({ reward, except }: { reward: RewardPresentation; except?: string }) {
    const impacts = reward.bossImpacts?.filter(impact => impact.id !== except);
    return impacts?.length ? <div className="battle-reports">{impacts.map(impact => <BossBattleFeedback key={impact.id} impact={impact} />)}</div> : null;
}
function Presentation({ reward, dismiss }: { reward: RewardPresentation; dismiss: () => void }) {
    const { effectiveEffects, enabled } = useExperience();
    const dialog = useRef<HTMLDialogElement>(null);
    const milestone = reward.mode === 'milestone';
    useEffect(() => {
        const sounds = reward.mode === 'recap' || reward.mode === 'correction' ? [] : reward.items.flatMap(item => item.sound ? [item.sound] : []);
        // Loss cues are intentional; undo/correction events have no sound items.
        const cues = reward.mode === 'correction' ? reward.items.flatMap(item => item.sound === 'bossFailure' || item.sound === 'loss' ? [item.sound] : []) : sounds;
        let startedAudio = false;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        // Deferring the start lets React's development effect replay cancel the first
        // setup before it can produce audio. Each mounted presentation starts once.
        const start = setTimeout(() => {
            if (cues.length) { startedAudio = true; playRewardSounds(cues); }
            if (!milestone) timeout = setTimeout(dismiss, Math.max(reward.bossImpacts?.length ? Math.min(12000, 5500 + (reward.bossImpacts.length - 1) * 1000) : 2200, cues.reduce((total, cue) => total + soundDuration[cue], 0)));
        }, 0);
        return () => { clearTimeout(start); clearTimeout(timeout); if (startedAudio) AudioFX.stop(); };
    }, [reward, dismiss, milestone]);
    useEffect(() => {
        if (!milestone || !dialog.current) return;
        const previous = reward.returnFocus ?? document.activeElement;
        const element = dialog.current;
        const previousOverflow = document.documentElement.style.overflow;
        document.documentElement.style.overflow = 'hidden';
        element.showModal();
        element.querySelector<HTMLButtonElement>('.milestone-continue')?.focus();
        return () => { element.close(); document.documentElement.style.overflow = previousOverflow; if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); else document.getElementById('main-content')?.focus({ preventScroll: true }); };
    }, [milestone, reward.returnFocus]);
    const victory = reward.bossImpacts?.find(impact => impact.defeated);
    const title = victory ? `Victory: ${victory.title}` : reward.mode === 'recap' ? 'Progress synced' : reward.mode === 'correction' ? reward.items[0]?.title ?? (reward.bossImpacts?.length ? 'Boss health corrected' : 'Progress corrected') : [...reward.items].reverse().find(item => item.milestone)?.title ?? reward.items[0]?.title ?? (reward.bossImpacts?.length ? 'Boss damage confirmed' : 'Progress earned');
    const badge = milestone && reward.items.some(item => item.sound === 'rankUp' || item.sound === 'levelUp');
    const particles = effectiveEffects === 'full' && reward.mode !== 'correction' && reward.mode !== 'recap';
    const art = <div className="reward-emblem" aria-hidden="true">{particles && <div className="reward-particles">{Array.from({ length: 16 }, (_, i) => <i key={i} style={{ '--angle': `${i * 22.5}deg`, '--travel': `${65 + i % 3 * 25}px`, '--delay': `${i % 4 * 35}ms` } as CSSProperties} />)}</div>}{badge ? <RankBadge rank={reward.rank} decorative /> : <GameIcon name={reward.items[0]?.icon ?? 'orbit'} />}</div>;
    if (milestone) return <dialog ref={dialog} className={`milestone-dialog ${victory ? 'boss-victory-dialog' : ''}`} data-effects={effectiveEffects} aria-labelledby="milestone-title" aria-describedby="milestone-summary" onCancel={e => { e.preventDefault(); dismiss(); }} onKeyDown={e => {
        if (e.key !== 'Tab' || !dialog.current) return;
        const buttons = dialog.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
        const first = buttons[0]; const last = buttons[buttons.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }}>
        <div className="milestone-content"><div className="milestone-scroll">{victory ? <BossBattleFeedback impact={victory} hero /> : art}<p className="reward-caption">{victory ? 'Boss defeated · Rewards claimed' : 'Orion · Milestone earned'}</p><h2 id="milestone-title">{title}</h2><p id="milestone-summary" className="sr-only">{reward.items.filter(item => item.milestone).map(item => item.title).join('. ')}. {reward.summary}</p>
            <RewardDetails reward={reward} /><BossImpacts reward={reward} except={victory?.id} /><ul className="milestone-list">{reward.items.map(item => <li key={item.id}><GameIcon name={item.icon} />{item.title}</li>)}</ul></div><button className="milestone-sound" aria-label={enabled ? 'Mute sounds' : 'Enable sounds'} onClick={() => { AudioFX.setEnabled(!enabled); }}><GameIcon name={enabled ? 'sound' : 'muted'} /></button><button className="primary milestone-continue" onClick={dismiss}>Continue</button>
        </div></dialog>;
    return <div className={`reward-popup reward-${reward.mode} ${reward.bossImpacts?.length ? 'reward-with-battle' : ''}`} data-effects={effectiveEffects} role="status"><div className="reward-popup-body">{effectiveEffects !== 'off' && art}<div><h2>{title}</h2><RewardDetails reward={reward} /><p className="reward-confirmed">{reward.summary}</p>{reward.items.length > 1 && <small>{reward.items.map(item => item.title).join(' · ')}</small>}</div></div><BossImpacts reward={reward} /><button aria-label="Dismiss reward" className="reward-dismiss" onClick={dismiss}>×</button></div>;
}
export default function RewardExperience() {
    const { presentations, dismissPresentation } = useOrion();
    const current = presentations[0];
    return current ? createPortal(<Presentation key={current.id} reward={current} dismiss={dismissPresentation} />, document.body) : null;
}
