import { useGame } from '../gameContext';
import { ACHIEVEMENTS } from '../gameData';
import AudioFX from '../audio';

export default function AchievementsPanel() {
    const { state } = useGame();

    return (
        <section className="panel">
            <h2 className="panel-title">🏆 Achievements</h2>
            <div className="achievements-grid">
                {ACHIEVEMENTS.map(ach => {
                    const unlocked = state.achievements.includes(ach.id);
                    return (
                        <div
                            key={ach.id}
                            className={`achievement-card ${unlocked ? 'unlocked' : ''}`}
                            onMouseEnter={() => unlocked && AudioFX.click()}
                        >
                            <div className="achievement-icon">{ach.icon}</div>
                            <div className="achievement-name">{ach.name}</div>
                            <div className="achievement-desc">{ach.desc}</div>
                        </div>
                    );
                })}
            </div>
        </section>
    );
}
