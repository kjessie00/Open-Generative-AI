import { actionButton, card, el, statusBadge } from './ui.js';

function stateBadge(workspace, execution) {
    if (execution?.status === 'executing') return statusBadge('선택 구간 렌더 중', 'WARN');
    if (execution?.status === 'success') return statusBadge('렌더·새 probe 검증 완료', 'PASS');
    if (execution?.status === 'error') return statusBadge('렌더 실행 차단', 'BLOCK');
    if (workspace.status === 'loading') return statusBadge('작업대 확인 중', 'UNREVIEWED');
    if (workspace.already_current || workspace.status === 'already_current') return statusBadge('현재 입력과 동일한 실행본', 'PASS');
    if (workspace.ready) return statusBadge('명시적 실행 확인 대기', 'WARN');
    if (workspace.ready_to_plan) return statusBadge('실행 계획 생성 가능', 'PREVIEW');
    if (workspace.status === 'stale') return statusBadge('이전 실행본 stale', 'WARN');
    return statusBadge('마감 실행 차단', 'BLOCK');
}

function definition(label, value) {
    return el('div', { className: 'border-l border-white/10 pl-3' }, [
        el('dt', { text: label, className: 'text-xs text-secondary' }),
        el('dd', { text: value || '—', className: 'mt-1 break-words text-sm font-semibold text-white' }),
    ]);
}

function blockerSection(workspace) {
    const blockers = Array.from(new Set([...(workspace.blockers || []), ...(workspace.current_blockers || [])]));
    if (!blockers.length) return null;
    return el('div', { className: 'rounded-md border border-red-400/20 bg-red-400/[0.06] p-3', attrs: { role: 'alert' } }, [
        el('p', { text: '현재 실행 차단 항목', className: 'text-xs font-semibold text-red-100' }),
        el('ul', { className: 'mt-2 space-y-1' }, blockers.map((blocker) => (
            el('li', { text: blocker, className: 'break-words font-mono text-xs text-red-200' })
        ))),
    ]);
}

