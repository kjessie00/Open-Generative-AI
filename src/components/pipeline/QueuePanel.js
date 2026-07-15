import { BLOCKERS } from '../../lib/pipeline/blockers.js';
import { buildPipelineCommandSpecs } from '../../lib/pipeline/commandBuilders.js';
import { QUEUE_PHASES, validateSeedanceQueuePolicy, validateSubmitAllowed } from '../../lib/pipeline/validators.js';
import { actionButton, card, dataTable, el, panelShell } from './ui.js';
import { CommandPreviewCard } from './CommandPreviewCard.js';
import { p } from './copy.js';
import { blockerLabel, issueList, plainStatus, queuePhaseLabel } from './generationUi.js';

function latestHeartbeatForClip(state, clipId) {
    return [...(state.heartbeatRecords || [])].reverse().find((record) => record.clip_id === clipId) || null;
}

function exactTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toISOString() : String(value);
}

function countdownText(value, now) {
    if (!value) return '—';
    const target = new Date(value).getTime();
    const current = now.getTime();
    if (!Number.isFinite(target) || !Number.isFinite(current)) return String(value);
    const remaining = target - current;
    if (remaining <= 0) return `${exactTime(value)} · ${p('due now')}`;
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    return `${exactTime(value)} · ${p('{minutes}m {seconds}s remaining', { minutes, seconds: String(seconds).padStart(2, '0') })}`;
}

function phaseBadge(phase) {
    const status = {
        [QUEUE_PHASES.PRE_QUEUE_FAILURE]: 'BLOCK',
        [QUEUE_PHASES.SUBMITTED_MISSING_ID]: 'BLOCK',
        [QUEUE_PHASES.HEARTBEAT_NOT_DUE]: 'PREVIEW',
        [QUEUE_PHASES.HEARTBEAT_DUE]: 'PREVIEW',
        [QUEUE_PHASES.DOWNLOADED]: 'PASS',
        [QUEUE_PHASES.COMPLETED_NOT_DOWNLOADED]: 'BLOCK',
        [QUEUE_PHASES.FAILED_AFTER_REAL_QUEUE]: 'FAIL',
        [QUEUE_PHASES.QUEUED]: 'PREVIEW',
        [QUEUE_PHASES.NOT_QUEUED]: 'UNREVIEWED',
    }[phase] || 'UNREVIEWED';
    return el('span', {
        text: queuePhaseLabel(phase),
        className: status === 'BLOCK' || status === 'FAIL' ? 'text-sm text-amber-100' : 'text-sm text-secondary',
    });
}

function submitIdBadge(submitId) {
    return submitId || '아직 없음';
}

function creditBadge(count) {
    const numeric = Number(count || 0);
    return `${numeric} 크레딧`;
}

function backendModelEvidence(item) {
    return item.backendModelEvidence || '아직 없음';
}

function policyBanner() {
    return card([
        el('strong', { text: '안전한 대기열 원칙', className: 'text-sm text-white' }),
        el('p', { text: '자동 재시도와 중복 생성은 하지 않습니다. 모든 승인 클립을 먼저 대기열에 넣은 뒤 상태만 확인합니다.', className: 'mt-1 text-sm leading-6 text-secondary' }),
    ], 'border-cyan-400/20');
}

