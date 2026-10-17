import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import QuestBuilder from './QuestBuilder';
import { useOrion } from './context';

export default function QuestDialog({ onClose }: { onClose: () => void }) {
    const dialog = useRef<HTMLDialogElement>(null);
    const { error, pending, busy, retry } = useOrion();
    useEffect(() => {
        const element = dialog.current;
        const launcher = document.activeElement;
        const previousOverflow = document.body.style.overflow;
        element?.showModal();
        document.body.style.overflow = 'hidden';
        return () => {
            element?.close();
            document.body.style.overflow = previousOverflow;
            if (launcher instanceof HTMLElement) launcher.focus({ preventScroll: true });
        };
    }, []);
    return createPortal(<dialog ref={dialog} className="quest-dialog" aria-labelledby="quest-builder-title" onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, input, select, textarea, [tabindex="0"]')).filter(el => !el.matches(':disabled') && el.getClientRects().length > 0);
        const first = controls[0]; const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}>
        <div className="quest-dialog-scroll">
            <QuestBuilder onClose={onClose} />
            {(error || pending) && <div className="error-banner quest-dialog-error" role="alert"><p>{error ?? 'An unfinished save is waiting. Retry it with the original request ID.'}</p><button disabled={busy} onClick={() => { void retry(); }}>{pending ? 'Retry save' : 'Reconnect'}</button></div>}
        </div>
    </dialog>, document.body);
}
