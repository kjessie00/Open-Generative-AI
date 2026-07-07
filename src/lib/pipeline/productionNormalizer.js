import { BLOCKERS } from './blockers.js';
import { basename, joinPath } from './filePathUtils.js';

function nowIso() {
    return new Date().toISOString();
}

function firstMarkdownPath(markdown = {}, keys = []) {
    for (const key of keys) {
        if (markdown[key]?.path) return markdown[key].path;
    }
    return '';
}

function firstMarkdownHeading(markdown = {}, keys = []) {
    for (const key of keys) {
        if (markdown[key]?.heading) return markdown[key].heading;
    }
    return '';
}

function arrayFromMaybe(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.clips)) return value.clips;
    if (Array.isArray(value?.storyboard)) return value.storyboard;
    if (Array.isArray(value?.shots)) return value.shots;
    if (Array.isArray(value?.items)) return value.items;
    return [];
}

function absolutePath(rootPath, value) {
    if (!value) return '';
    const stringValue = String(value);
    if (stringValue.startsWith('/') || /^[A-Za-z]:[\\/]/.test(stringValue)) return stringValue;
    return joinPath(rootPath, stringValue);
}

function pickValue(record = {}, keys = []) {
    for (const key of keys) {
        if (record[key] !== undefined && record[key] !== null && String(record[key]).trim() !== '') return record[key];
    }
    return '';
}

function fileMetaForPath(rawReader, pathValue) {
    const absolute = absolutePath(rawReader.rootPath, pathValue);
    return (rawReader.files || []).find((file) => file.path === absolute || file.relative_path === pathValue) || null;
}

function fileUpdatedAt(rawReader, pathValue) {
    return fileMetaForPath(rawReader, pathValue)?.updated_at || '';
}

function filesMatching(rawReader, predicate) {
    return (rawReader.files || []).filter(predicate).map((file) => file.path);
}

function normalizeStoryboard(rawValue = []) {
    return arrayFromMaybe(rawValue).map((clip, index) => ({
        scene_id: clip.scene_id || clip.scene || `scene_${String(index + 1).padStart(2, '0')}`,
        clip_id: clip.clip_id || clip.id || `clip_${String(index + 1).padStart(3, '0')}`,
        duration: Number(clip.duration || clip.duration_seconds || 0),
        dramatic_beat: clip.dramatic_beat || clip.beat || '',
        characters: Array.isArray(clip.characters) ? clip.characters : String(clip.characters || '').split(',').map((item) => item.trim()).filter(Boolean),
        location: clip.location || '',
        first_frame: clip.first_frame || clip.firstFrame || '',
        action: clip.action || '',
        camera: clip.camera || '',
        lighting: clip.lighting || '',
        audio_sfx_dialogue: clip.audio_sfx_dialogue || clip.audio || clip.sfx || '',
        reference_dependencies: Array.isArray(clip.reference_dependencies) ? clip.reference_dependencies : [],
        risk: clip.risk || clip.continuity_risk || '',
        dominant_action: clip.dominant_action || clip.action || '',
        dominant_camera_strategy: clip.dominant_camera_strategy || clip.camera || '',
    }));
}

function normalizeMotionBoard(rawValue = []) {
    return arrayFromMaybe(rawValue).map((shot) => ({
        clip_id: shot.clip_id || shot.id || '',
        shot_size: shot.shot_size || shot.size || '',
        camera_movement: shot.camera_movement || shot.camera || '',
        movement_risk: shot.movement_risk || '',
        identity_risk: shot.identity_risk || '',
        continuity_notes: shot.continuity_notes || shot.notes || '',
        duration_lock: shot.duration_lock === true || shot.duration_lock === 'true',
    }));
}