function strictBlockerCard(queuePolicy) {
    const details = queuePolicy.details || {};
    const rows = [
        details.missingApprovedSubmitIds?.length ? p('Approved clips missing submit_id: {value}', { value: details.missingApprovedSubmitIds.join(', ') }) : '',
        details.missingSubmittedIds?.length ? p('Submitted records missing submit_id: {value}', { value: details.missingSubmittedIds.join(', ') }) : '',
        details.duplicateAttempts?.length ? p('Duplicate live attempts blocked: {value}', { value: details.duplicateAttempts.join(', ') }) : '',
        details.vipOrFallback?.length ? p('VIP/fallback evidence blocked: {value}', { value: details.vipOrFallback.join(', ') }) : '',
        details.heartbeatBeforeAllApprovedQueued?.length ? p('Heartbeat blocked until all approved clips are queued with --poll=0: {value}', { value: details.heartbeatBeforeAllApprovedQueued.join(', ') }) : '',
        details.nextHeartbeatBlocked?.length ? p('Heartbeat not due: {value}', { value: details.nextHeartbeatBlocked.map((item) => `${item.clip_id} @ ${exactTime(item.next_heartbeat_at)}`).join('; ') }) : '',
    ].filter(Boolean);

    return card([
        el('strong', {
            text: queuePolicy.blockers.length ? '먼저 준비할 것' : '대기열 준비 완료',
            className: queuePolicy.blockers.length ? 'text-sm text-amber-100' : 'text-sm text-emerald-200',
        }),
        rows.length
            ? el('ul', { className: 'mt-3 flex flex-col gap-2 text-sm leading-6 text-secondary' }, rows.map((row) => el('li', { text: row, className: 'break-words' })))
            : el('p', { text: p('No strict queue blocker is active for preview state.'), className: 'text-sm text-secondary' }),
    ], queuePolicy.blockers.length ? 'border-red-400/20' : 'border-emerald-400/20');
}

function harnessStatusCard(harnessStatus) {
    const readiness = harnessStatus?.readiness || 'blocked';
    return card([
        el('div', { className: 'mb-2 flex flex-wrap items-center gap-2' }, [
            el('div', { text: p('Canonical harness handoff'), className: 'text-sm font-bold text-white' }),
            plainStatus(readiness === 'available' ? 'PASS' : readiness === 'partial' ? 'WARN' : 'BLOCK'),
        ]),
        el('p', {
            text: readiness === 'available'
                ? p('The canonical pack validator is available as a copy-only local read preview.')
                : p('Canonical pack commands remain copy-disabled until the fixed-root contract is complete.'),
            className: 'text-sm leading-6 text-secondary',
        }),
    ], readiness === 'available' ? 'border-emerald-400/20' : readiness === 'partial' ? 'border-yellow-400/20' : 'border-red-400/20');
}

