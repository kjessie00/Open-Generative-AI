import { BLOCKERS } from '../../lib/pipeline/blockers.js';
import { buildFfmpegConcatPreviewCommand, buildFfprobeValidationCommands } from '../../lib/pipeline/commandBuilders.js';
import { validateFinalReady } from '../../lib/pipeline/validators.js';
import { blockerList, card, dataTable, el, infoGrid, panelShell, statusBadge } from './ui.js';
import { CommandPreviewCard } from './CommandPreviewCard.js';
import { p } from './copy.js';

function checklistItem(label, ok, blocker = BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN) {
    return card([
        statusBadge(ok ? p('ready') : blocker, ok ? 'PASS' : 'BLOCK'),
        el('div', { text: label, className: 'mt-3 text-sm font-semibold text-white' }),
    ], ok ? 'border-emerald-400/20' : 'border-red-400/20');
}

function unique(values) {
    return Array.from(new Set(values.filter(Boolean)));
}

function plannedClipIds(state) {
    return unique([
        ...(state.storyboard || []).map((clip) => clip.clip_id),
        ...(state.promptPacks || []).map((pack) => pack.clip_id),
        ...(state.submitRecords || []).map((record) => record.clip_id),
    ]);
}

function hasFileEvidence(path, state) {
    if (!path) return false;
    return state.fileEvidence?.[path] === true || state.fileExists?.[path] === true || state.files?.includes(path) === true;
}

function firstForClip(records = [], clipId) {
    return records.find((record) => record.clip_id === clipId) || null;
}

function heartbeatForClip(state, clipId) {
    return [...(state.heartbeatRecords || [])].reverse().find((record) => record.clip_id === clipId) || null;
}

function firstFrameAssetForClip(state, clipId) {
    return (state.assets || state.imageDashboard?.assets || []).find((asset) => (
        asset.target_clip_id === clipId && ['first_frame', 'start_frame', 'image', 'reference'].includes(asset.type)
    )) || null;
}

function downloadedFileForClip(state, clipId) {
    const heartbeat = heartbeatForClip(state, clipId);
    const submit = firstForClip(state.submitRecords || [], clipId);
    return heartbeat?.downloaded_files?.[0] || submit?.source_file || '';
}

function acceptedSecondsText(record) {
    if (!record?.source_file || !(record.out_time > record.in_time)) return p('not recorded');
    return `${record.in_time}-${record.out_time}s · ${record.reviewer_confidence || p('confidence not recorded')}`;
}

function firstFrameCell(asset) {
    if (!asset?.path) return '—';
    const canPreview = /\.(png|jpe?g|webp|gif)$/i.test(asset.path);
    return el('div', { className: 'flex min-w-[180px] flex-col gap-2' }, [
        canPreview ? el('img', {
            className: 'h-20 w-32 rounded-lg border border-white/10 object-cover',
            attrs: { src: asset.path, alt: asset.asset_id || p('First frame') },
        }) : null,
        el('span', { text: asset.path, className: 'break-all font-mono text-xs text-secondary' }),
    ].filter(Boolean));
}

export function buildFinalClipRows(state = {}) {
    return plannedClipIds(state).map((clipId) => {
        const submit = firstForClip(state.submitRecords || [], clipId) || {};
        const heartbeat = heartbeatForClip(state, clipId) || {};
        const qa = firstForClip(state.qaRecords || [], clipId) || {};
        const accepted = firstForClip(state.acceptedSeconds || [], clipId) || {};
        const promptPack = firstForClip(state.promptPacks || [], clipId) || {};
        const finalClip = (state.finalReport?.clip_table || []).find((clip) => clip.clip_id === clipId) || {};

        return {
            clip_id: clipId,
            firstFrameAsset: firstFrameAssetForClip(state, clipId),
            prompt_pack_path: promptPack.prompt_path || '',
            submit_id: submit.submit_id || heartbeat.submit_id || '',
            status: finalClip.status || submit.status || heartbeat.gen_status || heartbeat.queue_status || 'not_recorded',
            model_evidence: submit.submitted_cli_model || heartbeat.submitted_cli_model || submit.requested_model || '',
            downloaded_file: downloadedFileForClip(state, clipId),
            qa_verdict: qa.verdict || 'UNREVIEWED',
            accepted_seconds: acceptedSecondsText(accepted),
        };
    });
}

