import { createContext, useContext } from 'react';
import type { Command, Snapshot } from './types';
export interface OrionState {
    data: Snapshot | null; busy: boolean; error: string | null; pending: Command | null; notices: string[];
}
export interface OrionContextValue extends OrionState {
    refresh: () => Promise<void>;
    command: (action: string, payload: Record<string, unknown>) => Promise<boolean>;
    retry: () => Promise<void>; dismiss: () => void;
}
export const OrionContext = createContext<OrionContextValue | null>(null);
export function useOrion() {
    const value = useContext(OrionContext);
    if (!value) throw new Error('Missing Orion provider');
    return value;
}
