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
            <TopBar />
            <XPBar />
            <nav className="tracker-tabs" aria-label="Trackers">
                {[
                    { id: 'overview', icon: '◫', label: 'Overview' },
                    { id: 'workouts', icon: '↗', label: 'Workouts' },
                    { id: 'habits', icon: '✓', label: 'Habits' },
                    { id: 'life', icon: '✳', label: 'Life' },
                    { id: 'goals', icon: '◎', label: 'Goals' },
                    { id: 'progress', icon: '▥', label: 'Progress' },
                ].map(tab => (
                    <button key={tab.id} className={`tracker-tab ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)} aria-current={activeTab === tab.id ? 'page' : undefined}>
                        <span>{tab.icon}</span>{tab.label}
                    </button>
                ))}
            </nav>
            <main className="tab-content" key={activeTab}>
                {activeTab === 'overview' && <>
                    <section className="welcome-card">
                        <div><span className="eyebrow">YOUR DAILY DASHBOARD</span><h1>Small steps. Stronger you.</h1>
                            <p>Build momentum by showing up for yourself today.</p></div>
                        <div className="welcome-mark">✦</div>
                    </section>
                    <div className="main-grid">
                        <div className="col-left"><WorkoutPanel showToast={showToast} /><QuestsPanel /><ProgressPanel /></div>
                        <div className="col-right"><HabitsPanel /><LifePanel /><AchievementsPanel /></div>
                    </div>
                </>}
                {activeTab === 'workouts' && <div className="single-panel"><WorkoutPanel showToast={showToast} /><ProgressPanel /></div>}
                {activeTab === 'habits' && <div className="single-panel"><HabitsPanel /></div>}
                {activeTab === 'life' && <div className="single-panel"><LifePanel /></div>}
                {activeTab === 'goals' && <div className="single-panel"><QuestsPanel /><AchievementsPanel /></div>}
                {activeTab === 'progress' && <div className="single-panel"><ProgressPanel /><AchievementsPanel /></div>}
            </main>
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
