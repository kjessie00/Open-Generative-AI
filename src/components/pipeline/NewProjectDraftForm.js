import { actionButton, card, codeBlock, el } from './ui.js';
import { p } from './copy.js';
import {
    PlanningSuggestionHistory,
    PlanningSuggestionPanel,
    planningSuggestionView,
} from './PlanningSuggestionPanel.js';

function fieldShell(label, id, control, help = '') {
    return el('div', { className: 'flex min-w-0 flex-col gap-2' }, [
        el('label', { text: label, className: 'text-xs font-semibold text-white', attrs: { for: id } }),
        control,
        help ? el('p', { text: help, className: 'text-xs leading-5 text-secondary', attrs: { id: `${id}-help` } }) : null,
    ].filter(Boolean));
}

function controlAttrs(id, name, help, extra = {}) {
    return { id, name, required: true, ...(help ? { 'aria-describedby': `${id}-help` } : {}), ...extra };
}

function textControl({ id, name, value, label, multiline = false, disabled, maxLength, help, onDraftChange, parts = false }) {
    const control = el(multiline ? 'textarea' : 'input', {
        value,
        disabled,
        className: `min-h-11 w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50 ${multiline ? 'min-h-[180px] resize-y leading-6' : ''}`,
        attrs: controlAttrs(id, name, help, {
            maxlength: maxLength,
            ...(multiline ? {} : { type: 'text', autocomplete: 'off', spellcheck: 'false' }),
        }),
    });
    control.addEventListener('input', (event) => onDraftChange?.(name, event.target.value));
    const shell = fieldShell(label || p(name), id, control, help);
    return parts ? { shell, control } : shell;
}

function selectControl({ id, name, value, options, disabled, onDraftChange }) {
    const control = el('select', {
        value,
        disabled,
        className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50',
        attrs: controlAttrs(id, name, ''),
    }, options.map((option) => el('option', { text: option.label, value: option.value, attrs: { value: option.value } })));
    control.addEventListener('change', (event) => onDraftChange?.(name, event.target.value));
    return fieldShell(p(name), id, control);
}

function numberControl({ id, name, value, min, max, disabled, onDraftChange }) {
    const control = el('input', {
        value,
        disabled,
        className: 'min-h-11 w-full rounded-md border border-white/10 bg-black/25 px-3 py-2 text-sm text-white outline-none focus:border-cyan-300/50',
        attrs: controlAttrs(id, name, '', { type: 'number', min, max, step: 1 }),
    });
    control.addEventListener('input', (event) => onDraftChange?.(name, Number(event.target.value)));
    return fieldShell(p(name), id, control);
}

function statusText(status) {
    if (status === 'restored') return '저장한 내용을 불러왔습니다.';
    if (status === 'saved') return '직접 저장됨';
    if (status === 'saving') return '저장 중…';
    if (status === 'requesting') return '에이전트가 수정안을 작성 중…';
    if (status === 'copying') return '명령 복사 중…';
    if (status === 'error') return '저장하지 못했습니다.';
    return '아직 저장된 내용이 없습니다.';
}

