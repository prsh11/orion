import { useState } from 'react';
import { loadTheme, saveTheme } from '../theme';
import { useGame } from '../gameContext';
import { getLevelInfo } from '../gameData';

export default function TopBar() {
    const { state } = useGame();
    const [theme, setTheme] = useState(loadTheme);
    const toggleTheme = () => {
        const next = theme === 'light' ? 'dark' : 'light';
        saveTheme(next);
        setTheme(next);
    };
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
            <button className="theme-toggle" type="button" aria-pressed={theme === 'dark'} onClick={toggleTheme}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
                    {theme === 'dark'
                        ? <path d="M20 14A8 8 0 0 1 10 4a8 8 0 1 0 10 10Z" />
                        : <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" /></>}
                </svg>
                Dark mode
            </button>
        </header>
    );
}
