import { useState } from 'react';
import type { FormEvent } from 'react';
import { ATTRIBUTES } from './types';
import { useOrion } from './context';

export default function ProfileForm() {
    const { data, command, busy } = useOrion();
    const p = data?.profile;
    const [domains, setDomains] = useState(p?.domains ?? []);
    if (!p) return null;
    async function save(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        const f = new FormData(event.currentTarget);
        await command('profile', { display_name: String(f.get('name')).trim(), timezone: f.get('timezone'), units: f.get('units'), domains });
    }
    return <form onSubmit={event => { void save(event); }} className="profile-form">
        <label>Display name<input name="name" defaultValue={p.onboarded ? p.display_name : ''} required maxLength={60} autoComplete="nickname" /></label>
        <label>Timezone<input name="timezone" list="timezones" defaultValue={p.onboarded ? p.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone} required /><datalist id="timezones">{Intl.supportedValuesOf('timeZone').map(z => <option key={z} value={z} />)}<option value="UTC" /></datalist></label>
        <label>Units<select name="units" defaultValue={p.units}><option value="metric">kg / km</option><option value="imperial">lb / mi</option></select></label>
        <fieldset><legend>Your life domains</legend><p className="muted">Choose the areas you want to make room for.</p><div className="domain-options">{ATTRIBUTES.map(a => <label key={a}><input type="checkbox" checked={domains.includes(a)} onChange={event => setDomains(event.target.checked ? [...domains, a] : domains.filter(d => d !== a))} />{a}</label>)}</div></fieldset>
        <button className="primary" disabled={busy}>{p.onboarded ? 'Save preferences' : 'Enter the System'}</button>
    </form>;
}
