import { el } from './ui.js';
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

function projectActions({ onNewProject, onOpenProduction, onRefreshProductions }) {
    return el('div', { className: 'pipeline-project-actions' }, [
        el('button', { text: p('New project draft'), onClick: onNewProject, attrs: { type: 'button' } }),
        el('button', { text: p('Open production folder'), onClick: onOpenProduction, attrs: { type: 'button' } }),
        el('button', { text: p('Refresh productions'), onClick: onRefreshProductions, attrs: { type: 'button' } }),
    ]);
}

function productionDetailsContent(props) {
    const { productions, productionsState, onSelectProduction, onOpenProduction, onRefreshProductions } = props;
    const state = productionsState || { status: 'idle', reason: '' };
    const body = el('div', {
        className: 'pipeline-production-body',
        attrs: { 'aria-live': 'polite', 'aria-busy': state.status === 'scanning' ? 'true' : 'false' },
    });
    body.appendChild(projectActions(props));

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
            text: p('Refresh productions'),
            onClick: () => onRefreshProductions?.(),
            className: 'pipeline-production-recovery',
            attrs: { type: 'button' },
        }));
        return body;
    }

    if (!Array.isArray(productions) || productions.length === 0) {
        body.appendChild(el('p', {
            text: '제작 상위 폴더가 없습니다.',
            className: 'pipeline-production-message',
            attrs: { role: 'status' },
        }));
        body.appendChild(el('button', {
            text: p('Open production folder'),
            onClick: () => onOpenProduction?.(),
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
        el('span', {
            text: state.status === 'scanning' ? p('Scanning…') : state.status === 'error' ? p('Error') : String(props.productions?.length || 0),
            className: 'pipeline-production-count',
        }),
    ]));
    details.appendChild(productionDetailsContent(props));
    return details;
}

export function PipelineSidebar(props) {
    const { stages, activeStageId, activeTab, onSelect, onSelectStage } = props;
    const aside = el('aside', { className: 'pipeline-sidebar' });

    const mobileLabel = el('label', { className: 'pipeline-mobile-nav' }, [
        el('span', { text: p('Choose a workflow step'), className: 'pipeline-mobile-nav-label' }),
    ]);
    const mobileSelect = el('select', {
        className: 'pipeline-mobile-nav-select',
        attrs: { 'aria-label': p('Pipeline workflow steps') },
    });
    stages.forEach((stage) => mobileSelect.appendChild(el('option', { text: `${stage.number} ${stage.label}`, value: stage.id })));
    mobileSelect.value = activeStageId;
    mobileSelect.addEventListener('change', () => onSelectStage(mobileSelect.value));
    mobileLabel.appendChild(mobileSelect);
    aside.appendChild(mobileLabel);
    const mobileStage = stages.find((stage) => stage.id === activeStageId);
    if (mobileStage) {
        aside.appendChild(el('div', { className: 'pipeline-mobile-subnav' }, mobileStage.tabs.filter((tab) => !tab.hidden).map((tab) => (
            el('button', {
                text: tab.label,
                onClick: () => onSelect(tab.id),
                className: `pipeline-mobile-subnav-item${activeTab === tab.id ? ' is-active' : ''}`,
                attrs: { type: 'button', 'aria-current': activeTab === tab.id ? 'page' : undefined },
            })
        ))));
    }

    const navigation = el('nav', {
        className: 'pipeline-desktop-nav',
        attrs: { 'aria-label': p('Pipeline workflow steps') },
    });
    stages.forEach((stage) => {
        const isActive = activeStageId === stage.id;
        const section = el('section', { className: `pipeline-nav-stage${isActive ? ' is-active' : ''}` });
        section.appendChild(el('button', {
            onClick: () => onSelectStage(stage.id),
            className: 'pipeline-stage-button',
            attrs: {
                type: 'button',
                'aria-label': `${stage.number} ${stage.label}`,
                'aria-current': isActive ? 'step' : undefined,
            },
        }, [
            el('span', { text: stage.number, className: 'pipeline-stage-number', attrs: { 'aria-hidden': 'true' } }),
            el('span', { text: stage.label, className: 'pipeline-stage-label' }),
        ]));
        if (isActive) {
            const subnav = el('div', { className: 'pipeline-subnav' });
            stage.tabs.filter((tab) => !tab.hidden).forEach((tab) => subnav.appendChild(el('button', {
                text: tab.label,
                onClick: () => onSelect(tab.id),
                className: `pipeline-subnav-item${activeTab === tab.id ? ' is-active' : ''}`,
                attrs: {
                    type: 'button',
                    'aria-current': activeTab === tab.id ? 'page' : undefined,
                },
            })));
            section.appendChild(subnav);
        }
        navigation.appendChild(section);
    });
    aside.appendChild(navigation);
    aside.appendChild(productionDetails(props));
    return aside;
}
