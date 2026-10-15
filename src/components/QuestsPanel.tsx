import { useGame } from '../gameContext';
import AudioFX from '../audio';

export default function QuestsPanel() {
    const { state, dispatch } = useGame();
    const reroll = () => {
        AudioFX.press();
        dispatch({ type: 'REROLL_QUESTS' });
    };

    return (
        <section className="panel">
            <h2 className="panel-title">Daily quests</h2>
            <ul className="quests-list">
                {state.quests.map(quest => (
                    <li key={quest.id} className={`quest-item ${quest.completed ? 'completed' : ''}`}>
                        <div className="quest-checkbox">{quest.completed ? '✓' : ''}</div>
                        <span className="quest-text">{quest.text}</span>
                        <span className="quest-reward">+{quest.xp} XP</span>
                    </li>
                ))}
            </ul>
            <button className="btn btn-ghost" onClick={reroll}>Refresh quests</button>
        </section>
    );
}
