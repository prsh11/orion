import { useState } from 'react';
import { useGame } from '../gameContext';
import AudioFX from '../audio';

export default function HabitsPanel() {
    const { state, dispatch } = useGame();
    const [newName, setNewName] = useState('');
    const toggleHabit = (id: string) => {
        const habit = state.habits.find(h => h.id === id);
        if (habit && !habit.completedToday) {
            AudioFX.habitDone();
        } else {
            AudioFX.habitUndo();
        }
        dispatch({ type: 'TOGGLE_HABIT', id });
    };

    const addHabit = () => {
        if (!newName.trim()) return;
        AudioFX.press();
        dispatch({ type: 'ADD_HABIT', name: newName.trim() });
        setNewName('');
    };

    const deleteHabit = (id: string) => {
        AudioFX.click();
        dispatch({ type: 'DELETE_HABIT', id });
    };

    return (
        <section className="panel">
            <h2 className="panel-title">Daily habits</h2>
            <div className="habits-list">
                {state.habits.map(habit => (
                    <div
                        key={habit.id}
                        className={`habit-item ${habit.completedToday ? 'done' : ''}`}
                    >
                        <button className="habit-toggle" onClick={() => toggleHabit(habit.id)} aria-pressed={habit.completedToday}>
                            <span className="habit-check" aria-hidden="true">{habit.completedToday ? '✓' : ''}</span>
                            <span className="habit-name">{habit.icon} {habit.name}</span>
                            <span className="habit-xp">+5 XP</span>
                        </button>
                        <button
                            className="habit-delete"
                            onClick={(e) => { e.stopPropagation(); deleteHabit(habit.id); }}
                            aria-label={`Delete ${habit.name}`}
                        >×</button>
                    </div>
                ))}
            </div>
            <div className="form-row">
                <input
                    className="input"
                    type="text"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && addHabit()}
                    aria-label="New habit name"
                    placeholder="Add a habit to your day"
                    maxLength={40}
                />
                <button className="btn btn-secondary" onClick={addHabit}>Add</button>
            </div>
        </section>
    );
}
