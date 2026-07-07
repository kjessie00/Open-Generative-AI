import { el, statusBadge } from './ui.js';

export function PipelineSidebar({ tabs, activeTab, onSelect }) {
    return el('aside', { className: 'flex w-full shrink-0 flex-col gap-2 border-b border-white/10 bg-black/20 p-3 lg:w-64 lg:border-b-0 lg:border-r' }, [
        el('div', { className: 'mb-2 flex flex-wrap gap-2' }, [
            statusBadge('DRY RUN', 'BLOCK'),
            statusBadge('Preview only', 'PREVIEW'),
        ]),
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