function normalizeDashboardAssets(rawReader, rootPath) {
    const dashboardValue = rawReader.parsed?.imageDashboard?.value;
    const dashboardItems = arrayFromMaybe(dashboardValue?.assets || dashboardValue);
    if (dashboardItems.length) {
        return dashboardItems.map((asset, index) => {
            const assetPath = absolutePath(rootPath, asset.path || asset.file_path || asset.image_path || '');
            const promptPath = absolutePath(rootPath, asset.prompt_path || '');
            const reviewPath = absolutePath(rootPath, asset.review_path || '');
            return {
                asset_id: asset.asset_id || asset.id || `asset_${String(index + 1).padStart(3, '0')}`,
                path: assetPath,
                type: asset.type || 'reference',
                target_clip_id: asset.target_clip_id || asset.clip_id || asset.target_shot || '',
                prompt_path: promptPath,
                review_path: reviewPath,
                review_verdict: asset.review_verdict || asset.verdict || 'UNREVIEWED',
                video_use_status: asset.video_use_status || '',
                continuity_notes: asset.continuity_notes || asset.notes || '',
                retry_notes: asset.retry_notes || '',
                explicit_exception: asset.explicit_exception === true || asset.exception_approved === true,
                exception_approved: asset.exception_approved === true,
                updated_at: asset.updated_at || fileUpdatedAt(rawReader, assetPath),
                file_updated_at: fileUpdatedAt(rawReader, assetPath),
                prompt_updated_at: fileUpdatedAt(rawReader, promptPath),
                review_updated_at: fileUpdatedAt(rawReader, reviewPath),
            };
        });
    }

    return (rawReader.files || [])
        .filter((file) => ['.png', '.jpg', '.jpeg', '.webp', '.gif'].includes(file.extension))
        .map((file, index) => ({
            asset_id: `asset_${String(index + 1).padStart(3, '0')}`,
            path: file.path,
            type: 'reference',
            target_clip_id: '',
            prompt_path: '',
            review_path: '',
            review_verdict: 'UNREVIEWED',
            video_use_status: 'file_exists_not_reviewed',
            continuity_notes: '',
            retry_notes: '',
            updated_at: file.updated_at,
            file_updated_at: file.updated_at,
            prompt_updated_at: '',
            review_updated_at: '',
            source_relative_path: file.relative_path,
            root_path: rootPath,
        }));
}

