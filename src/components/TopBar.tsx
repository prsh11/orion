import { useGame } from '../gameContext';
import { getLevelInfo } from '../gameData';
import AudioFX from '../audio';

export default function TopBar() {
    const { state } = useGame();
    const { current } = getLevelInfo(state.player.xp);

    return (
        <header className="topbar">
            <div className="brand">
                <span className="brand-icon" onClick={() => AudioFX.click()}>💪</span>
                <span className="brand-name">FitQuest</span>
            </div>
            <div className="player-stats">
                <div className="stat-chip level-chip" title={`Level ${current.level} — ${current.title}`}>
                    <span className="chip-label">LVL</span>
                    <span className="chip-value">{current.level}</span>
                    <span className="chip-title">{current.title}</span>
                </div>
                <div className="stat-chip" title="Streak">
                    <span className="chip-label">🔥</span>
                    <span className="chip-value">{state.player.streak}</span>
                </div>
                <div className="stat-chip" title="Achievements">
                    <span className="chip-label">🏆</span>
                    <span className="chip-value">{state.achievements.length}</span>
                </div>
            </div>
        </header>
    );
}
