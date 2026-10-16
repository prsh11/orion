import { useCallback, useEffect, useReducer, useRef } from 'react';
import type { ReactNode } from 'react';
import { OrionContext } from './context';
import type { OrionState } from './context';
import type { Command, Snapshot } from './types';
import { CommandError, sendCommand, snapshot, supabase } from './client';
import { feedbackForUpdate } from './feedback';
import type { FeedbackOrigin, RewardPresentation } from './feedback';
import AudioFX from '../audio';


type Action = { type: 'busy' } | { type: 'snapshot'; data: Snapshot; presentation: RewardPresentation | null } | { type: 'error'; message: string; pending?: Command } | { type: 'notice'; text: string } | { type: 'dismiss' } | { type: 'pending'; command: Command | null } | { type: 'dismissPresentation' };
function reducer(state: OrionState, action: Action): OrionState {
    switch (action.type) {
        case 'busy': return { ...state, busy: true, error: null };
        case 'snapshot': return { ...state, data: action.data, busy: false, error: null,
            presentations: action.presentation ? [...state.presentations, action.presentation] : state.presentations };
        case 'dismissPresentation': return { ...state, presentations: state.presentations.slice(1) };
        case 'error': return { ...state, busy: false, error: action.message, pending: action.pending ?? state.pending };
        case 'pending': return { ...state, pending: action.command };
        case 'notice': return { ...state, notices: [...state.notices, action.text] };
        case 'dismiss': return { ...state, notices: state.notices.slice(1) };
    }
}
export function OrionProvider({ userId, children }: { userId: string; children: ReactNode }) {
    const pendingKey = `orion-pending:${userId}`;
    const [state, dispatch] = useReducer(reducer, undefined, (): OrionState => {
        let pending: Command | null = null;
        try {
            const saved: unknown = JSON.parse(localStorage.getItem(pendingKey) ?? 'null');
            if (saved && typeof saved === 'object' && 'id' in saved && typeof saved.id === 'string' && 'action' in saved && typeof saved.action === 'string' && 'payload' in saved && saved.payload && typeof saved.payload === 'object' && !Array.isArray(saved.payload)) {
                pending = { id: saved.id, action: saved.action, payload: saved.payload as Record<string, unknown> };
            }
        } catch { /* Storage may be unavailable. */ }
        return { data: null, busy: false, error: null, pending, notices: [], presentations: [] };
    });
    const inFlight = useRef(false);
    const confirmedSnapshot = useRef<Snapshot | null>(null);
    const deferredOrigin = useRef<FeedbackOrigin | undefined>(undefined);
    const acceptSnapshot = useCallback((data: Snapshot, origin?: FeedbackOrigin) => {
        const presentation = feedbackForUpdate(confirmedSnapshot.current, data, origin ?? deferredOrigin.current);
        confirmedSnapshot.current = data;
        deferredOrigin.current = undefined;
        dispatch({ type: 'snapshot', data, presentation });
        return presentation;
    }, []);
    const dismissPresentation = useCallback(() => { dispatch({ type: 'dismissPresentation' }); }, []);
    const refresh = useCallback(async () => {
        if (inFlight.current) return;
        inFlight.current = true;
        dispatch({ type: 'busy' });
        try { acceptSnapshot(await snapshot()); }
        catch (error) { dispatch({ type: 'error', message: error instanceof Error ? error.message : 'Connection failed. Try refreshing.' }); }
        finally { inFlight.current = false; }
    }, [acceptSnapshot]);
    const execute = useCallback(async (command: Command) => {
        if (inFlight.current) return false;
        const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
        inFlight.current = true;
        dispatch({ type: 'busy' });
        dispatch({ type: 'pending', command });
        try { localStorage.setItem(pendingKey, JSON.stringify(command)); } catch { /* In-memory retry remains available. */ }
        let confirmed = false;
        try {
            const result = await sendCommand(command);
            confirmed = true;
            try { localStorage.removeItem(pendingKey); } catch { /* In-memory pending is cleared below. */ }
            // Mutation succeeded; a failed refresh must not invite a different submission.
            dispatch({ type: 'pending', command: null });
            if (result.deleted) {
                try {
                    for (const key of Object.keys(localStorage)) if (key.startsWith(`orion-draft:${userId}:`) || key === pendingKey) localStorage.removeItem(key);
                } catch { /* Account is already deleted on the server. */ }
                await supabase?.auth.signOut();
                window.location.reload(); return true;
            }
            deferredOrigin.current = { command, returnFocus, personalRecordCommandId: result.personal_record ? command.id : deferredOrigin.current?.personalRecordCommandId, personalRecord: Boolean(result.personal_record || deferredOrigin.current?.personalRecord) };
            const presentation = acceptSnapshot(await snapshot(), deferredOrigin.current);
            if (!presentation) dispatch({ type: 'notice', text: 'Saved to your account' });
            return true;
        } catch (error) {
            const retryable = !confirmed && (!(error instanceof CommandError) || error.retryable);
            if (!retryable) {
                try { localStorage.removeItem(pendingKey); } catch { /* In-memory pending cleared below. */ }
                dispatch({ type: 'pending', command: null });
            }
            dispatch({ type: 'error', message: confirmed ? 'Saved successfully. Refresh to load the latest progress.' : `${error instanceof Error ? error.message : 'Save failed'}. Your draft is kept.`, ...(retryable ? { pending: command } : {}) });
            return confirmed;
        } finally { inFlight.current = false; }
    }, [acceptSnapshot, pendingKey, userId]);
    const command = useCallback(async (action: string, payload: Record<string, unknown>) => {
        if (state.pending) { dispatch({ type: 'error', message: 'Retry the pending request before another save.' }); return false; }
        return execute({ id: crypto.randomUUID(), action, payload });
    }, [execute, state.pending]);
    useEffect(() => {
        // Resume audio inside a real gesture, before an asynchronous save returns.
        const unlock = () => AudioFX.unlock();
        window.addEventListener('pointerdown', unlock, true);
        window.addEventListener('keydown', unlock, true);
        return () => {
            window.removeEventListener('pointerdown', unlock, true);
            window.removeEventListener('keydown', unlock, true);
        };
    }, []);
    useEffect(() => {
        void refresh();
        const focus = () => { void refresh(); };
        window.addEventListener('focus', focus);
        const timer = window.setInterval(focus, 60_000);
        return () => { window.removeEventListener('focus', focus); clearInterval(timer); };
    }, [refresh]);
    useEffect(() => () => { AudioFX.stop(); }, []);
    return <OrionContext.Provider value={{ ...state, refresh, command, retry: async () => { if (state.pending) await execute(state.pending); else await refresh(); }, dismissPresentation, dismiss: () => dispatch({ type: 'dismiss' }) }}>{children}</OrionContext.Provider>;
}
