import { useState } from 'react';
import { useGame } from '../gameContext';
import { WORKOUT_TYPES } from '../gameData';
import type { WorkoutType } from '../types';
import AudioFX from '../audio';

export default function WorkoutPanel({ showToast }: { showToast: (message: string) => void }) {
    const { dispatch } = useGame();
    const [type, setType] = useState<WorkoutType>('strength');
    const [duration, setDuration] = useState(30);
    const [notes, setNotes] = useState('');

    const xpPreview = 20 + Math.floor(duration / 10) * 5;

    const handleLog = () => {
        if (!Number.isFinite(duration) || duration < 1 || duration > 300) return;
        AudioFX.success();
        dispatch({ type: 'LOG_WORKOUT', workoutType: type, duration: Math.trunc(duration), notes });
        setNotes('');
        showToast(`Workout logged! +${xpPreview} XP`);
    };

    return (
        <section className="panel">
            <h2 className="panel-title">🏋️ Log Workout</h2>
            <div className="form-row">
                <select
                    className="input"
                    value={type}
                    onChange={(e) => { const selected = WORKOUT_TYPES.find(workout => workout.value === e.target.value);
                        if (selected) setType(selected.value); AudioFX.click(); }}
                >
                    {WORKOUT_TYPES.map(w => (
                        <option key={w.value} value={w.value}>{w.icon} {w.label}</option>
                    ))}
                </select>
            </div>
            <div className="form-row">
                <input
                    className="input"
                    type="number"
                    min="1"
                    max="300"
                    value={duration}
                    onChange={(e) => setDuration(Number(e.target.value))}
                    placeholder="Duration (min)"
                />
            </div>
            <div className="form-row">
                <input
                    className="input"
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notes (e.g. leg day, 5k run)"
                    maxLength={60}
                />
            </div>
            <button className="btn btn-primary" onClick={handleLog}>
                Log Workout <span className="btn-xp">+{xpPreview} XP</span>
            </button>
        </section>
    );
}