export function FinishingWorkbenchPanel({
    workspace = {},
    execution = { status: 'idle', result: null, error: '' },
    onRefresh,
    onPlan,
    onExecute,
} = {}) {
    const section = card([], 'finishing-workbench border-cyan-400/20');
    section.setAttribute('aria-labelledby', 'finishing-workbench-title');
    section.appendChild(el('header', { className: 'space-y-2' }, [
        el('div', { className: 'flex flex-wrap items-center gap-2' }, [
            el('h3', { text: '선택 구간 마감 작업대', className: 'mr-auto text-lg font-bold text-white', attrs: { id: 'finishing-workbench-title' } }),
            stateBadge(workspace, execution),
        ]),
        el('p', {
            text: 'canonical 비트 순서와 selected_takes 구간을 다시 검증한 뒤 happyVideoFactory 편집 엔진으로 고정된 workbench 실행본을 만듭니다. source 경로·명령·실행 파일은 화면에 노출되지 않습니다.',
            className: 'max-w-4xl text-sm leading-6 text-secondary',
        }),
        el('p', {
            text: '렌더 실행 성공 ≠ 영상 품질 승인',
            className: 'rounded-md border border-amber-300/30 bg-amber-300/[0.08] px-3 py-2 text-sm font-bold text-amber-100',
            attrs: { role: 'note' },
        }),
    ]));

    section.appendChild(el('dl', { className: 'mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4' }, [
        definition('프로젝트 확인 문자열', workspace.project_id),
        definition('선택 구간', `${workspace.selected_range_count || 0}개 · ${workspace.selected_duration_seconds || 0}초`),
        definition('입력 / QC', `${workspace.input_ready ? '준비' : '차단'} / ${workspace.qc_ready ? '준비' : '차단'}`),
        definition('하네스 / 실행 도구', `${workspace.harness_ready ? '준비' : '차단'} / ${workspace.runtime_ready ? '준비' : '차단'}`),
        definition('고정 출력 계약', workspace.output_contract?.location),
        definition('Python', workspace.tool_status?.python),
        definition('ffmpeg', workspace.tool_status?.ffmpeg),
        definition('ffprobe', workspace.tool_status?.ffprobe),
    ]));

    if (workspace.current_run) {
        section.appendChild(el('div', { className: 'mt-4 rounded-md border border-emerald-400/20 bg-emerald-400/[0.05] p-3' }, [
            el('p', { text: '검증된 현재 workbench 실행본', className: 'text-xs font-semibold text-emerald-100' }),
            el('dl', { className: 'mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4' }, [
                definition('실행 ID', workspace.current_run.run_id),
                definition('렌더 / 선택 길이', `${workspace.current_run.output_duration_seconds}초 / ${workspace.current_run.selected_duration_seconds}초`),
                definition('출력 크기 / hash', `${workspace.current_run.output_size_bytes} bytes · ${workspace.current_run.output_sha256_short}`),
                definition('새 probe / 품질 승인', `${workspace.current_run.fresh_probe_verified ? 'PASS' : 'BLOCK'} / 승인 안 됨`),
            ]),
        ]));
    }

    const blockers = blockerSection(workspace);
    if (blockers) section.appendChild(el('div', { className: 'mt-4' }, blockers));

    if (execution.status === 'executing') {
        section.appendChild(el('div', { className: 'mt-4 space-y-2', attrs: { role: 'status', 'aria-live': 'polite' } }, [
            el('p', { text: '입력 재검증 → 정확한 구간 렌더 → 새 ffprobe → 원자적 게시를 진행 중입니다.', className: 'text-sm text-cyan-100' }),
            el('progress', { className: 'h-2 w-full accent-cyan-400', attrs: { 'aria-label': '선택 구간 렌더 진행 중' } }),
        ]));
    } else if (execution.status === 'success' && execution.result) {
        section.appendChild(el('div', { className: 'mt-4 rounded-md border border-emerald-400/20 bg-emerald-400/[0.06] p-3', attrs: { role: 'status', 'aria-live': 'polite' } }, [
            el('p', { text: execution.result.executed ? '선택 구간 렌더와 새 ffprobe 검증을 완료했습니다.' : '현재 입력과 동일한 검증 실행본을 재사용합니다.', className: 'text-sm font-semibold text-emerald-100' }),
            el('p', { text: `실행 ID ${execution.result.run_id || '—'} · ${execution.result.output_duration_seconds || 0}초 · 품질 승인은 별도`, className: 'mt-1 text-xs text-secondary' }),
        ]));
    } else if (execution.status === 'error') {
        section.appendChild(el('p', {
            text: `실행이 안전하게 차단되었습니다. ${execution.error || '계획을 다시 확인하세요.'}`,
            className: 'mt-4 rounded-md border border-red-400/20 bg-red-400/[0.06] p-3 text-sm text-red-100',
            attrs: { role: 'alert' },
        }));
    }

    const actions = el('div', { className: 'mt-4 flex flex-wrap gap-2' });
    actions.appendChild(actionButton('작업대 상태 새로 확인', { variant: 'muted', onClick: onRefresh }));
    if (workspace.ready_to_plan && execution.status !== 'executing') {
        actions.appendChild(actionButton('읽기 전용 렌더 계획 만들기', { onClick: onPlan }));
    }
    section.appendChild(actions);

    if (workspace.ready && workspace.plan_token && execution.status !== 'executing') {
        const confirmationInput = el('input', {
            className: 'mt-2 min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
            attrs: {
                id: 'finishing-project-confirmation', type: 'text', autocomplete: 'off', spellcheck: 'false',
                maxlength: '128', 'aria-describedby': 'finishing-confirmation-help',
            },
        });
        const checkbox = el('input', {
            className: 'h-5 w-5 shrink-0 accent-cyan-400',
            attrs: { id: 'finishing-explicit-confirmation', type: 'checkbox' },
        });
        const executeButton = actionButton('확인한 선택 구간 렌더 실행', {
            disabled: true,
            variant: 'danger',
            onClick: () => onExecute?.({
                planToken: workspace.plan_token,
                confirmed: checkbox.checked === true,
                projectId: confirmationInput.value,
            }),
        });
        const updateReady = () => {
            executeButton.disabled = !(checkbox.checked && confirmationInput.value === workspace.project_id);
            executeButton.classList.toggle('cursor-not-allowed', executeButton.disabled);
            executeButton.classList.toggle('opacity-45', executeButton.disabled);
        };
        confirmationInput.addEventListener('input', updateReady);
        checkbox.addEventListener('change', updateReady);
        section.appendChild(el('fieldset', { className: 'mt-4 space-y-3 border-t border-cyan-400/20 pt-4' }, [
            el('legend', { text: '실행 전 명시적 확인', className: 'text-sm font-bold text-white' }),
            el('label', { className: 'block text-xs font-semibold text-secondary', attrs: { for: 'finishing-project-confirmation' } }, [
                el('span', { text: `프로젝트 ID “${workspace.project_id}”를 정확히 입력` }),
                confirmationInput,
            ]),
            el('p', {
                text: `계획 만료: ${workspace.expires_at || '확인 불가'}. 실행 직전 입력·소스·하네스·도구·출력 상태가 바뀌면 자동 차단됩니다.`,
                className: 'text-xs leading-5 text-secondary', attrs: { id: 'finishing-confirmation-help' },
            }),
            el('label', { className: 'flex min-h-11 items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-white', attrs: { for: 'finishing-explicit-confirmation' } }, [
                checkbox,
                el('span', { text: '선택 구간 rough cut을 고정된 workbench_runs 위치에 로컬 실행하는 것을 명시적으로 확인합니다.' }),
            ]),
            executeButton,
        ]));
    }

    if (workspace.cooperative_lock_limit) {
        section.appendChild(el('p', { text: workspace.cooperative_lock_limit, className: 'mt-4 text-xs leading-5 text-secondary' }));
    }
    return section;
}
