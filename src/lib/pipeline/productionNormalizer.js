import { BLOCKERS } from './blockers.js';
import { basename, dirname, joinPath, looksSensitivePath, normalizeSlashes } from './filePathUtils.js';

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
    if (Array.isArray(value?.scenes)) return value.scenes;
    if (Array.isArray(value?.items)) return value.items;
    return [];
}

function structuralClipId(value, index = 0) {
    const match = String(value || '').match(/(?:scene|beat|shot|clip|씬|장면|비트)[\s_:#-]*(\d+)/i);
    return `clip_${String(match ? Number(match[1]) : index + 1).padStart(3, '0')}`;
}

function absolutePath(rootPath, value) {
    if (!value) return '';
    const stringValue = normalizeSlashes(String(value));
    if (looksSensitivePath(stringValue)) return '';
    const normalizedRoot = normalizeSlashes(rootPath).replace(/\/$/, '');
    const rawCandidate = stringValue.startsWith('/') || /^[A-Za-z]:\//.test(stringValue)
        ? stringValue
        : `${normalizedRoot}/${stringValue}`;
    const prefix = rawCandidate.startsWith('/') ? '/' : '';
    const segments = [];
    for (const segment of rawCandidate.split('/')) {
        if (!segment || segment === '.') continue;
        if (segment === '..') {
            segments.pop();
            continue;
        }
        segments.push(segment);
    }
    const candidate = `${prefix}${segments.join('/')}`;
    if (candidate !== normalizedRoot && !candidate.startsWith(`${normalizedRoot}/`)) return '';
    return candidate;
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
        dramatic_beat: clip.dramatic_beat || clip.beat || (clip.structural_only ? 'Structural scene evidence imported; narrative omitted.' : ''),
        characters: Array.isArray(clip.characters) ? clip.characters : String(clip.characters || '').split(',').map((item) => item.trim()).filter(Boolean),
        location: clip.location || (clip.structural_only ? 'Unresolved from structural evidence' : ''),
        first_frame: clip.first_frame || clip.firstFrame || (clip.structural_only ? 'Requires explicit first-frame evidence' : ''),
        action: clip.action || (clip.structural_only ? 'Requires narrative reconstruction' : ''),
        camera: clip.camera || (clip.structural_only ? 'Requires motion-board review' : ''),
        lighting: clip.lighting || (clip.structural_only ? 'Requires visual review' : ''),
        audio_sfx_dialogue: clip.audio_sfx_dialogue || clip.audio || clip.sfx || (clip.structural_only ? 'Requires audio review' : ''),
        reference_dependencies: Array.isArray(clip.reference_dependencies) ? clip.reference_dependencies : [],
        risk: clip.risk || clip.continuity_risk || (clip.structural_only ? 'Structure only; continuity not proven' : ''),
        dominant_action: clip.dominant_action || clip.action || (clip.structural_only ? 'Unresolved' : ''),
        dominant_camera_strategy: clip.dominant_camera_strategy || clip.camera || (clip.structural_only ? 'Unresolved' : ''),
        structural_only: clip.structural_only === true,
        source_relative_path: clip.source_relative_path || '',
    }));
}

