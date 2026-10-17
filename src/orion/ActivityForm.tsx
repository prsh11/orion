import { Panel } from './PageLayout';
import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { FormSection, FormActions } from './FormLayout';
import GymSets from './GymSets';
import type { SetDraft } from './GymSets';
import { gymReward } from './trainingLogic';
import { useOrion } from './context';
import { questStatus, matchingKinds } from './questLogic';
import { attributeFor, baseReward, dateTimeInput, dateTimeInstant, fromKg, fromMetres, toKg, toMetres } from './logic';
import type { Activity, Kind } from './types';

interface Draft { id: string; kind: Kind; title: string; minutes: string; distance: string; date: string; date_timezone?: string; date_instant?: string; date_mode?: 'now' | 'custom'; notes: string; sets: SetDraft[] }
function isDraft(value: unknown): value is Draft {
    if (!value || typeof value !== 'object') return false;
    const d = value as Record<string, unknown>;
    return typeof d.id === 'string' && typeof d.kind === 'string' && ['gym', 'running', 'cardio', 'other', 'reading', 'study', 'focus', 'social'].includes(d.kind)
        && (d.date_mode === undefined || d.date_mode === 'now' || d.date_mode === 'custom')
        && (d.date_timezone === undefined || typeof d.date_timezone === 'string')
        && (d.date_instant === undefined || typeof d.date_instant === 'string')
        && ['title', 'minutes', 'distance', 'date', 'notes'].every(k => typeof d[k] === 'string')
        && Array.isArray(d.sets) && d.sets.length < 1000 && d.sets.every((s: unknown) => s !== null && typeof s === 'object' && ['exercise_id', 'reps', 'weight'].every(k => typeof (s as Record<string, unknown>)[k] === 'string') && (!('original_kg' in s) || (typeof s.original_kg === 'number' && Number.isFinite(s.original_kg))) && (!('original_weight' in s) || typeof s.original_weight === 'string'));
}
export default function ActivityForm({ journal = false, edit, onDone }: { journal?: boolean; edit?: Activity; onDone?: () => void }) {
    const { data, command, busy, pending } = useOrion();
    const timingId = useId();
    const timezone = data?.profile.timezone ?? 'UTC';
    const currentDate = () => {
        const instant = new Date().toISOString();
        return { date: dateTimeInput(instant, timezone), date_timezone: timezone, date_instant: instant };
    };
    const imperial = data?.profile.units === 'imperial';
    const key = `orion-draft:${data?.profile.id}:${edit?.id ?? (journal ? 'journal' : 'training')}:${data?.profile.units}`;
    const [draft, setDraft] = useState<Draft>(() => {
        try { const raw = localStorage.getItem(key); if (raw) { const saved: unknown = JSON.parse(raw); if (isDraft(saved)) {
            // Older drafts used the device zone. Preserve their intended instant.
            const sourceTimezone = saved.date_timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
            const instant = saved.date_instant && Number.isFinite(Date.parse(saved.date_instant)) && dateTimeInput(saved.date_instant, sourceTimezone) === saved.date
                ? saved.date_instant : dateTimeInstant(saved.date, sourceTimezone);
            return { ...saved, date_mode: saved.date_mode ?? 'custom', date: instant ? dateTimeInput(instant, timezone) : saved.date, date_timezone: timezone, date_instant: instant ?? undefined };
        } } } catch { /* Use a fresh draft. */ }
        return { id: edit?.id ?? crypto.randomUUID(), kind: edit?.kind ?? (journal ? 'reading' : 'gym'), title: edit?.title ?? '', minutes: edit ? String(edit.minutes) : journal ? '30' : '', distance: edit ? String(fromMetres(edit.metres, imperial)) : '', ...(edit ? { date: dateTimeInput(edit.occurred_at, timezone), date_timezone: timezone, date_instant: edit.occurred_at } : currentDate()), date_mode: edit || journal ? 'custom' : 'now', notes: edit?.notes ?? '', sets: data?.sets.filter(s => s.activity_id === edit?.id).sort((a, b) => a.ordinal - b.ordinal).map(s => { const weight = String(Number(fromKg(s.kg, imperial).toFixed(3))); return { exercise_id: s.exercise_id, reps: String(s.reps), weight, original_kg: s.kg, original_weight: weight }; }) ?? [] };
    });
    const [formError, setFormError] = useState('');
    useEffect(() => { try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* In-memory draft stays available. */ } }, [draft, key]);
    if (!data) return null;
    const imported = Boolean(edit && edit.recorded_at <= '2000-01-01');
    const setRewards = draft.kind === 'gym' && (!edit || edit.reward_version === 2);
    const reward = imported ? { xp: 0, points: 0 } : setRewards ? gymReward(draft.sets.map(s => ({ reps: Number(s.reps) }))) : baseReward(Number(draft.minutes));
    const occurredAt = draft.date_mode === 'now' ? currentDate().date_instant : draft.date_instant ?? dateTimeInstant(draft.date, draft.date_timezone ?? timezone);
    const occurrence = occurredAt ? Date.parse(occurredAt) : NaN;
    const outsideQuestWindows = data.quests.filter(q => q.timeline && questStatus(q, data.server_time) === 'active'
        && q.objectives?.some(o => !['manual', 'checklist'].includes(o.metric) && matchingKinds(o.metric, o.attribute ?? '').includes(draft.kind) && (!o.activity_kind || o.activity_kind === draft.kind))
        && (occurrence < new Date(q.starts_at).getTime() || occurrence >= new Date(q.ends_at!).getTime()));
    const update = (field: keyof Omit<Draft, 'sets'>, value: string) => setDraft(d => ({ ...d, [field]: value, ...(field === 'date' ? { date_instant: undefined, date_timezone: timezone, date_mode: 'custom' as const } : {}) }));
    // A retry can succeed outside this form. Keep its saved draft identifiable
    // rather than submitting a second rewarded entry under a different ID.
    if (!edit && data.activities.some(a => a.id === draft.id)) return <Panel><h2>Activity saved</h2><p>This draft is confirmed in your history.</p><button onClick={() => setDraft(d => ({ ...d, id: crypto.randomUUID(), title: '', notes: '', sets: [], date_mode: journal ? 'custom' : 'now', ...currentDate() }))}>Start another activity</button></Panel>;
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault(); setFormError('');
        if (draft.kind === 'gym' && draft.sets.length === 0 && !imported) { setFormError('Add at least one completed set.'); return; }
        const savedInstant = draft.date_mode === 'now' ? currentDate().date_instant : occurredAt;
        if (!savedInstant) { setFormError(`Choose a valid date and time in ${timezone}. This local time may not exist because of a clock change.`); return; }
        if (Date.parse(savedInstant) > Date.now()) { setFormError('Choose a date and time in the past.'); return; }
        const saved = await command('activity', {
            id: draft.id, kind: draft.kind, title: draft.title.trim() || draft.kind,
            minutes: setRewards ? 0 : Number(draft.minutes), metres: draft.kind === 'running' ? toMetres(Number(draft.distance), imperial) : 0,
            occurred_at: savedInstant, notes: draft.notes,
            sets: draft.kind === 'gym' ? draft.sets.map(s => ({ exercise_id: s.exercise_id, reps: Number(s.reps), kg: s.original_weight === s.weight && s.original_kg !== undefined ? s.original_kg : toKg(Number(s.weight), imperial) })) : [],
        });
        if (saved) {
            try { localStorage.removeItem(key); } catch { /* Storage unavailable. */ }
            setDraft(d => ({ ...d, id: crypto.randomUUID(), title: '', notes: '', sets: [], date_mode: journal ? 'custom' : 'now', ...currentDate() })); onDone?.();
        }
    }
    const detailsFields = <>
        <label>Title (optional)<input maxLength={120} value={draft.title} onChange={e => update('title', e.target.value)} placeholder={journal ? 'A chapter before bed' : 'Evening training'} /></label>
        <div className="activity-date-field"><label>Date and time ({timezone})<input type="datetime-local" step="1" required={draft.date_mode !== 'now'} aria-describedby={outsideQuestWindows.length ? timingId : undefined} value={draft.date} onChange={e => update('date', e.target.value)} /></label>{!edit && <><small>{draft.date_mode === 'now' ? `Uses the save time in ${timezone}.` : `Custom time in ${timezone}.`}</small><button className="text-button" type="button" onClick={() => setDraft(d => ({ ...d, ...currentDate(), date_mode: 'now' }))}>Use current time</button></>}</div>
        <label className="full-width">Notes (optional)<textarea maxLength={5000} rows={3} value={draft.notes} onChange={e => update('notes', e.target.value)} /></label>
    </>;
    return <Panel id={edit ? undefined : journal ? 'journal-entry' : 'training-entry'} tabIndex={-1}>
        <h2>{edit ? 'Correct activity' : journal ? 'Make an entry' : 'Log your training'}</h2>
        <form className={`form-content ${journal ? '' : 'training-form'}`} onSubmit={event => { void save(event); }} onInvalidCapture={event => {
            if (event.target instanceof HTMLElement) { const details = event.target.closest('details'); if (details) details.open = true; }
        }}>
            <fieldset className="activity-fields" disabled={busy || Boolean(pending)}>
                {journal ? <FormSection title="Activity details"><div className="form-grid">
                    <label>Activity<select value={draft.kind} onChange={e => update('kind', e.target.value)}>{['reading', 'study', 'focus', 'social'].map(k => <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>)}</select></label>
                    <label>Duration (minutes)<input type="number" min="1" max="1440" step="1" required value={draft.minutes} onChange={e => update('minutes', e.target.value)} /></label>
                    {detailsFields}
                </div></FormSection> : <>
                    <div className="training-kind" role="group" aria-label="Activity type">
                        {(['gym', 'running'] as const).map(k => <button type="button" key={k} aria-pressed={draft.kind === k} onClick={() => update('kind', k)}>{k === 'gym' ? 'Gym' : 'Running'}</button>)}
                        {!['gym', 'running'].includes(draft.kind) && <span className="help-text">{draft.kind} · {edit ? 'historical activity' : 'restored draft'}</span>}
                    </div>
                    {draft.kind === 'gym' ? <GymSets data={data} sets={draft.sets} onChange={sets => setDraft(d => ({ ...d, sets }))} disabled={busy || Boolean(pending)} activityId={edit?.id} /> : <div className="form-grid running-fields">
                        <label>Duration (minutes)<input type="number" inputMode="numeric" min="1" max="1440" step="1" required value={draft.minutes} onChange={e => update('minutes', e.target.value)} placeholder="30" /></label>
                        {draft.kind === 'running' && <label>Distance ({imperial ? 'mi' : 'km'})<input type="number" inputMode="decimal" min="0.01" max="1000" step="0.01" required value={draft.distance} onChange={e => update('distance', e.target.value)} placeholder="5" /></label>}
                    </div>}
                    <details className="training-details"><summary>More details</summary><div className="form-grid">{detailsFields}</div></details>
                </>}
            </fieldset>
            {outsideQuestWindows.length > 0 && <div id={timingId} className="activity-quest-timing" role="status"><strong>This date falls outside a quest’s tracking window</strong>{outsideQuestWindows.map(q => <p key={q.id}>“{q.title}” counts activities performed and logged from {new Date(q.starts_at).toLocaleString(undefined, { timeZone: timezone })} until {new Date(q.ends_at!).toLocaleString(undefined, { timeZone: timezone })} ({timezone}). This entry can be saved, but it will not advance that quest. Check that the date reflects when you actually did the activity.</p>)}</div>}
            {formError && <p role="alert" className="feedback">{formError}</p>}
            <div className="training-save">
                <div className="training-reward"><p className="reward-preview">{setRewards ? 'Estimated base' : 'Base reward'}: {reward.xp} XP + {reward.points} {attributeFor(draft.kind)}{edit ? ' (replaces the original reward)' : ''}</p>
                    {setRewards && <small>{edit ? 'Original PR bonuses are reconciled on save.' : 'New personal record: +25 XP per exercise, up to +75 XP.'} Gym sets count toward workouts, not minute-based goals.</small>}
                </div>
                <FormActions><button className="primary" aria-busy={busy} disabled={busy || Boolean(pending)}>{busy ? 'Saving…' : edit ? 'Save correction' : 'Save activity'}</button>{onDone && <button type="button" onClick={onDone}>Close</button>}</FormActions>
            </div>
        </form>
    </Panel>;
}
