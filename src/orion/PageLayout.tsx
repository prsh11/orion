import { useId, useState } from 'react';
import type { HTMLAttributes, ReactNode } from 'react';
import RpgArt from './RpgArt';
import type { RpgScene } from './RpgArt';
import AudioFX from '../audio';
import NavIcon from './NavIcon';
import type { Tab } from './navigation';

export function Panel({ children, className = '', ...props }: HTMLAttributes<HTMLElement>) {
    return <section {...props} className={`panel ${className}`}>{children}</section>;
}

export function PageHeader({ title, description, scene }: { title: Tab; description: string; scene: RpgScene }) {
    return <header className="page-header"><div className="page-heading"><span className="page-heading-sigil" aria-hidden="true"><NavIcon page={title} /></span><div><h1>{title}</h1><p>{description}</p></div></div><RpgArt scene={scene} /></header>;
}

interface SectionItem { id: string; label: string }
export function PageTabs({ items, value, onChange, label, id }: { items: readonly SectionItem[]; value: string; onChange: (value: string) => void; label: string; id: string }) {
    return <div className="page-tabs" role="tablist" aria-label={label}>{items.map(item => <button key={item.id} id={`${id}-tab-${item.id}`} role="tab" type="button" aria-selected={value === item.id} aria-controls={`${id}-panel-${item.id}`} tabIndex={value === item.id ? 0 : -1} onClick={() => { if (value !== item.id) AudioFX.click(); onChange(item.id); }} onKeyDown={event => {
        const index = items.findIndex(i => i.id === item.id);
        const next = event.key === 'ArrowRight' ? (index + 1) % items.length : event.key === 'ArrowLeft' ? (index + items.length - 1) % items.length : event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : undefined;
        if (next === undefined) return;
        event.preventDefault(); const selected = items[next];
        if (selected) { onChange(selected.id); document.getElementById(`${id}-tab-${selected.id}`)?.focus(); }
    }}>{item.label}</button>)}</div>;
}

export function Subsections({ items, value, onChange, label }: { items: readonly (SectionItem & { content: ReactNode })[]; value: string; onChange: (value: string) => void; label: string }) {
    const id = useId();
    const [visited, setVisited] = useState(() => new Set([value]));
    return <div className="page-subsections"><PageTabs items={items} value={value} label={label} id={id} onChange={next => { setVisited(previous => new Set([...previous, value, next])); onChange(next); }} />{items.map(item => <div key={item.id} id={`${id}-panel-${item.id}`} role="tabpanel" aria-labelledby={`${id}-tab-${item.id}`} tabIndex={-1} className="page-tab-panel" hidden={value !== item.id}>{(visited.has(item.id) || value === item.id) && item.content}</div>)}</div>;
}
