import { Panel } from './PageLayout';
import { useEffect, useState } from 'react';
import { useOrion } from './context';
import BossPortrait from './BossPortrait';
import { BossHealth } from './BossVitals';
import { requirementsFor, stakesFor } from './bossLogic';
import { questStatus } from './questLogic';
import { dashboardQuestProgress, remainingTime } from './dashboardLogic';
import type { Navigate } from './navigation';
import GameIcon from './GameIcon';
import Todos from './Todos';
import { DailyCare } from './Tracking';

export default function Dashboard({ navigate }: { navigate: Navigate }) {
    const { data } = useOrion();
    const [clock, setClock] = useState<{ source?: string; elapsed: number }>({ elapsed: 0 });
    const serverTime = data?.server_time;
    useEffect(() => {
        const start = Date.now();
        const timer = setInterval(() => setClock({ source: serverTime, elapsed: Date.now() - start }), 30000);
        return () => clearInterval(timer);
    }, [serverTime]);
    if (!data) return null;
    const now = Date.parse(data.server_time) + (clock.source === serverTime ? clock.elapsed : 0);
    const imperial = data.profile.units === 'imperial';
    const quests = data.quests.filter(q => q.kind !== 'todo' && questStatus(q, data.server_time) === 'active')
        .sort((a, b) => (a.ends_at ?? a.due_at ?? '9999').localeCompare(b.ends_at ?? b.due_at ?? '9999') || a.id.localeCompare(b.id));
    const bosses = data.bosses.filter(b => b.status === 'active');
    const boss = bosses[0];
    return <div className="dashboard mission-dashboard">
        <div className="page-actions"><button className="primary" onClick={() => navigate('Training', { section: 'log' })}><GameIcon name="training" />Log training</button><button onClick={() => navigate('Journal', { section: 'entry' })}><GameIcon name="journal" />Write an entry</button></div>
        <div className="mission-overview">
            <Panel className="dashboard-quests" aria-labelledby="dashboard-quests-title"><div className="section-heading"><h2 id="dashboard-quests-title"><GameIcon name="quest" />Active quests <span>{quests.length}</span></h2><button className="text-button" onClick={() => navigate('Quests')}>View all</button></div>
                {quests.length ? <div className="dashboard-quest-list">{quests.slice(0, 3).map(q => {
                    const progress = dashboardQuestProgress(q, imperial); const deadline = q.ends_at ?? q.due_at;
                    return <button className="dashboard-quest-row" key={q.id} onClick={() => navigate('Quests', { questId: q.id })}><GameIcon name={q.attribute ?? 'quest'} /><span className="dashboard-quest-copy"><strong>{q.title}</strong><span className="dashboard-quest-meta"><span>{progress.label}</span><span className="quest-deadline" title={deadline ? new Date(deadline).toLocaleString(undefined, { timeZone: data.profile.timezone }) : undefined}>{deadline ? remainingTime(deadline, now) : 'No deadline'}</span></span><progress max={1} value={progress.fraction} aria-label={`${q.title}: ${progress.label}`} /><small>{q.reward_xp} XP{q.attribute ? ` + ${q.reward_points} ${q.attribute}` : ''}</small></span><span className="quest-row-open" aria-hidden="true">›</span></button>;
                })}</div> : <div className="dashboard-empty"><GameIcon name="quest" /><h3>A new quest awaits</h3><p>Set your next goal and build its objective path.</p><button onClick={() => navigate('Quests')}>Choose a quest</button></div>}
                {quests.length > 3 && <p className="dashboard-overflow">{quests.length - 3} more in your quest journal</p>}
            </Panel>
            <Panel className={`dashboard-boss ${boss ? 'has-encounter' : ''}`} aria-labelledby="dashboard-boss-title"><div className="section-heading"><h2 id="dashboard-boss-title"><GameIcon name="boss" />Boss encounter</h2>{boss && <span className="encounter-clock">{Date.parse(boss.deadline) <= now ? 'Awaiting settlement' : remainingTime(boss.deadline, now)}</span>}</div>
                {boss ? <>{bosses.slice(0, 3).map(b => { const requirements = requirementsFor(b, data); return <article className="dashboard-boss-entry" key={b.id}><div className="encounter-heading"><BossPortrait avatar={b.avatar} /><div><h3>{b.title}</h3><p>{requirements.filter(r => r.progress >= r.target && !r.failed).length} / {requirements.length} requirements complete</p></div></div><BossHealth boss={b} /><p className="encounter-terms">Victory +{stakesFor(b).victory_xp.toLocaleString()} XP · Failure −{stakesFor(b).failure_xp.toLocaleString()} XP</p><button className="boss-button encounter-open" onClick={() => navigate('Bosses', { bossId: b.id })}>View encounter</button></article>; })}{bosses.length > 3 && <button onClick={() => navigate('Bosses')}>View all {bosses.length} active bosses</button>}</> : <div className="dashboard-empty"><div className="encounter-seal"><GameIcon name="boss" /></div><h3>The next gate is waiting</h3><p>Take on a timed mission for greater rewards and real stakes.</p><button onClick={() => navigate('Bosses')}>Review encounters</button></div>}
            </Panel>
        </div>
        <div className="dashboard-dailies"><Todos compact onManage={() => navigate('Todos', { section: 'todos' })} /><DailyCare compact onManage={() => navigate('Journal', { section: 'daily' })} /></div>
    </div>;
}