function normalizePromptPacks(rawReader) {
    return (rawReader.files || [])
        .filter((file) => file.extension === '.md' && /(^|\/)prompts?\//.test(file.relative_path))
        .map((file, index) => ({
            clip_id: '',
            generator: file.relative_path.includes('flow') ? 'flow_omni' : 'seedance_dreamina',
            prompt_path: file.path,
            model: '',
            aspect_ratio: '',
            duration: 0,
            no_bgm_required: true,
            negative_constraints: [],
            attached_assets: [],
            review_status: 'UNREVIEWED',
            source_relative_path: file.relative_path,
            prompt_id: `prompt_${String(index + 1).padStart(3, '0')}`,
        }));
}

function normalizeAcceptedSeconds(rawReader) {
    const rows = rawReader.parsed?.acceptedSeconds?.records || [];
    return rows.map((row) => ({
        clip_id: pickValue(row, ['clip_id', 'clip', 'Clip', 'Clip ID', 'clip id']),
        source_file: absolutePath(rawReader.rootPath, pickValue(row, ['source_file', 'file', 'Source', 'Source file', 'source file'])),
        in_time: Number(pickValue(row, ['in_time', 'in', 'In', 'In time', 'in time']) || 0),
        out_time: Number(pickValue(row, ['out_time', 'out', 'Out', 'Out time', 'out time']) || 0),
        reason: pickValue(row, ['reason', 'Reason']),
        reviewer_confidence: pickValue(row, ['reviewer_confidence', 'confidence', 'Confidence', 'Reviewer confidence', 'reviewer confidence']),
        whole_clip_accepted: false,
    }));
}

function normalizeSubmitRecords(rawReader) {
    return (rawReader.parsed?.submitRecords?.records || []).map((record) => ({
        clip_id: record.clip_id || '',
        subcommand: record.subcommand || '',
        requested_model: record.requested_model || '',
        submitted_cli_model: record.submitted_cli_model || record.backend_model || '',
        submit_id: record.submit_id || '',
        logid: record.logid || '',
        credit_count: Number(record.credit_count || 0),
        status: record.status || '',
        next_heartbeat_at: record.next_heartbeat_at || '',
        download_dir: absolutePath(rawReader.rootPath, record.download_dir || ''),
        command_log_path: absolutePath(rawReader.rootPath, record.command_log_path || ''),
        downloaded: record.downloaded === true,
    }));
}

function normalizeHeartbeatRecords(rawReader) {
    return (rawReader.parsed?.heartbeatLog?.records || []).map((record) => ({
        checked_at: record.checked_at || '',
        submit_id: record.submit_id || '',
        clip_id: record.clip_id || '',
        queue_status: record.queue_status || '',
        gen_status: record.gen_status || '',
        backend_benefit_type: record.backend_benefit_type || '',
        backend_queue_debug: record.backend_queue_debug || '',
        downloaded_files: Array.isArray(record.downloaded_files) ? record.downloaded_files.map((file) => absolutePath(rawReader.rootPath, file)) : [],
        next_heartbeat_at: record.next_heartbeat_at || '',
        blocker: record.blocker || '',
    }));
}

function normalizeQaRecords(rawReader, storyboard) {
    const qaFiles = (rawReader.files || []).filter((file) => /(^|\/)qa\//.test(file.relative_path));
    const frameReviewPaths = filesMatching(rawReader, (file) => /(^|\/)reviews?\//.test(file.relative_path) && /frame|gemini/i.test(file.name));
    const videoReviewPaths = filesMatching(rawReader, (file) => /(^|\/)reviews?\//.test(file.relative_path) && /video|clip|qa/i.test(file.name));
    if (!storyboard.length && !qaFiles.length && !frameReviewPaths.length && !videoReviewPaths.length) return [];
    return (storyboard.length ? storyboard : [{ clip_id: '' }]).map((clip) => ({
        clip_id: clip.clip_id,
        file_path: '',
        valid_video: false,
        duration_ok: false,
        aspect_ratio_ok: false,
        identity_ok: false,
        first_frame_respected: false,
        camera_ok: false,
        no_subtitles_or_watermarks: false,
        no_background_music: false,
        dialogue_ok: false,
        continuity_ok: false,
        no_ui_text: false,
        gemini_frame_review_path: frameReviewPaths.find((filePath) => !clip.clip_id || filePath.includes(clip.clip_id)) || frameReviewPaths[0] || '',
        video_review_path: videoReviewPaths.find((filePath) => !clip.clip_id || filePath.includes(clip.clip_id)) || videoReviewPaths[0] || '',
        verdict: 'UNREVIEWED',
    }));
}

function normalizeCost(rawReader) {
    const jsonl = rawReader.parsed?.costLedgerJsonl?.records || [];
    const csv = rawReader.parsed?.ledgerCsv?.records || [];
    return [...jsonl, ...csv].reduce((sum, record) => {
        const value = Number(record.credit_count || record.credits || record.cost || 0);
        return Number.isFinite(value) ? sum + value : sum;
    }, 0);
}

function buildReviewGates(rawReader, blockers, imageDashboard, promptPacks, acceptedSeconds) {
    const dashboardParsed = imageDashboard?.parsed === true;
    const promptReviewed = promptPacks.some((pack) => pack.review_status === 'PASS');
    const accepted = acceptedSeconds.some((record) => record.source_file && record.out_time > record.in_time);
    const gate = (type, status, blocker = '', evidence_path = '', notes = '') => ({
        gate_id: `reader_${type}`,
        clip_id: '',
        type,
        status,
        evidence_path,
        blocker,
        notes,
    });

    return [
        gate('image_prompt', promptPacks.length ? 'UNREVIEWED' : 'BLOCK', promptPacks.length ? '' : BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED, promptPacks[0]?.prompt_path || '', 'Prompt file presence is separate from review pass.'),
        gate('image_qa', 'UNREVIEWED', BLOCKERS.IMAGE_GEMINI_REVIEW_REQUIRED, '', 'Image review evidence is not inferred from file presence.'),
        gate('dashboard', dashboardParsed ? 'PASS' : 'BLOCK', dashboardParsed ? '' : BLOCKERS.MISSING_IMAGE_DASHBOARD, imageDashboard?.path || '', 'Dashboard parse status only.'),
        gate('prompt_media', promptReviewed ? 'PASS' : 'UNREVIEWED', promptReviewed ? '' : BLOCKERS.GEMINI_REVIEW_BLOCKED, '', 'Prompt/media review is not assumed from prompt file presence.'),
        gate('preflight', blockers.length ? 'BLOCK' : 'UNREVIEWED', blockers[0] || '', '', 'Reader import does not authorize submit.'),
        gate('submit_confirmation', 'BLOCK', BLOCKERS.CREDIT_CONFIRMATION_REQUIRED, '', 'Credit confirmation is never inferred from imported files.'),
        gate('frame_qa', 'UNREVIEWED', BLOCKERS.FRAME_EXTRACTION_BLOCKED, '', 'Frame QA must be recorded explicitly.'),
        gate('accepted_seconds', accepted ? 'PASS' : 'BLOCK', accepted ? '' : BLOCKERS.MISSING_ACCEPTED_SECONDS, rawReader.parsed?.acceptedSeconds?.path || '', 'Accepted seconds must be parsed from markdown.'),
    ];
}

function fileStatus(rawReader) {
    const parsedRecords = Object.values(rawReader.parsed || {}).filter((record) => record?.parsed === true).length;
    const markdownExists = Object.values(rawReader.markdown || {}).filter((record) => record?.exists === true).length;
    const dashboardAssets = arrayFromMaybe(rawReader.parsed?.imageDashboard?.value?.assets || rawReader.parsed?.imageDashboard?.value);
    const acceptedRows = rawReader.parsed?.acceptedSeconds?.records || [];
    return {
        files_found: rawReader.files?.length || 0,
        markdown_exists: markdownExists,
        content_parsed: parsedRecords,
        review_passed: dashboardAssets.filter((asset) => ['PASS', 'pass'].includes(asset.review_verdict || asset.verdict)).length,
        quality_accepted: acceptedRows.filter((row) => {
            const sourceFile = row.source_file || row.file || row.Source || '';
            const inTime = Number(row.in_time || row.in || row.In || 0);
            const outTime = Number(row.out_time || row.out || row.Out || 0);
            return sourceFile && outTime > inTime;
        }).length,
    };
}

export function normalizeProductionReaderState(rawReader) {
    if (!rawReader || !rawReader.rootPath) return null;

    const rootPath = rawReader.rootPath;
    const markdown = rawReader.markdown || {};
    const storyboard = normalizeStoryboard(rawReader.parsed?.storyboardJson?.value);
    const motionBoard = normalizeMotionBoard(rawReader.parsed?.motionBoardJson?.value);
    const assets = normalizeDashboardAssets(rawReader, rootPath);
    const promptPacks = normalizePromptPacks(rawReader);
    const acceptedSeconds = normalizeAcceptedSeconds(rawReader);
    const submitRecords = normalizeSubmitRecords(rawReader);
    const heartbeatRecords = normalizeHeartbeatRecords(rawReader);
    const blockers = Array.from(new Set(rawReader.blockers || []));
    const finalVideoPath = joinPath(rootPath, rawReader.layout === 'A' ? 'final/final.mp4' : 'edit/final.mp4');
    const reportPath = rawReader.parsed?.report?.path || firstMarkdownPath(markdown, ['report', 'report.md']);
    const concatListPath = joinPath(rootPath, rawReader.layout === 'A' ? 'final/concat_list.txt' : 'edit/concat_list.txt');
    const finalVideoExists = rawReader.files?.some((file) => file.path === finalVideoPath) === true;
    const reportExists = Boolean(reportPath);
    const concatExists = rawReader.files?.some((file) => file.path === concatListPath) === true;
    const briefPath = firstMarkdownPath(markdown, ['brief', 'intake']);
    const scriptPath = firstMarkdownPath(markdown, ['script']);
    const title = firstMarkdownHeading(markdown, ['brief', 'intake', 'report']) || basename(rootPath) || 'Imported production';
    const qaArtifacts = {
        contactSheetPaths: (rawReader.files || []).filter((file) => /contact/i.test(file.name)).map((file) => file.path),
        frameSamplePaths: (rawReader.files || []).filter((file) => /(^|\/)(frames?|qa)\//.test(file.relative_path) && ['.jpg', '.jpeg', '.png', '.webp'].includes(file.extension)).map((file) => file.path),
        geminiFrameReviewPaths: filesMatching(rawReader, (file) => /(^|\/)reviews?\//.test(file.relative_path) && /frame|gemini/i.test(file.name)),
        videoReviewPaths: filesMatching(rawReader, (file) => /(^|\/)reviews?\//.test(file.relative_path) && /video|clip|qa/i.test(file.name)),
        ffprobePaths: filesMatching(rawReader, (file) => /ffprobe/i.test(file.name)),
        acceptedSecondsPath: rawReader.parsed?.acceptedSeconds?.path || '',
    };
    const ffprobePath = qaArtifacts.ffprobePaths[0] || `${finalVideoPath}.ffprobe.json`;
    const ffprobeExists = rawReader.files?.some((file) => file.path === ffprobePath) === true;

    const stateBlockers = [...blockers];
    if (!storyboard.length && !stateBlockers.includes(BLOCKERS.MISSING_STORYBOARD_CONTINUITY_PACKET)) {
        stateBlockers.push(BLOCKERS.MISSING_STORYBOARD_CONTINUITY_PACKET);
    }
    if (!motionBoard.length && !stateBlockers.includes(BLOCKERS.MISSING_MOTION_BOARD)) {
        stateBlockers.push(BLOCKERS.MISSING_MOTION_BOARD);
    }

    const imageDashboard = {
        path: rawReader.parsed?.imageDashboard?.path || '',
        updated_at: rawReader.parsed?.imageDashboard?.updated_at || rawReader.readAt,
        stale: false,
        parsed: rawReader.parsed?.imageDashboard?.parsed === true,
        exists: rawReader.parsed?.imageDashboard?.exists === true,
        error: rawReader.parsed?.imageDashboard?.error || '',
        assets,
    };
    const qaRecords = normalizeQaRecords(rawReader, storyboard);
    const reviewGates = buildReviewGates(rawReader, stateBlockers, rawReader.parsed?.imageDashboard, promptPacks, acceptedSeconds);

    return {
        project: {
            production_id: basename(rootPath),
            title,
            root_path: rootPath,
            route: rawReader.layout === 'A' ? 'seedance' : 'both',
            target_platform: '',
            aspect_ratio: '',
            status: stateBlockers.length ? 'partial_blocked' : 'imported',
            created_at: rawReader.readAt || nowIso(),
            updated_at: rawReader.readAt || nowIso(),
        },
        brief: {
            concept: markdown.brief?.heading || markdown.intake?.heading || '',
            logline: '',
            script_path: scriptPath,
            dialogue_required: false,
            subtitles_required: false,
            music_required: false,
            natural_sfx_required: false,
            stop_loss_rule: 'Imported production state: missing structured artifacts remain blockers, not success.',
        },
        storyboard,
        motionBoard,
        imageDashboard,
        assets,
        promptPacks,
        reviewGates,
        submitRecords,
        heartbeatRecords,
        qaRecords,
        acceptedSeconds,
        finalReport: {
            final_video_path: finalVideoPath,
            production_folder: rootPath,
            generator_route: rawReader.layout === 'A' ? 'seedance' : 'both',
            concat_list_path: concatListPath,
            ffprobe_verified: ffprobeExists,
            ffprobe_path: ffprobePath,
            report_path: reportPath,
            clip_table: storyboard.map((clip) => ({ clip_id: clip.clip_id, status: 'imported', accepted_seconds: 0 })),
            known_credits: normalizeCost(rawReader),
            heartbeat_history: heartbeatRecords,
            qa_result: qaRecords,
            residual_risks: stateBlockers,
            blockers: stateBlockers,
        },
        referenceMediaPaths: assets.map((asset) => asset.path).filter(Boolean),
        queueLedgers: {
            submit_records: rawReader.parsed?.submitRecords?.path || '',
            heartbeat_log: rawReader.parsed?.heartbeatLog?.path || '',
        },
        qaArtifacts,
        settings: {
            harnessDocs: {
                shorts: 'docs/harness/shorts-SKILL.md',
                seedance: 'docs/harness/Seedance2-SKILL.md',
            },
            dreaminaCliPath: '',
            flowOmniSetting: 'placeholder only',
            ffmpegPath: '',
            ffprobePath: '',
            modelDirectories: [],
        },
        fileEvidence: {
            [finalVideoPath]: finalVideoExists,
            [concatListPath]: concatExists,
            [reportPath]: reportExists,
            [ffprobePath]: ffprobeExists,
        },
        files: (rawReader.files || []).map((file) => file.path),
        fileStatus: fileStatus(rawReader),
        reader: rawReader,
        blockers: stateBlockers,
    };
}

export default normalizeProductionReaderState;
