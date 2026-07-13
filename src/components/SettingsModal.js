import { t } from '../lib/i18n.js';

export function SettingsModal(onClose) {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);display:flex;align-items:center;justify-content:center;z-index:100;';

    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--bg-card,#111);border-radius:1rem;border:1px solid rgba(255,255,255,0.08);width:min(90vw,36rem);max-height:85vh;display:flex;flex-direction:column;overflow:hidden;';

    const header = document.createElement('div');
    header.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:1.25rem 1.5rem;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';
    header.innerHTML = `
        <h2 style="font-size:1rem;font-weight:800;color:#fff;margin:0;">${t('settings.title')}</h2>
        <button id="settings-close-btn" style="color:rgba(255,255,255,0.4);background:none;border:none;cursor:pointer;padding:4px;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
    `;
    modal.appendChild(header);

    // The Cinematic Pipeline Studio is a preview/audit workbench. Legacy model
    // acquisition controls are intentionally unreachable from this surface.
    const tabs = [{ id: 'pipeline', label: t('settings.pipeline') }];
    const tabBar = document.createElement('div');
    tabBar.style.cssText = 'display:flex;gap:0.25rem;padding:0.75rem 1.5rem 0;border-bottom:1px solid rgba(255,255,255,0.06);flex-shrink:0;';
    const tabButtons = {};

    const body = document.createElement('div');
    body.style.cssText = 'flex:1;overflow-y:auto;padding:1.5rem;';

    // Folder selection and dry-run previews live in the full Pipeline Settings
    // panel. This lightweight modal deliberately stores no credentials.
    const pipelinePanel = document.createElement('div');
    pipelinePanel.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:0.75rem;">
            <h3 style="font-size:0.9rem;color:#fff;margin:0;">${t('settings.pipelineTitle')}</h3>
            <p style="font-size:0.75rem;line-height:1.6;color:rgba(255,255,255,0.5);margin:0;">
                ${t('settings.pipelineNote')}
            </p>
        </div>
    `;
    function switchTab(id) {
        body.replaceChildren(pipelinePanel);
        for (const tab of tabs) {
            const active = tab.id === id;
            tabButtons[tab.id].style.background = active ? 'rgba(255,255,255,0.08)' : 'transparent';
            tabButtons[tab.id].style.color = active ? '#fff' : 'rgba(255,255,255,0.4)';
        }
    }

    for (const tab of tabs) {
        const button = document.createElement('button');
        button.textContent = tab.label;
        button.style.cssText = 'padding:0.4rem 0.75rem;border-radius:0.5rem 0.5rem 0 0;font-size:0.75rem;font-weight:700;border:none;cursor:pointer;transition:all 0.15s;';
        button.onclick = () => switchTab(tab.id);
        tabButtons[tab.id] = button;
        tabBar.appendChild(button);
    }

    modal.appendChild(tabBar);
    modal.appendChild(body);
    switchTab('pipeline');

    const close = () => {
        if (document.body.contains(overlay)) document.body.removeChild(overlay);
        if (onClose) onClose();
    };
    header.querySelector('#settings-close-btn').onclick = close;
    overlay.addEventListener('click', (event) => { if (event.target === overlay) close(); });

    overlay.appendChild(modal);
    return overlay;
}
