import { useGame } from '../gameContext';
import { ACHIEVEMENTS } from '../gameData';

export default function AchievementsPanel({ compact = false, onViewAll }: { compact?: boolean; onViewAll?: () => void }) {
    const { state } = useGame();

    const milestones = compact
        ? [...ACHIEVEMENTS].sort((a, b) => Number(state.achievements.includes(b.id)) - Number(state.achievements.includes(a.id))).slice(0, 3)
        : ACHIEVEMENTS;

    return (
        <section className="panel">
            <h2 className="panel-title">Your milestones</h2>
            <div className="achievements-grid">
                {milestones.map(ach => {
                    const unlocked = state.achievements.includes(ach.id);
                    return (
                        <div
                            key={ach.id}
                            className={`achievement-card ${unlocked ? 'unlocked' : ''}`}
                        >
                            <div className="achievement-icon">{ach.icon}</div>
                            <div className="achievement-name">{ach.name}</div>
                            <div className="achievement-desc">{ach.desc}</div>
                            <span className="achievement-status">{unlocked ? 'Earned' : 'To unlock'}</span>
                        </div>
                    );
                })}
            </div>
            {compact && <button className="btn btn-ghost" onClick={onViewAll}>View all {ACHIEVEMENTS.length} milestones</button>}
        </section>
    );
}
