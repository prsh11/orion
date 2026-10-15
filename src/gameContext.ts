import { createContext, useContext } from 'react';
import type { Dispatch } from 'react';
import type { GameAction, GameState, Level } from './types';

export const GameContext = createContext<{
    state: GameState;
    dispatch: Dispatch<GameAction>;
    level: number;
    nextLevel: Level | null;
} | null>(null);

export function useGame() {
    const context = useContext(GameContext);
    if (!context) throw new Error('useGame must be used within GameProvider');
    return context;
}
