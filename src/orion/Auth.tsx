import { useEffect, useState } from 'react';
import type { ReactNode, FormEvent } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './client';
import { OrionProvider } from './store';
import { FormActions } from './FormLayout';
import RpgArt from './RpgArt';

export default function Auth({ children }: { children: ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [loading, setLoading] = useState(Boolean(supabase));
    const [mode, setMode] = useState<'signin' | 'signup' | 'reset' | 'password'>('signin');
    const [message, setMessage] = useState('');
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        if (!supabase) return;
        let active = true;
        void supabase.auth.getSession().then(({ data, error }) => { if (active) { setSession(data.session); setLoading(false); if (error) setMessage(error.message); } });
        const { data } = supabase.auth.onAuthStateChange((event, current) => {
            if (event === 'PASSWORD_RECOVERY') setMode('password');
            setSession(current); setLoading(false);
        });
        return () => { active = false; data.subscription.unsubscribe(); };
    }, []);
    async function submit(event: FormEvent<HTMLFormElement>) {
        event.preventDefault();
        if (!supabase) return;
        const form = new FormData(event.currentTarget);
        const email = String(form.get('email') ?? '');
        const password = String(form.get('password') ?? '');
        setBusy(true); setMessage('');
        try {
            const redirectTo = window.location.origin + window.location.pathname;
            const response = mode === 'signup' ? await supabase.auth.signUp({ email, password, options: { emailRedirectTo: redirectTo } })
                : mode === 'reset' ? await supabase.auth.resetPasswordForEmail(email, { redirectTo })
                    : mode === 'password' ? await supabase.auth.updateUser({ password }) : await supabase.auth.signInWithPassword({ email, password });
            if (response.error) throw response.error;
            if (mode === 'signup') setMessage('Check your email to confirm your account, then sign in.');
            if (mode === 'reset') setMessage('If an account exists, a password reset link is on its way.');
            if (mode === 'password') { setMode('signin'); setMessage('Password updated.'); }
        } catch (error) { setMessage(error instanceof Error ? error.message : 'Connection failed. Try again.'); }
        finally { setBusy(false); }
    }
    if (loading) return <main className="auth-page"><p role="status">Connecting to your System…</p></main>;
    if (session && mode !== 'password') return <OrionProvider key={session.user.id} userId={session.user.id}>{children}</OrionProvider>;
    return <main className="auth-page">
        <a className="wordmark" href="/" aria-label="Orion home"><OrionMark />orion<span>Life, leveled.</span></a>
        <div className="auth-layout">
            <section className="auth-intro"><div className="system-rule" /><h1>Your next chapter<br />starts with a quest.</h1><p>Train your body. Make space for your mind. Turn the things you do each day into a character that grows with you.</p>
                <RpgArt scene="dashboard" hero />
                <p className="muted">Six attributes. Your own pace. Private by default.</p>
            </section>
            <section className="panel auth-panel">
                {!supabase ? <><h2>Connect your System</h2><p>Orion needs a Supabase project to securely save your progress across devices.</p><ol><li>Apply the migration in <code>supabase/migrations</code>.</li><li>Copy <code>.env.example</code> to <code>.env.local</code> and set the public project URL and key.</li><li>Restart the development server.</li></ol><p className="muted">See README.md for authentication, email, and deployment setup. Your previous browser save stays on this device for import after signup.</p></> : <>
                    <h2>{({ signin: 'Welcome back, player', signup: 'Begin your story', reset: 'Reset your password', password: 'Choose a new password' })[mode]}</h2>
                    <p className="muted">{mode === 'signup' ? 'Create a private account. No leaderboard, no comparison.' : 'Your progress follows you across devices.'}</p>
                    <form onSubmit={event => { void submit(event); }}>
                        {mode !== 'password' && <label>Email<input name="email" type="email" autoComplete="email" required /></label>}
                        {mode !== 'reset' && <label>Password<input name="password" type="password" minLength={8} autoComplete={mode === 'signin' ? 'current-password' : 'new-password'} required /></label>}
                        <FormActions><button className="primary" aria-busy={busy} disabled={busy}>{busy ? 'Connecting…' : ({ signin: 'Sign in', signup: 'Create account', reset: 'Send reset link', password: 'Save password' })[mode]}</button></FormActions>
                    </form>
                    {message && <p role="status" className="feedback">{message}</p>}
                    <div className="button-row">{mode !== 'signin' && <button className="text-button" onClick={() => setMode('signin')}>Back to sign in</button>}{mode === 'signin' && <><button className="text-button" onClick={() => setMode('signup')}>Create an account</button><button className="text-button" onClick={() => setMode('reset')}>Forgot password?</button></>}</div>
                </>}
            </section>
        </div>
    </main>;
}
export function OrionMark() {
    return <svg className="orion-mark" viewBox="0 0 32 32" shapeRendering="crispEdges" aria-hidden="true"><path d="M13 1h6v6h4v4h7v10h-7v4h-4v6h-6v-6H9v-4H2V11h7V7h4Z" fill="currentColor" /><path d="M14 7h4v5h5v7h-5v6h-4v-6H9v-7h5Z" fill="var(--sidebar)" /><path d="M14 12h4v7h-4Z" fill="var(--amber)" /></svg>;
}
