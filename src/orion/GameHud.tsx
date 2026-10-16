import AudioFX from '../audio';
import { useOrion } from './context';
import { useExperience } from './experience';
import { levelFor, rankFor, threshold } from './logic';
import GameIcon, { RankBadge } from './GameIcon';
export default function GameHud() {
    const { data, presentations } = useOrion();
    const { enabled } = useExperience();
    if (!data) return null;
    const level = levelFor(data.profile.xp); const intoLevel = data.profile.xp - threshold(level); const needed = threshold(level + 1) - threshold(level);
    return <div className={`game-hud ${presentations[0]?.xp && presentations[0].xp > 0 ? 'hud-gain' : ''}`}>
        <RankBadge rank={rankFor(level)} /><div className="hud-identity"><span>{data.profile.display_name}</span><strong>Level {level}</strong><small>{threshold(level + 1) - data.profile.xp} XP to level {level + 1}</small></div>
        <div className="hud-energy"><div className="hud-energy-label"><span><GameIcon name="orbit" />Experience</span><span>{data.profile.xp.toLocaleString()} XP</span></div><div className="hud-track" role="progressbar" aria-label={`${intoLevel} of ${needed} XP toward level ${level + 1}`} aria-valuemin={0} aria-valuemax={needed} aria-valuenow={intoLevel}><span style={{ width: `${intoLevel / needed * 100}%` }} /></div></div>
        <button className="hud-audio" aria-label={enabled ? 'Mute sounds' : 'Enable sounds'} onClick={() => { AudioFX.setEnabled(!enabled); if (!enabled) { AudioFX.unlock(); AudioFX.click(); } }}><GameIcon name={enabled ? 'sound' : 'muted'} /><span>{enabled ? 'Sound on' : 'Sound off'}</span></button>
    </div>;
}
