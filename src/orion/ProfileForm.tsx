import RpgCheckbox from './CompletionControl';
import { useState } from 'react';
import type { FormEvent } from 'react';
import { FormSection, FormActions } from './FormLayout';
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
        <FormSection title="Identity"><label>Display name<input name="name" defaultValue={p.onboarded ? p.display_name : ''} required maxLength={60} autoComplete="nickname" /></label>
        </FormSection><FormSection title="Timezone and units"><div className="form-grid"><label>Timezone<input name="timezone" list="timezones" defaultValue={p.onboarded ? p.timezone : Intl.DateTimeFormat().resolvedOptions().timeZone} required /><datalist id="timezones">{Intl.supportedValuesOf('timeZone').map(z => <option key={z} value={z} />)}<option value="UTC" /></datalist></label>
        <label>Units<select name="units" defaultValue={p.units}><option value="metric">kg / km</option><option value="imperial">lb / mi</option></select></label>
        </div></FormSection><FormSection title="Your life domains" help="Choose the areas you want to make room for."><div className="domain-options">{ATTRIBUTES.map(a => <label key={a}><RpgCheckbox checked={domains.includes(a)} onChange={event => setDomains(event.target.checked ? [...domains, a] : domains.filter(d => d !== a))} />{a}</label>)}</div></FormSection>
        <FormActions><button className="primary" aria-busy={busy} disabled={busy}>{busy ? 'Saving…' : p.onboarded ? 'Save preferences' : 'Enter the System'}</button></FormActions>
    </form>;
}