function normalizeMotionBoard(rawValue = []) {
    return arrayFromMaybe(rawValue).map((shot) => ({
        clip_id: shot.clip_id || shot.id || '',
        shot_size: shot.shot_size || shot.size || (shot.structural_only ? 'unresolved' : ''),
        camera_movement: shot.camera_movement || shot.camera || (shot.structural_only ? 'requires review' : ''),
        movement_risk: shot.movement_risk || (shot.structural_only ? 'unreviewed' : ''),
        identity_risk: shot.identity_risk || (shot.structural_only ? 'unreviewed' : ''),
        continuity_notes: shot.continuity_notes || shot.notes || (shot.structural_only ? 'Structure only; continuity not proven.' : ''),
        duration_lock: shot.duration_lock === true || shot.duration_lock === 'true',
        structural_only: shot.structural_only === true,
        source_relative_path: shot.source_relative_path || '',
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
        .filter((file) => file.extension === '.md' && (/^seedance_prompts\.md$/i.test(file.relative_path) || /(^|\/)prompts?\//.test(file.relative_path)))
        .map((file, index) => ({
            clip_id: structuralClipId(file.name, index),
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
    const structured = rawReader.parsed?.submitRecords?.records || [];
    const canonical = rawReader.parsed?.submissionManifest?.records || [];
    const artifacts = rawReader.parsed?.submitArtifacts?.records || [];
    const canonicalState = rawReader.parsed?.jimengState?.value || {};
    const downloads = rawReader.parsed?.downloadManifest?.records || [];
    const canonicalRecords = canonical.length ? canonical : (canonicalState.submitted_indices || []).map((sceneIndex) => ({
        scene_index: sceneIndex,
        submit_id: canonicalState.submit_ids?.[String(sceneIndex)] || '',
        model: canonicalState.model || '',
    }));
    const records = [...structured, ...canonicalRecords, ...artifacts].map((record) => {
        const sceneIndex = Number.isSafeInteger(record.scene_index) ? record.scene_index : null;
        const download = sceneIndex === null ? null : downloads.find((candidate) => candidate.scene_index === sceneIndex);
        const downloadedByState = sceneIndex !== null && (canonicalState.downloaded_indices || []).includes(sceneIndex);
        const downloadedPath = absolutePath(rawReader.rootPath, download?.downloaded_paths?.[0] || '');
        return {
            clip_id: record.clip_id || record.shot_id || '',
            subcommand: record.subcommand || '',
            requested_model: record.requested_model || '',
            submitted_cli_model: record.submitted_cli_model || record.model || record.model_version || record.backend_model || canonicalState.model || 'unknown',
            submit_id: record.submit_id || '',
            logid: record.logid || '',
            credit_count: Number(record.credit_count || 0),
            status: record.status || record.gen_status || 'unknown',
            next_heartbeat_at: record.next_heartbeat_at || '',
            download_dir: absolutePath(rawReader.rootPath, record.download_dir || '') || dirname(downloadedPath),
            command_log_path: absolutePath(rawReader.rootPath, record.command_log_path || ''),
            downloaded: record.downloaded === true || downloadedByState || Boolean(download?.downloaded_paths?.length),
            source_relative_path: record.source_relative_path || (canonicalRecords.includes(record) ? 'submission_manifest.json' : ''),
            canonical_scene_index: sceneIndex,
        };
    });
    const seen = new Set();
    return records.filter((record) => {
        const key = record.submit_id
            ? `submit:${record.submit_id}`
            : record.canonical_scene_index !== null
                ? `scene:${record.canonical_scene_index}`
                : `clip:${record.clip_id}:${record.source_relative_path}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
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
    const storyboardSource = rawReader.parsed?.storyboardJson?.parsed
        ? rawReader.parsed.storyboardJson.value
        : rawReader.parsed?.storySceneBundle?.parsed
            ? rawReader.parsed.storySceneBundle.value
            : rawReader.parsed?.storyboardMarkdown?.records;
    const motionBoardSource = rawReader.parsed?.motionBoardJson?.parsed
        ? rawReader.parsed.motionBoardJson.value
        : rawReader.parsed?.motionBoardMarkdown?.records;
    const storyboard = normalizeStoryboard(storyboardSource);
    const motionBoard = normalizeMotionBoard(motionBoardSource);
    const assets = normalizeDashboardAssets(rawReader, rootPath);
    const promptPacks = normalizePromptPacks(rawReader);
    const acceptedSeconds = normalizeAcceptedSeconds(rawReader);
    const submitRecords = normalizeSubmitRecords(rawReader);
    const heartbeatRecords = normalizeHeartbeatRecords(rawReader);
    const blockers = Array.from(new Set(rawReader.blockers || []));
    const finalVideoPath = joinPath(rootPath, rawReader.layout === 'A' ? 'final/final.mp4' : 'edit/final.mp4');
    const reportPath = rawReader.parsed?.report?.path || rawReader.parsed?.capcutReport?.path || firstMarkdownPath(markdown, ['report', 'report.md']);
    const concatListPath = joinPath(rootPath, rawReader.layout === 'A' ? 'final/concat_list.txt' : 'edit/concat_list.txt');
    const finalVideoExists = rawReader.files?.some((file) => file.path === finalVideoPath) === true;
    const reportExists = Boolean(reportPath);
    const concatExists = rawReader.files?.some((file) => file.path === concatListPath) === true;
    const briefPath = firstMarkdownPath(markdown, ['brief', 'intake', 'script']);
    const scriptPath = firstMarkdownPath(markdown, ['script']) || rawReader.parsed?.storySceneBundle?.path || '';
    const title = firstMarkdownHeading(markdown, ['brief', 'intake', 'report']) || basename(rootPath) || 'Imported production';
    const hasSummaryBrief = Boolean(markdown.brief || markdown.intake);
    const structuralBrief = !hasSummaryBrief && Boolean(markdown.script);
    const sceneBundle = rawReader.parsed?.storySceneBundle?.value || {};
    const pipelinePackReport = rawReader.parsed?.pipelinePackReport?.value || {};
    const canonicalRoute = ({ seedance: 'seedance', flow: 'flow_omni', both: 'both' })[pipelinePackReport.target_generator] || '';
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
            route: canonicalRoute || (rawReader.layout === 'A' || rawReader.variant === 'gangnam_scene_bundle' ? 'seedance' : 'both'),
            target_platform: '',
            aspect_ratio: sceneBundle.aspect_ratio || '',
            status: stateBlockers.length ? 'partial_blocked' : 'imported',
            created_at: rawReader.readAt || nowIso(),
            updated_at: rawReader.readAt || nowIso(),
        },
        brief: {
            concept: markdown.brief?.metadata?.concept || markdown.intake?.metadata?.concept || markdown.brief?.heading || markdown.intake?.heading || (structuralBrief ? 'Imported script structure' : ''),
            logline: markdown.brief?.metadata?.logline || markdown.intake?.metadata?.logline || (hasSummaryBrief ? 'A summary artifact is present; narrative content was not copied.' : structuralBrief ? 'A script artifact is present; narrative content was not copied.' : ''),
            script_path: scriptPath,
            dialogue_required: false,
            subtitles_required: false,
            music_required: false,
            natural_sfx_required: false,
            stop_loss_rule: 'Imported production state: missing structured artifacts remain blockers, not success.',
            structural_only: structuralBrief,
            source_path: briefPath,
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
            generator_route: canonicalRoute || (rawReader.layout === 'A' || rawReader.variant === 'gangnam_scene_bundle' ? 'seedance' : 'both'),
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
            submit_records: rawReader.parsed?.submitRecords?.path || rawReader.parsed?.submissionManifest?.path || '',
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
        canonicalHandoff: {
            contract: rawReader.canonical?.contract || '',
            pipeline_pack_report_path: rawReader.parsed?.pipelinePackReport?.path || '',
            submission_manifest_path: rawReader.parsed?.submissionManifest?.path || '',
            jimeng_state_path: rawReader.parsed?.jimengState?.path || '',
            download_manifest_path: rawReader.parsed?.downloadManifest?.path || '',
            inconsistencies: rawReader.canonical?.inconsistencies || [],
            validation_input_ready: rawReader.parsed?.pipelinePackReport?.parsed === true
                && rawReader.markdown?.intake?.exists === true
                && rawReader.markdown?.script?.exists === true
                && (rawReader.canonical?.inconsistencies || []).length === 0,
            final_ready: false,
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
