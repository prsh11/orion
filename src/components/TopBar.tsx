import { useGame } from '../gameContext';
import { getLevelInfo } from '../gameData';

export default function TopBar() {
    const { state } = useGame();
    const { current } = getLevelInfo(state.player.xp);
    return (
        <header className="topbar">
            <div className="brand">
                <svg className="brand-icon" viewBox="0 0 40 40" aria-hidden="true">
                    <path d="M8 29V18a11 11 0 0 1 22 0v11M14 29V18a5 5 0 0 1 10 0v11M8 23h22" />
                </svg>
                <div><span className="brand-name">FitQuest</span><span className="brand-caption">Your everyday training journal</span></div>
            </div>
            <div className="player-stats">
                <div className="stat-chip level-chip"><span className="level-number">{current.level}</span><span>Level {current.level}<strong>{current.title}</strong></span></div>
                <div className="stat-chip"><strong>{state.player.streak}</strong><span>day streak</span></div>
                <div className="stat-chip"><strong>{state.achievements.length}</strong><span>badges earned</span></div>
            </div>
        </header>
    );
}
