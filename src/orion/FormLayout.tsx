import type { ReactNode } from 'react';

export function FormSection({ title, help, children }: { title: string; help?: string; children: ReactNode }) {
    return <fieldset className="form-section"><legend>{title}</legend>{help && <p className="muted form-help">{help}</p>}<div className="form-section-fields">{children}</div></fieldset>;
}

export function FormActions({ children }: { children: ReactNode }) {
    return <div className="form-actions">{children}</div>;
}
