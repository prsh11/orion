import { useSyncExternalStore } from 'react';
import AudioFX from '../audio';
export type Effects = 'full' | 'reduced' | 'off';
function readEffects(): Effects {
    if (typeof window === 'undefined') return 'full';
    try { const saved = localStorage.getItem('orion-effects'); return saved === 'reduced' || saved === 'off' ? saved : 'full'; } catch { return 'full'; }
}
let effects = readEffects();
const listeners = new Set<() => void>();
function subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
const reducedQuery = '(prefers-reduced-motion: reduce)';
function subscribeMotion(listener: () => void) { const query = window.matchMedia(reducedQuery); query.addEventListener('change', listener); return () => query.removeEventListener('change', listener); }
export function useExperience() {
    const audio = useSyncExternalStore(AudioFX.subscribe, AudioFX.settings);
    const preference = useSyncExternalStore(subscribe, () => effects);
    const reduced = useSyncExternalStore(subscribeMotion, () => window.matchMedia(reducedQuery).matches);
    return { ...audio, effects: preference, effectiveEffects: preference === 'full' && reduced ? 'reduced' : preference };
}
export function setEffects(value: Effects) {
    effects = value; try { localStorage.setItem('orion-effects', value); } catch { /* In-memory fallback. */ }
    listeners.forEach(listener => listener());
}
