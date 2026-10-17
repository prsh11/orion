import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import Auth, { OrionMark } from './orion/Auth';
import { useOrion } from './orion/context';
import { levelFor, rankFor } from './orion/logic';
import { ATTRIBUTES } from './orion/types';
import ActivityForm from './orion/ActivityForm';
import { ActivityHistory, DailyCare, ExerciseLibrary } from './orion/Tracking';
import Quests from './orion/Quests';
import ProfileForm from './orion/ProfileForm';
import { Analytics, Settings } from './orion/Settings';
import CharacterConstellation from './orion/CharacterConstellation';
import type { RpgScene } from './orion/RpgArt';
import NavIcon from './orion/NavIcon';
import Dashboard from './orion/Dashboard';
import { pageSections } from './orion/navigation';
import { PageHeader, Panel, Subsections } from './orion/PageLayout';
import Bosses from './orion/Bosses';
import Todos from './orion/Todos';
import type { TodoView } from './orion/Todos';
import type { NavigationTarget, Tab } from './orion/navigation';
import GameHud from './orion/GameHud';
import GameIcon, { RankBadge } from './orion/GameIcon';
import RewardExperience from './orion/RewardExperience';
import { useExperience } from './orion/experience';
import AudioFX from './audio';
import './App.css';
import './orion/rpg-ui.css';
import './orion/boss-battle.css';

