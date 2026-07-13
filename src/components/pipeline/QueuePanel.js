import { BLOCKERS } from '../../lib/pipeline/blockers.js';
import { buildPipelineCommandSpecs } from '../../lib/pipeline/commandBuilders.js';
import { QUEUE_PHASES, validateSeedanceQueuePolicy, validateSubmitAllowed } from '../../lib/pipeline/validators.js';
import { actionButton, blockerList, card, dataTable, el, panelShell, statusBadge } from './ui.js';
import { CommandPreviewCard } from './CommandPreviewCard.js';
import { p } from './copy.js';

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
    return statusBadge(phase, status);
}

function submitIdBadge(submitId) {
    return submitId ? statusBadge(submitId, 'PASS') : statusBadge(p('missing submit_id'), 'BLOCK');
}

function creditBadge(count) {
    const numeric = Number(count || 0);
    return statusBadge(p('{count} credits', { count: numeric }), numeric > 0 ? 'WARN' : 'PREVIEW');
}

function backendModelEvidence(item) {
    return item.backendModelEvidence
        ? statusBadge(item.backendModelEvidence, 'PASS')
        : statusBadge(p('not recorded'), 'UNREVIEWED');
}

function policyBanner() {
    return card([
        el('div', { className: 'mb-3 flex flex-wrap items-center gap-2' }, [
            statusBadge(p('No auto-retry'), 'BLOCK'),
            statusBadge(p('No duplicate jobs'), 'BLOCK'),
            statusBadge(p('No VIP/fallback'), 'BLOCK'),
            statusBadge('--poll=0 first', 'PREVIEW'),
            statusBadge('list_task/query_result only', 'PREVIEW'),
        ]),
        el('p', {
            text: p('Slow queue status is not a retry signal. Seedance/Dreamina clips get one live generation attempt by default; approved clips must be queued first with --poll=0, then heartbeat checks use only non-consuming list_task/query_result previews.'),
            className: 'text-sm leading-6 text-secondary',
        }),
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
        el('div', { className: 'mb-3 flex flex-wrap gap-2' }, queuePolicy.blockers.length
            ? queuePolicy.blockers.map((blocker) => statusBadge(blocker, 'BLOCK'))
            : [statusBadge(p('Strict queue policy clear'), 'PASS')]),
        rows.length
            ? el('ul', { className: 'flex flex-col gap-2 text-sm leading-6 text-secondary' }, rows.map((row) => el('li', { text: row, className: 'break-words' })))
            : el('p', { text: p('No strict queue blocker is active for preview state.'), className: 'text-sm text-secondary' }),
    ], queuePolicy.blockers.length ? 'border-red-400/20' : 'border-emerald-400/20');
}

function harnessStatusCard(harnessStatus) {
    const readiness = harnessStatus?.readiness || 'blocked';
    const label = readiness === 'available' ? p('Available') : readiness === 'partial' ? p('Partial') : p('Blocked');
    const badge = readiness === 'available' ? 'PASS' : readiness === 'partial' ? 'WARN' : 'BLOCK';
    return card([
        el('div', { className: 'mb-2 flex flex-wrap items-center gap-2' }, [
            el('div', { text: p('Canonical harness handoff'), className: 'text-sm font-bold text-white' }),
            statusBadge(label, badge),
            statusBadge(p('Read-only metadata'), 'PREVIEW'),
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
        blockerList([...motionBoardBlockers, ...submitValidation.blockers, ...queuePolicy.blockers]),
        strictBlockerCard(queuePolicy),
        card([
            el('div', { className: 'mb-4 flex flex-wrap items-center gap-2' }, [
                statusBadge('submit_records.jsonl', 'PREVIEW'),
                statusBadge('heartbeat_log.jsonl', 'PREVIEW'),
            ]),
            el('div', { className: 'grid grid-cols-1 gap-3 md:grid-cols-2' }, [
                el('div', { text: ledgers.submit_records || p('submit_records.jsonl not loaded'), className: 'break-all rounded-md border border-white/10 bg-black/20 p-3 font-mono text-xs text-secondary' }),
                el('div', { text: ledgers.heartbeat_log || p('heartbeat_log.jsonl not loaded'), className: 'break-all rounded-md border border-white/10 bg-black/20 p-3 font-mono text-xs text-secondary' }),
            ]),
        ]),
        dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Timeline'), render: (item) => phaseBadge(item.phase) },
            { label: p('Submit ID'), render: (item) => submitIdBadge(item.submit_id) },
            { label: p('Live attempts'), render: (item) => statusBadge(`${item.liveAttemptCount}/1`, item.liveAttemptCount > 1 ? 'BLOCK' : item.liveAttemptCount === 1 ? 'PASS' : 'UNREVIEWED') },
            { label: p('Known credits'), render: (item) => creditBadge(item.knownCreditCount) },
            { label: p('Backend model evidence'), render: backendModelEvidence },
            { label: p('Next heartbeat countdown'), render: (item) => el('span', { text: countdownText(item.heartbeat.details?.nextHeartbeatAt || item.next_heartbeat_at, now), className: 'font-mono text-xs text-secondary' }) },
            { label: p('Downloaded files'), render: (item) => item.downloadedFiles?.length ? item.downloadedFiles.join(', ') : '—' },
        ], queueTimeline),
        dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Submitted?'), render: (record) => statusBadge(record.submit_id ? p('yes') : p('no'), record.submit_id ? 'PASS' : 'UNREVIEWED') },
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
                statusBadge(p(heartbeatBlocked ? '20m gate blocked' : '20m gate clear'), heartbeatBlocked ? 'BLOCK' : 'PREVIEW'),
            ]),
            el('p', { text: p('Retry, faster queue, VIP/fallback model, and duplicate job paths are never suggested by this UI. Blocker: {blocker}.', { blocker: BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED }), className: 'mb-4 text-sm leading-6 text-secondary' }),
            el('p', { text: p('Dreamina submit execution is not exposed. The cards below are shell-safe previews for planning, preflight/status, ffprobe, and concat review only.'), className: 'text-sm leading-6 text-secondary' }),
        ]),
        el('section', { className: 'flex flex-col gap-4' }, [
            el('div', {}, [
                el('h3', { text: p('Heartbeat Query Commands'), className: 'text-lg font-bold text-white' }),
                el('p', { text: p('Copy-only Dreamina list_task/query_result previews. They remain disabled until submit_id is recorded, all approved clips are queued first, and the 20 minute gate is due.'), className: 'mt-1 text-sm leading-6 text-secondary' }),
            ]),
            el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, queryCommandSpecs.map((commandSpec) => CommandPreviewCard({ commandSpec }))),
        ]),
        el('section', { className: 'flex flex-col gap-4' }, [
            el('div', {}, [
                el('h3', { text: p('Other Command Previews'), className: 'text-lg font-bold text-white' }),
                el('p', { text: p('Planning, Dreamina help/user_credit, ffprobe, and concat cards are still copy-only; no hidden execution path is attached.'), className: 'mt-1 text-sm leading-6 text-secondary' }),
            ]),
            el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, otherCommandSpecs.map((commandSpec) => CommandPreviewCard({ commandSpec }))),
        ]),
    ]);
}
