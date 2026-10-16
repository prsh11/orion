import { useState } from 'react';
import { useOrion } from './context';
import { dayKey, deadlineInput, questReward, todoOrder } from './logic';
import GameIcon from './GameIcon';
import AudioFX from '../audio';
import { ATTRIBUTES } from './types';
import type { Attribute, Difficulty, Quest } from './types';

function TodoForm({ todo, onDone }: { todo?: Quest; onDone?: () => void }) {
    const { data, command, busy } = useOrion();
    const [difficulty, setDifficulty] = useState<Difficulty>(todo?.difficulty ?? 'medium');
    const [attribute, setAttribute] = useState<Attribute | ''>(todo?.attribute ?? '');
    const [deadline, setDeadline] = useState(deadlineInput(todo?.due_at ?? null, data?.profile.timezone ?? 'UTC'));
    if (!data) return null;
    const frozen = Boolean(todo && (todo.completed_at || todo.due_at && new Date(todo.due_at) <= new Date(data.server_time)));
    const reward = questReward('one-off', difficulty);
    const fields = <>
        <div className="form-grid">
            <label>Difficulty<select aria-label="Difficulty" value={difficulty} onChange={e => setDifficulty(e.target.value as Difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label>
            <label>Attribute<select aria-label="Todo attribute" value={attribute} onChange={e => setAttribute(e.target.value as Attribute | '')}><option value="">None</option>{ATTRIBUTES.map(a => <option key={a}>{a}</option>)}</select></label>
            <label>Planned date<input name="planned_on" type="date" defaultValue={todo?.planned_on ?? dayKey(data.server_time, data.profile.timezone)} required /></label>
            <label>Optional deadline ({data.profile.timezone})<input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} /></label>
        </div>
        <p className="reward-preview">On time: +{reward.xp} XP{attribute ? ` / +1 ${attribute}` : ''}.</p>
        {deadline && <p className="muted small">Late: +{reward.xp - Math.ceil(reward.xp / 4)} XP (−{Math.ceil(reward.xp / 4)} XP){attribute ? ` / −1 ${attribute}, with no attribute reward` : ''}. No deduction until completion.</p>}
    </>;
    return <form className="todo-form" onSubmit={e => {
        e.preventDefault(); const form = e.currentTarget; const f = new FormData(form);
        const payload: Record<string, unknown> = { title: f.get('title') };
        if (todo) payload.id = todo.id;
        if (!frozen) {
            Object.assign(payload, { difficulty, attribute: attribute || null, planned_on: f.get('planned_on') });
            if (!todo || deadline !== deadlineInput(todo.due_at, data.profile.timezone)) payload.due_local = deadline || null;
        }
        void command(todo ? 'edit_todo' : 'todo', payload).then(ok => {
            if (ok) { if (!todo) { form.reset(); setDifficulty('medium'); setAttribute(''); setDeadline(''); } onDone?.(); }
        });
    }}>
        <div className="todo-add"><label className="grow">{todo ? 'Todo title' : 'New todo'}<input name="title" placeholder="Get groceries" defaultValue={todo?.title ?? ''} maxLength={120} required /></label><button className="primary" disabled={busy}>{todo ? 'Save todo' : 'Add todo'}</button></div>
        {frozen ? <p className="muted small">Only title corrections are available after the deadline or completion.</p> : todo ? fields : <details onToggle={e => { if (e.currentTarget.open) AudioFX.click(); }}><summary>Options · {reward.xp} XP{attribute ? ` / ${attribute}` : ''}</summary>{fields}</details>}
    </form>;
}
function TodoRow({ todo: q }: { todo: Quest }) {
    const { data, command, busy } = useOrion();
    const [editing, setEditing] = useState(false);
    if (!data) return null;
    const overdue = !q.completed_at && q.due_at && new Date(q.due_at) <= new Date(data.server_time);
    const today = dayKey(data.server_time, data.profile.timezone);
    return <article className={`todo-row ${q.completed_at ? 'todo-complete' : ''}`}>
        <div className="todo-line">
            <input className="todo-check" type="checkbox" aria-label={`Complete ${q.title}`} checked={Boolean(q.completed_at)} disabled={busy || q.archived} onChange={e => { void command('set_todo_completed', { id: q.id, completed: e.target.checked }); }} />
            <div className="todo-copy"><h3>{q.title}</h3><p className="muted small">{q.archived ? 'Archived' : q.completed_at ? 'Complete' : overdue ? 'Overdue' : q.due_at ? 'Due' : 'No deadline'}{q.planned_on && q.planned_on < today && !q.completed_at ? ` · Carried from ${q.planned_on}` : q.planned_on && q.planned_on > today ? ` · Planned ${q.planned_on}` : ''}{q.due_at && ` · ${new Date(q.due_at).toLocaleString(undefined, { timeZone: data.profile.timezone })}`}</p><p className="todo-terms">{q.difficulty} · +{q.reward_xp} XP{q.attribute ? ` / +1 ${q.attribute} on time` : ''}{q.due_at ? ` · Late: +${q.reward_xp - Math.ceil(q.reward_xp / 4)} XP${q.attribute ? ` / −1 ${q.attribute}` : ''}` : ''}</p></div>
            {!q.archived && <button className="text-button" onClick={() => setEditing(!editing)} aria-expanded={editing}>Edit</button>}
        </div>
        {editing && <div className="todo-editor"><TodoForm todo={q} onDone={() => setEditing(false)} /><button disabled={busy} className="text-button" onClick={() => { void command('archive_todo', { id: q.id }); }}>Archive todo</button></div>}
        {q.completion_history.length > 0 && <details className="todo-history"><summary>Completion history</summary>{q.completion_history.map(outcome => <p className="muted small" key={outcome.revision}>{new Date(outcome.completed_at).toLocaleString(undefined, { timeZone: data.profile.timezone })}: reward {outcome.reward_xp} XP{outcome.attribute ? ` / ${outcome.reward_points} ${outcome.attribute}` : ''}; penalty −{outcome.penalty_xp} XP{outcome.attribute ? ` / −${outcome.penalty_points} ${outcome.attribute}` : ''}; applied {outcome.applied_xp >= 0 ? '+' : ''}{outcome.applied_xp} XP{outcome.attribute ? ` / ${outcome.applied_points >= 0 ? '+' : '−'}${Math.abs(outcome.applied_points)} ${outcome.attribute}` : ''}.{outcome.undone_at ? ` Unchecked ${new Date(outcome.undone_at).toLocaleString(undefined, { timeZone: data.profile.timezone })}.` : ''}</p>)}</details>}
    </article>;
}
export default function Todos({ compact = false }: { compact?: boolean }) {
    const { data } = useOrion();
    const [view, setView] = useState<'today' | 'upcoming' | 'history'>('today');
    if (!data) return null;
    const today = dayKey(data.server_time, data.profile.timezone);
    const todos = data.quests.filter(q => q.kind === 'todo');
    const forToday = (q: Quest) => !q.archived && (!q.completed_at ? (q.planned_on ?? today) <= today || Boolean(q.due_at && dayKey(q.due_at, data.profile.timezone) <= today) : dayKey(q.completed_at, data.profile.timezone) === today);
    const rows = todos.filter(q => view === 'history' ? q.archived || q.completion_history.length > 0 : view === 'upcoming' ? !q.archived && !q.completed_at && !forToday(q) : forToday(q)).sort(todoOrder);
    return <section className="panel todo-panel" aria-label="Daily todos"><div className="section-heading"><div><h2><GameIcon name="todo" />Today</h2><p className="muted small">Small things, off your mind.</p></div><span className="daily-summary">{todos.filter(q => q.completed_at && dayKey(q.completed_at, data.profile.timezone) === today).length} done today</span></div>
        {!compact && <TodoForm />}
        {!compact && <div className="button-row todo-tabs" aria-label="Todo views">{(['today', 'upcoming', 'history'] as const).map(tab => <button key={tab} aria-pressed={view === tab} onClick={() => setView(tab)}>{tab === 'today' ? 'Today' : tab === 'upcoming' ? 'Upcoming' : 'Todo history'}</button>)}</div>}
        <div className="todo-list">{rows.map(q => <TodoRow todo={q} key={q.id} />)}</div>
        {!rows.length && <p className="empty">{view === 'today' ? compact ? 'No todos for today. Add one in Quests.' : 'What would you like to get done today? Add a todo above.' : view === 'upcoming' ? 'No upcoming todos.' : 'Completed and archived todos will stay here.'}</p>}
    </section>;
}