export function QueuePanel({ state, config, harnessStatus }) {
    const now = new Date();
    const submitRecords = state.submitRecords || [];
    const promptPack = state.promptPacks?.[0];
    const queuePolicy = validateSeedanceQueuePolicy(state, now);
    const queueTimeline = queuePolicy.details?.timeline || [];
    const submitValidation = validateSubmitAllowed({
        ...state,
        promptPack,
        reviewGates: state.reviewGates || [],
        credit_confirmed: false,
        live_attempt_count: queueTimeline.find((item) => item.clip_id === promptPack?.clip_id)?.liveAttemptCount || 0,
    });
    const motionClipIds = new Set((state.motionBoard || []).map((shot) => shot.clip_id));
    const missingMotionBoard = !(state.storyboard || []).every((clip) => motionClipIds.has(clip.clip_id));
    const motionBoardBlockers = missingMotionBoard ? [BLOCKERS.MISSING_MOTION_BOARD] : [];
    const ledgers = state.queueLedgers || {};
    const nextHeartbeatBlocked = queuePolicy.details?.nextHeartbeatBlocked?.[0] || null;
    const heartbeatBlocked = Boolean(nextHeartbeatBlocked);
    const commandSpecs = buildPipelineCommandSpecs(state, {
        now,
        harnessStatus,
        configuredProductionRoot: config?.productionRoot || '',
    });
    const queryCommandSpecs = commandSpecs.filter((commandSpec) => commandSpec.id.startsWith('dreamina_list_task_') || commandSpec.id.startsWith('dreamina_query_result_'));
    const otherCommandSpecs = commandSpecs.filter((commandSpec) => !queryCommandSpecs.includes(commandSpec));

    return panelShell(p('Generation Queue'), p('Submit and heartbeat ledgers. Live submit is disabled; UI-only mode only renders preview commands.'), [
        harnessStatusCard(harnessStatus),
        policyBanner(),
        issueList([...motionBoardBlockers, ...submitValidation.blockers, ...queuePolicy.blockers]),
        strictBlockerCard(queuePolicy),
        card([
            el('strong', { text: '대기열 기록 파일', className: 'text-sm text-white' }),
            el('div', { className: 'grid grid-cols-1 gap-3 md:grid-cols-2' }, [
                el('div', { text: ledgers.submit_records || p('submit_records.jsonl not loaded'), className: 'break-all rounded-md border border-white/10 bg-black/20 p-3 font-mono text-xs text-secondary' }),
                el('div', { text: ledgers.heartbeat_log || p('heartbeat_log.jsonl not loaded'), className: 'break-all rounded-md border border-white/10 bg-black/20 p-3 font-mono text-xs text-secondary' }),
            ]),
        ]),
        dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Timeline'), render: (item) => phaseBadge(item.phase) },
            { label: p('Submit ID'), render: (item) => submitIdBadge(item.submit_id) },
            { label: p('Live attempts'), render: (item) => `${item.liveAttemptCount}/1` },
            { label: p('Known credits'), render: (item) => creditBadge(item.knownCreditCount) },
            { label: p('Backend model evidence'), render: backendModelEvidence },
            { label: p('Next heartbeat countdown'), render: (item) => el('span', { text: countdownText(item.heartbeat.details?.nextHeartbeatAt || item.next_heartbeat_at, now), className: 'font-mono text-xs text-secondary' }) },
            { label: p('Downloaded files'), render: (item) => item.downloadedFiles?.length ? item.downloadedFiles.join(', ') : '—' },
        ], queueTimeline),
        dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Submitted?'), render: (record) => record.submit_id ? '예' : '아니요' },
            { label: p('Submit ID'), key: 'submit_id' },
            { label: p('Backend model evidence'), key: 'submitted_cli_model' },
            { label: p('Credits'), key: 'credit_count' },
            { label: p('Next heartbeat'), key: 'next_heartbeat_at' },
            { label: p('Downloaded files'), render: (record) => {
                const heartbeat = latestHeartbeatForClip(state, record.clip_id);
                return heartbeat?.downloaded_files?.join(', ') || '—';
            } },
        ], submitRecords),
        card([
            el('div', { className: 'mb-4 flex flex-wrap items-center gap-3' }, [
                actionButton(p('Submit disabled'), { disabled: true, variant: 'danger' }),
                actionButton(heartbeatBlocked ? p('Heartbeat disabled until {time}', { time: exactTime(nextHeartbeatBlocked.next_heartbeat_at) }) : p('Heartbeat preview only'), { disabled: true, variant: 'muted' }),
                el('span', { text: heartbeatBlocked ? '상태 확인 대기 중' : '상태 확인 가능', className: 'text-sm text-secondary' }),
            ]),
            el('p', { text: `현재 상태: ${blockerLabel(BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED)}`, className: 'mb-4 text-sm leading-6 text-secondary' }),
            el('p', { text: p('Dreamina submit execution is not exposed. Planning and status previews remain non-executing; unfinished ffprobe and selected-range rendering commands are blocked.'), className: 'text-sm leading-6 text-secondary' }),
        ]),
        el('details', { className: 'rounded-lg border border-white/10 bg-white/[0.025] p-4' }, [
            el('summary', { text: `상태 확인 명령 ${queryCommandSpecs.length}개`, className: 'cursor-pointer text-sm font-bold text-white' }),
            el('p', { text: '필요할 때만 펼쳐서 명령 내용을 확인하세요. 앱에서는 실행되지 않습니다.', className: 'mt-2 text-sm text-secondary' }),
            el('div', { className: 'mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2' }, queryCommandSpecs.map((commandSpec) => CommandPreviewCard({ commandSpec, compact: true }))),
        ]),
        el('details', { className: 'rounded-lg border border-white/10 bg-white/[0.025] p-4' }, [
            el('summary', { text: `기타 준비 명령 ${otherCommandSpecs.length}개`, className: 'cursor-pointer text-sm font-bold text-white' }),
            el('p', { text: '계획·검증·생성 명령을 기술적으로 확인할 때만 펼치세요.', className: 'mt-2 text-sm text-secondary' }),
            el('div', { className: 'mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2' }, otherCommandSpecs.map((commandSpec) => CommandPreviewCard({ commandSpec, compact: true }))),
        ]),
    ]);
}
