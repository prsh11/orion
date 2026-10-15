import { useState } from 'react';
import { useOrion } from './context';
import { ATTRIBUTES } from './types';
import type { Period, Quest, QuestDefinition } from './types';
import { metricLabel, questReward } from './logic';

export function QuestCard({ quest: q }: { quest: Quest }) {
    const { command, busy, data } = useOrion();
    const reward = questReward(q.period);
    const expired = q.ends_at <= (data?.server_time ?? '');
    return <article className={`quest-card ${q.completed_at ? 'complete' : ''}`}><div className="entry-heading"><span className="attribute-tag violet">{q.period}</span><span>{q.completed_at ? 'Complete' : expired ? 'Ended · no penalty' : `${Math.min(q.progress, q.target)} / ${q.target}`}</span></div><h3>{q.title}</h3><p className="muted">{q.target} {metricLabel[q.metric]} · {q.attribute}</p><progress max={q.target} value={q.progress} aria-label={`${q.title}: ${q.progress} of ${q.target}`} /><p className="reward-preview">+{reward.xp} XP / +{reward.points} {q.attribute}</p>
        <small>Ends {new Date(q.ends_at).toLocaleString(undefined, { timeZone: data?.profile.timezone })}</small>
        {q.metric === 'manual' && !q.completed_at && !expired && <form className="button-row" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void command('quest_progress', { id: q.id, count: Number(f.get('count')) }); }}><label className="grow">Add progress<input type="number" name="count" min="1" max={q.target} defaultValue="1" required /></label><button disabled={busy}>Add</button></form>}
    </article>;
}
export default function Quests() {
    const { data, command, busy } = useOrion();
    const [period, setPeriod] = useState<Period>('daily');
    const [history, setHistory] = useState(false);
    if (!data) return null;
    const reward = questReward(period);
    const current = data.quests.filter(q => q.ends_at > data.server_time);
    return <><section className="panel"><div className="section-heading"><h2>Quest log</h2><button onClick={() => setHistory(!history)}>{history ? 'Current quests' : 'Quest history'}</button></div><p className="muted">Calendar periods follow {data.profile.timezone}. Weeks start Monday. Missing a quest has no penalty.</p><div className="quest-grid">{(history ? data.quests.filter(q => q.ends_at <= data.server_time) : current).map(q => <QuestCard quest={q} key={q.id} />)}</div>{!(history ? data.quests.filter(q => q.ends_at <= data.server_time) : current).length && <p className="empty">{history ? 'Past quest instances will stay here.' : 'Choose a template or create your first quest below.'}</p>}</section>
        <section className="panel"><h2>Choose a quest</h2><div className="template-grid">{[
            { title: 'A chapter a day', period: 'daily', target: 20, metric: 'minutes', attribute: 'Intellect' },
            { title: 'Show up three times', period: 'weekly', target: 3, metric: 'workouts', attribute: 'Strength' },
            { title: 'Find your distance', period: 'monthly', target: 20000, metric: 'metres', attribute: 'Endurance' },
        ].map(t => <article key={t.title}><h3>{t.title}</h3><p>{t.target} {metricLabel[t.metric as keyof typeof metricLabel]} / {t.period}</p><p className="reward-preview">+{questReward(t.period as Period).xp} XP / +{questReward(t.period as Period).points} {t.attribute}</p><button disabled={busy || data.definitions.some(d => !d.archived && d.title === t.title)} onClick={() => { void command('quest', t); }}>Activate quest</button></article>)}</div></section>
        <section className="panel"><h2>Create a recurring quest</h2><form onSubmit={e => { e.preventDefault(); const form = e.currentTarget; const f = new FormData(form); void command('quest', { title: f.get('title'), period, target: Number(f.get('target')), metric: f.get('metric'), attribute: f.get('attribute') }).then(ok => { if (ok) form.reset(); }); }}><label>Title<input name="title" maxLength={120} required /></label><div className="form-grid"><label>Period<select value={period} onChange={e => setPeriod(e.target.value as Period)}><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><label>Progress from<select name="metric">{Object.entries(metricLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Target<input name="target" type="number" min="1" max="10000000" required defaultValue="30" /></label><label>Attribute<select name="attribute">{ATTRIBUTES.map(a => <option key={a}>{a}</option>)}</select></label></div><p className="muted">Automatic progress counts activities in the selected attribute. Running distance targets are in metres.</p><p className="reward-preview">Reward: {reward.xp} XP + {reward.points} points in the chosen attribute</p><button className="primary" disabled={busy}>Activate quest</button></form>
        <details><summary>Manage recurring quests</summary><p className="muted">Changes apply to future periods. Archiving stops future instances. Existing history and settled rewards remain.</p>{data.definitions.filter(d => !d.archived).map(d => <QuestEditor definition={d} key={d.id} />)}</details></section>
    </>;
}
function QuestEditor({ definition: d }: { definition: QuestDefinition }) {
    const { command, busy } = useOrion();
    return <details><summary>Edit {d.title}</summary><form onSubmit={e => {
        e.preventDefault(); const f = new FormData(e.currentTarget);
        void command('edit_quest', { id: d.id, title: f.get('title'), metric: f.get('metric'), target: Number(f.get('target')), attribute: f.get('attribute') });
    }}><label>Quest title<input name="title" defaultValue={d.title} required maxLength={120} /></label><div className="form-grid"><label>Target<input type="number" name="target" min="1" max="10000000" defaultValue={d.target} required /></label><label>Progress from<select name="metric" defaultValue={d.metric}>{Object.entries(metricLabel).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label><label>Attribute<select name="attribute" defaultValue={d.attribute}>{ATTRIBUTES.map(a => <option key={a}>{a}</option>)}</select></label></div><p className="muted">Period stays {d.period}. Current and completed instances keep their original goals and rewards.</p><div className="button-row"><button disabled={busy}>Save future quest</button><button type="button" disabled={busy} onClick={() => { void command('archive_quest', { id: d.id }); }}>Archive quest</button></div></form></details>;
}
