import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import GameIcon from './GameIcon';
import { useExperience } from './experience';
import type { Exercise } from './types';

export default function ExercisePicker({ exercises, recent, selected, onChoose, onClose, disabled }: {
    exercises: Exercise[]; recent: Set<string>; selected: string[];
    onChoose: (id: string) => void; onClose: () => void; disabled: boolean;
}) {
    const { effectiveEffects } = useExperience();
    const dialog = useRef<HTMLDialogElement>(null);
    const searchInput = useRef<HTMLInputElement>(null);
    const backdropPress = useRef(false);
    const titleId = useId();
    const hintId = useId();
    const [search, setSearch] = useState('');
    const matches = [...exercises].sort((a, b) => Number(recent.has(b.id)) - Number(recent.has(a.id)) || a.name.localeCompare(b.name))
        .filter(e => e.name.toLowerCase().includes(search.trim().toLowerCase()));
    useEffect(() => {
        const element = dialog.current;
        const launcher = document.activeElement;
        const overflow = document.body.style.overflow;
        element?.showModal();
        document.body.style.overflow = 'hidden';
        searchInput.current?.focus({ preventScroll: true });
        return () => {
            element?.close();
            document.body.style.overflow = overflow;
            if (launcher instanceof HTMLElement && launcher.isConnected) launcher.focus({ preventScroll: true });
        };
    }, []);
    function outside(event: { target: EventTarget; currentTarget: HTMLDialogElement; clientX: number; clientY: number }) {
        const box = event.currentTarget.getBoundingClientRect();
        return event.target === event.currentTarget && (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom);
    }
    return createPortal(<dialog ref={dialog} className="exercise-dialog" data-effects={effectiveEffects} aria-labelledby={titleId} aria-describedby={hintId}
        onCancel={event => { event.preventDefault(); onClose(); }}
        onPointerDown={event => { backdropPress.current = outside(event); }}
        onClick={event => { if (backdropPress.current && outside(event)) onClose(); backdropPress.current = false; }}
        onKeyDown={event => {
            if (event.key !== 'Tab') return;
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input')).filter(el => !el.matches(':disabled') && el.getClientRects().length > 0);
            const first = controls[0]; const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }}>
        <div className="exercise-picker-shell">
            <header className="exercise-picker-header">
                <span className="exercise-picker-crest" aria-hidden="true"><GameIcon name="training" /></span>
                <div><h2 id={titleId}>Choose an exercise</h2><p id={hintId}>Build your workout, one exercise at a time.</p></div>
                <button className="icon-button text-button" type="button" aria-label="Close exercise chooser" onClick={onClose}>×</button>
            </header>
            <div className="exercise-picker-search"><label>Search exercises<input ref={searchInput} type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Squat, press, pull-up…" /></label></div>
            <div className="exercise-picker-roster-heading"><span>{search.trim() ? 'Search results' : recent.size ? 'Recent exercises first' : 'Exercise library'}</span><span role="status">{matches.length} {matches.length === 1 ? 'exercise' : 'exercises'}</span></div>
            <div className="gym-picker-list exercise-picker-roster">
                {matches.map(exercise => {
                    const added = selected.includes(exercise.id);
                    return <button className={`exercise-picker-choice ${added ? 'is-added' : ''}`} type="button" key={exercise.id} disabled={disabled} onClick={() => onChoose(exercise.id)}>
                        <span className="exercise-picker-icon" aria-hidden="true"><GameIcon name={exercise.bodyweight ? 'character' : 'training'} /></span>
                        <span className="exercise-picker-copy"><strong>{exercise.name}</strong><small>{exercise.bodyweight ? 'Bodyweight · record added weight' : exercise.dumbbell ? 'Dumbbells · weight per dumbbell' : 'Reps and weight'}</small></span>
                        <span className="exercise-picker-action">{added ? <><GameIcon name="check" /><small>In workout</small></> : <>{recent.has(exercise.id) && <small>Recent</small>}<span aria-hidden="true">+</span></>}</span>
                    </button>;
                })}
                {matches.length === 0 && <div className="exercise-picker-empty"><GameIcon name="training" /><h3>No exercises found</h3><p>Try another name, or add a private exercise in the Exercises section.</p><button type="button" className="secondary" onClick={() => { setSearch(''); searchInput.current?.focus(); }}>Clear search</button></div>}
            </div>
            <footer className="exercise-picker-footer"><span>{selected.length ? `${selected.length} ${selected.length === 1 ? 'exercise' : 'exercises'} in your workout` : 'Choose an exercise to add your first set.'}</span><button className="text-button" type="button" onClick={onClose}>Back to workout</button></footer>
        </div>
    </dialog>, document.body);
}