function collaborationSection({
    number, title, stage, createDraftControl, draftValue, disabled, draftDirty, collaboration,
    onSave, onEnqueue, onRun, onRefresh, onDecide,
}) {
    const stageDirty = draftDirty?.settings === true || draftDirty?.[stage] === true;
    const view = planningSuggestionView(collaboration, stage, stageDirty);
    const draftField = createDraftControl(view.compareOpen ? '현재 내용' : '');
    const requestId = `planning-${stage}-agent-request`;
    const requestStatus = el('p', {
        text: view.queued
            ? '요청이 저장됐습니다 · 에이전트 작업을 다시 시작할 수 있습니다.'
            : '',
        className: 'text-xs leading-5 text-secondary',
        attrs: { role: 'status', 'aria-live': 'polite' },
    });
    const requestInput = el('textarea', {
        disabled,
        className: 'min-h-[112px] w-full resize-y rounded-md border border-white/10 bg-black/25 px-3 py-3 text-sm leading-6 text-white outline-none focus:border-cyan-300/50',
        attrs: {
            id: requestId,
            maxlength: 4000,
            placeholder: stage === 'brief' ? '예: 주인공의 목표와 갈등이 첫 문단에서 보이게 다듬어줘' : '예: 첫 3초에 핵심 갈등이 드러나게 고쳐줘',
        },
    });
    const requestButton = actionButton('에이전트 작업 시작', {
        disabled,
        onClick: async () => {
            const instruction = requestInput.value.trim();
            if (!instruction) {
                requestStatus.textContent = '요청 내용을 입력하세요.';
                requestInput.focus();
                return;
            }
            await onEnqueue?.({ stage, instruction });
        },
    });
    const requestComposer = el('div', { className: 'flex min-w-0 flex-col gap-3 rounded-md border border-white/10 bg-black/20 p-3' }, [
        el('div', {}, [
            el('h5', { text: '에이전트에게 요청', className: 'text-sm font-semibold text-white' }),
        ]),
        fieldShell('어떻게 바꿀까요?', requestId, requestInput),
        el('div', { className: 'flex flex-wrap gap-2' }, [
            requestButton,
            view.queued ? actionButton('다시 시도', { disabled, variant: 'muted', onClick: () => onRun?.({ stage }) }) : null,
            view.queued ? actionButton('수정안 확인', { disabled, variant: 'muted', onClick: () => onRefresh?.() }) : null,
        ].filter(Boolean)),
        requestStatus,
    ]);

    let agentColumn = requestComposer;
    if (view.compareOpen) {
        const comparison = PlanningSuggestionPanel({
            stage,
            suggestion: view.suggestion,
            reviewStatus: view.reviewStatus,
            disabled,
            currentControl: draftField.control,
            onDecide,
        });
        const composer = view.reviewStatus === 'ready'
            ? el('details', { className: 'rounded-md border border-white/10 bg-black/10 px-3' }, [
                el('summary', { text: '다른 요청 남기기', className: 'min-h-11 cursor-pointer py-3 text-xs font-semibold text-white' }),
                el('div', { className: 'pb-3' }, [requestComposer]),
            ])
            : requestComposer;
        agentColumn = el('div', { className: 'flex min-w-0 flex-col gap-3' }, [comparison, composer]);
    } else if (view.history) {
        agentColumn = el('div', { className: 'flex min-w-0 flex-col gap-3' }, [
            PlanningSuggestionHistory({
                stage,
                suggestion: view.suggestion,
                reviewStatus: view.reviewStatus,
                disabled,
                draftDirty: stageDirty,
                onDecide,
            }),
            requestComposer,
        ]);
    }

    return el('section', {
        className: `grid min-w-0 grid-cols-1 gap-4 border-t border-white/10 pt-5 ${view.compareOpen ? 'lg:grid-cols-2' : 'lg:grid-cols-[minmax(0,3fr)_minmax(16rem,2fr)]'}`,
        attrs: { 'aria-labelledby': `planning-${stage}-title` },
    }, [
        el('div', { className: 'flex min-w-0 flex-col gap-3' }, [
            el('h4', { text: `${number}. ${title}`, className: 'text-base font-bold text-white', attrs: { id: `planning-${stage}-title` } }),
            el('h5', { text: '직접 수정', className: 'text-sm font-semibold text-white' }),
            draftField.shell,
            el('div', { className: 'flex flex-wrap gap-2' }, [
                actionButton('직접 저장', { disabled, onClick: () => onSave?.({ ...draftValue }) }),
            ]),
        ]),
        agentColumn,
    ]);
}

