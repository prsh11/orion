import { useRef, useState } from 'react';
import { useOrion } from './context';
import type { Quest, QuestObjective } from './types';
import { fromMetres, metricLabel, questReward } from './logic';
import { questMetrics, questStatus, questSummary } from './questLogic';
import Bosses from './Bosses';
import Todos from './Todos';
import GameIcon from './GameIcon';
import QuestBuilder from './QuestBuilder';

function LegacyQuestCard({ quest: q }: { quest: Quest }) {
    const { command, busy, data, presentations } = useOrion();
    const reward = { xp: q.reward_xp ?? questReward(q.period, q.difficulty).xp, points: q.reward_points ?? questReward(q.period, q.difficulty).points };
    const expired = q.period !== 'one-off' && q.ends_at !== null && q.ends_at <= (data?.server_time ?? '');
    const overdue = q.due_at && q.due_at <= (data?.server_time ?? '');
    const justCompleted = q.completed_at && presentations[0]?.eventIds.some(id => data?.events.some(event => event.id === id && event.source === `quest:${q.id}`));
    return <article className={`quest-card ${q.completed_at ? 'complete' : ''} ${justCompleted ? 'quest-just-completed' : ''}`}><div className="entry-heading"><span className="attribute-tag violet">{q.attribute && <GameIcon name={q.attribute} />}{q.period}</span><span>{q.completed_at ? 'Complete' : q.archived ? 'Archived' : expired ? 'Period ended' : overdue ? 'Overdue' : q.due_at || q.ends_at ? 'Due' : 'No deadline'}</span></div><h3><GameIcon name={q.completed_at ? 'check' : 'quest'} />{q.title}</h3><p className="muted">{q.target} {metricLabel[q.metric]} · {q.attribute}</p><progress max={q.target} value={q.progress} aria-label={`${q.title}: ${q.progress} of ${q.target}`} /><p className="reward-preview">+{reward.xp} XP / +{reward.points} {q.attribute}</p>
        <small>{q.due_at || q.ends_at ? `Due ${new Date((q.due_at || q.ends_at)!).toLocaleString(undefined, { timeZone: data?.profile.timezone })}` : 'No deadline'} · {q.difficulty ?? 'medium'}</small>
        {q.completed_at && <p>Completed {new Date(q.completed_at).toLocaleString(undefined, { timeZone: data?.profile.timezone })}. Reward: {reward.xp} XP / {reward.points} {q.attribute}. Penalty: −{q.penalty_xp ?? 0} XP / −{q.penalty_points ?? 0} {q.attribute}. Net: +{reward.xp - (q.penalty_xp ?? 0)} XP / +{reward.points - (q.penalty_points ?? 0)} {q.attribute}.</p>}
        {!q.completed_at && q.due_at && <p className="muted">Late completion: −{Math.ceil(reward.xp / 4)} XP / −1 {q.attribute}; net +{reward.xp - Math.ceil(reward.xp / 4)} XP / +{reward.points - 1} {q.attribute}.</p>}
        {q.metric === 'manual' && !q.completed_at && !q.archived && !expired && <form className="button-row" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void command('quest_progress', { id: q.id, count: Number(f.get('count')) }); }}>{q.target === 1 ? <input type="hidden" name="count" value="1" /> : <label className="grow">Add progress<input type="number" name="count" min="1" max={q.target} defaultValue="1" required /></label>}<button disabled={busy}>{q.target === 1 ? 'Complete task' : 'Add count'}</button></form>}
        {q.period === 'one-off' && !q.archived && <details><summary>Manage existing quest</summary><p className="muted small">This quest keeps its original accepted goals and reward rules.</p><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void command('edit_quest', { id: q.definition_id, title: f.get('title') }); }}><label>Existing quest title<input name="title" defaultValue={q.title} maxLength={120} required /></label><div className="button-row"><button disabled={busy}>Save title</button>{!q.completed_at && <button type="button" disabled={busy} onClick={() => { void command('archive_quest', { id: q.definition_id }); }}>Archive quest</button>}</div></form></details>}
    </article>;
}
const statusLabel = { active: 'In progress', completed: 'Completed', expired: 'Expired', abandoned: 'Abandoned' };
export function QuestCard({ quest: q }: { quest: Quest }) {
    const { data } = useOrion();
    if (!q.timeline) return <LegacyQuestCard quest={q} />;
    return <article className="quest-card mission-preview"><div className="entry-heading"><span className="attribute-tag violet"><GameIcon name="quest" />One-time quest</span><span>{statusLabel[questStatus(q, data?.server_time ?? '')]}</span></div><h3>{q.title}</h3><p>{questSummary(q)}</p><progress max={q.target} value={q.progress} aria-label={`${q.title}: ${questSummary(q)}`} /><p className="reward-preview">{q.reward_xp} XP + {q.reward_points} {q.attribute}</p><small>Deadline {new Date(q.ends_at!).toLocaleString(undefined, { timeZone: data?.profile.timezone })}</small></article>;
}
function ObjectiveRow({ objective: o, quest: q }: { objective: QuestObjective; quest: Quest }) {
    const { data, command, busy, pending } = useOrion();
    const complete = o.progress >= o.target;
    const active = questStatus(q, data?.server_time ?? '') === 'active';
    const imperial = data?.profile.units === 'imperial';
    const format = (n: number) => o.metric === 'metres' ? `${Number(fromMetres(n, imperial).toFixed(2))} ${imperial ? 'mi' : 'km'}` : n.toLocaleString();
    return <li className={`mission-objective ${complete ? 'is-complete' : ''}`}><span className="objective-node"><GameIcon name={complete ? 'check' : o.metric === 'checklist' || o.metric === 'manual' ? 'todo' : 'orbit'} /></span><div className="objective-body"><h4>{o.title}</h4><p className="muted">{questMetrics[o.metric]}{o.activity_kind ? ` · ${o.activity_kind}` : ''}{o.attribute ? ` · ${o.attribute}` : ''}</p>
        {o.metric !== 'checklist' && <><progress value={o.progress} max={o.target} aria-label={`${o.title}: ${format(o.progress)} of ${format(o.target)}`} /><p className="objective-count">{format(o.progress)} / {format(o.target)}</p></>}
        {active && o.metric === 'checklist' && <label className="objective-checkbox"><input type="checkbox" aria-label={`Complete ${o.title}`} checked={complete} disabled={busy || Boolean(pending)} onChange={e => { void command('set_quest_objective', { id: q.id, objective_id: o.id, progress: e.target.checked ? 1 : 0 }); }} />{complete ? 'Completed' : 'Mark complete'}</label>}
        {active && o.metric === 'manual' && <form className="button-row" key={`${o.id}:${o.progress}`} onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void command('set_quest_objective', { id: q.id, objective_id: o.id, progress: Number(f.get('progress')) }); }}><label>Completed count<input name="progress" aria-label={`Completed count for ${o.title}`} type="number" min="0" max={o.target} step="1" defaultValue={o.progress} required /></label><button disabled={busy || Boolean(pending)}>Save count</button></form>}
        {!active && o.metric === 'checklist' && <span>{complete ? 'Completed' : 'Unfinished'}</span>}
    </div></li>;
}
function MissionDossier({ quest: q }: { quest: Quest }) {
    const { data, command, busy, pending } = useOrion();
    const [confirmAbandon, setConfirmAbandon] = useState(false);
    const status = questStatus(q, data?.server_time ?? '');
    return <article className={`mission-dossier mission-${status}`}><div className="mission-heading"><div className="mission-sigil"><GameIcon name={q.completed_at ? 'star' : q.attribute ?? 'quest'} /></div><div><p className="mission-state">{statusLabel[status]} / {q.difficulty}</p><h3>{q.title}</h3></div></div>
        {q.description && <p className="mission-description">{q.description}</p>}
        <div className="mission-terms"><div><span>Timeline</span><strong>{q.timeline === 'custom' ? 'Custom deadline' : q.timeline}</strong><small>{new Date(q.starts_at).toLocaleString(undefined, { timeZone: data?.profile.timezone })} — {new Date(q.ends_at!).toLocaleString(undefined, { timeZone: data?.profile.timezone })}</small></div><div className="mission-reward"><GameIcon name={q.attribute ?? 'star'} /><span>{status === 'completed' ? 'Reward earned' : 'Completion reward'}</span><strong>{q.reward_xp} XP</strong><small>+{q.reward_points} {q.attribute}</small></div></div>
        <div className="section-heading objective-heading"><h4>Objective path</h4><span>{questSummary(q)}</span></div><ol className="mission-path">{q.objectives?.map(o => <ObjectiveRow key={o.id} objective={o} quest={q} />)}</ol>
        <p className="muted small">{status === 'active' ? 'Complete every objective before the deadline. Activities count from acceptance. This quest will not repeat.' : status === 'expired' ? 'The deadline passed. No quest reward or penalty was applied.' : status === 'abandoned' ? 'This attempt was closed without a quest reward or penalty.' : 'Achievement secured. This quest is complete and will not repeat.'}</p>
        <details className="mission-edit"><summary>Correct quest text</summary><form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void command('edit_mission', { id: q.id, title: f.get('title'), description: f.get('description') }); }}><label>Quest title<input name="title" defaultValue={q.title} required maxLength={120} /></label><label>Description<textarea name="description" defaultValue={q.description} maxLength={2000} /></label><button disabled={busy || Boolean(pending)}>Save text</button></form></details>
        {status === 'active' && (confirmAbandon ? <div className="abandon-confirm"><p>Close this attempt without rewards? Your activity records stay saved.</p><div className="button-row"><button disabled={busy || Boolean(pending)} onClick={() => { void command('abandon_quest', { id: q.id }); }}>Confirm abandonment</button><button onClick={() => setConfirmAbandon(false)}>Keep quest</button></div></div> : <button className="text-button" onClick={() => setConfirmAbandon(true)}>Abandon quest</button>)}
    </article>;
}
export default function Quests() {
    const { data } = useOrion();
    const [view, setView] = useState<'active' | 'completed' | 'past'>('active');
    const [selected, setSelected] = useState('');
    const [creating, setCreating] = useState(false);
    const detail = useRef<HTMLDivElement>(null);
    if (!data) return null;
    const quests = data.quests.filter(q => q.kind !== 'todo');
    const list = quests.filter(q => { const status = questStatus(q, data.server_time); return view === 'past' ? status === 'expired' || status === 'abandoned' : status === view; }).sort((a, b) => (a.ends_at ?? a.due_at ?? '9999').localeCompare(b.ends_at ?? b.due_at ?? '9999'));
    const current = list.find(q => q.id === selected) ?? list[0];
    return <><section className="quest-journal" aria-labelledby="quest-journal-title"><header className="journal-header"><div className="journal-title"><GameIcon name="quest" /><div><h2 id="quest-journal-title">Quest journal</h2><p>Choose a goal. Follow the path. Earn your achievement.</p></div></div><button className="primary" onClick={() => setCreating(true)}>Create quest</button></header>
        {creating ? <QuestBuilder key={`${data.profile.id}:${data.profile.units}`} onClose={() => setCreating(false)} /> : <><div className="journal-tabs" role="group" aria-label="Quest status">{(['active', 'completed', 'past'] as const).map(v => <button key={v} aria-pressed={view === v} onClick={() => setView(v)}>{v === 'active' ? 'Active' : v === 'completed' ? 'Completed' : 'Past'}</button>)}</div>
        {list.length ? <div className="journal-layout"><nav className="mission-roster" aria-label="Quest roster">{list.map(q => <button key={q.id} className="mission-roster-entry" aria-current={q.id === current?.id ? 'true' : undefined} onClick={() => { setSelected(q.id); requestAnimationFrame(() => { detail.current?.focus({ preventScroll: true }); if (window.matchMedia('(max-width: 760px)').matches) detail.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }); }}><GameIcon name={q.completed_at ? 'star' : q.attribute ?? 'quest'} /><span><strong>{q.title}</strong><small>{questSummary(q)}</small><progress max={q.target} value={q.progress} aria-label={`${q.title}: ${questSummary(q)}`} /><small>{q.reward_xp} XP · {statusLabel[questStatus(q, data.server_time)]}</small></span></button>)}</nav><div className="mission-detail" role="region" aria-label="Quest details" tabIndex={-1} ref={detail}>{current && (current.timeline ? <MissionDossier key={current.id} quest={current} /> : <LegacyQuestCard quest={current} />)}</div></div> : <div className="journal-empty"><GameIcon name={view === 'completed' ? 'star' : 'quest'} /><h3>{view === 'active' ? 'Your next achievement starts here' : view === 'completed' ? 'A place for your achievements' : 'Every attempt has a story'}</h3><p>{view === 'active' ? 'Build a one-time quest with tasks, activity goals, and a deadline you choose.' : view === 'completed' ? 'Completed quests and their earned rewards will stay here.' : 'Expired and abandoned quests will stay here without penalties.'}</p>{view === 'active' && <button onClick={() => setCreating(true)}>Create your first quest</button>}</div>}</>}
    </section><Todos /><Bosses /></>;
}
