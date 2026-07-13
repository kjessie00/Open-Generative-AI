import { el, statusBadge } from './ui.js';
import { p } from './copy.js';

function formatRelativeMtime(isoString, now = Date.now()) {
    if (!isoString) return '—';
    const then = new Date(isoString).getTime();
    if (Number.isNaN(then)) return '—';
    const diff = Math.max(0, now - then);
    if (diff < 60 * 1000) return p('just now');
    if (diff < 60 * 60 * 1000) return p('{count}m ago', { count: Math.floor(diff / 60000) });
    if (diff < 24 * 60 * 60 * 1000) return p('{count}h ago', { count: Math.floor(diff / 3600000) });
    if (diff < 60 * 24 * 60 * 60 * 1000) return p('{count}d ago', { count: Math.floor(diff / 86400000) });
    return new Date(isoString).toISOString().slice(0, 10);
}

function productionDetailsContent({ productions, productionsState, onSelectProduction, onOpenSettings, onRefreshProductions }) {
    const state = productionsState || { status: 'idle', reason: '' };
    const body = el('div', {
        className: 'pipeline-production-body',
        attrs: { 'aria-live': 'polite', 'aria-busy': state.status === 'scanning' ? 'true' : 'false' },
    });

    if (state.status === 'scanning') {
        body.appendChild(el('p', { text: p('Scanning production parent…'), className: 'pipeline-production-message', attrs: { role: 'status' } }));
        return body;
    }

    if (state.status === 'error') {
        body.appendChild(el('p', {
            text: p('Cannot read parent: {reason}', { reason: state.reason || 'unknown' }),
            className: 'pipeline-production-error',
            attrs: { role: 'alert' },
        }));
        body.appendChild(el('button', {
            text: p('Open settings'),
            onClick: () => onOpenSettings?.(),
            className: 'pipeline-production-recovery',
            attrs: { type: 'button' },
        }));
        return body;
    }

    if (!Array.isArray(productions) || productions.length === 0) {
        body.appendChild(el('p', {
            text: p('No productions found. Set a production parent in Settings.'),
            className: 'pipeline-production-message',
            attrs: { role: 'status' },
        }));
        body.appendChild(el('button', {
            text: p('Open settings'),
            onClick: () => onOpenSettings?.(),
            className: 'pipeline-production-recovery',
            attrs: { type: 'button' },
        }));
        return body;
    }

    const refresh = el('button', {
        text: '↻',
        title: p('Refresh productions'),
        onClick: () => onRefreshProductions?.(),
        className: 'pipeline-production-refresh',
        attrs: { type: 'button', 'aria-label': p('Refresh production list') },
    });
    body.appendChild(refresh);

    productions.forEach((entry) => {
        const meta = [
            formatRelativeMtime(entry.mtime),
            p('{count} files', { count: entry.fileCount || 0 }),
            p('brief: {value}', { value: entry.hasMarkdownBrief ? p('yes') : p('no') }),
            p('ledger: {value}', { value: entry.hasJsonlLedger ? p('yes') : p('no') }),
        ].join(' · ');
        body.appendChild(el('button', {
            onClick: () => onSelectProduction?.(entry.path),
            className: 'pipeline-production-entry',
            attrs: { type: 'button' },
        }, [
            el('span', { text: entry.name, className: 'pipeline-production-name' }),
            el('span', { text: meta, className: 'pipeline-production-meta' }),
        ]));
    });
    return body;
}

function productionDetails(props) {
    const state = props.productionsState || { status: 'idle' };
    const details = el('details', { className: 'pipeline-production-details' });
    details.appendChild(el('summary', { className: 'pipeline-production-summary' }, [
        el('span', { text: p('Production list') }),
        state.status === 'scanning'
            ? statusBadge(p('Scanning…'), 'PREVIEW')
            : state.status === 'error'
                ? statusBadge(p('Error'), 'BLOCK')
                : statusBadge(String(props.productions?.length || 0), props.productions?.length ? 'PASS' : 'UNREVIEWED'),
    ]));
    details.appendChild(productionDetailsContent(props));
    return details;
}

function groupedTabs(tabs) {
    const groups = [];
    tabs.forEach((tab) => {
        let group = groups.find((item) => item.id === tab.group);
        if (!group) {
            group = { id: tab.group, label: tab.groupLabel, tabs: [] };
            groups.push(group);
        }
        group.tabs.push(tab);
    });
    return groups;
}

export function PipelineSidebar(props) {
    const { tabs, activeTab, onSelect } = props;
    const aside = el('aside', { className: 'pipeline-sidebar' });

    const mobileLabel = el('label', { className: 'pipeline-mobile-nav' }, [
        el('span', { text: p('Choose a workflow step'), className: 'pipeline-mobile-nav-label' }),
    ]);
    const mobileSelect = el('select', {
        className: 'pipeline-mobile-nav-select',
        attrs: { 'aria-label': p('Pipeline workflow steps') },
    });
    tabs.forEach((tab) => mobileSelect.appendChild(el('option', { text: tab.label, value: tab.id })));
    mobileSelect.value = activeTab;
    mobileSelect.addEventListener('change', () => onSelect(mobileSelect.value));
    mobileLabel.appendChild(mobileSelect);
    aside.appendChild(mobileLabel);

    const navigation = el('nav', {
        className: 'pipeline-desktop-nav',
        attrs: { 'aria-label': p('Pipeline workflow steps') },
    });
    groupedTabs(tabs).forEach((group) => {
        const section = el('section', { className: 'pipeline-nav-group' }, [
            el('h2', { text: group.label, className: 'pipeline-nav-group-title' }),
        ]);
        group.tabs.forEach((tab) => {
            section.appendChild(el('button', {
                text: tab.label,
                onClick: () => onSelect(tab.id),
                className: `pipeline-nav-item${activeTab === tab.id ? ' is-active' : ''}`,
                attrs: {
                    type: 'button',
                    'aria-current': activeTab === tab.id ? 'page' : undefined,
                },
            }));
        });
        navigation.appendChild(section);
    });
    aside.appendChild(navigation);
    aside.appendChild(productionDetails(props));
    return aside;
}
