import { t } from '../lib/i18n.js';

export function SettingsModal(onClose) {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'settings-overlay';

    const modal = document.createElement('section');
    modal.className = 'settings-dialog';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'settings-dialog-title');

    const header = document.createElement('header');
    header.className = 'settings-dialog-header';

    const title = document.createElement('h2');
    title.id = 'settings-dialog-title';
    title.className = 'settings-dialog-title';
    title.textContent = t('settings.title');

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'settings-dialog-close';
    closeButton.setAttribute('aria-label', t('settings.close'));
    closeButton.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <path d="M18 6L6 18M6 6l12 12"/>
        </svg>
    `;

    const body = document.createElement('div');
    body.className = 'settings-dialog-body';
    const bodyTitle = document.createElement('h3');
    bodyTitle.className = 'settings-dialog-section-title';
    bodyTitle.textContent = t('settings.pipelineTitle');
    const note = document.createElement('p');
    note.className = 'settings-dialog-note';
    note.textContent = t('settings.pipelineNote');
    body.appendChild(bodyTitle);
    body.appendChild(note);

    const close = () => {
        document.removeEventListener('keydown', onKeyDown);
        overlay.remove();
        if (typeof previousFocus?.focus === 'function') previousFocus.focus();
        onClose?.();
    };
    const onKeyDown = (event) => {
        if (event.key === 'Escape') close();
    };

    closeButton.addEventListener('click', close);
    overlay.addEventListener('click', (event) => {
        if (event.target === overlay) close();
    });
    document.addEventListener('keydown', onKeyDown);

    header.appendChild(title);
    header.appendChild(closeButton);
    modal.appendChild(header);
    modal.appendChild(body);
    overlay.appendChild(modal);

    setTimeout(() => closeButton.focus(), 0);
    return overlay;
}
