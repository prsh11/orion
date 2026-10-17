import { useRevisionSaved } from './useRevisionSaved';
import { useEffect, useState } from 'react';
import { useOrion } from './context';
import { ATTRIBUTES } from './types';
import type { Attribute, Difficulty, Kind, Quest, QuestMetric, QuestTimeline } from './types';
import { attributeFor, questReward, toMetres, fromMetres, dateTimeInput, dateTimeInstant } from './logic';
import { bossDeadline } from './bossLogic';
import { matchingKinds, questMetrics } from './questLogic';
import { FormSection, FormActions } from './FormLayout';
import RpgArt from './RpgArt';
import GameIcon from './GameIcon';
interface ObjectiveDraft { id?: string; original_target?: number; original_display?: string; key: string; title: string; metric: QuestMetric; target: string; activity_kind: Kind | ''; attribute: Attribute | '' }
interface Draft { revision?: number; id: string; title: string; description: string; timeline: QuestTimeline; difficulty: Difficulty; attribute: Attribute; due_local: string; objectives: ObjectiveDraft[] }
const objective = (): ObjectiveDraft => ({ key: crypto.randomUUID(), title: '', metric: 'checklist', target: '1', activity_kind: '', attribute: '' });
const fresh = (): Draft => ({ id: crypto.randomUUID(), title: '', description: '', timeline: 'weekly', difficulty: 'medium', attribute: 'Discipline', due_local: '', objectives: [objective()] });
function isDraft(value: unknown): value is Draft {
    if (!value || typeof value !== 'object') return false;
    const d = value as Record<string, unknown>;
    return (d.revision === undefined || (typeof d.revision === 'number' && Number.isInteger(d.revision) && d.revision >= 0)) && typeof d.id === 'string' && /^[0-9a-f-]{36}$/i.test(d.id) && ['title', 'description', 'due_local'].every(k => typeof d[k] === 'string')
        && ['daily', 'weekly', 'monthly', 'custom'].includes(String(d.timeline)) && ['easy', 'medium', 'hard'].includes(String(d.difficulty)) && ATTRIBUTES.some(a => a === d.attribute)
        && Array.isArray(d.objectives) && d.objectives.length > 0 && d.objectives.length <= 20 && d.objectives.every((o: unknown) => {
            if (!o || typeof o !== 'object') return false;
            const row = o as Record<string, unknown>;
            return (row.id === undefined || typeof row.id === 'string') && (row.original_target === undefined || typeof row.original_target === 'number') && (row.original_display === undefined || typeof row.original_display === 'string') && ['key', 'title', 'target'].every(k => typeof row[k] === 'string') && typeof row.metric === 'string' && Object.hasOwn(questMetrics, row.metric)
                && (row.activity_kind === '' || matchingKinds(row.metric as QuestMetric).some(k => k === row.activity_kind)) && (row.attribute === '' || ATTRIBUTES.some(a => a === row.attribute));
        });
}
export default function QuestBuilder({ onClose, edit }: { onClose: () => void; edit?: Quest }) {
    const { data, command, busy, pending, refresh } = useOrion();
    const key = `orion-draft:${data?.profile.id}:quest${edit ? `:edit:${edit.id}` : ''}:${data?.profile.units}`;
    const seed = (): Draft => edit ? {
        id: edit.id, revision: edit.edit_revision ?? 0, title: edit.title, description: edit.description ?? '', timeline: edit.timeline ?? 'custom', difficulty: edit.difficulty, attribute: edit.attribute ?? 'Discipline',
        due_local: edit.ends_at || edit.due_at ? dateTimeInput((edit.ends_at || edit.due_at)!, data?.profile.timezone ?? 'UTC') : '',
        objectives: (edit.objectives?.length ? edit.objectives : [{ id: edit.id, title: edit.title, metric: edit.metric, target: edit.target, activity_kind: null, attribute: null }]).map(o => {
            const display = String(o.metric === 'metres' ? Number(fromMetres(o.target, data?.profile.units === 'imperial').toFixed(2)) : o.target);
            return { id: o.id, key: o.id, title: o.title, metric: o.metric, target: display, original_target: o.target, original_display: display, activity_kind: o.activity_kind ?? '', attribute: o.attribute ?? '' };
        }),
    } : fresh();
    const [draft, setDraft] = useState<Draft>(() => { try { const raw: unknown = JSON.parse(localStorage.getItem(key) ?? 'null'); if (isDraft(raw)) return raw; } catch { /* Start fresh. */ } return seed(); });
    const [review, setReview] = useState(false);
    useEffect(() => { try { localStorage.setItem(key, JSON.stringify(draft)); } catch { /* Keep the in-memory draft. */ } }, [draft, key]);
    const savedRevision = () => { try { localStorage.removeItem(key); } catch { /* The server has saved the revision. */ } onClose(); };
    useRevisionSaved('revise_quest', edit?.id, savedRevision);
    if (!data) return null;
    const stale = Boolean(edit && (edit.edit_revision ?? 0) !== (draft.revision ?? 0));
    const imperial = data.profile.units === 'imperial';
    const reward = questReward(draft.timeline === 'custom' ? 'one-off' : draft.timeline, draft.difficulty);
    const update = (patch: Partial<Draft>) => { setReview(false); setDraft(d => ({ ...d, ...patch })); };
    const updateObjective = (key: string, patch: Partial<ObjectiveDraft>) => { setReview(false); setDraft(d => ({ ...d, objectives: d.objectives.map(o => o.key === key ? { ...o, ...patch } : o) })); };
    const deadline = edit ? draft.timeline === 'custom' ? ((edit.ends_at || edit.due_at) && draft.due_local === dateTimeInput((edit.ends_at || edit.due_at)!, data.profile.timezone) ? edit.ends_at ?? edit.due_at : dateTimeInstant(draft.due_local, data.profile.timezone)) : draft.timeline === edit.timeline ? edit.ends_at : bossDeadline(edit.starts_at, data.profile.timezone, draft.timeline) : null;
    if (!edit && data.definitions.some(d => d.id === draft.id)) return <section className="panel quest-builder"><div className="quest-success-emblem"><GameIcon name="quest" /></div><h2 id="quest-builder-title">Quest accepted</h2><p>Your mission is saved in the journal.</p><button onClick={() => setDraft(fresh())}>Create another quest</button><button onClick={onClose}>Back to journal</button></section>;
    return <section className="panel quest-builder" aria-labelledby="quest-builder-title"><header className="quest-forge-header"><div className="quest-forge-copy"><div className="quest-forge-sigil" aria-hidden="true"><GameIcon name="quest" /></div><h2 id="quest-builder-title">{edit ? 'Edit quest' : 'Create quest'}</h2><p>{edit ? 'Add the goals you missed and reshape your next achievement.' : 'Give your next achievement a story.'}</p></div><RpgArt scene="quest" /><button className="quest-dialog-close" onClick={onClose} aria-label="Back to journal">×</button></header>
        {!edit && <><div className="quest-preset-heading"><h3>Choose a starting point</h3><span className="muted">Or write your own below</span></div>
        <div className="quest-presets" aria-label="Quest presets">{[
            { title: 'A chapter worth keeping', timeline: 'daily', attribute: 'Intellect', objectives: [{ title: 'Read for 20 minutes', metric: 'minutes', target: '20', activity_kind: 'reading' }, { title: 'Write down one idea', metric: 'checklist', target: '1', activity_kind: '' }] },
            { title: 'Build your momentum', timeline: 'weekly', attribute: 'Strength', objectives: [{ title: 'Complete three workouts', metric: 'workouts', target: '3', activity_kind: '' }, { title: 'Plan your next session', metric: 'checklist', target: '1', activity_kind: '' }] },
            { title: 'Find your distance', timeline: 'monthly', attribute: 'Endurance', objectives: [{ title: 'Run your distance', metric: 'metres', target: imperial ? '12.43' : '20', activity_kind: 'running' }] },
        ].map(p => <button key={p.title} aria-label={p.title} type="button" disabled={Boolean(pending)} onClick={() => update({ title: p.title, timeline: p.timeline as QuestTimeline, attribute: p.attribute as Attribute, objectives: p.objectives.map(o => ({ ...o, key: crypto.randomUUID(), metric: o.metric as QuestMetric, activity_kind: o.activity_kind as Kind | '', attribute: '' })) })}><GameIcon name={p.attribute as Attribute} /><span>{p.title}<small>{p.timeline.charAt(0).toUpperCase() + p.timeline.slice(1)} quest</small></span></button>)}</div></>}
        {stale && <p role="status" className="feedback">This quest has a newer saved version. Reload the saved version before accepting changes.</p>}
        <form onSubmit={e => {
            e.preventDefault();
            if (edit && !review) { setReview(true); return; }
            void command(edit ? 'revise_quest' : 'create_quest', {
                id: draft.id, title: draft.title, description: draft.description, timeline: draft.timeline, difficulty: draft.difficulty, attribute: draft.attribute,
                ...(edit ? { revision: draft.revision ?? 0, accepted: true, ...(draft.timeline === 'custom' ? { deadline } : {}) } : draft.timeline === 'custom' ? { due_local: draft.due_local } : {}),
                objectives: draft.objectives.map(o => ({ ...(edit && o.id ? { id: o.id } : {}), title: o.title, metric: o.metric, target: o.metric === 'checklist' ? 1 : o.metric === 'metres' ? o.original_target !== undefined && o.original_display === o.target ? o.original_target : toMetres(Number(o.target), imperial) : Number(o.target), activity_kind: o.activity_kind || null, attribute: o.attribute || null })),
            }).then(ok => { if (ok && edit) savedRevision(); });
        }}>

        <fieldset disabled={busy || Boolean(pending)} aria-busy={busy}><div hidden={review}><FormSection title="Quest details"><label>Quest title<input required maxLength={120} value={draft.title} onChange={e => update({ title: e.target.value })} placeholder="What will you achieve?" /></label><label>Description (optional)<textarea maxLength={2000} value={draft.description} onChange={e => update({ description: e.target.value })} /></label>
        </FormSection><FormSection title="Timeline and rewards"><div className="form-grid"><label>Timeline<select value={draft.timeline} onChange={e => update({ timeline: e.target.value as QuestTimeline })}><option value="daily">Daily — one day</option><option value="weekly">Weekly — seven days</option><option value="monthly">Monthly — one calendar month</option><option value="custom">Custom deadline</option></select></label><label>Difficulty<select value={draft.difficulty} onChange={e => update({ difficulty: e.target.value as Difficulty })}>{['easy', 'medium', 'hard'].map(d => <option key={d}>{d}</option>)}</select></label><label>Reward attribute<select value={draft.attribute} onChange={e => update({ attribute: e.target.value as Attribute })}>{ATTRIBUTES.map(a => <option key={a}>{a}</option>)}</select></label></div>
        {draft.timeline === 'custom' && <label>Deadline ({data.profile.timezone})<input type="datetime-local" step="1" required value={draft.due_local} onChange={e => update({ due_local: e.target.value })} /></label>}
        {edit && <p className="muted">Timelines count from the original acceptance, not today. Use a custom deadline to choose another date.</p>}<p className="muted">Only activities performed and logged after acceptance count. Timelines follow {data.profile.timezone}. Finish before the deadline; quests never repeat and expiry has no penalty.</p>
        </FormSection><FormSection title="Objectives"><div className="objective-builder">{draft.objectives.map((o, i) => <fieldset className="objective-draft" key={o.key}><legend>Objective {i + 1}</legend><label>Objective title<input required maxLength={120} value={o.title} onChange={e => updateObjective(o.key, { title: e.target.value })} /></label><div className="form-grid"><label>Progress from<select value={o.metric} onChange={e => updateObjective(o.key, { metric: e.target.value as QuestMetric, original_target: undefined, original_display: undefined, target: '1', activity_kind: '', attribute: '' })}>{Object.entries(questMetrics).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>{o.metric !== 'checklist' && <label>Target{o.metric === 'metres' ? ` (${imperial ? 'mi' : 'km'})` : ''}<input type="number" min={o.metric === 'metres' ? '0.01' : '1'} max={o.metric === 'metres' ? (imperial ? 6213 : 10000) : 10000000} step={o.metric === 'metres' || o.metric === 'minutes' ? '0.01' : '1'} required value={o.target} onChange={e => updateObjective(o.key, { target: e.target.value })} /></label>}
        {!['checklist', 'manual'].includes(o.metric) && <><label>Activity filter<select value={o.activity_kind} onChange={e => { const kind = e.target.value as Kind | ''; updateObjective(o.key, { activity_kind: kind, attribute: o.attribute && kind && attributeFor(kind) !== o.attribute ? '' : o.attribute }); }}><option value="">Any matching activity</option>{matchingKinds(o.metric).map(k => <option key={k}>{k}</option>)}</select></label><label>Attribute filter<select value={o.attribute} onChange={e => updateObjective(o.key, { attribute: e.target.value as Attribute | '' })}><option value="">Any attribute</option>{ATTRIBUTES.filter(a => matchingKinds(o.metric, a).length && (!o.activity_kind || attributeFor(o.activity_kind) === a)).map(a => <option key={a}>{a}</option>)}</select></label></>}
        </div><button className="text-button" type="button" disabled={draft.objectives.length === 1} onClick={() => update({ objectives: draft.objectives.filter(row => row.key !== o.key) })}>Remove objective {i + 1}</button></fieldset>)}</div>
        <button className="outlined" type="button" disabled={draft.objectives.length >= 20} onClick={() => update({ objectives: [...draft.objectives, objective()] })}>Add objective</button>
        </FormSection></div>{edit && review && <div className="boss-acceptance"><h3>Review quest changes</h3><p>{draft.title}</p><p>Deadline: {deadline ? new Date(deadline).toLocaleString(undefined, { timeZone: data.profile.timezone }) : 'Choose a valid deadline'} ({data.profile.timezone})</p><ul>{draft.objectives.map(o => <li key={o.key}>{o.title} — {o.target} {o.metric === 'metres' ? imperial ? 'mi' : 'km' : o.metric}</li>)}</ul><p>Acceptance stays at {new Date(edit.starts_at).toLocaleString(undefined, { timeZone: data.profile.timezone })}. Existing goals keep manual progress when their type is unchanged. Activity goals recalculate from the original tracking window. Removing goals or reducing targets can complete this quest and linked bosses immediately.</p><button type="button" onClick={() => setReview(false)}>Continue editing</button></div>}<FormActions><div className="quest-acceptance"><GameIcon name={draft.attribute} /><div><strong>{reward.xp} XP + {reward.points} {draft.attribute}</strong><p>Earned once, when every objective is complete. {edit ? 'Rewards recalculate from the revised timeline and difficulty.' : 'Active goals and rewards can be revised before completion.'}</p></div></div><button className="reward-action" disabled={stale} type="submit">{busy ? 'Saving…' : edit ? review ? 'Accept changes and rewards' : 'Review changes' : 'Accept quest'}</button></FormActions>{edit && <button className="text-button" type="button" onClick={() => { try { localStorage.removeItem(key); } catch { /* The next edit starts from confirmed data. */ } onClose(); void refresh(); }}>Discard draft and reload</button>}</fieldset></form>
    </section>;
}
