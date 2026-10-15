import { useState, useEffect, useCallback } from 'react';
import { GameProvider } from './store';
import { useGame } from './gameContext';
import AudioFX from './audio';
import TopBar from './components/TopBar';
import XPBar from './components/XPBar';
import WorkoutPanel from './components/WorkoutPanel';
import HabitsPanel from './components/HabitsPanel';
import LifePanel from './components/LifePanel';
import ProgressPanel from './components/ProgressPanel';
import AchievementsPanel from './components/AchievementsPanel';
import QuestsPanel from './components/QuestsPanel';
import Popups from './components/Popups';
import Toast from './components/Toast';
import './App.css';

function AppContent() {
    const { state, dispatch } = useGame();
    const [toast, setToast] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState('overview');
    const [journalDate] = useState(() => new Date().toLocaleDateString('en', { weekday: 'long', month: 'long', day: 'numeric' }));
    const { pendingAchievement, pendingLevelUp } = state;

    useEffect(() => {
        if (pendingAchievement) AudioFX.achievement();
    }, [pendingAchievement]);
    useEffect(() => {
        if (pendingLevelUp) AudioFX.levelUp();
    }, [pendingLevelUp]);

    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2500);
    }, []);

    return (
        <div className="app">
            <a className="skip-link" href="#main-content">Skip to content</a>
            <TopBar />
            <XPBar />
            <nav className="tracker-tabs" aria-label="Trackers">
                {[
                    { id: 'overview', label: 'Overview' },
                    { id: 'workouts', label: 'Workouts' },
                    { id: 'habits', label: 'Habits' },
                    { id: 'life', label: 'Life' },
                    { id: 'goals', label: 'Goals' },
                    { id: 'progress', label: 'Progress' },
                ].map(tab => (
                    <button key={tab.id} className={`tracker-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)} aria-current={activeTab === tab.id ? 'page' : undefined}>
                        {tab.label}
                    </button>
                ))}
            </nav>
            <main id="main-content" className="tab-content" tabIndex={-1}>
                {activeTab === 'overview' && <>
                    <section className="welcome-card">
                        <div className="welcome-copy">
                            <time>{journalDate}</time>
                            <h1>Find your<br />everyday pace.</h1>
                            <p>A little movement. A good habit. Another day of getting stronger.</p>
                            <a className="welcome-link" href="#workout-type">Log today’s workout</a>
                        </div>
                        <svg className="track-art" viewBox="0 0 430 320" fill="none" aria-hidden="true">
                            {[0, 1, 2, 3, 4].map(lane => <rect key={lane} x={40 + lane * 19} y={-100 + lane * 19} width={340 - lane * 38} height={540 - lane * 38} rx={170 - lane * 19} />)}
                            <path className="track-finish" d="M40 191h76M40 199h76" />
                            <circle className="track-runner" cx="78" cy="154" r="10" />
                        </svg>
                    </section>
                    <div className="main-grid">
                        <WorkoutPanel showToast={showToast} />
                        <HabitsPanel />
                        <ProgressPanel />
                        <LifePanel />
                        <QuestsPanel />
                        <AchievementsPanel compact onViewAll={() => setActiveTab('goals')} />
                    </div>
                </>}
                {activeTab !== 'overview' && <div className="page-heading"><h1>{({ workouts: 'Your training', habits: 'Build your rhythm', life: 'Make room for recovery', goals: 'Something to work toward', progress: 'See how far you’ve come' })[activeTab]}</h1><p>Every entry is another step forward.</p></div>}
                {activeTab === 'workouts' && <div className="single-panel"><WorkoutPanel showToast={showToast} /><ProgressPanel /></div>}
                {activeTab === 'habits' && <div className="single-panel"><HabitsPanel /></div>}
                {activeTab === 'life' && <div className="single-panel"><LifePanel /></div>}
                {activeTab === 'goals' && <div className="single-panel"><QuestsPanel /><AchievementsPanel /></div>}
                {activeTab === 'progress' && <div className="single-panel"><ProgressPanel /><AchievementsPanel /></div>}
            </main>
            <footer className="app-footer"><span>FitQuest</span><p>Progress at your pace.</p></footer>
            <Popups
                achievement={pendingAchievement}
                levelUp={pendingLevelUp}
                onCloseAchievement={() => dispatch({ type: 'DISMISS_ACHIEVEMENT' })}
                onCloseLevelUp={() => dispatch({ type: 'DISMISS_LEVELUP' })}
            />
            {toast && <Toast message={toast} />}
        </div>
    );
}

export default function App() {
    return (
        <GameProvider>
            <AppContent />
        </GameProvider>
    );
}