export function NewProjectDraftForm({
    draftState, draftValue, notice = '', onDraftChange, onSaveNewProjectDraft,
    onEnqueuePlanningAgentRequest, onRunPlanningAgentRequest, onRefreshNewProjectDraft, onDecidePlanningAgentSuggestion,
    onCopyNewProjectBuildCommand, draftDirty = false,
}) {
    const loading = ['loading', 'saving', 'requesting', 'copying'].includes(draftState?.status);
    const readyToCopy = draftState?.preview?.copyAllowed === true;
    const visibleNotice = notice || (['saved', 'saving', 'requesting', 'copying', 'error'].includes(draftState?.status)
        ? statusText(draftState?.status)
        : '');
    const errorMessages = [...new Set([
        ...(draftState?.blockers || []),
        ...(draftState?.collaboration?.blockers || []),
    ].map((code) => p(code)).filter((message) => message && !/^[A-Z0-9_]+$/.test(message)))];
    const createBriefControl = (label) => textControl({
        id: 'new-project-brief', name: 'brief', value: draftValue.brief, label, multiline: true,
        disabled: loading, maxLength: 65536, help: '콘셉트, 대상 시청자, 톤, 반드시 지킬 내용을 적으세요.', onDraftChange, parts: true,
    });
    const createScriptControl = (label) => textControl({
        id: 'new-project-script', name: 'script', value: draftValue.script, label, multiline: true,
        disabled: loading, maxLength: 262144, help: '내레이션이나 대사를 직접 작성하고 계속 고칠 수 있습니다.', onDraftChange, parts: true,
    });

    return card([
        el('div', {}, [
            el('h3', { text: '기획·대본 작업', className: 'text-base font-bold text-white' }),
            el('p', { text: '직접 고치거나 원하는 변경을 에이전트에게 요청하세요. 에이전트는 기획과 대본만 다듬으며 제작·생성은 시작하지 않습니다.', className: 'mt-1 text-sm leading-6 text-secondary' }),
        ]),
        visibleNotice ? el('p', {
            text: visibleNotice,
            className: `rounded-md border px-3 py-2 text-xs leading-5 ${draftState?.status === 'error' ? 'border-red-400/20 text-red-100' : 'border-white/10 text-secondary'}`,
            attrs: { role: draftState?.status === 'error' ? 'alert' : 'status', 'aria-live': 'polite' },
        }) : null,
        draftState?.status === 'error' && errorMessages.length ? el('ul', {
            className: 'flex list-disc flex-col gap-1 pl-5 text-xs leading-5 text-red-100',
            attrs: { 'aria-label': '확인할 내용' },
        }, errorMessages.map((message) => el('li', { text: message }))) : null,
        el('form', { className: 'flex min-w-0 flex-col gap-5', attrs: { 'aria-label': p('New project draft') } }, [
            el('fieldset', { className: 'min-w-0' }, [
                el('legend', { text: '제작 설정', className: 'mb-3 text-sm font-semibold text-white' }),
                el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5' }, [
                    textControl({
                        id: 'new-project-production-id', name: 'production_id', value: draftValue.production_id,
                        disabled: loading, maxLength: 64, help: '', onDraftChange,
                    }),
                    selectControl({
                        id: 'new-project-route', name: 'route', value: draftValue.route, disabled: loading,
                        options: [
                            { value: 'seedance', label: 'Seedance' },
                            { value: 'flow_omni', label: 'Flow/Omni' },
                            { value: 'both', label: '두 경로 모두' },
                        ],
                        onDraftChange,
                    }),
                    selectControl({
                        id: 'new-project-aspect', name: 'aspect_ratio', value: draftValue.aspect_ratio, disabled: loading,
                        options: [{ value: '9:16', label: '9:16' }, { value: '16:9', label: '16:9' }], onDraftChange,
                    }),
                    numberControl({
                        id: 'new-project-duration', name: 'scene_duration', value: draftValue.scene_duration,
                        min: 4, max: 15, disabled: loading, onDraftChange,
                    }),
                    numberControl({
                        id: 'new-project-scenes', name: 'max_scenes', value: draftValue.max_scenes,
                        min: 1, max: 10, disabled: loading, onDraftChange,
                    }),
                ]),
            ]),
            collaborationSection({
                number: 1, title: '기획', stage: 'brief', createDraftControl: createBriefControl, draftValue,
                disabled: loading, draftDirty, collaboration: draftState?.collaboration, onSave: onSaveNewProjectDraft,
                onEnqueue: onEnqueuePlanningAgentRequest, onRun: onRunPlanningAgentRequest, onRefresh: onRefreshNewProjectDraft,
                onDecide: onDecidePlanningAgentSuggestion,
            }),
            collaborationSection({
                number: 2, title: '스크립트', stage: 'script', createDraftControl: createScriptControl, draftValue,
                disabled: loading, draftDirty, collaboration: draftState?.collaboration, onSave: onSaveNewProjectDraft,
                onEnqueue: onEnqueuePlanningAgentRequest, onRun: onRunPlanningAgentRequest, onRefresh: onRefreshNewProjectDraft,
                onDecide: onDecidePlanningAgentSuggestion,
            }),
        ]),
        el('details', { className: 'border-t border-white/10 pt-4' }, [
            el('summary', { text: '고급: 빌드 명령', className: 'min-h-11 cursor-pointer py-3 text-xs font-semibold text-secondary' }),
            el('div', { className: 'mt-2 flex min-w-0 flex-col items-start gap-3' }, [
                actionButton('빌드 명령 복사', {
                    disabled: loading || !readyToCopy, variant: 'muted', onClick: () => onCopyNewProjectBuildCommand?.(),
                }),
                readyToCopy ? codeBlock(draftState.preview.shellSafeCommand) : null,
            ].filter(Boolean)),
        ]),
    ].filter(Boolean), 'flex min-w-0 flex-col gap-5 border-cyan-400/20');
}
