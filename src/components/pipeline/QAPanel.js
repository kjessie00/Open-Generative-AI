import { BLOCKERS } from '../../lib/pipeline/blockers.js';
import { validateFinalReady } from '../../lib/pipeline/validators.js';
import { blockerList, card, dataTable, el, infoGrid, panelShell, pathList, statusBadge } from './ui.js';
import { p } from './copy.js';

function qaBadge(value) {
    return statusBadge(value ? p('ok') : p('blocked'), value ? 'PASS' : 'BLOCK');
}

function qaVerdictBadge(record) {
    const verdict = record.verdict || 'UNREVIEWED';
    return statusBadge(verdict, verdict);
}

function rangeIsAccepted(record) {
    if (record.canonical_provenance === 'selected_takes.json') {
        return record.accepted === true && record.source_exists === true && Boolean(record.clip_id);
    }
    return record.accepted === true || Boolean(record.source_file && record.out_time > record.in_time);
}

function canonicalDecisionBadge(record) {
    const decision = record.canonical_decision || 'UNREVIEWED';
    return statusBadge(p(decision), decision === 'accept' ? 'PREVIEW' : decision === 'retry' || decision === 'abandon' ? 'BLOCK' : 'UNREVIEWED');
}

function scoreText(record) {
    return typeof record.dialogue_intelligibility_score === 'number'
        ? record.dialogue_intelligibility_score.toFixed(2)
        : '—';
}

