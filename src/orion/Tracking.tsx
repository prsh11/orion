import { useState } from 'react';
import { useOrion } from './context';
import { bestWeight, dayKey, fromKg, fromMetres, pace, volume } from './logic';
import ActivityForm from './ActivityForm';
import type { Activity } from './types';

export function ActivityHistory({ journal = false }: { journal?: boolean }) {
    const { data, command, busy } = useOrion();
    const [editing, setEditing] = useState<Activity | undefined>();
    const [remove, setRemove] = useState<string | null>(null);
    if (!data) return null;
    const imperial = data.profile.units === 'imperial';
    const rows = data.activities.filter(a => journal ? !['gym', 'running', 'cardio', 'other'].includes(a.kind) : ['gym', 'running', 'cardio', 'other'].includes(a.kind));
    return <>{editing && <ActivityForm key={editing.id} journal={journal} edit={editing} onDone={() => setEditing(undefined)} />}<section className="panel"><h2>{journal ? 'Your journal' : 'Session history'}</h2>
        {!rows.length && <p className="empty">{journal ? 'A book, a conversation, a moment of focus. Your first entry starts here.' : 'Your first session is a starting point. Log it above.'}</p>}
        <div className="history">{rows.map(a => {
            const sets = data.sets.filter(s => s.activity_id === a.id).sort((x, y) => x.ordinal - y.ordinal);
            return <article className="history-entry" key={a.id}><div className="entry-heading"><div><time>{new Date(a.occurred_at).toLocaleString(undefined, { timeZone: data.profile.timezone, dateStyle: 'medium', timeStyle: 'short' })}</time><h3>{a.title}</h3></div><span className="attribute-tag">{a.attribute}</span></div>
                <p>{a.minutes > 0 ? `${a.minutes} min` : 'Daily completion'}{a.metres > 0 && ` · ${fromMetres(a.metres, imperial).toFixed(2)} ${imperial ? 'mi' : 'km'} · ${pace(a.minutes, a.metres, imperial)}`}{sets.length > 0 && ` · ${fromKg(volume(sets, data.exercises), imperial).toFixed(1)} ${imperial ? 'lb' : 'kg'} volume`}</p>
                {a.notes && <p className="entry-notes">{a.notes}</p>}
                {sets.length > 0 && <details><summary>{sets.length} completed sets</summary><ul>{sets.map(s => <li key={s.id}>{data.exercises.find(e => e.id === s.exercise_id)?.name}: {s.reps} reps × {fromKg(s.kg, imperial).toFixed(1)} {imperial ? 'lb' : 'kg'}</li>)}</ul></details>}
                {!['habit', 'recovery'].includes(a.kind) && <div className="button-row"><button className="text-button" onClick={() => setEditing(a)}>Correct entry</button>{remove !== a.id ? <button className="text-button" onClick={() => setRemove(a.id)}>Delete</button> : <><span>Remove this entry and its base rewards?</span><button className="danger" disabled={busy} onClick={() => { void command('delete_activity', { id: a.id }).then(ok => { if (ok) setRemove(null); }); }}>Delete entry</button><button onClick={() => setRemove(null)}>Cancel</button></>}</div>}
            </article>;
        })}</div>
    </section></>;
}
export function ExerciseLibrary() {
    const { data, command, busy } = useOrion();
    const [search, setSearch] = useState('');
    const [selected, setSelected] = useState('');
    if (!data) return null;
    const imperial = data.profile.units === 'imperial';
    const exerciseSets = data.sets.filter(s => s.exercise_id === selected);
    return <section className="panel"><h2>Exercise library</h2><label>Find an exercise<input type="search" value={search} onChange={e => setSearch(e.target.value)} /></label>
        <div className="exercise-list">{data.exercises.filter(e => e.name.toLowerCase().includes(search.toLowerCase())).map(e => <button key={e.id} aria-pressed={selected === e.id} onClick={() => setSelected(e.id)}>{e.name}<span>{fromKg(bestWeight(data.sets, e.id), imperial).toFixed(1)} {imperial ? 'lb' : 'kg'} {e.bodyweight ? 'added weight best' : 'best'}</span></button>)}</div>
        {selected && <div><h3>{data.exercises.find(e => e.id === selected)?.name} history</h3>{!exerciseSets.length && <p className="muted">No completed sets yet.</p>}<ul>{exerciseSets.map(s => <li key={s.id}>{new Date(data.activities.find(a => a.id === s.activity_id)?.occurred_at ?? '').toLocaleDateString()}: {s.reps} × {fromKg(s.kg, imperial).toFixed(1)} {imperial ? 'lb' : 'kg'}</li>)}</ul></div>}
        <details><summary>Add a private exercise</summary><form onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); void command('exercise', { name: f.get('name'), bodyweight: f.has('bodyweight'), dumbbell: f.has('dumbbell') }).then(ok => { if (ok) form.reset(); }); }}><label>Name<input name="name" maxLength={100} required /></label><label className="check-label"><input type="checkbox" name="bodyweight" />Bodyweight (record added weight)</label><label className="check-label"><input type="checkbox" name="dumbbell" />Dumbbells (weight per dumbbell, volume counts both)</label><button disabled={busy}>Add exercise</button></form></details>
    </section>;
}
export function DailyCare() {
    const { data, command, busy } = useOrion();
    if (!data) return null;
    const today = dayKey(data.server_time, data.profile.timezone);
    const done = (key: string) => data.activities.some(a => a.daily_key === key + ':' + today);
    return <section className="panel"><h2>Daily rhythm</h2><p className="muted">Habits: +5 XP / +1 Discipline. Recovery: +10 XP / +1 Vitality per target. Awarded once a day.</p>
        <h3>Your habits</h3>{!data.habits.some(h => !h.archived) && <p className="muted">Add one small action you want to repeat.</p>}
        {data.habits.filter(h => !h.archived).map(h => <div className="daily-row" key={h.id}><button disabled={busy || done('habit:' + h.id)} onClick={() => { void command('complete_habit', { id: h.id }); }}>{done('habit:' + h.id) ? '✓' : '+'} {h.name}</button><button className="text-button" onClick={() => { void command('archive_habit', { id: h.id }); }} disabled={busy} aria-label={`Archive ${h.name}`}>Archive</button></div>)}
        <form className="button-row" onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); void command('habit', { name: f.get('name') }).then(ok => { if (ok) form.reset(); }); }}><label className="grow">New habit<input name="name" required maxLength={100} placeholder="Read before bed" /></label><button disabled={busy}>Add habit</button></form>
        <h3>Recovery targets</h3><div className="recovery-grid">{['Water: 2 litres', 'Sleep: 8 hours', 'Mindfulness: 10 minutes', 'Balanced meals: 3'].map(target => <button key={target} disabled={busy || done('recovery:' + target)} onClick={() => { void command('recovery', { target }); }}>{done('recovery:' + target) ? '✓ ' : '+ '}{target}</button>)}</div>
    </section>;
}
