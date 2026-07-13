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

export function QAPanel({ state }) {
    const finalValidation = validateFinalReady(state);
    const qaRecords = state.qaRecords || [];
    const acceptedSeconds = state.acceptedSeconds || [];
    const qaPaths = state.qaArtifacts || {};
    const downloadedClipIds = new Set([
        ...(state.heartbeatRecords || []).filter((record) => record.downloaded_files?.length).map((record) => record.clip_id),
        ...(state.submitRecords || []).filter((record) => record.downloaded === true).map((record) => record.clip_id),
    ]);
    const qaRecordedClipIds = new Set(qaRecords.filter((record) => record.verdict && record.verdict !== 'UNREVIEWED').map((record) => record.clip_id));
    const downloadedButQaMissing = Array.from(downloadedClipIds).filter((clipId) => !qaRecordedClipIds.has(clipId));
    const acceptedSecondsBlockers = acceptedSeconds.some((record) => !record.source_file || record.out_time <= record.in_time)
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
            { label: p('Gemini frame review paths'), value: (qaPaths.geminiFrameReviewPaths || []).join(', ') || qaRecords.map((record) => record.gemini_frame_review_path).filter(Boolean).join(', ') || p('not recorded') },
            { label: p('Video review paths'), value: (qaPaths.videoReviewPaths || []).join(', ') || qaRecords.map((record) => record.video_review_path).filter(Boolean).join(', ') || p('not recorded') },
        ]),
        dataTable([
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
        ], qaRecords),
        card([
            el('div', { className: 'mb-3 flex flex-wrap gap-2' }, [
                statusBadge(p('Whole clip is not automatically accepted'), 'BLOCK'),
                statusBadge(acceptedSeconds.length ? p('accepted ranges recorded') : BLOCKERS.MISSING_ACCEPTED_SECONDS, acceptedSeconds.length ? 'PREVIEW' : 'BLOCK'),
            ]),
            el('p', { text: p('Accepted seconds must name explicit in/out ranges per clip. A downloaded or completed clip does not become accepted footage by default.'), className: 'text-sm leading-6 text-secondary' }),
        ], acceptedSeconds.length ? 'border-cyan-400/20' : 'border-red-400/20'),
        dataTable([
            { label: p('Clip'), key: 'clip_id' },
            { label: p('Source file'), key: 'source_file' },
            { label: p('In'), key: 'in_time' },
            { label: p('Out'), key: 'out_time' },
            { label: p('Range accepted?'), render: (record) => statusBadge(p(record.source_file && record.out_time > record.in_time ? 'explicit range' : 'not accepted'), record.source_file && record.out_time > record.in_time ? 'PASS' : 'BLOCK') },
            { label: p('Reason'), key: 'reason' },
            { label: p('Reviewer confidence'), key: 'reviewer_confidence' },
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
