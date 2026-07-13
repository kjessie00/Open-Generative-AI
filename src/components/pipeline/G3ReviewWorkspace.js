import { G3CandidatePanel } from './G3CandidatePanel.js';
import { G3SelectionEditor } from './G3SelectionEditor.js';
import { G3ShotNavigator } from './G3ShotNavigator.js';
import { actionButton, el, emptyState, statusBadge } from './ui.js';
import { p } from './copy.js';

function machineQcSurface(record) {
    if (!record) {
        return el('p', {
            text: '선택한 제공자와 일치하는 canonical 기계 QC가 없습니다. 내보내기는 차단됩니다.',
            className: 'text-sm leading-6 text-red-200',
            attrs: { role: 'alert' },
        });
    }
    return el('dl', { className: 'grid grid-cols-1 gap-3 sm:grid-cols-2' }, [
        ['제공자', record.provider],
        ['결정론적 검사', record.deterministic_checks_passed ? '통과 기록' : '미통과 기록'],
        ['대사 명료도', Number.isFinite(record.dialogue_intelligibility_score) ? record.dialogue_intelligibility_score.toFixed(2) : '—'],
        ['발음 위험', record.pronunciation_risk_flag ? '위험 기록 있음' : '위험 플래그 없음'],
        ['canonical 결정', record.decision || '—'],
        ['외부 검토 메타데이터', `${record.external_review_state || '미기록'} · ${record.external_finding_count || 0}건`],
    ].map(([label, value]) => el('div', { className: 'border-l border-white/10 pl-3' }, [
        el('dt', { text: label, className: 'text-xs text-secondary' }),
        el('dd', { text: value, className: 'mt-1 text-sm font-semibold text-white' }),
    ])));
}

