export type Tab = 'Dashboard' | 'Todos' | 'Quests' | 'Training' | 'Journal' | 'Character' | 'Settings';
export interface NavigationTarget { questId?: string; section?: 'todos' | 'bosses' | 'daily' | 'log' | 'entry' }
export type Navigate = (tab: Tab, target?: NavigationTarget) => void;
export const pageSections: Record<Tab, readonly { id: string; label: string }[]> = {
    Dashboard: [],
    Todos: [{ id: 'today', label: 'Today' }, { id: 'upcoming', label: 'Upcoming' }, { id: 'history', label: 'History' }],
    Quests: [{ id: 'journal', label: 'Quest journal' }, { id: 'bosses', label: 'Boss encounters' }],
    Training: [{ id: 'log', label: 'Log training' }, { id: 'history', label: 'History' }, { id: 'exercises', label: 'Exercises' }],
    Journal: [{ id: 'entry', label: 'Make an entry' }, { id: 'daily', label: 'Daily rhythm' }, { id: 'history', label: 'History' }],
    Character: [{ id: 'overview', label: 'Overview' }, { id: 'analytics', label: 'Analytics' }, { id: 'progression', label: 'Progression history' }],
    Settings: [{ id: 'preferences', label: 'Preferences' }, { id: 'appearance', label: 'Appearance and sound' }, { id: 'data', label: 'Data and account' }],
};
