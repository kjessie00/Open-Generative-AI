import { card, el, panelShell } from './ui.js';
import { p } from './copy.js';

function readinessText(readiness) {
    if (readiness === 'available') return '로컬 하네스 확인됨';
    if (readiness === 'partial') return '일부만 준비됨';
    return '연결 확인 필요';
}

function statusRow(label, value) {
    return el('div', { className: 'flex min-w-0 items-start justify-between gap-4 border-b border-white/10 py-3 last:border-b-0' }, [
        el('span', { text: label, className: 'text-sm text-secondary' }),
        el('strong', { text: value, className: 'text-right text-sm text-white' }),
    ]);
}

const MEDIA_ROOTS = Object.freeze([
    { provider: 'dst', label: '이미지 결과' },
    { provider: 'flow', label: 'Flow 영상' },
    { provider: 'grok', label: 'Grok 영상' },
    { provider: 'replicate', label: 'Replicate 영상' },
    { provider: 'bytedance', label: 'ByteDance 영상' },
]);

export function PipelineSettingsPanel({ state, config, harnessStatus, onPickParent, onPickMediaRoot, onRefresh }) {
    const settings = state.settings || {};
    const productionRoot = config?.productionRoot || '';
    const productionParentRoot = config?.productionParentRoot || '';
    const externalMediaRoots = config?.externalMediaRoots || {};
    const harnessReadiness = harnessStatus?.readiness || 'blocked';
    const advancedRows = [
        ['현재 제작 폴더', productionRoot],
        ['제작 상위 폴더', productionParentRoot],
        ...MEDIA_ROOTS.map(({ provider, label }) => [`${label} 폴더`, externalMediaRoots[provider] || '']),
        ['Shorts 문서', settings.harnessDocs?.shorts || 'docs/harness/shorts-SKILL.md'],
        ['Seedance 문서', settings.harnessDocs?.seedance || 'docs/harness/Seedance2-SKILL.md'],
        ['로컬 하네스', harnessStatus?.rootPath || ''],
        ['ffmpeg', settings.ffmpegPath || ''],
        ['ffprobe', settings.ffprobePath || ''],
    ].filter(([, value]) => value);

    return panelShell('파이프라인 설정', '로컬 작업대 연결 상태를 확인합니다. 외부 생성은 항상 꺼져 있습니다.', [
        card([
            el('div', { className: 'flex flex-wrap items-start justify-between gap-4' }, [
                el('div', { className: 'min-w-0' }, [
                    el('h3', { text: '제작 폴더', className: 'text-base font-bold text-white' }),
                    el('p', {
                        text: productionParentRoot ? '제작 목록을 읽을 상위 폴더가 연결되어 있습니다.' : '제작 목록을 보려면 상위 폴더를 선택하세요.',
                        className: 'mt-1 text-sm leading-6 text-secondary',
                    }),
                ]),
                el('div', { className: 'flex flex-wrap gap-2' }, [
                    el('button', {
                        text: '상위 폴더 선택', onClick: () => onPickParent?.(),
                        className: 'ui-action-button min-h-11 rounded-md border border-cyan-400/20 bg-cyan-400/10 px-3 py-2 text-xs font-semibold text-cyan-100 hover:bg-white/10',
                        attrs: { type: 'button' },
                    }),
                    el('button', {
                        text: '새로고침', onClick: () => onRefresh?.(),
                        className: 'ui-action-button min-h-11 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-secondary hover:bg-white/[0.07] hover:text-white',
                        attrs: { type: 'button' },
                    }),
                ]),
            ]),
        ]),
        card([
            el('h3', { text: '결과 폴더', className: 'text-base font-bold text-white' }),
            el('p', {
                text: '다른 컴퓨터에서는 실제 생성 결과가 저장되는 폴더만 한 번 연결하세요.',
                className: 'mt-1 text-sm leading-6 text-secondary',
            }),
            el('div', { className: 'mt-3 divide-y divide-white/10' }, MEDIA_ROOTS.map(({ provider, label }) => (
                el('div', { className: 'flex min-h-14 items-center justify-between gap-3 py-2' }, [
                    el('div', { className: 'min-w-0' }, [
                        el('p', { text: label, className: 'text-sm font-semibold text-white' }),
                        el('p', {
                            text: externalMediaRoots[provider] ? '연결됨' : '선택 필요',
                            className: 'mt-0.5 text-xs text-secondary',
                        }),
                    ]),
                    el('button', {
                        text: '선택', onClick: () => onPickMediaRoot?.(provider),
                        className: 'ui-action-button min-h-11 shrink-0 rounded-md border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-secondary hover:bg-white/[0.07] hover:text-white',
                        attrs: { type: 'button', 'aria-label': `${label} 폴더 선택` },
                    }),
                ])
            ))),
        ]),
        card([
            el('h3', { text: '연결 상태', className: 'text-base font-bold text-white' }),
            el('div', { className: 'mt-2' }, [
                statusRow('새 프로젝트 작업대', '사용 가능'),
                statusRow('로컬 하네스', readinessText(harnessReadiness)),
                statusRow('외부 이미지·영상 생성', '꺼짐'),
                statusRow('외부 업로드', '꺼짐'),
            ]),
        ]),
        advancedRows.length ? el('details', { className: 'rounded-md border border-white/10 bg-black/20 px-3' }, [
            el('summary', { text: '고급: 로컬 경로', className: 'min-h-11 cursor-pointer py-3 text-sm font-semibold text-white' }),
            el('dl', { className: 'pb-3' }, advancedRows.flatMap(([label, value]) => [
                el('dt', { text: label, className: 'mt-3 text-xs font-semibold text-secondary' }),
                el('dd', { text: value, className: 'mt-1 break-all text-xs leading-5 text-white' }),
            ])),
        ]) : null,
        card([
            el('h3', { text: '안전 모드', className: 'text-base font-bold text-white' }),
            el('p', {
                text: '기획 저장과 로컬 결과 확인만 실행합니다. 유료 생성, 외부 검토, 제출과 업로드는 이 작업대에서 시작하지 않습니다.',
                className: 'mt-1 text-sm leading-6 text-secondary',
            }),
            el('label', { className: 'mt-3 flex min-h-11 cursor-not-allowed items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 text-sm text-white' }, [
                el('input', { type: 'checkbox', attrs: { checked: 'checked', disabled: 'disabled' }, className: 'h-4 w-4 accent-cyan-300' }),
                el('span', { text: '외부 실행 꺼짐' }),
            ]),
        ]),
    ].filter(Boolean));
}
