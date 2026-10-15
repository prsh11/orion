import { useGame } from '../gameContext';
import type { LifeStats } from '../types';
import AudioFX from '../audio';

const LIFE_FIELDS: { key: keyof LifeStats; label: string; unit: string; step: number; xpEach: number }[] = [
    { key: 'water', label: '💧 Water', unit: 'glasses', step: 1, xpEach: 1 },
    { key: 'sleep', label: '😴 Sleep', unit: 'hours', step: 0.5, xpEach: 0 },
    { key: 'mindfulness', label: '🧘 Mindfulness', unit: 'min', step: 5, xpEach: 0 },
    { key: 'meals', label: '🍎 Healthy Meals', unit: 'meals', step: 1, xpEach: 3 },
];

export default function LifePanel() {
    const { state, dispatch } = useGame();

    const handleCounter = (field: keyof LifeStats, dir: number) => {
        const f = LIFE_FIELDS.find(l => l.key === field);
        if (!f) return;
        const delta = f.step * dir;
        const current = state.lifeStats[field];
        if (dir < 0 && current <= 0) return;

        if (dir > 0) {
            AudioFX.counterUp();
        } else {
            AudioFX.counterDown();
        }
        dispatch({ type: 'UPDATE_LIFE', field, delta });
    };

    const handleReset = () => {
        AudioFX.click();
        dispatch({ type: 'RESET_LIFE' });
    };

    return (
        <section className="panel">
            <h2 className="panel-title">🌱 Life Tracking</h2>
            <div className="life-grid">
                {LIFE_FIELDS.map(f => (
                    <div className="life-item" key={f.key}>
                        <label>{f.label} ({f.unit})</label>
                        <div className="counter">
                            <button className="counter-btn" onClick={() => handleCounter(f.key, -1)}>−</button>
                            <span className="counter-val">{state.lifeStats[f.key]}</span>
                            <button className="counter-btn" onClick={() => handleCounter(f.key, 1)}>+</button>
                        </div>
                    </div>
                ))}
            </div>
            <button className="btn btn-ghost" onClick={handleReset}>Reset Today</button>
        </section>
    );
}
