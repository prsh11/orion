import { useState } from 'react';
import { useGame } from '../gameContext';
import { getToday } from '../dates';

export default function ProgressPanel() {
    const { state } = useGame();
    const [today] = useState(getToday);

    // Weekly chart data (last 7 days)
    const days = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(`${today}T12:00:00Z`);
        d.setDate(d.getDate() - i);
        const dateStr = d.toISOString().slice(0, 10);
        const dayWorkouts = state.workouts.filter(w => w.date.slice(0, 10) === dateStr);
        const dayMinutes = dayWorkouts.reduce((s, w) => s + w.duration, 0);
        days.push({
            label: d.toLocaleDateString('en', { weekday: 'short' }),
            minutes: dayMinutes,
            isToday: dateStr === today,
        });
    }
    const maxMinutes = Math.max(...days.map(d => d.minutes), 30);

    return (
        <section className="panel">
            <h2 className="panel-title">Your momentum</h2>
            <div className="progress-stats">
                <div className="pstat">
                    <span className="pstat-val">{state.totalWorkouts}</span>
                    <span className="pstat-label">Workouts</span>
                </div>
                <div className="pstat">
                    <span className="pstat-val">{state.totalXp}</span>
                    <span className="pstat-label">Total XP</span>
                </div>
                <div className="pstat">
                    <span className="pstat-val">{state.totalMinutes}</span>
                    <span className="pstat-label">Minutes</span>
                </div>
            </div>
            <h3 className="sub-title">Training this week</h3>
            <div className="weekly-chart">
                {days.map((d, i) => (
                    <div
                        key={i}
                        className={`wchart-bar ${d.isToday ? 'today' : ''}`}
                        style={{ height: `${Math.max(4, (d.minutes / maxMinutes) * 100)}%` }}
                        data-day={d.label}
                        title={`${d.label}: ${d.minutes} min`}
                    />
                ))}
            </div>
            <h3 className="sub-title">Recent activity</h3>
            <ul className="activity-feed">
                {state.activityFeed.length === 0 && (
                    <li className="activity-empty">Your journal starts here. Log a workout or complete a habit to see your activity.</li>
                )}
                {state.activityFeed.slice(0, 8).map(item => (
                    <li key={item.id} className="activity-item">
                        <span className="activity-icon">{item.icon}</span>
                        <span className="activity-text">{item.text}</span>
                        <span className="activity-time">
                            {new Date(item.time).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
