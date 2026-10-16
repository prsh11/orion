import { useState } from 'react';
import { useOrion } from './context';
import { ATTRIBUTES } from './types';
import type { Difficulty, Period, Quest, QuestDefinition } from './types';
import { metricLabel, questReward } from './logic';
import Bosses from './Bosses';
import Todos from './Todos';
import GameIcon from './GameIcon';

export function QuestCard({ quest: q }: { quest: Quest }) {
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
    </article>;
}
export default function Quests() {
    const { data, command, busy } = useOrion();
    const [period, setPeriod] = useState<Period>('daily');
    const [difficulty, setDifficulty] = useState<Difficulty>('medium');
    const [history, setHistory] = useState(false);
    if (!data) return null;
    const reward = questReward(period, difficulty);
    const isCurrent = (q: Quest) => !q.archived && !q.completed_at && (q.period === 'one-off' || q.ends_at !== null && q.ends_at > data.server_time);
    const quests = data.quests.filter(q => q.kind !== 'todo');
    const current = quests.filter(isCurrent);
    return <><Todos /><section className="panel"><div className="section-heading"><h2>Quest log</h2><button onClick={() => setHistory(!history)}>{history ? 'Current quests' : 'Quest history'}</button></div><p className="muted">Calendar periods follow {data.profile.timezone}. Weeks start Monday. Missing a quest has no penalty.</p><div className="quest-grid">{(history ? quests.filter(q => !isCurrent(q)) : current).map(q => <QuestCard quest={q} key={q.id} />)}</div>{!(history ? quests.filter(q => !isCurrent(q)) : current).length && <p className="empty">{history ? 'Past quest instances will stay here.' : 'Choose a template or create your first quest below.'}</p>}</section>
        <section className="panel"><h2>Create a recurring quest</h2><form onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); void command('quest', { title: f.get('title'), period, target: Number(f.get('target')), metric: f.get('metric'), attribute: f.get('attribute'), difficulty }).then(ok => { if (ok) { form.reset(); setPeriod('daily'); setDifficulty('medium'); } }); }}><label>Title<input name="title" maxLength={120} required /></label><div className="form-grid"><label>Period<select value={period} onChange={e => setPeriod(e.target.value as Period)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label>Difficulty<select value={difficulty} onChange={e => setDifficulty(e.target.value as Difficulty)}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label><label>Progress from<select name="metric" defaultValue="manual">{Object.entries(metricLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Target<input name="target" type="number" min="1" max="10000000" required defaultValue="1" /></label><label>Attribute<select aria-label="Attribute" name="attribute" defaultValue="" required><option value="" disabled>Select an attribute</option>{ATTRIBUTES.map(a => <option key={a}>{a}</option>)}</select></label></div><p className="muted">Automatic progress counts activities in the selected attribute. Running distance targets are in metres.</p><p className="reward-preview">Reward: {reward.xp} XP + {reward.points} points in the chosen attribute</p><button className="primary" disabled={busy}>Create quest</button></form>
        <details><summary>Manage quests</summary><p className="muted">Recurring changes apply to future periods. One-off tasks allow title corrections only; archiving closes them without rewards. Archiving recurring quests stops future instances. Existing history and settled rewards remain.</p>{data.definitions.filter(d => d.kind !== 'todo' && !d.archived).map(d => <QuestEditor definition={d} key={d.id} />)}</details></section>
        <section className="panel"><h2>Choose a quest</h2><div className="template-grid">{[
            { title: 'A chapter a day', period: 'daily', target: 20, metric: 'minutes', attribute: 'Intellect' },
            { title: 'Show up three times', period: 'weekly', target: 3, metric: 'workouts', attribute: 'Strength' },
            { title: 'Find your distance', period: 'monthly', target: 20000, metric: 'metres', attribute: 'Endurance' },
        ].map(t => <article key={t.title}><h3>{t.title}</h3><p>{t.target} {metricLabel[t.metric as keyof typeof metricLabel]} / {t.period}</p><p className="reward-preview">+{questReward(t.period as Period).xp} XP / +{questReward(t.period as Period).points} {t.attribute}</p><button disabled={busy || data.definitions.some(d => !d.archived && d.title === t.title)} onClick={() => { void command('quest', t); }}>Activate quest</button></article>)}</div></section>
        <Bosses />
    </>;
}
function QuestEditor({ definition: d }: { definition: QuestDefinition }) {
    const { command, busy } = useOrion();
    return <details><summary>Edit {d.title}</summary><form onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        void command('edit_quest', d.period === 'one-off' ? { id: d.id, title: f.get('title') } : { id: d.id, title: f.get('title'), metric: f.get('metric'), target: Number(f.get('target')), attribute: f.get('attribute'), difficulty: f.get('difficulty') });
    }}><label>Quest title<input name="title" defaultValue={d.title} required maxLength={120} /></label><fieldset disabled={d.period === 'one-off'}><div className="form-grid"><label>Difficulty<select name="difficulty" defaultValue={d.difficulty}><option value="easy">Easy</option><option value="medium">Medium</option><option value="hard">Hard</option></select></label><label>Target<input type="number" name="target" min="1" max="10000000" defaultValue={d.target} required /></label><label>Progress from<select name="metric" defaultValue={d.metric}>{Object.entries(metricLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Attribute<select aria-label="Attribute" name="attribute" defaultValue={d.attribute ?? ''}>{ATTRIBUTES.map(a => <option key={a}>{a}</option>)}</select></label></div></fieldset><p className="muted">Period stays {d.period}. Current and completed instances keep their original goals and rewards.</p><div className="button-row"><button disabled={busy}>{d.period === 'one-off' ? 'Save title' : 'Save future quest'}</button><button type="button" disabled={busy} onClick={() => { void command('archive_quest', { id: d.id }); }}>Archive quest</button></div></form></details>;
}
