import type { Attribute } from './types';
export type IconName = Attribute | 'orbit' | 'quest' | 'training' | 'journal' | 'character' | 'settings' | 'star' | 'boss' | 'check' | 'water' | 'sleep' | 'focus' | 'meal' | 'sound' | 'muted' | 'loss' | 'todo';
const paths: Record<IconName, string> = {
    Strength: 'M12 2 7 8l2 3-4 5 3 5h8l3-5-4-5 2-3Zm-3 9h6M8 16h8m-4-5v10',
    Endurance: 'm13 2-9 12h7l-1 8 10-13h-7Zm-9 5h3M2 11h3m13 6h4',
    Vitality: 'M12 21S2 15 2 9a5 5 0 0 1 10-1A5 5 0 0 1 22 9c0 6-10 12-10 12ZM5 12h4l2-4 3 8 2-4h3',
    Intellect: 'm12 2 9 6v8l-9 6-9-6V8Zm0 4-5 6 5 6 5-6Zm0-4v4m9 2-4 4m-14-4 4 4m5 6v4',
    Discipline: 'm12 2 8 4v7c0 5-8 9-8 9S4 18 4 13V6Zm-4 10 3 3 5-7',
    Connection: 'M8 4a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8ZM11 7h4a5 5 0 0 1 5 5M4 12a5 5 0 0 0 5 5h4',
    orbit: 'M12 2v4m0 12v4M2 12h4m12 0h4M5 5l3 3m8 8 3 3M5 19l3-3m8-8 3-3M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z',
    quest: 'M6 3h12l3 6-9 13L3 9Zm-3 6h18M6 3l6 19 6-19M3 9l9-6 9 6',
    training: 'm7 3-4 4m18 10-4 4M2 5l3-3m14 20 3-3M5 8l11 11m-8-14 11 11M4 10l6-6m4 16 6-6',
    journal: 'M3 4h6a4 4 0 0 1 3 4v13a4 4 0 0 0-4-2H3Zm18 0h-6a4 4 0 0 0-3 4m9-4v15h-5M6 8h3m-3 4h3m7-4h2m-2 4h2',
    character: 'm12 2 9 5v10l-9 5-9-5V7Zm0 0v20M3 7l18 10M21 7 3 17',
    settings: 'M9 3h6l1 4 4 1 1 6-4 2-1 4h-6l-2-4-4-1-1-6 4-2Zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
    star: 'm12 2 3 6 7 1-5 5 1 8-6-4-6 4 1-8-5-5 7-1Z',
    boss: 'm3 3 6 4 3-5 3 5 6-4-2 10-7 9-7-9Zm4 9 3 2m7-2-3 2m-4 3h4',
    check: 'm5 12 4 4L19 6M8 3H3v18h18v-5',
    water: 'M12 2S4 11 4 15a8 8 0 0 0 16 0c0-4-8-13-8-13Zm-4 13a4 4 0 0 0 4 4',
    sleep: 'M19 15A9 9 0 0 1 9 3 9 9 0 1 0 19 15Zm-3-12v5m-2-3h4m2 3v4m-2-2h4',
    focus: 'M12 2v4m0 12v4M2 12h4m12 0h4M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 3v4m-2-2h4',
    meal: 'M4 2v7a3 3 0 0 0 6 0V2M7 2v20M19 2s-5 4-5 10h5Zm0 10v10',
    sound: 'm3 9 5 0 5-5v16l-5-5H3Zm14-2a7 7 0 0 1 0 10m3-13a11 11 0 0 1 0 16',
    muted: 'm3 9 5 0 5-5v16l-5-5H3Zm14 0 5 6m0-6-5 6',
    loss: 'M12 3v17m-6-6 6 6 6-6M4 3h16',
    todo: 'M6 3h12l3 4v14H3V3Zm1 9 3 3 7-7',
};
export default function GameIcon({ name, className = '' }: { name: IconName; className?: string }) {
    return <svg className={`game-icon ${className}`} data-icon={name} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
export function RankBadge({ rank, decorative = false }: { rank: string; decorative?: boolean }) {
    const tier = Math.max(0, ['E', 'D', 'C', 'B', 'A', 'S'].indexOf(rank));
    return <svg className="rank-badge" data-rank={rank} viewBox="0 0 120 128" role={decorative ? undefined : 'img'} aria-label={decorative ? undefined : `Rank ${rank}`} aria-hidden={decorative || undefined}>
        <path className="rank-wings" d="m28 40-20-8 9 33 16 13m59-38 20-8-9 33-16 13M21 81l14 12m64-12L85 93" />
        <path className="rank-shell" d="m60 5 39 23v49L60 119 21 77V28Z" />
        <path className="rank-inner" d="m60 15 30 18v40l-30 33-30-33V33Z" />
        {Array.from({ length: tier + 1 }, (_, i) => <circle className="rank-star" key={i} cx={60 + (i - tier / 2) * 10} cy="31" r="2" />)}
        <text x="60" y="78" textAnchor="middle">{rank}</text><path className="rank-wings" d="m48 89 12 10 12-10" />
    </svg>;
}
