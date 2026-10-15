import { useState } from 'react';
import { useOrion } from './context';
import { supabase } from './client';
import ProfileForm from './ProfileForm';
import { dayKey, fromMetres, pace } from './logic';
import { loadTheme, saveTheme } from '../theme';
import { parseSave } from '../save';

export function Analytics({ compact = false }: { compact?: boolean }) {
    const { data } = useOrion();
    if (!data) return null;
    const imperial = data.profile.units === 'imperial';
    const days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date(data.server_time); date.setUTCDate(date.getUTCDate() - 6 + i);
        const key = dayKey(date, data.profile.timezone);
        return { key, minutes: data.activities.filter(a => dayKey(a.occurred_at, data.profile.timezone) === key).reduce((n, a) => n + a.minutes, 0) };
    });
    const max = Math.max(60, ...days.map(d => d.minutes));
    const running = data.activities.filter(a => a.kind === 'running').slice().reverse();
    return <section className="panel"><div className="section-heading"><h2>Your week in motion</h2><span className="muted">{days.reduce((n, d) => n + d.minutes, 0)} minutes</span></div><div className="weekly-chart" aria-hidden="true">{days.map(d => <div key={d.key}><span>{d.minutes}</span><div style={{ height: `${Math.max(2, d.minutes / max * 110)}px` }} /><small>{d.key.slice(5)}</small></div>)}</div><details><summary>Weekly activity data</summary><table><caption>Last seven days in {data.profile.timezone}</caption><thead><tr><th>Date</th><th>Minutes</th></tr></thead><tbody>{days.map(d => <tr key={d.key}><td>{d.key}</td><td>{d.minutes}</td></tr>)}</tbody></table></details>
        {!compact && <><h3>Running trends</h3>{running.length ? <div className="table-scroll"><table><caption>Distance and average pace by run</caption><thead><tr><th>Date</th><th>Distance ({imperial ? 'mi' : 'km'})</th><th>Pace</th></tr></thead><tbody>{running.map(a => <tr key={a.id}><td>{dayKey(a.occurred_at, data.profile.timezone)}</td><td>{fromMetres(a.metres, imperial).toFixed(2)}</td><td>{pace(a.minutes, a.metres, imperial)}</td></tr>)}</tbody></table></div> : <p className="empty">Log a run to start your distance and pace history.</p>}</>}
    </section>;
}
export function Settings() {
    const { data, command, busy } = useOrion();
    const [theme, setTheme] = useState(loadTheme);
    const [sound, setSound] = useState(() => { try { return localStorage.getItem('orion-sound') === 'on'; } catch { return false; } });
    const [message, setMessage] = useState('');
    const [deleting, setDeleting] = useState(false);
    const [legacy] = useState(() => { try { const raw = localStorage.getItem('fitquest-save-v1'); return raw ? parseSave(raw) : null; } catch { return null; } });
    if (!data) return null;
    async function exportData() {
        if (!supabase) return;
        const { data: exported, error } = await supabase.rpc('orion_export');
        if (error) { setMessage(error.message); return; }
        const url = URL.createObjectURL(new Blob([JSON.stringify(exported, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'orion-account.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    return <><section className="panel"><h2>Player preferences</h2><ProfileForm /></section><section className="panel"><h2>Appearance and sound</h2><div className="form-grid"><label>Appearance<select value={theme} onChange={e => { const t = e.target.value === 'light' ? 'light' : 'dark'; setTheme(t); saveTheme(t); }}><option value="dark">Dark System</option><option value="light">Light System</option></select></label><label className="check-label"><input type="checkbox" checked={sound} onChange={e => { setSound(e.target.checked); try { localStorage.setItem('orion-sound', e.target.checked ? 'on' : 'off'); } catch { setMessage('Sound preference could not be stored.'); } }} />Play reward sounds</label></div><p className="muted">Animations follow your device’s reduced-motion preference.</p></section>
        <section className="panel"><h2>Bring your history</h2>{data.profile.imported ? <p>Your previous browser save was imported. Its original achievements and historical records are included in your account export.</p> : legacy ? <><p>A previous browser save is available: {legacy.player.xp} XP, {legacy.workouts.length} workouts, {legacy.achievements.length} achievements. Import once; no historical sets or rewards are invented. Your browser copy stays intact.</p><button disabled={busy} onClick={() => { void command('import', { save: legacy }); }}>Import browser save</button></> : <p className="muted">No previous browser save found on this device.</p>}</section>
        <section className="panel"><h2>Your private data</h2><p>Export your profile, tracking history, quests, missions, progression events, and imported records.</p><div className="button-row"><button onClick={() => { void exportData(); }}>Export account data</button><button onClick={() => { void supabase?.auth.signOut().then(({ error }) => { if (error) setMessage(error.message); }); }}>Sign out</button><button className="danger" onClick={() => setDeleting(true)}>Delete account</button></div>{message && <p role="status" className="feedback">{message}</p>}
        {deleting && <form className="feedback" onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void command('delete_account', { confirmation: f.get('confirmation') }); }}><p>This permanently deletes your account and all server records. Export first if you want a copy.</p><label>Type DELETE to confirm<input name="confirmation" required pattern="DELETE" autoComplete="off" /></label><div className="button-row"><button className="danger" disabled={busy}>Permanently delete account</button><button type="button" onClick={() => setDeleting(false)}>Cancel</button></div></form>}</section>
    </>;
}
