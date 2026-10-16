import { useState } from 'react';
import { useOrion } from './context';
import GameIcon from './GameIcon';
import AudioFX from '../audio';
import { bossActivities, metric, metricLabel } from './logic';

export default function Bosses() {
    const { data, command, busy } = useOrion();
    const [accepting, setAccepting] = useState<string | null>(null);
    const [abandon, setAbandon] = useState(false);
    if (!data) return null;
    const active = data.bosses.find(b => b.status === 'active');
    return <section className="panel boss-panel"><h2><GameIcon name="boss" />Boss missions</h2><p className="muted">Optional challenges with real game penalties. Only activities recorded and performed after acceptance, before the deadline, count.</p>
        {active ? <article><div className="entry-heading"><h3><GameIcon name="boss" />{active.title}</h3><span className="attribute-tag amber">Active</span></div><p>Deadline: {new Date(active.deadline).toLocaleString(undefined, { timeZone: data.profile.timezone })}</p>{active.objectives.map(o => { const n = metric(bossActivities(data.activities, active.accepted_at, active.deadline), o.metric); return <div key={o.metric}><p>{n} / {o.target} {metricLabel[o.metric]}</p><progress max={o.target} value={n} aria-label={`${o.metric}: ${n} of ${o.target}`} /></div>; })}<BossTerms hours={active.hours} attributes={active.attributes} /><button className="danger" disabled={busy} onClick={() => { AudioFX.click(); setAbandon(true); }}>Abandon mission</button>{abandon && <div className="feedback"><p>Abandoning applies the failure penalty immediately and starts a 24-hour cooldown.</p><div className="button-row"><button className="danger" disabled={busy} onClick={() => { void command('abandon_boss', { id: active.id }).then(ok => { if (ok) setAbandon(false); }); }}>Accept failure and abandon</button><button onClick={() => setAbandon(false)}>Keep fighting</button></div></div>}</article>
        : <div className="template-grid">{data.templates.map(t => <article key={t.id}><GameIcon name="boss" className="boss-crest" /><h3>{t.title}</h3><p>{t.hours === 24 ? '24 hours' : '7 days'} from acceptance</p><ul>{t.objectives.map(o => <li key={o.metric}>{o.target} {metricLabel[o.metric]}</li>)}</ul><BossTerms hours={t.hours} attributes={t.attributes} />{accepting !== t.id ? <button disabled={busy} onClick={() => { AudioFX.click(); setAccepting(t.id); }}>Review acceptance</button> : <div className="feedback"><p>Objectives and deadline are fixed after acceptance. One attempt per {t.hours === 24 ? 'day' : 'Monday-start week'}. Failure starts a 24-hour cooldown.</p><div className="button-row"><button className="boss-button" disabled={busy} onClick={() => { void command('accept_boss', { id: t.id }).then(ok => { if (ok) setAccepting(null); }); }}>Accept mission and penalties</button><button onClick={() => setAccepting(null)}>Cancel</button></div></div>}</article>)}</div>}
        <details><summary>Mission history</summary>{!data.bosses.some(b => b.status !== 'active') && <p className="muted">Your completed missions will appear here.</p>}{data.bosses.filter(b => b.status !== 'active').map(b => <p key={b.id}>{b.title}: {b.status} · {new Date(b.resolved_at ?? b.deadline).toLocaleDateString()}</p>)}</details>
    </section>;
}
function BossTerms({ hours, attributes }: { hours: number; attributes: string[] }) {
    return <div className="boss-terms"><p>Victory: +{hours === 24 ? 250 : 1000} XP, +{hours === 24 ? 5 : 15} in each of {attributes.join(' and ')}.</p><p>Failure: −{hours === 24 ? 75 : 250} XP, −{hours === 24 ? 2 : 5} in each of {attributes.join(' and ')}.</p></div>;
}
