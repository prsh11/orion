import { createContext, useContext } from 'react';
import type { Command, Snapshot } from './types';
import type { RewardPresentation } from './feedback';
export interface OrionState {
    data: Snapshot | null; busy: boolean; error: string | null; pending: Command | null; notices: string[]; presentations: RewardPresentation[];
}
export interface OrionContextValue extends OrionState {
    serverNow: () => number;
    refresh: () => Promise<void>;
    command: (action: string, payload: Record<string, unknown>) => Promise<boolean>;
    retry: () => Promise<void>; dismiss: () => void; dismissPresentation: () => void;
}
export const OrionContext = createContext<OrionContextValue | null>(null);
export function useOrion() {
    const value = useContext(OrionContext);
    if (!value) throw new Error('Missing Orion provider');
    return value;
}
