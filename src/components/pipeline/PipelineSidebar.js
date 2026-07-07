// PipelineSidebar — renders the productions list populated by
// `pipelineClient.listProductionChildren(config.productionParentRoot)`
// (Electron IPC: `film-pipeline:list-production-children`). The
// productions array is passed in by PipelineStudio; this module only
// shapes the entries for display.
import { el, statusBadge } from './ui.js';

const RELATIVE_TIME_THRESHOLDS = [
    { ms: 1000, divisor: 1000, unit: 's' },
    { ms: 60 * 1000, divisor: 60 * 1000, unit: 'm' },
    { ms: 60 * 60 * 1000, divisor: 60 * 60 * 1000, unit: 'h' },
    { ms: 24 * 60 * 60 * 1000, divisor: 24 * 60 * 60 * 1000, unit: 'd' },
];

function formatRelativeMtime(isoString, now = Date.now()) {
    if (!isoString) return '—';
    const then = new Date(isoString).getTime();
    if (Number.isNaN(then)) return '—';
    const diff = Math.max(0, now - then);
    if (diff < 60 * 1000) return 'just now';
    for (const threshold of RELATIVE_TIME_THRESHOLDS) {
        if (diff < threshold.ms * 60 || threshold.unit === 'd') {
            if (threshold.unit === 'd') {
                const days = Math.floor(diff / threshold.divisor);
                return `${days}d ago`;
            }
            const value = Math.floor(diff / threshold.divisor);
            return `${value}${threshold.unit} ago`;
        }
    }
    return new Date(isoString).toISOString().slice(0, 10);
}

function productionsSection({ productions, productionsState, onSelectProduction, onOpenSettings, onRefreshProductions }) {
    const state = productionsState || { status: 'idle', reason: '' };

    if (state.status === 'scanning') {
        return el('section', { className: 'mb-3 flex flex-col gap-2' }, [
            el('div', { className: 'flex flex-wrap items-center justify-between gap-2' }, [
                el('div', { text: 'Productions', className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
                statusBadge('Scanning…', 'PREVIEW'),
            ]),
            el('div', { text: 'Scanning production parent…', className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-xs text-secondary' }),
        ]);
    }

    if (state.status === 'error') {
        return el('section', { className: 'mb-3 flex flex-col gap-2' }, [
            el('div', { className: 'flex flex-wrap items-center justify-between gap-2' }, [
                el('div', { text: 'Productions', className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
                statusBadge('Error', 'BLOCK'),
            ]),
            el('div', { text: `Cannot read parent: ${state.reason || 'unknown'}`, className: 'rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-2 text-xs text-red-100' }),
            el('button', {
                text: 'Open Settings',
                onClick: () => onOpenSettings && onOpenSettings(),
                className: 'rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs font-bold uppercase tracking-widest text-secondary hover:bg-white/[0.07] hover:text-white',
            }),
        ]);
    }

    if (!Array.isArray(productions) || productions.length === 0) {
        return el('section', { className: 'mb-3 flex flex-col gap-2' }, [
            el('div', { className: 'flex flex-wrap items-center justify-between gap-2' }, [
                el('div', { text: 'Productions', className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
                statusBadge('Empty', 'UNREVIEWED'),
            ]),
            el('div', { text: 'No productions found. Set a production parent in Settings.', className: 'rounded-xl border border-dashed border-white/10 bg-black/20 px-3 py-2 text-xs text-secondary' }),
            el('button', {
                text: 'Open Settings',
                onClick: () => onOpenSettings && onOpenSettings(),
                className: 'rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-left text-xs font-bold uppercase tracking-widest text-secondary hover:bg-white/[0.07] hover:text-white',
            }),
        ]);
    }

    return el('section', { className: 'mb-3 flex flex-col gap-2' }, [
        el('div', { className: 'flex flex-wrap items-center justify-between gap-2' }, [
            el('div', { text: 'Productions', className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
            el('button', {
                text: '↻',
                title: 'Refresh productions',
                onClick: () => onRefreshProductions && onRefreshProductions(),
                className: 'rounded-md border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-secondary hover:bg-white/[0.07] hover:text-white',
            }),
        ]),
        productions.map((entry) => {
            const meta = [
                formatRelativeMtime(entry.mtime),
                `${entry.fileCount || 0} files`,
                `brief: ${entry.hasMarkdownBrief ? 'yes' : 'no'}`,
                `ledger: ${entry.hasJsonlLedger ? 'yes' : 'no'}`,
            ].join(' · ');
            return el('button', {
                onClick: () => onSelectProduction && onSelectProduction(entry.path),
                className: 'rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left transition hover:border-cyan-400/30 hover:bg-cyan-400/10',
            }, [
                el('div', { text: entry.name, className: 'truncate text-xs font-bold text-white' }),
                el('div', { text: meta, className: 'mt-1 truncate text-[10px] text-secondary' }),
            ]);
        }),
    ]);
}

export function PipelineSidebar({ tabs, activeTab, productions, productionsState, onSelect, onSelectProduction, onOpenSettings, onRefreshProductions }) {
    return el('aside', { className: 'flex w-full shrink-0 flex-col gap-2 border-b border-white/10 bg-black/20 p-3 lg:w-64 lg:border-b-0 lg:border-r' }, [
        el('div', { className: 'mb-2 flex flex-wrap gap-2' }, [
            statusBadge('DRY RUN', 'BLOCK'),
            statusBadge('Preview only', 'PREVIEW'),
        ]),
        productionsSection({ productions, productionsState, onSelectProduction, onOpenSettings, onRefreshProductions }),
        el('nav', { className: 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-1' }, tabs.map((tab) => (
            el('button', {
                text: tab.label,
                onClick: () => onSelect(tab.id),
                className: `rounded-xl border px-3 py-3 text-left text-xs font-bold uppercase tracking-widest transition ${
                    activeTab === tab.id
                        ? 'border-cyan-400/40 bg-cyan-400/10 text-cyan-100'
                        : 'border-white/10 bg-white/[0.03] text-secondary hover:bg-white/[0.07] hover:text-white'
                }`,
            })
        ))),
    ]);
}