export function G3ReviewWorkspace({
    workspace,
    activeShotId,
    onActiveShotChange,
    onSelectionChange,
    onOverallNotesChange,
    onPreview,
    onSave,
    onExport,
}) {
    if (workspace.status === 'loading') {
        return el('section', { className: 'border-t border-white/10 pt-5', attrs: { 'aria-labelledby': 'g3-workspace-title' } }, [
            el('h3', { text: 'G3 인간 검토 작업대', className: 'text-lg font-bold text-white', attrs: { id: 'g3-workspace-title' } }),
            el('p', { text: '로컬 검토 초안을 불러오는 중…', className: 'mt-3 text-sm text-secondary', attrs: { role: 'status', 'aria-live': 'polite' } }),
        ]);
    }
    const blockers = Array.from(new Set([...(workspace.blockers || []), ...(workspace.validation_blockers || [])]));
    const shots = workspace.shots || [];
    if (!shots.length) {
        return el('section', { className: 'space-y-4 border-t border-white/10 pt-5', attrs: { 'aria-labelledby': 'g3-workspace-title' } }, [
            el('div', { className: 'flex flex-wrap items-center gap-2' }, [
                el('h3', { text: 'G3 인간 검토 작업대', className: 'mr-auto text-lg font-bold text-white', attrs: { id: 'g3-workspace-title' } }),
                statusBadge('초안/비승격', 'PREVIEW'),
            ]),
            emptyState(workspace.status === 'error'
                ? 'G3 검토 작업대를 안전하게 불러오지 못했습니다.'
                : 'canonical shot_manifest.json이 있어야 검토를 시작할 수 있습니다.'),
            blockers.length ? el('ul', { className: 'space-y-2', attrs: { 'aria-label': 'G3 차단 항목' } }, blockers.map((blocker) => (
                el('li', { text: p(blocker), className: 'text-sm text-red-200' })
            ))) : null,
        ]);
    }

    const resolvedShotId = shots.some((shot) => shot.shot_id === activeShotId) ? activeShotId : shots[0].shot_id;
    const selection = workspace.selections.find((item) => item.shot_id === resolvedShotId);
    const qc = workspace.machine_qc.find((item) => item.shot_id === resolvedShotId
        && (!selection?.chosen_provider || item.provider === selection.chosen_provider));
    const overallNotes = el('textarea', {
        className: 'mt-2 min-h-24 w-full rounded-md border border-white/10 bg-black/40 px-3 py-3 text-sm text-white',
        attrs: { id: 'g3-overall-notes', maxlength: '32000', rows: '3' },
    });
    overallNotes.value = workspace.overall_notes || '';
    overallNotes.addEventListener('input', () => onOverallNotesChange(overallNotes.value));

    return el('section', { className: 'space-y-5 border-t border-white/10 pt-5', attrs: { 'aria-labelledby': 'g3-workspace-title' } }, [
        el('header', { className: 'space-y-2' }, [
            el('div', { className: 'flex flex-wrap items-center gap-2' }, [
                el('h3', { text: 'G3 인간 검토 작업대', className: 'mr-auto text-lg font-bold text-white', attrs: { id: 'g3-workspace-title' } }),
                statusBadge('초안/비승격', 'PREVIEW'),
                statusBadge(workspace.export_ready ? '내보내기 준비됨' : '검토 미완료', workspace.export_ready ? 'PASS' : 'UNREVIEWED'),
            ]),
            el('p', {
                text: '후보 클립을 샷과 비트에 사람이 직접 연결합니다. 저장과 내보내기는 생성·검토·승격·업로드를 실행하지 않습니다.',
                className: 'max-w-4xl text-sm leading-6 text-secondary',
            }),
        ]),
        blockers.length ? el('details', { className: 'rounded-md border border-red-400/20 bg-red-400/[0.04] p-3' }, [
            el('summary', { text: `현재 차단 항목 ${blockers.length}개`, className: 'min-h-11 cursor-pointer py-2 text-sm font-semibold text-red-100' }),
            el('ul', { className: 'mt-2 space-y-2' }, blockers.map((blocker) => el('li', { text: p(blocker), className: 'text-sm text-red-200' }))),
        ]) : null,
        el('div', { className: 'grid grid-cols-1 gap-5 md:grid-cols-[11rem_minmax(0,1fr)]' }, [
            G3ShotNavigator({ shots, selections: workspace.selections, activeShotId: resolvedShotId, onSelect: onActiveShotChange }),
            el('div', { className: 'min-w-0 space-y-6' }, [
                el('section', { className: 'space-y-3 border-b border-white/10 pb-5', attrs: { 'aria-labelledby': 'g3-machine-qc-title' } }, [
                    el('div', { className: 'flex flex-wrap items-center gap-2' }, [
                        el('h4', { text: '기계 QC · 읽기 전용', className: 'text-sm font-bold text-white', attrs: { id: 'g3-machine-qc-title' } }),
                        statusBadge(workspace.machine_qc_contract || 'canonical QC 없음', workspace.machine_qc_contract ? 'PREVIEW' : 'BLOCK'),
                    ]),
                    el('p', { text: '기계 QC 기록은 참고 근거이며 아래 인간 선택을 대신하거나 자동 승인하지 않습니다.', className: 'text-xs leading-5 text-secondary' }),
                    machineQcSurface(qc),
                ]),
                G3CandidatePanel({ candidates: workspace.candidates, selection, onChange: (field, value) => onSelectionChange(resolvedShotId, field, value), onPreview }),
                G3SelectionEditor({
                    selection,
                    beats: workspace.beats,
                    canonicalBeatListAvailable: workspace.canonical_beat_list_available,
                    onChange: (field, value) => onSelectionChange(resolvedShotId, field, value),
                }),
            ]),
        ]),
        el('label', { className: 'block text-xs font-semibold text-secondary', attrs: { for: 'g3-overall-notes' } }, [
            el('span', { text: '전체 검토 메모' }),
            overallNotes,
        ]),
        el('div', { className: 'flex flex-col gap-3 sm:flex-row sm:items-center' }, [
            actionButton('로컬 검토 초안 저장', { disabled: !workspace.authoring_ready, onClick: onSave }),
            actionButton('canonical 형태로 초안 내보내기', { disabled: !workspace.export_ready, variant: 'muted', onClick: onExport }),
            el('p', { text: '내보낸 파일도 비승격 초안입니다. 실제 production 반영은 별도의 happyVideoFactory importer/CAS가 필요합니다.', className: 'text-xs leading-5 text-secondary' }),
        ]),
    ]);
}
