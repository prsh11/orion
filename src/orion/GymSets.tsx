import { useId, useState } from 'react';
import ExercisePicker from './ExercisePicker';
import type { Snapshot } from './types';
import { fromKg } from './logic';
import { exerciseSets } from './trainingLogic';

export interface SetDraft { exercise_id: string; reps: string; weight: string; original_kg?: number; original_weight?: string }
export default function GymSets({ data, sets, onChange, disabled, activityId }: {
    data: Snapshot; sets: SetDraft[]; onChange: (sets: SetDraft[]) => void; disabled: boolean; activityId?: string;
}) {
    const [picking, setPicking] = useState(false);
    const pickerId = useId();
    const imperial = data.profile.units === 'imperial';
    const unit = imperial ? 'lb' : 'kg';
    const history = data.activities.filter(a => a.kind === 'gym' && a.id !== activityId).sort((a, b) => b.occurred_at.localeCompare(a.occurred_at));
    const recent = new Set(history.flatMap(a => data.sets.filter(s => s.activity_id === a.id).map(s => s.exercise_id)));
    const groups = [...new Set(sets.map(s => s.exercise_id))];
    function addExercise(id: string) {
        if (!groups.includes(id)) onChange([...sets, { exercise_id: id, reps: '10', weight: '0' }]);
        setPicking(false);
        requestAnimationFrame(() => document.getElementById(`${pickerId}-${id}-reps`)?.focus());
    }
    return <div className="gym-workout">
        {groups.length === 0 && <div className="gym-empty"><strong>What did you train?</strong><p>Add an exercise, then enter your completed sets.</p></div>}
        {groups.map(id => {
            const exercise = data.exercises.find(e => e.id === id);
            const rows = sets.map((s, index) => ({ ...s, index })).filter(s => s.exercise_id === id);
            const previous = history.find(a => data.sets.some(s => s.activity_id === a.id && s.exercise_id === id));
            const last = previous ? exerciseSets(data.sets, previous.id, id) : [];
            return <fieldset className="gym-exercise" key={id}>
                <legend>{exercise?.name ?? 'Exercise unavailable'}</legend>
                <div className="gym-exercise-meta"><span>{exercise?.bodyweight ? 'Added weight' : exercise?.dumbbell ? 'Weight per dumbbell' : 'Completed sets'}</span><button className="text-button danger" type="button" disabled={disabled} aria-label={`Remove ${exercise?.name ?? 'exercise'}`} onClick={() => onChange(sets.filter(s => s.exercise_id !== id))}>Remove exercise</button></div>
                {rows.map((row, n) => <div className="gym-set" key={row.index}>
                    <span className="gym-set-number" aria-hidden="true">{n + 1}</span>
                    <label>Reps<input id={n === 0 ? `${pickerId}-${id}-reps` : undefined} inputMode="numeric" type="number" min="1" max="1000" step="1" required value={row.reps} onChange={e => onChange(sets.map((s, i) => i === row.index ? { ...s, reps: e.target.value } : s))} /></label>
                    <label>{unit}<input inputMode="decimal" type="number" min="0" max={imperial ? 2204 : 1000} step="any" required value={row.weight} onChange={e => onChange(sets.map((s, i) => i === row.index ? { ...s, weight: e.target.value } : s))} /></label>
                    <button className="icon-button text-button" type="button" disabled={disabled} aria-label={`Remove set ${n + 1} of ${exercise?.name ?? 'exercise'}`} onClick={() => onChange(sets.filter((_, i) => i !== row.index))}>×</button>
                    {last[n] && <small className="gym-last-set">Last session: {last[n].reps} reps × {Number(fromKg(last[n].kg, imperial).toFixed(2))} {unit}</small>}
                </div>)}
                <button className="gym-add-set" type="button" disabled={disabled || sets.length >= 999} onClick={() => { const lastRow = rows.at(-1)!; onChange([...sets, { exercise_id: id, reps: lastRow.reps, weight: lastRow.weight, original_kg: lastRow.original_kg, original_weight: lastRow.original_weight }]); }}>+ Set</button>
            </fieldset>;
        })}
        <button className="secondary gym-add-exercise" type="button" disabled={disabled || sets.length >= 999} aria-haspopup="dialog" onClick={() => setPicking(true)}>+ Add exercise</button>
        {picking && <ExercisePicker exercises={data.exercises} recent={recent} selected={groups} onChoose={addExercise} onClose={() => setPicking(false)} disabled={disabled} />}
        <p className="help-text gym-guidance">Log completed sets only. Zero weight means bodyweight without added weight.</p>
    </div>;
}
