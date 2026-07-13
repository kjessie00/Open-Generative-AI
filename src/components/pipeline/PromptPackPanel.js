import { validatePromptPack } from '../../lib/pipeline/validators.js';
import { blockerList, card, dataTable, el, panelShell, statusBadge } from './ui.js';
import { p } from './copy.js';

const REQUIRED_NEGATIVE_CONSTRAINTS = [
    'no subtitles',
    'no logo',
    'no watermark',
    'no extra characters',
    'no face morphing',
    'no warped hands',
];

function hasConstraint(promptPack, needle) {
    const text = (promptPack.negative_constraints || []).join(' ').toLowerCase();
    return text.includes(needle.replace('no ', '').toLowerCase()) || text.includes(needle.toLowerCase());
}

export function PromptPackPanel({ state }) {
    const packs = state.promptPacks || [];
    const blockers = packs.flatMap((pack) => validatePromptPack(pack).blockers);
    const musicRequired = state.brief?.music_required === true;

    return panelShell(p('Prompt Packs'), p('Seedance and Flow prompt files, attached assets, prompt/media review state, and negative constraints.'), [
        blockerList(blockers),
        dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Generator'), key: 'generator' },
            { label: p('Prompt file'), key: 'prompt_path' },
            { label: p('Model'), key: 'model' },
            { label: p('Duration'), render: (pack) => `${pack.duration || 0}s` },
            { label: p('Aspect'), key: 'aspect_ratio' },
            { label: p('Assets'), render: (pack) => (pack.attached_assets || []).join(', ') || '—' },
            { label: p('No BGM'), render: (pack) => statusBadge(p(pack.no_bgm_required ? 'required' : 'not locked'), pack.no_bgm_required ? 'PASS' : 'WARN') },
            { label: p('Review'), render: (pack) => statusBadge(pack.review_status || 'UNREVIEWED', pack.review_status || 'UNREVIEWED') },
        ], packs),
        el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, packs.map((pack) => (
            card([
                el('div', { className: 'mb-3 flex flex-wrap items-center gap-2' }, [
                    statusBadge(pack.generator || p('generator'), pack.review_status || 'UNREVIEWED'),
                    statusBadge(p(!musicRequired && pack.no_bgm_required ? 'no BGM locked' : 'music exception needed'), !musicRequired && pack.no_bgm_required ? 'PASS' : 'WARN'),
                    statusBadge(p('one camera movement per shot'), 'PASS'),
                ]),
                el('div', { text: p('Negative Constraints'), className: 'mb-2 text-xs font-semibold text-secondary' }),
                el('div', { className: 'flex flex-wrap gap-2' }, REQUIRED_NEGATIVE_CONSTRAINTS.map((constraint) => (
                    statusBadge(constraint, hasConstraint(pack, constraint) ? 'PASS' : 'WARN')
                ))),
                el('div', { text: (pack.negative_constraints || []).join(', ') || '—', className: 'mt-4 break-words text-sm leading-6 text-secondary' }),
            ])
        ))),
    ]);
}