export function knownCreditEvidence(state = {}) {
    const submitCredits = (state.submitRecords || []).reduce((sum, record) => {
        const value = Number(record.credit_count || 0);
        return Number.isFinite(value) ? sum + value : sum;
    }, 0);
    const reportCredits = Number(state.finalReport?.known_credits || 0);
    const total = reportCredits > 0 ? reportCredits : submitCredits;
    const source = reportCredits > 0 ? 'finalReport.known_credits' : submitCredits > 0 ? 'submit_records.credit_count' : 'no credit evidence';
    return { total, source };
}

function completionTime(state = {}) {
    const finalReport = state.finalReport || {};
    if (finalReport.completed_at) return finalReport.completed_at;
    const completion = [...(state.heartbeatRecords || [])].reverse().find((record) => {
        const statusText = `${record.queue_status || ''} ${record.gen_status || ''}`.toLowerCase();
        return /downloaded|complete|completed|done/.test(statusText);
    });
    return completion?.checked_at || '';
}

export function deriveFinalCondition(state = {}, validation = validateFinalReady(state)) {
    const finalReport = state.finalReport || {};
    if (hasFileEvidence(finalReport.final_video_path, state)) return 'final.mp4 exists';
    const activeQueued = (state.heartbeatRecords || []).some((record) => /queued|pending|running|processing|generating|submitted/.test(`${record.queue_status || ''} ${record.gen_status || ''}`.toLowerCase()));
    if (activeQueued) return 'queued';
    if (validation.details?.missingSubmitIds?.length) return 'blocked before submission';
    if (validation.details?.qaNotPassedOrException?.length || validation.details?.downloadedButQaMissing?.length) return 'generated but failed QA';
    if (validation.details?.missingDownloads?.length || validation.details?.missingFinishedSourceClipPaths?.length) return 'missing download';
    if (validation.details?.missingAcceptedSeconds?.length) return 'missing accepted seconds';
    return 'missing final stitch';
}

