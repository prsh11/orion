import { useRef, useState } from 'react';
import { Panel } from './PageLayout';
import { useOrion } from './context';
import GameIcon from './GameIcon';
import BossBuilder from './BossBuilder';
import { BossHealth, BossTerms } from './BossVitals';
import BossPortrait, { AvatarPicker } from './BossPortrait';
import RpgCheckbox from './CompletionControl';
import { bossHealth, bossStakes, requirementsFor, stakesFor } from './bossLogic';
import { metricLabel } from './logic';
import { metricProgress, remainingTime } from './dashboardLogic';
import type { Boss, BossAvatar, BossRequirement } from './types';
import type { Navigate } from './navigation';

function ManualCount({ boss, requirement }: { boss: Boss; requirement: BossRequirement }) {
    const { command, busy, pending } = useOrion();
    const [value, setValue] = useState(String(requirement.progress));
    return <form className="button-row" onSubmit={e => { e.preventDefault(); void command('set_boss_requirement', { id: boss.id, requirement_id: requirement.id, progress: Number(value) }); }}><label>Count for {requirement.title}<input type="number" required min={0} max={requirement.target} step={1} value={value} disabled={busy || Boolean(pending)} onChange={e => setValue(e.target.value)} /></label><button disabled={busy || Boolean(pending)}>Save count</button></form>;
}
function Encounter({ boss, navigate }: { boss: Boss; navigate?: Navigate }) {
    const { data, command, busy, pending } = useOrion();
    const [abandon, setAbandon] = useState(false);
    const [editing, setEditing] = useState(false);
    const [revising, setRevising] = useState(false);
    const [avatar, setAvatar] = useState<BossAvatar>(boss.avatar ?? 'dragon');
    if (!data) return null;
    const requirements = requirementsFor(boss, data);
    const disabled = busy || Boolean(pending);
    const active = boss.status === 'active';
    return <><div className="boss-hero"><div className="boss-portrait-stage" aria-hidden="true"><BossPortrait avatar={boss.avatar} /></div><div><span className="attribute-tag amber" data-status={boss.status}>{boss.status}</span><h2>{boss.title}</h2>{boss.description && <p>{boss.description}</p>}<p>Deadline: <time dateTime={boss.deadline}>{new Date(boss.deadline).toLocaleString(undefined, { timeZone: data.profile.timezone })}</time><br /><span className="muted">{data.profile.timezone}</span></p><BossHealth boss={boss} /></div></div>
        {active && <button className="text-button" disabled={disabled} onClick={() => setRevising(true)}>Edit boss</button>}
        {revising && <BossBuilder edit={boss} onClose={() => setRevising(false)} />}
        <div className="section-heading boss-requirements-heading"><h3>Encounter requirements</h3><span className="muted small">{requirements.filter(r => r.progress >= r.target && !r.failed).length} / {requirements.length} complete</span></div><p className="muted">Each requirement removes an equal share of health. Corrections can restore health while the encounter is active.</p>
        <div className="boss-requirements">{requirements.map(r => <article key={r.id} className={`boss-requirement ${r.failed ? 'is-failed' : r.progress >= r.target ? 'is-complete' : ''}`} data-kind={r.metric}><div className="entry-heading"><h4><GameIcon name={r.failed ? 'loss' : r.progress >= r.target ? 'check' : r.metric === 'quest' ? 'quest' : r.metric === 'checklist' || r.metric === 'manual' ? 'todo' : 'orbit'} />{r.title}</h4><span>{r.failed ? 'Linked quest failed' : r.progress >= r.target ? 'Complete' : 'In progress'}</span></div>{r.metric === 'checklist' && active ? <label className="check-label"><RpgCheckbox checked={r.progress >= 1} disabled={disabled} pending={busy} uncertain={Boolean(pending)} onChange={e => { void command('set_boss_requirement', { id: boss.id, requirement_id: r.id, progress: e.target.checked ? 1 : 0 }); }} />Complete {r.title}</label> : <><p>{r.metric === 'quest' ? `${Math.floor(r.progress * 100)}% of linked quest` : metricProgress(r.metric, r.progress, r.target, data.profile.units === 'imperial')}</p><progress max={r.target} value={r.progress} aria-label={`${r.title} progress`} /></>}
        {r.metric === 'manual' && active && <ManualCount key={`${r.id}:${r.progress}`} boss={boss} requirement={r} />}
        {r.metric === 'quest' && r.quest_id && <button className="text-button" onClick={() => navigate?.('Quests', { questId: r.quest_id ?? undefined })}>Open linked quest</button>}
        {r.activity_kind && <small>Activity: {r.activity_kind}{r.attribute ? ` / ${r.attribute}` : ''}</small>}</article>)}</div>
        <BossTerms stakes={stakesFor(boss)} attributes={boss.attributes} />
        {!active && (editing ? <form onSubmit={e => { e.preventDefault(); const f = new FormData(e.currentTarget); void command('edit_boss', { id: boss.id, title: f.get('title'), description: f.get('description'), avatar }).then(ok => { if (ok) setEditing(false); }); }}><fieldset disabled={disabled}><label>Boss name<input name="title" required maxLength={120} defaultValue={boss.title} /></label><label>Description<textarea name="description" maxLength={2000} defaultValue={boss.description ?? ''} /></label><AvatarPicker value={avatar} onChange={setAvatar} /><div className="button-row"><button>Save appearance</button><button type="button" onClick={() => setEditing(false)}>Cancel</button></div></fieldset></form> : <button className="text-button" onClick={() => setEditing(true)}>Edit name and avatar</button>)}
        {active && (abandon ? <div className="feedback"><p>Abandoning applies the failure penalty immediately and starts a 24-hour cooldown. Other active bosses continue.</p><div className="button-row"><button className="danger" disabled={disabled} onClick={() => { void command('abandon_boss', { id: boss.id }).then(ok => { if (ok) setAbandon(false); }); }}>Accept failure and abandon</button><button onClick={() => setAbandon(false)}>Keep fighting</button></div></div> : <button className="text-button danger" disabled={disabled} onClick={() => setAbandon(true)}>Abandon boss</button>)}
    </>;
}
export default function Bosses({ initialBossId, navigate }: { initialBossId?: string; navigate?: Navigate }) {
    const { data, command, busy, pending } = useOrion();
    const [selected, setSelected] = useState(initialBossId ?? '');
    const [view, setView] = useState<'active' | 'history'>('active');
    const [creating, setCreating] = useState(false);
    const [accepting, setAccepting] = useState('');
    const detail = useRef<HTMLDivElement>(null);
    if (!data) return null;
    const bosses = data.bosses.filter(b => view === 'active' ? b.status === 'active' : b.status !== 'active');
    const current = bosses.find(b => b.id === selected) ?? bosses[0];
    const failures = data.bosses.filter(b => b.status === 'failure' && b.resolved_at).map(b => Date.parse(b.resolved_at!));
    const cooldown = failures.length ? new Date(Math.max(...failures) + 86400000) : null;
    const cooling = cooldown && cooldown.getTime() > Date.parse(data.server_time);
    return <><Panel id="boss-missions" tabIndex={-1} className="boss-page" aria-label="Boss missions"><header className="section-heading"><h2><GameIcon name="boss" />Boss encounters</h2><button className="boss-button" disabled={Boolean(cooling) || busy || Boolean(pending)} onClick={() => setCreating(true)}>Create boss</button></header>
        {cooling && <p role="status">New encounters unlock {cooldown.toLocaleString(undefined, { timeZone: data.profile.timezone })}. Your other active bosses continue.</p>}
        <label className="boss-view-filter">Encounters<select value={view} onChange={e => setView(e.target.value as typeof view)}><option value="active">Active bosses ({data.bosses.filter(b => b.status === 'active').length})</option><option value="history">Encounter history</option></select></label>
        {bosses.length ? <div className="boss-layout"><nav className="boss-roster" aria-label="Boss roster">{bosses.map(b => { const requirements = requirementsFor(b, data); return <button key={b.id} aria-current={current?.id === b.id ? 'true' : undefined} onClick={() => { setSelected(b.id); requestAnimationFrame(() => { detail.current?.focus({ preventScroll: true }); if (matchMedia('(max-width: 760px)').matches) detail.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); }); }}><BossPortrait avatar={b.avatar} /><span><strong>{b.title}</strong><small>{bossHealth(b, data)} HP · {requirements.filter(r => r.progress >= r.target && !r.failed).length} / {requirements.length} complete</small><small>{b.status === 'active' ? remainingTime(b.deadline, Date.parse(data.server_time)) : b.status}</small><small>{new Date(b.deadline).toLocaleString(undefined, { timeZone: data.profile.timezone })}</small></span></button>; })}</nav><div className="boss-detail" id="boss-detail" ref={detail} tabIndex={-1} role="region" aria-label="Boss details">{current && <Encounter key={current.id} boss={current} navigate={navigate} />}</div></div> : <div className="journal-empty"><BossPortrait avatar="guardian" /><h3>{view === 'active' ? 'Choose what stands in your way' : 'Your encounters will stay here'}</h3><p>{view === 'active' ? 'Create a named boss with tasks, activity goals, and quests. Accept its deadline and stakes before you begin.' : 'Victories and failures keep their final progress and stakes.'}</p></div>}
        <details className="boss-templates"><summary>Classic encounters</summary><div className="template-grid">{data.templates.map(t => <article key={t.id}><h3>{t.title}</h3><p>{t.hours === 24 ? '24 hours' : '7 days'} from acceptance</p><ul>{t.objectives.map(o => <li key={o.metric}>{o.target} {metricLabel[o.metric]}</li>)}</ul><BossTerms stakes={bossStakes[t.hours === 24 ? 'daily' : 'weekly']} attributes={t.attributes} />{accepting === t.id ? <div className="feedback"><p>Requirements, deadline and stakes are fixed. One attempt per {t.hours === 24 ? 'day' : 'Monday-start week'}. Failure starts a 24-hour cooldown.</p><button disabled={busy || Boolean(pending) || Boolean(cooling)} onClick={() => { void command('accept_boss', { id: t.id }).then(ok => { if (ok) setAccepting(''); }); }}>Accept mission and penalties</button><button onClick={() => setAccepting('')}>Cancel</button></div> : <button disabled={busy || Boolean(pending) || Boolean(cooling)} onClick={() => setAccepting(t.id)}>Review acceptance</button>}</article>)}</div></details>
    </Panel>{creating && <BossBuilder key={`${data.profile.id}:${data.profile.units}`} onClose={() => setCreating(false)} />}</>;
}
