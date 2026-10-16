const paths = [
    'M3 10 12 3l9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1Z',
    'm12 3 8 5v8l-8 5-8-5V8Zm0 5v8m-4-4h8',
    'm5 5 14 14M3 7l4-4m10 18 4-4M1 5l4-4m14 22 4-4M7 3 3 7m14 14 4-4',
    'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H4Zm16 0h-4a3 3 0 0 0-3 3m7-3v15h-3',
    'M12 3 3 8v8l9 5 9-5V8Zm0 0v18M3 8l18 8M21 8 3 16',
    'M9 3h6l1 4 4 1 1 6-4 2-1 4h-6l-2-4-4-1-1-6 4-2Zm3 6a3 3 0 1 0 0 6 3 3 0 0 0 0-6',
];
export default function NavIcon({ index }: { index: number }) {
    return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[index]} /></svg>;
}