export function QAPanel({ state }) {
    const finalValidation = validateFinalReady(state);
    const qaRecords = state.qaRecords || [];
    const acceptedSeconds = state.acceptedSeconds || [];
    const canonicalQaRecords = qaRecords.filter((record) => record.canonical_provenance === 'qc_report.json');
    const legacyQaRecords = qaRecords.filter((record) => record.canonical_provenance !== 'qc_report.json');
    const qaPaths = state.qaArtifacts || {};
    const downloadedClipIds = new Set([
        ...(state.heartbeatRecords || []).filter((record) => record.downloaded_files?.length).map((record) => record.clip_id),
        ...(state.submitRecords || []).filter((record) => record.downloaded === true).map((record) => record.clip_id),
    ]);
    const qaRecordedClipIds = new Set(qaRecords.filter((record) => record.verdict && record.verdict !== 'UNREVIEWED').map((record) => record.clip_id));
    const downloadedButQaMissing = Array.from(downloadedClipIds).filter((clipId) => !qaRecordedClipIds.has(clipId));
    const acceptedReadyCount = acceptedSeconds.filter(rangeIsAccepted).length;
    const acceptedSecondsBlockers = !acceptedSeconds.length || acceptedSeconds.some((record) => !rangeIsAccepted(record))
        ? [BLOCKERS.MISSING_ACCEPTED_SECONDS]
        : [];
    const qaBlockers = qaRecords.some((record) => !['PASS', 'EXCEPTION'].includes(record.verdict))
        ? [BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN]
        : [];

    return panelShell(p('Clip QA And Accepted Ranges'), p('Clip QA, frame samples, contact sheets, and accepted seconds. Final is blocked until output quality is proven.'), [
        blockerList([
            ...finalValidation.blockers,
            ...acceptedSecondsBlockers,
            ...qaBlockers,
            ...(downloadedButQaMissing.length ? [BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN] : []),
        ]),
        downloadedButQaMissing.length ? card([
            statusBadge(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN, 'BLOCK'),
            el('p', {
                text: p('Downloaded clips without QA records: {value}', { value: downloadedButQaMissing.join(', ') }),
                className: 'mt-3 text-sm leading-6 text-secondary',
            }),
        ], 'border-red-400/20') : null,
        infoGrid([
            { label: p('Accepted seconds source'), value: qaPaths.acceptedSecondsPath || p('not loaded') },
            { label: p('Canonical shot manifest'), value: qaPaths.shotManifestPath || p('not loaded') },
            { label: p('Canonical selected takes'), value: qaPaths.selectedTakesPath || p('not loaded') },
            { label: p('Canonical QC report'), value: qaPaths.qcReportPath || p('not loaded') },
            { label: p('Gemini frame review paths'), value: (qaPaths.geminiFrameReviewPaths || []).join(', ') || qaRecords.map((record) => record.gemini_frame_review_path).filter(Boolean).join(', ') || p('not recorded') },
            { label: p('Video review paths'), value: (qaPaths.videoReviewPaths || []).join(', ') || qaRecords.map((record) => record.video_review_path).filter(Boolean).join(', ') || p('not recorded') },
        ]),
        canonicalQaRecords.length ? card([
            el('div', { className: 'mb-3 flex flex-wrap gap-2' }, [
                statusBadge(p('Canonical QC is structural evidence only'), 'PREVIEW'),
                statusBadge(p('Human decision remains unreviewed'), 'UNREVIEWED'),
            ]),
            el('p', { text: p('Deterministic checks, external findings metadata, canonical decision, and human approval remain separate. A canonical accept decision does not prove final output quality.'), className: 'text-sm leading-6 text-secondary' }),
        ], 'border-cyan-400/20') : null,
        canonicalQaRecords.length ? dataTable([
            { label: p('Canonical shot'), key: 'canonical_shot_id' },
            { label: p('Clip alias'), key: 'clip_id' },
            { label: p('Provider'), key: 'canonical_provider' },
            { label: p('Deterministic checks'), render: (record) => qaBadge(record.deterministic_checks_passed) },
            { label: p('Dialogue score'), render: scoreText },
            { label: p('Pronunciation risk'), render: (record) => statusBadge(record.pronunciation_risk_flag ? p('risk detected') : p('no risk flag'), record.pronunciation_risk_flag ? 'BLOCK' : 'PREVIEW') },
            { label: p('Canonical decision'), render: canonicalDecisionBadge },
            { label: p('External review metadata'), render: (record) => statusBadge(p(record.external_review_state || 'not recorded'), 'UNREVIEWED') },
            { label: p('Human decision'), render: (record) => statusBadge(record.human_decision || 'UNREVIEWED', 'UNREVIEWED') },
            { label: p('Overall QA'), render: qaVerdictBadge },
        ], canonicalQaRecords) : null,
        legacyQaRecords.length ? dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('File'), key: 'file_path' },
            { label: p('Valid video'), render: (record) => qaBadge(record.valid_video) },
            { label: p('Duration plausible'), render: (record) => qaBadge(record.duration_ok) },
            { label: p('Aspect ratio'), render: (record) => qaBadge(record.aspect_ratio_ok) },
            { label: p('Identity'), render: (record) => qaBadge(record.identity_ok) },
            { label: p('First-frame role'), render: (record) => qaBadge(record.first_frame_respected) },
            { label: p('Camera movement'), render: (record) => qaBadge(record.camera_ok) },
            { label: p('No subtitles/logo/watermark/UI text'), render: (record) => qaBadge(record.no_subtitles_or_watermarks && record.no_ui_text !== false) },
            { label: p('No BGM'), render: (record) => qaBadge(record.no_background_music) },
            { label: p('Dialogue'), render: (record) => qaBadge(record.dialogue_ok) },
            { label: p('Continuity'), render: (record) => qaBadge(record.continuity_ok) },
            { label: p('Gemini frame review'), key: 'gemini_frame_review_path' },
            { label: p('Video review'), key: 'video_review_path' },
            { label: p('Verdict'), render: qaVerdictBadge },
        ], legacyQaRecords) : null,
        card([
            el('div', { className: 'mb-3 flex flex-wrap gap-2' }, [
                statusBadge(p('Whole clip is not automatically accepted'), 'BLOCK'),
                statusBadge(acceptedReadyCount ? p('accepted ranges with source evidence: {value}', { value: acceptedReadyCount }) : BLOCKERS.MISSING_ACCEPTED_SECONDS, acceptedReadyCount ? 'PREVIEW' : 'BLOCK'),
            ]),
            el('p', { text: p('Canonical ranges count only when shot identity is proven by shot_manifest.json, in/out values are finite, and the source is a real non-symlink file inside the selected production.'), className: 'text-sm leading-6 text-secondary' }),
        ], acceptedReadyCount ? 'border-cyan-400/20' : 'border-red-400/20'),
        dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Canonical shot'), key: 'canonical_shot_id' },
            { label: p('Beat'), key: 'canonical_beat_id' },
            { label: p('Take'), key: 'canonical_take_id' },
            { label: p('Source file'), key: 'source_file' },
            { label: p('Source exists'), render: (record) => statusBadge(record.source_exists ? p('yes') : p('no'), record.source_exists ? 'PASS' : 'BLOCK') },
            { label: p('In'), key: 'in_time' },
            { label: p('Out'), key: 'out_time' },
            { label: p('Transition'), render: (record) => record.transition_type ? `${record.transition_type} · ${record.transition_duration_sec ?? 0}s` : '—' },
            { label: p('Range accepted?'), render: (record) => statusBadge(p(rangeIsAccepted(record) ? 'explicit range' : 'not accepted'), rangeIsAccepted(record) ? 'PASS' : 'BLOCK') },
            { label: p('Reason'), render: (record) => p(record.reason || 'not recorded') },
            { label: p('Provenance'), render: (record) => record.canonical_provenance || record.provenance || '—' },
        ], acceptedSeconds),
        card([
            el('h3', { text: p('Contact Sheets'), className: 'mb-3 text-sm font-bold text-white' }),
            pathList(qaPaths.contactSheetPaths || []),
            el('h3', { text: p('Frame Samples'), className: 'mb-3 mt-5 text-sm font-bold text-white' }),
            pathList(qaPaths.frameSamplePaths || []),
            el('h3', { text: p('Gemini Frame Reviews'), className: 'mb-3 mt-5 text-sm font-bold text-white' }),
            pathList(qaPaths.geminiFrameReviewPaths || qaRecords.map((record) => record.gemini_frame_review_path).filter(Boolean)),
            el('h3', { text: p('Video Reviews'), className: 'mb-3 mt-5 text-sm font-bold text-white' }),
            pathList(qaPaths.videoReviewPaths || qaRecords.map((record) => record.video_review_path).filter(Boolean)),
        ]),
    ]);
}
