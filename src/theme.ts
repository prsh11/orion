export type Theme = 'light' | 'dark';

const THEME_KEY = 'fitquest-theme';

export function loadTheme(): Theme {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        if (saved === 'light' || saved === 'dark') return saved;
    } catch {
        // The toggle still works when browser storage is unavailable.
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme) {
    document.documentElement.dataset.theme = theme;
}

export function saveTheme(theme: Theme) {
    applyTheme(theme);
    try {
        localStorage.setItem(THEME_KEY, theme);
    } catch {
        // Keep the selected appearance for this session.
    }
}
