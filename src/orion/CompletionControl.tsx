import { useEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, InputHTMLAttributes } from 'react';

function useCompletionFeedback(checked: boolean, pending: boolean, uncertain: boolean) {
    const previous = useRef(checked);
    const armed = useRef(false);
    const wasPending = useRef(false);
    const [activated, setActivated] = useState(false);
    const [phase, setPhase] = useState<'idle' | 'check' | 'undo'>('idle');
    useEffect(() => {
        if (previous.current !== checked) {
            if (armed.current) setPhase(checked ? 'check' : 'undo');
            armed.current = false;
            setActivated(false);
        } else if (wasPending.current && !pending && !uncertain) { armed.current = false; setActivated(false); }
        previous.current = checked;
        wasPending.current = pending;
    }, [checked, pending, uncertain]);
    useEffect(() => {
        if (phase === 'idle') return;
        const timer = setTimeout(() => setPhase('idle'), 460);
        return () => clearTimeout(timer);
    }, [phase]);
    return { phase, waiting: pending && activated, activate: () => { armed.current = true; setActivated(true); } };
}

export function CompletionMark({ checked, waiting = false, phase = 'idle' }: { checked: boolean; waiting?: boolean; phase?: 'idle' | 'check' | 'undo' }) {
    return <span className={`completion-mark ${checked ? 'is-checked' : ''} ${waiting ? 'is-waiting' : ''}`} data-phase={phase} aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M3 9h3v3h3V9h3V6h3V3h3v6h-3v3h-3v3H9v3H6v-3H3Z" /></svg></span>;
}

type CheckboxProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'size'> & { pending?: boolean; uncertain?: boolean };
export default function RpgCheckbox({ checked, defaultChecked, pending = false, uncertain = false, className = '', onChange, onReset, ...props }: CheckboxProps) {
    const [local, setLocal] = useState(Boolean(defaultChecked));
    const value = checked ?? local;
    const feedback = useCompletionFeedback(value, pending, uncertain);
    const input = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const form = input.current?.form;
        const reset = () => setLocal(Boolean(defaultChecked));
        form?.addEventListener('reset', reset);
        return () => form?.removeEventListener('reset', reset);
    }, [defaultChecked]);
    return <span className={`rpg-checkbox ${className}`}><input {...props} ref={input} type="checkbox" checked={value} aria-busy={feedback.waiting || undefined} onReset={onReset} onChange={event => { feedback.activate(); if (checked === undefined) setLocal(event.target.checked); onChange?.(event); }} /><CompletionMark checked={value} waiting={feedback.waiting} phase={feedback.phase} /></span>;
}

type CompletionButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'aria-pressed'> & { checked: boolean; pending?: boolean; uncertain?: boolean; onToggle: () => void };
export function CompletionButton({ checked, pending = false, uncertain = false, onToggle, children, className = '', ...props }: CompletionButtonProps) {
    const feedback = useCompletionFeedback(checked, pending, uncertain);
    return <button {...props} type="button" className={`completion-button ${className}`} aria-pressed={checked} aria-busy={feedback.waiting || undefined} onClick={() => { feedback.activate(); onToggle(); }}><CompletionMark checked={checked} waiting={feedback.waiting} phase={feedback.phase} />{children}</button>;
}