export function FinalReportPanel({ state }) {
    const finalReport = state.finalReport || {};
    const validation = validateFinalReady(state);
    const allClipIds = plannedClipIds(state);
    const downloadedClipIds = new Set([
        ...(state.heartbeatRecords || []).filter((record) => record.downloaded_files?.length).map((record) => record.clip_id),
        ...(state.submitRecords || []).filter((record) => record.downloaded === true).map((record) => record.clip_id),
    ]);
    const qaClipIds = new Set((state.qaRecords || []).filter((record) => ['PASS', 'EXCEPTION'].includes(record.verdict)).map((record) => record.clip_id));
    const acceptedClipIds = new Set((state.acceptedSeconds || []).filter((record) => record.source_file && record.out_time > record.in_time).map((record) => record.clip_id));
    const finalVideoPath = finalReport.final_video_path;
    const concatListPath = finalReport.concat_list_path;
    const reportPath = finalReport.report_path;
    const ffprobePath = finalReport.ffprobe_path || (finalVideoPath ? `${finalVideoPath}.ffprobe.json` : '');
    const finalVideoExists = hasFileEvidence(finalVideoPath, state);
    const condition = deriveFinalCondition(state, validation);
    const creditEvidence = knownCreditEvidence(state);
    const clipRows = buildFinalClipRows(state);
    const ffprobeSpecs = buildFfprobeValidationCommands(state);
    const concatSpec = buildFfmpegConcatPreviewCommand(state);

    const checklist = [
        checklistItem(p('all clips downloaded'), allClipIds.length > 0 && allClipIds.every((clipId) => downloadedClipIds.has(clipId)), BLOCKERS.FRAME_EXTRACTION_BLOCKED),
        checklistItem(p('all QA passed or exception recorded'), allClipIds.length > 0 && allClipIds.every((clipId) => qaClipIds.has(clipId)), BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN),
        checklistItem(p('accepted seconds recorded'), allClipIds.length > 0 && allClipIds.every((clipId) => acceptedClipIds.has(clipId)), BLOCKERS.MISSING_ACCEPTED_SECONDS),
        checklistItem(p('concat list exists'), hasFileEvidence(concatListPath, state), BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN),
        checklistItem(p('final.mp4 exists'), hasFileEvidence(finalVideoPath, state), BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN),
        checklistItem(p('ffprobe verification exists'), finalReport.ffprobe_verified === true || hasFileEvidence(ffprobePath, state), BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN),
        checklistItem(p('report.md exists'), hasFileEvidence(reportPath, state), BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN),
    ];

    const conditionLabel = p(condition);
    return panelShell(p('Final Edit And Report'), p('Final readiness checklist and exact blockers. Execution success is separated from output-quality proof.'), [
        blockerList(validation.blockers),
        card([
            el('div', { className: 'mb-3 flex flex-wrap gap-2' }, [
                statusBadge(validation.ok ? p('final ready') : conditionLabel, validation.ok ? 'PASS' : 'BLOCK'),
                statusBadge(p('evidence-only credits'), 'PREVIEW'),
                statusBadge(p('ffmpeg/ffprobe preview only'), 'PREVIEW'),
            ]),
            el('p', {
                text: finalVideoExists
                    ? p('Final video exists: {path}', { path: finalVideoPath })
                    : p('No final video exists. Current condition: {condition}.', { condition: conditionLabel }),
                className: 'break-words text-sm leading-6 text-secondary',
            }),
        ], validation.ok ? 'border-emerald-400/20' : 'border-red-400/20'),
        infoGrid([
            { label: p('Final report path'), value: finalReport.report_path },
            { label: p('Final video path'), value: finalVideoExists ? finalReport.final_video_path : p('not available · {condition}', { condition: conditionLabel }) },
            { label: p('Production folder'), value: finalReport.production_folder },
            { label: p('Generator route'), value: finalReport.generator_route },
            { label: p('Concat list path'), value: finalReport.concat_list_path },
            { label: p('ffprobe evidence path'), value: ffprobePath },
            { label: p('Known credits'), value: `${creditEvidence.total} (${creditEvidence.source})` },
            { label: p('Completion time'), value: completionTime(state) || p('not complete') },
            { label: p('Residual risks'), value: (finalReport.residual_risks || []).join(', ') },
        ]),
        dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('First-frame image'), render: (row) => firstFrameCell(row.firstFrameAsset) },
            { label: p('Prompt pack path'), key: 'prompt_pack_path' },
            { label: p('Submit ID'), render: (row) => row.submit_id ? statusBadge(row.submit_id, 'PASS') : statusBadge(p('missing'), 'BLOCK') },
            { label: p('Status'), render: (row) => statusBadge(row.status, row.status === 'downloaded' || row.status === 'accepted' ? 'PASS' : 'PREVIEW') },
            { label: p('Model evidence'), key: 'model_evidence' },
            { label: p('Downloaded file'), key: 'downloaded_file' },
            { label: p('QA verdict'), render: (row) => statusBadge(row.qa_verdict, row.qa_verdict) },
            { label: p('Accepted seconds'), key: 'accepted_seconds' },
        ], clipRows),
        dataTable([
            { label: p('Checked at'), key: 'checked_at' },
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Submit ID'), key: 'submit_id' },
            { label: p('Queue status'), key: 'queue_status' },
            { label: p('Gen status'), key: 'gen_status' },
            { label: p('Downloaded files'), render: (record) => record.downloaded_files?.join(', ') || '—' },
            { label: p('Next heartbeat'), key: 'next_heartbeat_at' },
            { label: p('Blocker'), key: 'blocker' },
        ], state.heartbeatRecords || []),
        el('div', { className: 'grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3' }, checklist),
        el('section', { className: 'flex flex-col gap-4' }, [
            el('div', {}, [
                el('h3', { text: p('Final Stitch Command Previews'), className: 'text-lg font-bold text-white' }),
                el('p', { text: p('Copy-only previews for ffmpeg concat and ffprobe validation. These commands are not executed by the UI.'), className: 'mt-1 text-sm leading-6 text-secondary' }),
            ]),
            el('div', { className: 'grid grid-cols-1 gap-4 xl:grid-cols-2' }, [
                ...ffprobeSpecs.map((commandSpec) => CommandPreviewCard({ commandSpec })),
                CommandPreviewCard({ commandSpec: concatSpec }),
            ]),
        ]),
        card([
            el('div', { text: p('Readiness details'), className: 'mb-3 text-xs font-semibold text-secondary' }),
            el('pre', { className: 'overflow-auto rounded-xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-secondary' }, [
                el('code', { text: JSON.stringify(validation.details || {}, null, 2) }),
            ]),
        ]),
        card([
            el('div', { text: p('Blockers and residual risks'), className: 'mb-3 text-xs font-semibold text-secondary' }),
            el('div', { className: 'flex flex-wrap gap-2' }, [
                ...((finalReport.blockers || []).length
                    ? (finalReport.blockers || []).map((blocker) => statusBadge(blocker, 'BLOCK'))
                    : [statusBadge(p('blockers recorded empty'), 'PASS')]),
                ...(finalReport.residual_risks || []).map((risk) => statusBadge(risk, 'WARN')),
            ]),
        ]),
    ]);
}
