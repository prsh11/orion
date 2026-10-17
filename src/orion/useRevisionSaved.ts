import { useEffect, useRef } from 'react';
import { useOrion } from './context';

/** A revision retried by the provider can finish after the original form submit returned. */
export function useRevisionSaved(action: 'revise_quest' | 'revise_boss', id: string | undefined, onSaved: () => void) {
    const { busy, pending, error } = useOrion();
    const waiting = useRef(false);
    useEffect(() => {
        if (id && pending?.action === action && pending.payload.id === id) waiting.current = true;
        if (waiting.current && !busy && !pending) {
            waiting.current = false;
            if (!error) onSaved();
        }
    }, [action, id, busy, pending, error, onSaved]);
}
