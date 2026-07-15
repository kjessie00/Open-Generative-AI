import { validatePromptPack } from '../../lib/pipeline/validators.js';
import { card, dataTable, el, panelShell } from './ui.js';
import { p } from './copy.js';
import { issueList, plainStatus } from './generationUi.js';

const REQUIRED_NEGATIVE_CONSTRAINTS = [
    'no subtitles',
    'no logo',
    'no watermark',
    'no extra characters',
    'no face morphing',
    'no warped hands',
];

const CONSTRAINT_LABELS = Object.freeze({
    'no subtitles': '자막 없음',
    'no logo': '로고 없음',
    'no watermark': '워터마크 없음',
    'no extra characters': '추가 인물 없음',
    'no face morphing': '얼굴 변형 없음',
    'no warped hands': '손 왜곡 없음',
});

function hasConstraint(promptPack, needle) {
    const text = (promptPack.negative_constraints || []).join(' ').toLowerCase();
    return text.includes(needle.replace('no ', '').toLowerCase()) || text.includes(needle.toLowerCase());
}

export function PromptPackPanel({ state }) {
    const packs = state.promptPacks || [];
    const blockers = packs.flatMap((pack) => validatePromptPack(pack).blockers);
    const musicRequired = state.brief?.music_required === true;

    return panelShell(p('Prompt Packs'), p('Seedance and Flow prompt files, attached assets, prompt/media review state, and negative constraints.'), [
        issueList(blockers),
        dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Generator'), key: 'generator' },
            { label: p('Prompt file'), key: 'prompt_path' },
            { label: p('Model'), key: 'model' },
            { label: p('Duration'), render: (pack) => `${pack.duration || 0}s` },
            { label: p('Aspect'), key: 'aspect_ratio' },
            { label: p('Assets'), render: (pack) => (pack.attached_assets || []).join(', ') || '—' },
            { label: p('No BGM'), render: (pack) => pack.no_bgm_required ? '필수' : '확인 필요' },
            { label: p('Review'), render: (pack) => plainStatus(pack.review_status) },
        ], packs),
        el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, packs.map((pack) => (
            card([
                el('h3', { text: pack.generator || p('generator'), className: 'text-base font-bold text-white' }),
                el('p', {
                    text: `${!musicRequired && pack.no_bgm_required ? '배경음악 없음' : '배경음악 확인 필요'} · 카메라 움직임 1개`,
                    className: 'mt-1 text-sm text-secondary',
                }),
                el('div', { text: p('Negative Constraints'), className: 'mb-2 mt-4 text-xs font-semibold text-secondary' }),
                el('ul', { className: 'grid grid-cols-1 gap-1 text-sm text-secondary sm:grid-cols-2' }, REQUIRED_NEGATIVE_CONSTRAINTS.map((constraint) => (
                    el('li', { text: `${hasConstraint(pack, constraint) ? '완료' : '확인 필요'} · ${CONSTRAINT_LABELS[constraint]}` })
                ))),
                el('details', { className: 'mt-4 text-xs text-secondary' }, [
                    el('summary', { text: '원문 제약 보기', className: 'cursor-pointer font-semibold' }),
                    el('p', { text: (pack.negative_constraints || []).join(', ') || '—', className: 'mt-2 break-words leading-5' }),
                ]),
            ])
        ))),
    ]);
}