const tabs = ['Dashboard', 'Todos', 'Quests', 'Bosses', 'Training', 'Journal', 'Character', 'Settings'] as const;
const tabScenes: Record<Tab, RpgScene> = { Dashboard: 'dashboard', Todos: 'journal', Quests: 'quest', Bosses: 'quest', Training: 'training', Journal: 'journal', Character: 'character', Settings: 'settings' };
function Character() {
    const { data, presentations } = useOrion();
    if (!data) return null;
    const level = levelFor(data.profile.xp);
    return <Panel className="character-panel"><div className="section-heading"><h2>{data.profile.display_name}</h2><RankBadge rank={rankFor(level)} /></div><p className="muted">Level {level} · {data.profile.xp.toLocaleString()} total XP</p><div className="attribute-list">{ATTRIBUTES.map(a => <div key={`${a}:${data.profile.attributes[a]}`} className={(presentations[0]?.attributes[a] ?? 0) > 0 ? 'attribute-changed' : (presentations[0]?.attributes[a] ?? 0) < 0 ? 'attribute-lost' : ''}><GameIcon name={a} className="attribute-symbol" /><span>{a}</span><strong>{data.profile.attributes[a]}</strong><meter min="1" max={Math.max(100, data.profile.attributes[a])} value={data.profile.attributes[a]} aria-label={`${a}: ${data.profile.attributes[a]}`} /></div>)}</div><p className="muted small">Attributes represent game progress, not physical assessments.</p>{Boolean(data.legacy_achievements?.length) && <details><summary>Imported achievements</summary><ul>{data.legacy_achievements?.map(a => <li key={a}>{a.replaceAll('_', ' ')}</li>)}</ul></details>}</Panel>;
}
function MainNavigation({ tab, navigate }: { tab: Tab; navigate: (tab: Tab) => void }) {
    const nav = useRef<HTMLElement>(null);
    const [overflow, setOverflow] = useState({ left: false, right: false });
    useEffect(() => {
        const element = nav.current;
        if (!element) return;
        const update = () => setOverflow({ left: element.scrollLeft > 2, right: element.scrollLeft + element.clientWidth < element.scrollWidth - 2 });
        const observer = new ResizeObserver(update); observer.observe(element);
        element.addEventListener('scroll', update); update();
        return () => { observer.disconnect(); element.removeEventListener('scroll', update); };
    }, []);
    useEffect(() => {
        const element = nav.current; const active = element?.querySelector<HTMLElement>("[aria-current='page']");
        if (element && active && element.scrollWidth > element.clientWidth) active.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
    }, [tab]);
    return <div className="main-nav-wrap" data-overflow-left={overflow.left} data-overflow-right={overflow.right}><nav ref={nav} aria-label="Main navigation">{tabs.map(t => <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => navigate(t)}><NavIcon page={t} />{t}</button>)}</nav>{overflow.left && <span className="nav-overflow nav-overflow-left" aria-hidden="true">‹</span>}{overflow.right && <span className="nav-overflow nav-overflow-right" aria-hidden="true">›</span>}</div>;
}
function System() {
    const { data, busy, error, pending, retry, refresh, notices, dismiss } = useOrion();
    const [tab, setTab] = useState<Tab>('Dashboard');
    const [sections, setSections] = useState<Record<Tab, string>>({ Dashboard: '', Todos: 'today', Quests: 'journal', Bosses: '', Training: 'log', Journal: 'entry', Character: 'overview', Settings: 'preferences' });
    const selectSection = (page: Tab, value: string) => setSections(previous => ({ ...previous, [page]: value }));
    const [destination, setDestination] = useState<NavigationTarget>();
    useEffect(() => {
        if (!destination) return;
        const id = destination.bossId ? 'boss-detail' : destination.questId ? 'quest-detail' : destination.section === 'todos' ? 'daily-todos' : destination.section === 'bosses' ? 'boss-missions' : destination.section === 'log' ? 'training-entry' : destination.section === 'entry' ? 'journal-entry' : 'daily-rhythm';
        const frame = requestAnimationFrame(() => { const section = document.getElementById(id) ?? document.getElementById('main-content'); section?.focus({ preventScroll: true }); section?.scrollIntoView({ block: 'start', behavior: 'instant' }); });
        return () => cancelAnimationFrame(frame);
    }, [tab, destination]);
    const { effectiveEffects } = useExperience();
    const navigate = (next: Tab, target?: NavigationTarget) => {
        if (next !== tab) AudioFX.click();
        if (target?.questId) selectSection('Quests', 'journal');
        else if (target?.section === 'bosses') next = 'Bosses';
        else if (target?.section === 'todos') selectSection('Todos', 'today');
        else if (target?.section === 'daily') selectSection('Journal', 'daily');
        else if (target?.section === 'log') selectSection('Training', 'log');
        else if (target?.section === 'entry') selectSection('Journal', 'entry');
        setDestination(target); setTab(next); if (!target) window.scrollTo({ top: 0, behavior: 'instant' }); void refresh();
    };
    const level = levelFor(data?.profile.xp ?? 0);
    const descriptions: Record<Tab, string> = { Dashboard: data ? new Date(data.server_time).toLocaleDateString(undefined, { timeZone: data.profile.timezone, weekday: 'long', month: 'short', day: 'numeric' }) : '', Todos: 'Make room for what matters today.', Quests: 'Your goals and achievements.', Bosses: 'Name your challenge. Accept the stakes.', Training: 'Record your movement and strength.', Journal: 'Read, focus, connect, and recover.', Character: 'Your growth, stats, and achievements.', Settings: 'Your preferences and private data.' };
    const subsection = (page: Tab, contents: Record<string, ReactNode>) => <Subsections label={`${page} sections`} value={sections[page]} onChange={value => selectSection(page, value)} items={pageSections[page].map(item => ({ ...item, content: contents[item.id] }))} />;
    return <div className={`app view-${tab.toLowerCase()}`} data-effects={effectiveEffects}><a className="skip-link" href="#main-content">Skip to content</a>
        <aside className="sidebar"><a className="wordmark" href="/" aria-label="Orion home"><OrionMark />orion</a><p className="sidebar-caption">Your everyday RPG</p><MainNavigation tab={tab} navigate={navigate} /><div className="sidebar-bottom"><span className="status-dot" />Private player account<p>Every action adds up.</p></div></aside>
        <div className="workspace"><header className="topbar"><span>{tab}</span><div className="player-summary"><span className="sync-status" role="status">{busy ? 'Syncing…' : error ? 'Connection needs attention' : 'Saved to your account'}</span><span className="player-avatar">{data?.profile.display_name.slice(0, 1) ?? 'O'}</span><span>{data?.profile.display_name ?? 'Player'}<small>Level {level} · Rank {rankFor(level)}</small></span></div></header>
            <GameHud />
            <main id="main-content" tabIndex={-1} aria-busy={busy}>
                {(error || pending) && <div className="error-banner" role="alert"><p>{error ?? 'An unfinished save is waiting. Retry it with the original request ID.'}</p><button disabled={busy} onClick={() => { void retry(); }}>{pending ? 'Retry save' : 'Reconnect'}</button></div>}
                {!data ? <div className="panel"><h1>{busy ? 'Opening your System…' : 'Your System is waiting'}</h1><p>Connect to load your private character and history.</p>{!busy && <button onClick={() => { void refresh(); }}>Try again</button>}</div>
                    : !data.profile.onboarded ? <section className="panel onboarding"><h1>Welcome to Orion</h1><p>Your story begins at level 1. All six attributes start at 10.</p><ProfileForm /></section> : <>
                        <PageHeader title={tab} description={descriptions[tab]} scene={tabScenes[tab]} />
                        <div className="page-content">
                        {tab === 'Dashboard' && <Dashboard navigate={navigate} />}
                        {tab === 'Todos' && <Todos selectedView={sections.Todos as TodoView} onViewChange={value => selectSection('Todos', value)} />}
                        {tab === 'Quests' && <Quests key={destination?.questId} initialQuestId={destination?.questId} />}
                        {tab === 'Bosses' && <Bosses key={destination?.bossId} initialBossId={destination?.bossId} navigate={navigate} />}
                        {tab === 'Training' && subsection('Training', { log: <ActivityForm key={`${data.profile.units}:${data.profile.timezone}`} />, history: <ActivityHistory />, exercises: <ExerciseLibrary /> })}
                        {tab === 'Journal' && subsection('Journal', { entry: <ActivityForm key={`${data.profile.units}:${data.profile.timezone}`} journal />, daily: <DailyCare />, history: <ActivityHistory journal /> })}
                        {tab === 'Character' && subsection('Character', { overview: <div className="character-overview"><Character /><CharacterConstellation /></div>, analytics: <Analytics />, progression: <Panel><h2>Progression history</h2>{!data.events.length && <p className="empty">Your first action starts the story.</p>}<ul className="event-list">{data.events.map(e => <li key={e.id}><time>{new Date(e.created_at).toLocaleDateString(undefined, { timeZone: data.profile.timezone })}</time><span>{e.source.startsWith('todo-undo:') ? 'Todo unchecked' : e.source.startsWith('todo:') ? 'Todo completed' : e.source.startsWith('activity') ? 'Activity reward' : e.source.startsWith('quest') ? 'Quest completed' : e.source.startsWith('boss') ? 'Boss result' : e.source.startsWith('legacy') ? 'Legacy import' : e.source.startsWith('correction') ? 'Activity correction' : 'Daily completion'}</span><strong>{e.xp >= 0 ? '+' : ''}{e.xp} XP</strong><span>{Object.entries(e.attributes).filter(([, n]) => n !== 0).map(([a, n]) => `${n > 0 ? '+' : ''}${n} ${a}`).join(', ')}</span></li>)}</ul></Panel> })}
                        {tab === 'Settings' && <Settings section={sections.Settings} onSectionChange={value => selectSection('Settings', value)} />}
                        </div>
                    </>}
            </main><footer>Orion<span>Progress at your own pace.</span></footer>
        </div><RewardExperience />{notices[0] && <div className="notification" role="status"><span>{notices[0]}</span><button onClick={dismiss} aria-label="Dismiss notification">×</button></div>}
    </div>;
}
export default function App() { return <Auth><System /></Auth>; }
