import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useOrion } from './context';
import { attributeFor, baseReward, fromKg, fromMetres, toKg, toMetres } from './logic';
import type { Activity, Kind } from './types';

interface Draft { id: string; kind: Kind; title: string; minutes: string; distance: string; date: string; notes: string; sets: { exercise_id: string; reps: string; weight: string }[] }
function isDraft(value: unknown): value is Draft {
    if (!value || typeof value !== 'object') return false;
    const d = value as Record<string, unknown>;
    return typeof d.id === 'string' && typeof d.kind === 'string' && ['gym', 'running', 'cardio', 'other', 'reading', 'study', 'focus', 'social'].includes(d.kind)
        && ['title', 'minutes', 'distance', 'date', 'notes'].every(k => typeof d[k] === 'string')
        && Array.isArray(d.sets) && d.sets.length < 1000 && d.sets.every((s: unknown) => s !== null && typeof s === 'object' && ['exercise_id', 'reps', 'weight'].every(k => typeof (s as Record<string, unknown>)[k] === 'string'));
}
function localDate(iso = new Date().toISOString()) { const d = new Date(iso); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 19); }
export default function ActivityForm({ journal = false, edit, onDone }: { journal?: boolean; edit?: Activity; onDone?: () => void }) {
    const { data, command, busy, pending } = useOrion();
    const imperial = data?.profile.units === 'imperial';
    const key = `orion-draft:${data?.profile.id}:${edit?.id ?? (journal ? 'journal' : 'training')}:${data?.profile.units}`;
    const [draft, setDraft] = useState<Draft>(() => {
        try { const raw = localStorage.getItem(key); if (raw) { const saved: unknown = JSON.parse(raw); if (isDraft(saved)) return saved; } } catch { /* Use a fresh draft. */ }
        return { id: edit?.id ?? crypto.randomUUID(), kind: edit?.kind ?? (journal ? 'reading' : 'gym'), title: edit?.title ?? '', minutes: edit ? String(edit.minutes) : '30', distance: edit ? String(fromMetres(edit.metres, imperial)) : '', date: localDate(edit?.occurred_at), notes: edit?.notes ?? '', sets: data?.sets.filter(s => s.activity_id === edit?.id).map(s => ({ exercise_id: s.exercise_id, reps: String(s.reps), weight: String(Number(fromKg(s.kg, imperial).toFixed(3))) })) ?? [] };
    });
    const [search, setSearch] = useState('');
    const [exercise, setExercise] = useState(data?.exercises[0]?.id ?? '');
    const [formError, setFormError] = useState('');
    useEffect(() => { try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* In-memory draft stays available. */ } }, [draft, key]);
    if (!data) return null;
    const exercises = data.exercises.filter(e => e.name.toLowerCase().includes(search.toLowerCase()));
    const selectedExercise = exercises.some(e => e.id === exercise) ? exercise : exercises[0]?.id ?? '';
    const imported = Boolean(edit && edit.recorded_at <= '2000-01-01');
    const reward = imported ? { xp: 0, points: 0 } : baseReward(Number(draft.minutes));
    const update = (field: keyof Omit<Draft, 'sets'>, value: string) => setDraft(d => ({ ...d, [field]: value }));
    // A retry can succeed outside this form. Keep its saved draft identifiable
    // rather than submitting a second rewarded entry under a different ID.
    if (!edit && data.activities.some(a => a.id === draft.id)) return <section className="panel"><h2>Activity saved</h2><p>This draft is confirmed in your history.</p><button onClick={() => setDraft(d => ({ ...d, id: crypto.randomUUID(), title: '', notes: '', sets: [], date: localDate() }))}>Start another activity</button></section>;
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setFormError('');
        if (draft.kind === 'gym' && draft.sets.length === 0 && !imported) { setFormError('Add at least one completed set.'); return; }
        if (new Date(draft.date).getTime() > Date.now()) { setFormError('Choose a date and time in the past.'); return; }
        const saved = await command('activity', {
            id: draft.id, kind: draft.kind, title: draft.title.trim() || draft.kind,
            minutes: Number(draft.minutes), metres: draft.kind === 'running' ? toMetres(Number(draft.distance), imperial) : 0,
            occurred_at: new Date(draft.date).toISOString(), notes: draft.notes,
            sets: draft.kind === 'gym' ? draft.sets.map(s => ({ exercise_id: s.exercise_id, reps: Number(s.reps), kg: toKg(Number(s.weight), imperial) })) : [],
        });
        if (saved) {
            try { localStorage.removeItem(key); } catch { /* Storage unavailable. */ }
            setDraft(d => ({ ...d, id: crypto.randomUUID(), title: '', notes: '', sets: [], date: localDate() })); onDone?.();
        }
    }
    return <section className="panel"><h2>{edit ? 'Correct activity' : journal ? 'Make an entry' : 'Log your training'}</h2><form onSubmit={event => { void save(event); }}>
        <div className="form-grid"><label>Activity<select value={draft.kind} onChange={e => update('kind', e.target.value)}>{(journal ? ['reading', 'study', 'focus', 'social'] : ['gym', 'running', 'cardio', 'other']).map(k => <option key={k} value={k}>{k === 'gym' ? 'Gym session' : k.charAt(0).toUpperCase() + k.slice(1)}</option>)}</select></label>
            <label>Duration (minutes)<input type="number" min="1" max="1440" step="1" required value={draft.minutes} onChange={e => update('minutes', e.target.value)} /></label>
            {draft.kind === 'running' && <label>Distance ({imperial ? 'mi' : 'km'})<input type="number" min="0.01" max="1000" step="0.01" required value={draft.distance} onChange={e => update('distance', e.target.value)} /></label>}
            <label>Title (optional)<input maxLength={120} value={draft.title} onChange={e => update('title', e.target.value)} placeholder={journal ? 'A chapter before bed' : 'Evening training'} /></label>
            <label>Date and time (this device)<input type="datetime-local" step="1" required value={draft.date} onChange={e => update('date', e.target.value)} /></label></div>
        {draft.kind === 'gym' && <fieldset><legend>Completed sets</legend><p className="muted">Record completed sets only. Dumbbell weight is per dumbbell. Bodyweight uses added weight.</p>
            <label>Search exercises<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Incline dumbbell press…" /></label>
            <div className="button-row"><label className="grow">Exercise<select value={selectedExercise} onChange={e => setExercise(e.target.value)}>{exercises.map(e => <option value={e.id} key={e.id}>{e.name}{e.bodyweight ? ' (bodyweight)' : ''}</option>)}</select></label><button type="button" disabled={!selectedExercise} onClick={() => setDraft(d => ({ ...d, sets: [...d.sets, { exercise_id: selectedExercise, reps: '10', weight: '0' }] }))}>Add set</button></div>
            {draft.sets.map((s, i) => <div className="set-row" key={i}><span>{data.exercises.find(e => e.id === s.exercise_id)?.name}</span><label>Reps<input type="number" min="1" max="1000" required value={s.reps} onChange={e => setDraft(d => ({ ...d, sets: d.sets.map((row, n) => n === i ? { ...row, reps: e.target.value } : row) }))} /></label><label>{imperial ? 'lb' : 'kg'}<input type="number" min="0" max={imperial ? 2204 : 1000} step="0.01" required value={s.weight} onChange={e => setDraft(d => ({ ...d, sets: d.sets.map((row, n) => n === i ? { ...row, weight: e.target.value } : row) }))} /></label><button type="button" aria-label={`Remove set ${i + 1}`} onClick={() => setDraft(d => ({ ...d, sets: d.sets.filter((_, n) => n !== i) }))}>×</button></div>)}
        </fieldset>}
        <label>Notes (optional)<textarea maxLength={5000} rows={3} value={draft.notes} onChange={e => update('notes', e.target.value)} /></label>
        <p className="reward-preview">Base reward: {reward.xp} XP + {reward.points} {attributeFor(draft.kind)}{edit ? ' (replaces the original base reward)' : ''}</p>
        {formError && <p role="alert" className="feedback">{formError}</p>}
        <div className="button-row"><button className="primary" disabled={busy || Boolean(pending)}>{busy ? 'Saving…' : edit ? 'Save correction' : 'Save activity'}</button>{onDone && <button type="button" onClick={onDone}>Close</button>}</div>
    </form></section>;
}
