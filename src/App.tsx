import { useState } from 'react';
import Auth, { OrionMark } from './orion/Auth';
import { useOrion } from './orion/context';
import { levelFor, rankFor, threshold } from './orion/logic';
import { ATTRIBUTES } from './orion/types';
import ActivityForm from './orion/ActivityForm';
import { ActivityHistory, DailyCare, ExerciseLibrary } from './orion/Tracking';
import Quests, { QuestCard } from './orion/Quests';
import ProfileForm from './orion/ProfileForm';
import { Analytics, Settings } from './orion/Settings';
import './App.css';

const tabs = ['Dashboard', 'Quests', 'Training', 'Journal', 'Character', 'Settings'] as const;
type Tab = typeof tabs[number];
function Character() {
    const { data } = useOrion();
    if (!data) return null;
    const level = levelFor(data.profile.xp);
    return <section className="panel character-panel"><div className="section-heading"><h2>{data.profile.display_name}</h2><span className="rank-seal" aria-label={`Rank ${rankFor(level)}`}>{rankFor(level)}</span></div><p className="muted">Level {level} · {data.profile.xp.toLocaleString()} total XP</p><div className="attribute-list">{ATTRIBUTES.map((a, i) => <div key={a}><span className="attribute-symbol" aria-hidden="true">{['◇', '↗', '✧', '◈', '▱', '⋈'][i]}</span><span>{a}</span><strong>{data.profile.attributes[a]}</strong><meter min="1" max={Math.max(100, data.profile.attributes[a])} value={data.profile.attributes[a]} aria-label={`${a}: ${data.profile.attributes[a]}`} /></div>)}</div><p className="muted small">Attributes represent game progress, not physical assessments.</p>{Boolean(data.legacy_achievements?.length) && <details><summary>Imported achievements</summary><ul>{data.legacy_achievements?.map(a => <li key={a}>{a.replaceAll('_', ' ')}</li>)}</ul></details>}</section>;
}
function Dashboard({ navigate }: { navigate: (tab: Tab) => void }) {
    const { data } = useOrion();
    if (!data) return null;
    const next = data.quests.find(q => !q.completed_at && q.ends_at > data.server_time);
    const boss = data.bosses.find(b => b.status === 'active');
    return <><section className="dashboard-intro"><div><p className="system-status"><span /> System connected</p><h1>A little stronger.<br />A little more you.</h1><p>Your next level lives in the things you do today.</p><div className="button-row"><button className="primary" onClick={() => navigate('Training')}>Log training</button><button onClick={() => navigate('Journal')}>Write an entry</button></div></div><div className="orbit-art" aria-hidden="true"><OrionMark /></div></section>
        <div className="dashboard-grid"><Character /><div className="next-quest panel"><div className="section-heading"><h2>Your next quest</h2><button className="text-button" onClick={() => navigate('Quests')}>Quest log</button></div>{next ? <QuestCard quest={next} /> : <div className="empty"><h3>Choose your direction</h3><p>Start with one repeatable action. Daily, weekly, or monthly: you set the pace.</p><button onClick={() => navigate('Quests')}>Find a quest</button></div>}{boss && <div className="boss-alert"><h3>{boss.title}</h3><p>Deadline {new Date(boss.deadline).toLocaleString(undefined, { timeZone: data.profile.timezone })}</p><button onClick={() => navigate('Quests')}>View active mission</button></div>}</div></div><DailyCare /><Analytics compact />
    </>;
}
function System() {
    const { data, busy, error, pending, retry, refresh, notices, dismiss } = useOrion();
    const [tab, setTab] = useState<Tab>('Dashboard');
    const navigate = (next: Tab) => { setTab(next); void refresh(); };
    const level = levelFor(data?.profile.xp ?? 0);
    return <div className="app"><a className="skip-link" href="#main-content">Skip to content</a>
        <aside className="sidebar"><a className="wordmark" href="/" aria-label="Orion home"><OrionMark />orion</a><p className="sidebar-caption">Your everyday RPG</p><nav aria-label="Main navigation">{tabs.map((t, i) => <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => navigate(t)}><span aria-hidden="true">{['⌂', '◇', '↗', '▤', '◈', '⚙'][i]}</span>{t}</button>)}</nav><div className="sidebar-bottom"><span className="status-dot" />Private player account<p>Every action adds up.</p></div></aside>
        <div className="workspace"><header className="topbar"><span>{tab}</span><div className="player-summary"><span className="sync-status" role="status">{busy ? 'Syncing…' : error ? 'Connection needs attention' : 'Saved to your account'}</span><span className="player-avatar">{data?.profile.display_name.slice(0, 1) ?? 'O'}</span><span>{data?.profile.display_name ?? 'Player'}<small>Level {level} · Rank {rankFor(level)}</small></span></div></header>
            {data && <div className="xp-strip"><span>Level {level}</span><progress max={threshold(level + 1) - threshold(level)} value={data.profile.xp - threshold(level)} aria-label={`${data.profile.xp - threshold(level)} of ${threshold(level + 1) - threshold(level)} XP toward level ${level + 1}`} /><span>{data.profile.xp} / {threshold(level + 1)} XP</span></div>}
            <main id="main-content" tabIndex={-1} aria-busy={busy}>
                {(error || pending) && <div className="error-banner" role="alert"><p>{error ?? 'An unfinished save is waiting. Retry it with the original request ID.'}</p><button disabled={busy} onClick={() => { void retry(); }}>{pending ? 'Retry save' : 'Reconnect'}</button></div>}
                {!data ? <div className="panel"><h1>{busy ? 'Opening your System…' : 'Your System is waiting'}</h1><p>Connect to load your private character and history.</p>{!busy && <button onClick={() => { void refresh(); }}>Try again</button>}</div>
                    : !data.profile.onboarded ? <section className="panel onboarding"><h1>Welcome to Orion</h1><p>Your story begins at level 1. All six attributes start at 10.</p><ProfileForm /></section> : <>
                        {tab !== 'Dashboard' && <div className="page-heading"><h1>{tab === 'Training' ? 'Build your strength.' : tab === 'Journal' ? 'Make time count.' : tab === 'Character' ? 'Meet your progress.' : tab === 'Quests' ? 'Give today a direction.' : 'Your System, your rules.'}</h1><p>{({ Quests: 'Small commitments. Meaningful rewards.', Training: 'Every completed set, every kilometre, every session.', Journal: 'Read. Focus. Connect. Recover.', Character: 'A record of what you keep showing up for.', Settings: 'Manage your preferences, data, and account.' })[tab]}</p></div>}
                        {tab === 'Dashboard' && <Dashboard navigate={navigate} />}
                        {tab === 'Quests' && <Quests />}
                        {tab === 'Training' && <><ActivityForm /><ActivityHistory /><ExerciseLibrary /></>}
                        {tab === 'Journal' && <><ActivityForm journal /><DailyCare /><ActivityHistory journal /></>}
                        {tab === 'Character' && <><Character /><Analytics /><section className="panel"><h2>Progression history</h2>{!data.events.length && <p className="empty">Your first action starts the story.</p>}<ul className="event-list">{data.events.map(e => <li key={e.id}><time>{new Date(e.created_at).toLocaleDateString()}</time><span>{e.source.startsWith('activity') ? 'Activity reward' : e.source.startsWith('quest') ? 'Quest completed' : e.source.startsWith('boss') ? 'Boss result' : e.source.startsWith('legacy') ? 'Legacy import' : e.source.startsWith('correction') ? 'Activity correction' : 'Daily completion'}</span><strong>{e.xp >= 0 ? '+' : ''}{e.xp} XP</strong><span>{Object.entries(e.attributes).filter(([, n]) => n !== 0).map(([a, n]) => `${n > 0 ? '+' : ''}${n} ${a}`).join(', ')}</span></li>)}</ul></section></>}
                        {tab === 'Settings' && <Settings />}
                    </>}
            </main><footer>Orion<span>Progress at your own pace.</span></footer>
        </div>{notices[0] && <div className="notification" role="status"><span>{notices[0]}</span><button onClick={dismiss} aria-label="Dismiss notification">×</button></div>}
    </div>;
}
export default function App() { return <Auth><System /></Auth>; }
