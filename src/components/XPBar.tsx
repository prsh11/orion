import { useGame } from '../gameContext';
import { getLevelInfo } from '../gameData';

export default function XPBar() {
    const { state } = useGame();
    const { current, next } = getLevelInfo(state.player.xp);

    const xpInRange = state.player.xp - current.xpRequired;
    const rangeSize = next ? next.xpRequired - current.xpRequired : 1;
    const pct = next ? Math.min(100, (xpInRange / rangeSize) * 100) : 100;

    return (
        <div className="xp-bar-wrap">
            <div className="xp-bar">
                <div className="xp-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="xp-text">
                {next ? `${xpInRange} / ${rangeSize} XP` : `${state.player.xp} XP (MAX)`}
            </span>
        </div>
    );
}
