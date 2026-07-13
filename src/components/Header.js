import { t, getLang, setLang } from '../lib/i18n.js';

function iconButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-brand-button';
    button.setAttribute('aria-label', t('nav.pipeline'));
    button.innerHTML = `
        <span class="app-brand-mark" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2L2 7L12 12L22 7L12 2Z" fill="currentColor"/>
                <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </span>
    `;
    return button;
}

export function Header(navigate) {
    const header = document.createElement('header');
    header.className = 'app-bar';

    const left = document.createElement('div');
    left.className = 'app-brand';
    const logo = iconButton();
    logo.addEventListener('click', () => navigate('pipeline'));

    const productName = document.createElement('span');
    productName.className = 'app-brand-name';
    productName.textContent = t('nav.pipeline');
    left.appendChild(logo);
    left.appendChild(productName);

    const controls = document.createElement('div');
    controls.className = 'app-bar-controls';

    const language = document.createElement('select');
    language.className = 'app-language-select';
    language.setAttribute('aria-label', t('web.languageLabel'));
    [
        ['ko-KR', '한국어'],
        ['en', 'EN'],
        ['zh-CN', '中文'],
    ].forEach(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        language.appendChild(option);
    });
    language.value = getLang();
    language.addEventListener('change', () => setLang(language.value));

    const settings = document.createElement('button');
    settings.type = 'button';
    settings.className = 'app-settings-button';
    settings.setAttribute('aria-label', t('web.settingsTitle'));
    settings.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33A1.65 1.65 0 0 0 14 20.83V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1.08-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15.08 1.65 1.65 0 0 0 3.09 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 8.92a1.65 1.65 0 0 0-.33-1.82l-.06-.06A2 2 0 1 1 7.04 4.2l.06.06a1.65 1.65 0 0 0 1.82.33H9A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1.08 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c.12.6.64 1 1.25 1H21a2 2 0 0 1 0 4h-.09c-.61 0-1.13.4-1.51 1Z"/>
        </svg>
        <span>${t('nav.settings')}</span>
    `;
    settings.addEventListener('click', () => {
        document.querySelector('.pipeline-studio')?.dispatchEvent(
            new CustomEvent('pipeline:navigate', { detail: { tab: 'settings' } }),
        );
    });

    controls.appendChild(language);
    controls.appendChild(settings);
    header.appendChild(left);
    header.appendChild(controls);
    return header;
}
