const fs = require('fs');
const path = require('path');

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_CANONICAL_JSON_BYTES = 512 * 1024;
const MAX_CANONICAL_RECORDS = 1000;
const MAX_WALK_FILES = 1200;
const MAX_WALK_DEPTH = 8;

const BLOCKERS = Object.freeze({
    MISSING_PRODUCTION_BRIEF: 'MISSING_PRODUCTION_BRIEF',
    MISSING_STORYBOARD_CONTINUITY_PACKET: 'MISSING_STORYBOARD_CONTINUITY_PACKET',
    MISSING_MOTION_BOARD: 'MISSING_MOTION_BOARD',
    MISSING_IMAGE_DASHBOARD: 'MISSING_IMAGE_DASHBOARD',
    MISSING_ACCEPTED_SECONDS: 'MISSING_ACCEPTED_SECONDS',
    OUTPUT_QUALITY_NOT_PROVEN: 'OUTPUT_QUALITY_NOT_PROVEN',
});

const SENSITIVE_NAME_PATTERNS = [
    /cookie/i,
    /browser[-_ ]?profile/i,
    /auth[-_ ]?bundle/i,
    /session[-_ ]?(zip|bundle|profile)?/i,
    /token/i,
    /secret/i,
    /credential/i,
    /api[-_ ]?key/i,
    /private[-_ ]?key/i,
    /^\.env(?:\.|$)/i,
    /^id_rsa(?:\.|$)/i,
];

function isSensitiveName(name) {
    return SENSITIVE_NAME_PATTERNS.some((pattern) => pattern.test(name)) || name.toLowerCase().endsWith('.zip');
}

function assertDirectory(rootPath) {
    if (typeof rootPath !== 'string' || !rootPath.trim()) {
        throw new Error('rootPath must be a non-empty string');
    }
    const absolute = path.resolve(rootPath);
    let stats;
    try {
        stats = fs.lstatSync(absolute);
    } catch {
        stats = null;
    }
    if (!stats?.isDirectory() || stats.isSymbolicLink()) {
        throw new Error(`Production folder does not exist: ${absolute}`);
    }
    if (isSensitiveName(path.basename(absolute))) {
        throw new Error('Production folder rejected by safety policy');
    }
    return absolute;
}

function existsFile(filePath) {
    try {
        const stats = fs.lstatSync(filePath);
        return stats.isFile() && !stats.isSymbolicLink();
    } catch {
        return false;
    }
}

function existsDir(dirPath) {
    try {
        const stats = fs.lstatSync(dirPath);
        return stats.isDirectory() && !stats.isSymbolicLink();
    } catch {
        return false;
    }
}

function safeRelative(root, filePath) {
    return path.relative(root, filePath);
}

function isWithinRoot(root, filePath) {
    const relative = safeRelative(root, filePath);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

function safeReadText(filePath, maxBytes = MAX_TEXT_BYTES) {
    const stats = fs.statSync(filePath);
    if (stats.size > maxBytes) {
        return { ok: false, error: `file too large: ${stats.size} bytes` };
    }
    return { ok: true, content: fs.readFileSync(filePath, 'utf8') };
}

function markdownRecord(root, filePath, label) {
    if (!filePath || !isWithinRoot(root, filePath) || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
        return null;
    }
    const stats = fs.statSync(filePath);
    const read = safeReadText(filePath);
    const lines = read.ok ? read.content.split(/\r?\n/) : [];
    const heading = lines.find((line) => /^#{1,3}\s+/.test(line.trim()))?.replace(/^#{1,3}\s+/, '').trim() || '';
    const metadata = {};
    for (const line of lines) {
        const match = line.match(/^\s*(concept|logline)\s*:\s*(.+?)\s*$/i);
        if (match) metadata[match[1].toLowerCase()] = match[2];
    }
    return {
        label,
        path: filePath,
        relative_path: safeRelative(root, filePath),
        exists: true,
        parsed: read.ok,
        heading,
        metadata,
        line_count: read.ok ? read.content.split(/\r?\n/).length : 0,
        updated_at: stats.mtime.toISOString(),
        error: read.ok ? '' : read.error,
    };
}

function walkFiles(root, options = {}) {
    const files = [];
    const maxDepth = options.maxDepth ?? MAX_WALK_DEPTH;
    const maxFiles = options.maxFiles ?? MAX_WALK_FILES;
    const skipped = {
        sensitive_name: 0,
        ignored_directory: 0,
        symlink: 0,
        unsupported_entry: 0,
        root_escape: 0,
        depth_limit: 0,
        file_limit: 0,
        read_error: 0,
    };
    const errors = [];
    let truncated = false;

    function walk(dir, depth) {
        if (files.length >= maxFiles) {
            truncated = true;
            skipped.file_limit += 1;
            return;
        }
        if (depth > maxDepth) {
            truncated = true;
            skipped.depth_limit += 1;
            return;
        }
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            skipped.read_error += 1;
            errors.push({ relative_path: safeRelative(root, dir), code: error.code || 'READ_ERROR' });
            return;
        }
        for (const entry of entries) {
            if (files.length >= maxFiles) {
                truncated = true;
                skipped.file_limit += 1;
                break;
            }
            if (entry.name === '.git' || entry.name === 'node_modules') {
                skipped.ignored_directory += 1;
                continue;
            }
            if (isSensitiveName(entry.name)) {
                skipped.sensitive_name += 1;
                continue;
            }
            const fullPath = path.join(dir, entry.name);
            if (!isWithinRoot(root, fullPath)) {
                skipped.root_escape += 1;
                continue;
            }
            if (entry.isSymbolicLink()) {
                skipped.symlink += 1;
                continue;
            }
            if (entry.isDirectory()) {
                walk(fullPath, depth + 1);
                continue;
            }
            if (!entry.isFile()) {
                skipped.unsupported_entry += 1;
                continue;
            }
            let stats;
            try {
                stats = fs.lstatSync(fullPath);
            } catch (error) {
                skipped.read_error += 1;
                errors.push({ relative_path: safeRelative(root, fullPath), code: error.code || 'READ_ERROR' });
                continue;
            }
            files.push({
                path: fullPath,
                relative_path: safeRelative(root, fullPath),
                name: entry.name,
                extension: path.extname(entry.name).toLowerCase(),
                size: stats.size,
                updated_at: stats.mtime.toISOString(),
            });
        }
    }

    walk(root, 0);
    return { files, skipped, truncated, errors, maxDepth, maxFiles };
}

function findFirst(root, relativeCandidates) {
    for (const relativePath of relativeCandidates) {
        const filePath = path.join(root, relativePath);
        if (existsFile(filePath) && !isSensitiveName(path.basename(filePath))) return filePath;
    }
    return null;
}

function findByName(files, names) {
    const wanted = new Set(names);
    return files.find((file) => wanted.has(file.name))?.path || null;
}

function parseJsonFile(root, filePath, label) {
    if (!filePath || !isWithinRoot(root, filePath) || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
        return { label, path: '', exists: false, parsed: false, value: null, error: 'missing' };
    }
    const read = safeReadText(filePath);
    const stats = fs.statSync(filePath);
    if (!read.ok) {
        return { label, path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, value: null, updated_at: stats.mtime.toISOString(), error: read.error };
    }
    try {
        return {
            label,
            path: filePath,
            relative_path: safeRelative(root, filePath),
            exists: true,
            parsed: true,
            value: JSON.parse(read.content),
            updated_at: stats.mtime.toISOString(),
            error: '',
        };
    } catch (error) {
        return {
            label,
            path: filePath,
            relative_path: safeRelative(root, filePath),
            exists: true,
            parsed: false,
            value: null,
            updated_at: stats.mtime.toISOString(),
            error: error.message,
        };
    }
}

function safeToken(value, maxLength = 160) {
    if (typeof value !== 'string' || value.length > maxLength) return '';
    return /^[A-Za-z0-9_.:@/+\-]*$/.test(value) ? value : '';
}

function safeInteger(value) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function safeBoolean(value) {
    return typeof value === 'boolean' ? value : null;
}

function safeFiniteNumber(value, minimum = -Infinity, maximum = Infinity) {
    return typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
        ? value
        : null;
}

function safeCanonicalPath(root, value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048 || value.includes('\0')
        || value.split(/[\\/]/).some((component) => isSensitiveName(component))) return '';
    const candidate = path.isAbsolute(value) ? path.normalize(value) : path.resolve(root, value);
    return isWithinRoot(root, candidate) ? candidate : '';
}

function canonicalSourceFileEvidence(root, value) {
    const candidate = safeCanonicalPath(root, value);
    if (!candidate || candidate === root) {
        return { path: '', exists: false, reason: 'unsafe_source_path' };
    }

    const relative = safeRelative(root, candidate);
    let cursor = root;
    const components = relative.split(path.sep).filter(Boolean);
    for (let index = 0; index < components.length; index += 1) {
        cursor = path.join(cursor, components[index]);
        let stats;
        try {
            stats = fs.lstatSync(cursor);
        } catch {
            return { path: candidate, exists: false, reason: 'missing_source_file' };
        }
        if (stats.isSymbolicLink()) {
            return { path: '', exists: false, reason: 'symlink_source_path' };
        }
        if (index < components.length - 1 && !stats.isDirectory()) {
            return { path: candidate, exists: false, reason: 'non_directory_source_parent' };
        }
        if (index === components.length - 1 && !stats.isFile()) {
            return { path: candidate, exists: false, reason: 'non_regular_source_file' };
        }
    }

    return { path: candidate, exists: true, reason: '' };
}

function parseCanonicalJson(root, relativePath, label, sanitize) {
    const filePath = path.join(root, relativePath);
    let stats;
    try {
        stats = fs.lstatSync(filePath);
    } catch {
        return { label, path: '', relative_path: relativePath, exists: false, parsed: false, value: null, records: [], error: 'missing' };
    }
    if (stats.isSymbolicLink() || !stats.isFile()) {
        return { label, path: filePath, relative_path: relativePath, exists: true, parsed: false, value: null, records: [], updated_at: stats.mtime.toISOString(), error: 'not a non-symlink regular file' };
    }
    const read = safeReadText(filePath, MAX_CANONICAL_JSON_BYTES);
    const base = {
        label,
        path: filePath,
        relative_path: relativePath,
        exists: true,
        parsed: false,
        value: null,
        records: [],
        updated_at: stats.mtime.toISOString(),
    };
    if (!read.ok) return { ...base, error: read.error };
    try {
        const sanitized = sanitize(JSON.parse(read.content));
        return { ...base, ...sanitized, parsed: true, error: '' };
    } catch (error) {
        return { ...base, error: error.message };
    }
}

function sanitizePipelinePackReport(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('pipeline pack report must be an object');
    const sceneCount = safeInteger(value.scene_count);
    return {
        value: {
            pack_contract_version: safeToken(value.pack_contract_version),
            canonical_production_id: safeToken(value.canonical_production_id),
            target_generator: safeToken(value.target_generator),
            image_provider: safeToken(value.image_provider),
            video_element_mode: safeToken(value.video_element_mode),
            plan_only_status: safeToken(value.plan_only_status),
            scene_count: sceneCount,
            actual_generation_submitted: safeBoolean(value.actual_generation_submitted),
            common_ir_enabled: safeBoolean(value.common_ir_enabled),
        },
        records: [],
    };
}

function sanitizeSubmissionManifest(value) {
    if (!Array.isArray(value)) throw new Error('submission manifest must be an array');
    if (value.length > MAX_CANONICAL_RECORDS) throw new Error(`submission manifest exceeds ${MAX_CANONICAL_RECORDS} records`);
    const records = value.map((record) => {
        if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('submission manifest entry must be an object');
        return {
            scene_index: safeInteger(record.scene_index),
            segment_index: safeInteger(record.segment_index),
            clip_id: safeToken(record.clip_id),
            shot_id: safeToken(record.shot_id),
            status: safeToken(record.status),
            gen_status: safeToken(record.gen_status),
            submitted_cli_model: safeToken(record.submitted_cli_model),
            model: safeToken(record.model),
            model_version: safeToken(record.model_version),
            submit_id: safeToken(record.submit_id),
            provider: safeToken(record.provider),
            next_heartbeat_at: safeToken(record.next_heartbeat_at),
        };
    });
    return { value: null, records };
}

function sanitizeJimengState(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('jimeng state must be an object');
    const indexArray = (key) => {
        if (value[key] === undefined) return [];
        if (!Array.isArray(value[key]) || value[key].length > MAX_CANONICAL_RECORDS) throw new Error(`${key} must be a bounded array`);
        return value[key].map(safeInteger).filter((item) => item !== null);
    };
    const rawSubmitIds = value.submit_ids;
    if (rawSubmitIds !== undefined && (!rawSubmitIds || typeof rawSubmitIds !== 'object' || Array.isArray(rawSubmitIds))) {
        throw new Error('submit_ids must be an object');
    }
    const submitIds = Object.fromEntries(Object.entries(rawSubmitIds || {})
        .filter(([key]) => /^\d{1,6}$/.test(key))
        .slice(0, MAX_CANONICAL_RECORDS)
        .map(([key, submitId]) => [key, safeToken(submitId)]));
    return {
        value: {
            provider: safeToken(value.provider),
            model: safeToken(value.model),
            submitted_at: safeToken(value.submitted_at),
            last_poll_at: safeToken(value.last_poll_at),
            submitted_indices: indexArray('submitted_indices'),
            completed_indices: indexArray('completed_indices'),
            downloaded_indices: indexArray('downloaded_indices'),
            failed_indices: indexArray('failed_indices'),
            submit_ids: submitIds,
        },
        records: [],
    };
}

function sanitizeDownloadManifest(root, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('download manifest must be an object');
    const entries = Object.entries(value);
    if (entries.length > MAX_CANONICAL_RECORDS) throw new Error(`download manifest exceeds ${MAX_CANONICAL_RECORDS} records`);
    return {
        value: null,
        records: entries.map(([sceneKey, record]) => {
            if (!/^\d{1,6}$/.test(sceneKey) || !record || typeof record !== 'object' || Array.isArray(record)) {
                throw new Error('download manifest entry is malformed');
            }
            const rawPaths = Array.isArray(record.downloaded_paths) ? record.downloaded_paths : [];
            return {
                scene_index: Number(sceneKey),
                submit_id: safeToken(record.submit_id),
                provider: safeToken(record.provider),
                downloaded_at: safeToken(record.downloaded_at),
                downloaded_paths: rawPaths.slice(0, 20).map((candidate) => safeCanonicalPath(root, candidate)).filter(Boolean),
            };
        }),
    };
}

function sanitizeShotManifest(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shot manifest must be an object');
    if (!Array.isArray(value.shots)) throw new Error('shot manifest shots must be an array');
    if (value.shots.length > MAX_CANONICAL_RECORDS) throw new Error(`shot manifest exceeds ${MAX_CANONICAL_RECORDS} records`);

    const issues = [];
    const seen = new Set();
    const records = value.shots.map((shot, index) => {
        if (!shot || typeof shot !== 'object' || Array.isArray(shot)) throw new Error('shot manifest entry must be an object');
        const shotId = safeToken(shot.shot_id);
        if (!shotId) issues.push(`shot_manifest:invalid_shot_id:${index}`);
        if (shotId && seen.has(shotId)) issues.push(`shot_manifest:duplicate_shot_id:${shotId}`);
        if (shotId) seen.add(shotId);
        return { shot_id: shotId };
    });
    const schemaVersion = safeToken(value.schema_version);
    const projectId = safeToken(value.project_id);
    const episodeId = safeToken(value.episode_id);
    if (schemaVersion !== 'short-drama-room-shot-manifest-v1' || !projectId || !episodeId) {
        issues.push('shot_manifest:required_metadata_invalid');
    }
    if (!records.length) issues.push('shot_manifest:empty');
    return {
        value: {
            schema_version: schemaVersion,
            project_id: projectId,
            episode_id: episodeId,
            shot_count: records.length,
        },
        records,
        issues,
    };
}

function sanitizeSelectedTakes(root, value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('selected takes must be an object');
    if (!Array.isArray(value.takes)) throw new Error('selected takes must contain a takes array');
    if (value.takes.length > MAX_CANONICAL_RECORDS) throw new Error(`selected takes exceeds ${MAX_CANONICAL_RECORDS} records`);

    const issues = [];
    if (!Object.keys(value).every((key) => ['schema_version', 'project_id', 'episode_id', 'takes'].includes(key))) {
        issues.push('selected_takes:unexpected_top_level_fields');
    }
    const seen = new Set();
    const records = value.takes.map((take, index) => {
        if (!take || typeof take !== 'object' || Array.isArray(take)) throw new Error('selected take entry must be an object');
        const allowedFields = new Set([
            'shot_id', 'chosen_provider', 'video_path', 'dialogue_source', 'qc_report_ref', 'selected_at',
            'beat_id', 'take_id', 'source_in_sec', 'source_out_sec', 'transition_in',
        ]);
        const shotId = safeToken(take.shot_id);
        const beatId = safeToken(take.beat_id);
        const takeId = safeToken(take.take_id);
        const provider = ['seedance', 'flow'].includes(take.chosen_provider) ? take.chosen_provider : '';
        const sourceIn = safeFiniteNumber(take.source_in_sec, 0);
        const sourceOut = safeFiniteNumber(take.source_out_sec, 0);
        const source = canonicalSourceFileEvidence(root, take.video_path);
        const transition = take.transition_in;
        const transitionObject = transition === null || transition === undefined
            ? null
            : (!transition || typeof transition !== 'object' || Array.isArray(transition) ? undefined : transition);
        const transitionType = transitionObject === null ? '' : ['cut', 'crossfade', 'dip_black'].includes(transitionObject?.type) ? transitionObject.type : '';
        const transitionDuration = transitionObject === null ? null : safeFiniteNumber(transitionObject?.dur, 0);
        const transitionValid = transitionObject !== undefined
            && (transitionObject === null
                || (transitionType && transitionDuration !== null
                    && Object.keys(transitionObject).every((key) => ['type', 'dur'].includes(key))));
        const rangeValid = sourceIn !== null && sourceOut !== null && sourceOut > sourceIn;
        const hiddenContractFieldsValid = ['native_video_lipsync', 'tts_adr_overlay'].includes(take.dialogue_source)
            && Boolean(safeToken(take.qc_report_ref))
            && Boolean(safeToken(take.selected_at));

        if (!Object.keys(take).every((key) => allowedFields.has(key))) issues.push(`selected_takes:unexpected_fields:${index}`);
        if (!shotId || !beatId || !takeId) issues.push(`selected_takes:invalid_identifiers:${index}`);
        if (shotId && seen.has(shotId)) issues.push(`selected_takes:duplicate_shot_id:${shotId}`);
        if (shotId) seen.add(shotId);
        if (!provider) issues.push(`selected_takes:invalid_provider:${index}`);
        if (!rangeValid) issues.push(`selected_takes:invalid_range:${index}`);
        if (!transitionValid) issues.push(`selected_takes:invalid_transition:${index}`);
        if (!hiddenContractFieldsValid) issues.push(`selected_takes:invalid_hidden_contract_fields:${index}`);
        if (source.reason) issues.push(`selected_takes:${source.reason}:${index}`);

        return {
            shot_id: shotId,
            beat_id: beatId,
            take_id: takeId,
            provider,
            video_path: source.path,
            source_in_sec: sourceIn,
            source_out_sec: sourceOut,
            transition_type: transitionType,
            transition_duration_sec: transitionDuration,
            source_exists: source.exists,
            source_reason: source.reason,
            range_valid: rangeValid,
            record_ready: Boolean(shotId && beatId && takeId && provider && rangeValid && transitionValid
                && hiddenContractFieldsValid && source.exists),
            provenance: 'selected_takes.json',
        };
    });
    const schemaVersion = safeToken(value.schema_version);
    const projectId = safeToken(value.project_id);
    const episodeId = safeToken(value.episode_id);
    if (schemaVersion !== 'short-drama-room-selected-takes-v1' || !projectId || !episodeId) {
        issues.push('selected_takes:required_metadata_invalid');
    }
    if (!records.length) issues.push('selected_takes:empty');
    return {
        value: {
            schema_version: schemaVersion,
            project_id: projectId,
            episode_id: episodeId,
            take_count: records.length,
            source_ready_count: records.filter((record) => record.record_ready).length,
        },
        records,
        issues,
    };
}

function sanitizeQcReport(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('qc report must be an object');
    if (!Array.isArray(value.shot_qc)) throw new Error('qc report must contain a shot_qc array');
    if (value.shot_qc.length > MAX_CANONICAL_RECORDS) throw new Error(`qc report exceeds ${MAX_CANONICAL_RECORDS} records`);

    const issues = [];
    if (!Object.keys(value).every((key) => ['schema_version', 'project_id', 'episode_id', 'shot_qc', 'subtitle_audio_drift_s'].includes(key))) {
        issues.push('qc_report:unexpected_top_level_fields');
    }
    const seen = new Set();
    const records = value.shot_qc.map((entry, index) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new Error('qc report entry must be an object');
        const allowedFields = new Set([
            'shot_id', 'provider', 'deterministic_checks_passed', 'gemini_findings',
            'dialogue_intelligibility_score', 'pronunciation_risk_flag', 'decision',
        ]);
        const shotId = safeToken(entry.shot_id);
        const provider = ['seedance', 'flow'].includes(entry.provider) ? entry.provider : '';
        const deterministicPassed = safeBoolean(entry.deterministic_checks_passed);
        const score = safeFiniteNumber(entry.dialogue_intelligibility_score, 0, 1);
        const pronunciationRisk = safeBoolean(entry.pronunciation_risk_flag);
        const decision = ['accept', 'retry', 'abandon'].includes(entry.decision) ? entry.decision : '';
        const findings = entry.gemini_findings;
        const findingsValid = Array.isArray(findings)
            && findings.length <= MAX_CANONICAL_RECORDS
            && findings.every((finding) => typeof finding === 'string' && finding.length <= 512);

        if (!Object.keys(entry).every((key) => allowedFields.has(key))) issues.push(`qc_report:unexpected_fields:${index}`);
        if (!shotId) issues.push(`qc_report:invalid_shot_id:${index}`);
        if (shotId && seen.has(shotId)) issues.push(`qc_report:duplicate_shot_id:${shotId}`);
        if (shotId) seen.add(shotId);
        if (!provider) issues.push(`qc_report:invalid_provider:${index}`);
        if (deterministicPassed === null) issues.push(`qc_report:invalid_deterministic_state:${index}`);
        if (score === null) issues.push(`qc_report:invalid_dialogue_score:${index}`);
        if (pronunciationRisk === null) issues.push(`qc_report:invalid_pronunciation_risk:${index}`);
        if (!decision) issues.push(`qc_report:invalid_decision:${index}`);
        if (!findingsValid) issues.push(`qc_report:invalid_external_review_metadata:${index}`);

        return {
            shot_id: shotId,
            provider,
            deterministic_checks_passed: deterministicPassed,
            dialogue_intelligibility_score: score,
            pronunciation_risk_flag: pronunciationRisk,
            decision,
            external_review_state: findingsValid ? 'recorded_without_verdict' : 'missing_or_invalid',
            external_finding_count: findingsValid ? findings.length : 0,
            record_ready: Boolean(shotId && provider && deterministicPassed !== null && score !== null
                && pronunciationRisk !== null && decision && findingsValid),
            provenance: 'qc_report.json',
        };
    });
    const schemaVersion = safeToken(value.schema_version);
    const projectId = safeToken(value.project_id);
    const episodeId = safeToken(value.episode_id);
    const subtitleAudioDrift = safeFiniteNumber(value.subtitle_audio_drift_s, -3600, 3600);
    if (schemaVersion !== 'short-drama-room-qc-report-v1' || !projectId || !episodeId) {
        issues.push('qc_report:required_metadata_invalid');
    }
    if (subtitleAudioDrift === null) issues.push('qc_report:invalid_subtitle_audio_drift');
    if (!records.length) issues.push('qc_report:empty');
    return {
        value: {
            schema_version: schemaVersion,
            project_id: projectId,
            episode_id: episodeId,
            shot_count: records.length,
            deterministic_passed_count: records.filter((record) => record.deterministic_checks_passed === true).length,
            accepted_count: records.filter((record) => record.decision === 'accept').length,
            retry_count: records.filter((record) => record.decision === 'retry').length,
            abandoned_count: records.filter((record) => record.decision === 'abandon').length,
            pronunciation_risk_count: records.filter((record) => record.pronunciation_risk_flag === true).length,
            subtitle_audio_drift_s: subtitleAudioDrift,
        },
        records,
        issues,
    };
}

function parseImageDashboardJs(root, filePath) {
    if (!filePath || !isWithinRoot(root, filePath) || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
        return { label: 'image-dashboard-data.js', path: '', exists: false, parsed: false, value: null, error: 'missing' };
    }
    const stats = fs.statSync(filePath);
    const read = safeReadText(filePath);
    if (!read.ok) {
        return { label: 'image-dashboard-data.js', path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, value: null, updated_at: stats.mtime.toISOString(), error: read.error };
    }

    const withoutExport = read.content
        .replace(/^\s*export\s+default\s+/, '')
        .replace(/^\s*module\.exports\s*=\s*/, '')
        .replace(/^\s*(const|let|var)\s+[A-Za-z0-9_$]+\s*=\s*/, '');
    const firstObject = withoutExport.search(/[\[{]/);
    const lastObject = Math.max(withoutExport.lastIndexOf('}'), withoutExport.lastIndexOf(']'));

    if (firstObject < 0 || lastObject < firstObject) {
        return { label: 'image-dashboard-data.js', path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, value: null, updated_at: stats.mtime.toISOString(), error: 'no JSON object found' };
    }

    const jsonSlice = withoutExport.slice(firstObject, lastObject + 1);
    try {
        return {
            label: 'image-dashboard-data.js',
            path: filePath,
            relative_path: safeRelative(root, filePath),
            exists: true,
            parsed: true,
            value: JSON.parse(jsonSlice),
            updated_at: stats.mtime.toISOString(),
            error: '',
        };
    } catch (error) {
        return {
            label: 'image-dashboard-data.js',
            path: filePath,
            relative_path: safeRelative(root, filePath),
            exists: true,
            parsed: false,
            value: null,
            updated_at: stats.mtime.toISOString(),
            error: error.message,
        };
    }
}

function parseJsonl(root, filePath, label) {
    if (!filePath || !isWithinRoot(root, filePath) || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
        return { label, path: '', exists: false, parsed: false, records: [], errors: ['missing'] };
    }
    const read = safeReadText(filePath);
    if (!read.ok) {
        return { label, path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, records: [], errors: [read.error] };
    }

    const records = [];
    const errors = [];
    read.content.split(/\r?\n/).forEach((line, index) => {
        if (!line.trim()) return;
        try {
            records.push(JSON.parse(line));
        } catch (error) {
            errors.push(`line ${index + 1}: ${error.message}`);
        }
    });

    return {
        label,
        path: filePath,
        relative_path: safeRelative(root, filePath),
        exists: true,
        parsed: errors.length === 0,
        records,
        errors,
    };
}

function parseCsv(root, filePath, label) {
    if (!filePath || !isWithinRoot(root, filePath) || !existsFile(filePath) || isSensitiveName(path.basename(filePath))) {
        return { label, path: '', exists: false, parsed: false, records: [], errors: ['missing'] };
    }
    const read = safeReadText(filePath);
    if (!read.ok) {
        return { label, path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: false, records: [], errors: [read.error] };
    }
    const lines = read.content.split(/\r?\n/).filter((line) => line.trim());
    const headers = splitCsvLine(lines[0] || '').filter(Boolean);
    const records = lines.slice(1).map((line) => {
        const cells = splitCsvLine(line);
        return Object.fromEntries(headers.map((header, index) => [header, cells[index] || '']));
    });
    const errors = headers.length ? [] : ['missing CSV header'];
    return { label, path: filePath, relative_path: safeRelative(root, filePath), exists: true, parsed: errors.length === 0, records, errors };
}

function parseCostCsv(root, filePath) {
    const parsed = parseCsv(root, filePath, 'cost ledger CSV');
    if (!parsed.parsed) return parsed;
    const allowed = /^(?:credit_count|credits?|cost|amount|known_credits)$/i;
    return {
        ...parsed,
        records: parsed.records.map((record) => Object.fromEntries(
            Object.entries(record).filter(([key]) => allowed.test(key)),
        )),
    };
}

function splitCsvLine(line) {
    const cells = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];
        if (char === '"' && next === '"') {
            current += '"';
            i += 1;
        } else if (char === '"') {
            inQuotes = !inQuotes;
        } else if (char === ',' && !inQuotes) {
            cells.push(current);
            current = '';
        } else {
            current += char;
        }
    }
    cells.push(current);
    return cells.map((cell) => cell.trim());
}

function parseAcceptedSeconds(root, filePath) {
    const record = markdownRecord(root, filePath, 'accepted_seconds.md');
    if (!record) return { exists: false, parsed: false, records: [], path: '', relative_path: '', error: 'missing' };
    const read = safeReadText(filePath);
    if (!read.ok) return { ...record, records: [], error: read.error };

    const rows = read.content.split(/\r?\n/)
        .filter((line) => /^\|/.test(line.trim()) && !/^\|\s*-/.test(line.trim()))
        .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()))
        .filter((cells) => cells.length >= 4);
    const [header, ...body] = rows;
    const normalizedHeader = (header || []).map((value) => value.toLowerCase().replace(/\s+/g, '_'));
    const required = ['clip_id', 'source_file', 'in_time', 'out_time'];
    const missingHeaders = required.filter((name) => !normalizedHeader.includes(name));
    const records = header ? body.map((cells) => Object.fromEntries(header.map((key, index) => [key, cells[index] || '']))) : [];

    return {
        ...record,
        parsed: Boolean(header) && missingHeaders.length === 0,
        records: missingHeaders.length ? [] : records,
        error: missingHeaders.length ? `missing required table headers: ${missingHeaders.join(', ')}` : '',
    };
}

function parseBlockers(root, filePath) {
    const record = markdownRecord(root, filePath, 'blockers.md');
    if (!record) return { exists: false, parsed: false, blockers: [], path: '', relative_path: '', error: 'missing' };
    const read = safeReadText(filePath);
    if (!read.ok) return { ...record, blockers: [], error: read.error };
    const blockers = Array.from(new Set(read.content.match(/[A-Z][A-Z0-9_]{4,}/g) || []));
    return { ...record, parsed: true, blockers, error: '' };
}

function structuralNumber(value) {
    const match = String(value || '').match(/(?:scene|beat|shot|clip|씬|장면|비트)[\s_:#-]*(\d+)/i);
    return match ? Number(match[1]) : null;
}

function structuralIds(value, index) {
    const number = structuralNumber(value) || index + 1;
    const paddedScene = String(number).padStart(2, '0');
    const paddedClip = String(number).padStart(3, '0');
    return {
        scene_id: `scene_${paddedScene}`,
        clip_id: `clip_${paddedClip}`,
    };
}

function parseStorySceneBundle(root, filePath) {
    const parsed = parseJsonFile(root, filePath, 'story_scene_bundle.json');
    if (!parsed.parsed || !parsed.value || typeof parsed.value !== 'object' || !Array.isArray(parsed.value.scenes)) {
        return { ...parsed, parsed: false, value: null, error: parsed.error || 'missing scenes array' };
    }

    const scenes = parsed.value.scenes.map((scene, index) => {
        const ids = structuralIds(scene?.scene_id || scene?.clip_id || scene?.id || scene?.scene || '', index);
        const duration = Number(scene?.duration_seconds || scene?.duration || 0);
        return {
            scene_id: ids.scene_id,
            clip_id: ids.clip_id,
            duration_seconds: Number.isFinite(duration) && duration > 0 ? duration : 0,
            structural_only: true,
            source_relative_path: safeRelative(root, filePath),
        };
    });

    return {
        ...parsed,
        value: {
            video_id_present: typeof parsed.value.video_id === 'string' && parsed.value.video_id.trim().length > 0,
            aspect_ratio: typeof parsed.value.aspect_ratio === 'string' && /^[0-9]+:[0-9]+$/.test(parsed.value.aspect_ratio)
                ? parsed.value.aspect_ratio
                : '',
            duration_seconds: Number.isFinite(Number(parsed.value.duration_seconds)) ? Number(parsed.value.duration_seconds) : 0,
            audio_path_present: typeof parsed.value.audio_path === 'string' && parsed.value.audio_path.trim().length > 0,
            scenes,
        },
    };
}

function parseStructuralMarkdown(root, files, label, role) {
    const records = [];
    const errors = [];
    for (const file of files) {
        if (!isWithinRoot(root, file.path) || !existsFile(file.path) || isSensitiveName(file.name)) continue;
        const read = safeReadText(file.path);
        if (!read.ok) {
            errors.push(`${file.relative_path}: ${read.error}`);
            continue;
        }
        const headingLines = read.content.split(/\r?\n/).filter((line) => /^#{1,4}\s+/.test(line.trim()));
        const candidates = headingLines
            .map((line) => line.replace(/^#{1,4}\s+/, '').trim())
            .filter((heading) => structuralNumber(heading));
        const fileNumber = structuralNumber(file.name);
        const identifiers = role === 'motion_board' && fileNumber
            ? [file.name]
            : candidates.length
                ? candidates
                : (fileNumber ? [file.name] : []);
        identifiers.forEach((identifier, index) => {
            const ids = structuralIds(identifier, records.length + index);
            records.push({
                ...ids,
                structural_only: true,
                evidence_kind: role,
                source_relative_path: file.relative_path,
                heading_count: headingLines.length,
                duration: 0,
                duration_lock: false,
            });
        });
    }
    return {
        label,
        exists: files.length > 0,
        parsed: files.length > 0 && records.length > 0 && errors.length === 0,
        records,
        errors,
        paths: files.map((file) => file.path),
        relative_paths: files.map((file) => file.relative_path),
        error: errors.length ? errors.join('; ') : (files.length && !records.length ? 'no structural scene identifiers found' : files.length ? '' : 'missing'),
    };
}

function parseSubmitArtifacts(files) {
    const submitFiles = files.filter((file) => /(^|\/)dreamina_outputs\/submit_[^/]+\.txt$/i.test(file.relative_path));
    return {
        label: 'submit text artifacts',
        exists: submitFiles.length > 0,
        parsed: submitFiles.length > 0,
        records: submitFiles.map((file, index) => {
            const ids = structuralIds(file.name, index);
            return {
                clip_id: ids.clip_id,
                status: 'artifact_present_unverified',
                source_relative_path: file.relative_path,
            };
        }),
        paths: submitFiles.map((file) => file.path),
        error: submitFiles.length ? '' : 'missing',
    };
}

function parseReportSummary(root, filePath) {
    const parsed = parseJsonFile(root, filePath, 'capcut_report.json');
    if (!parsed.parsed || !parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) {
        return { ...parsed, parsed: false, value: null, keys: [], error: parsed.error || 'report must be an object' };
    }
    return {
        ...parsed,
        value: null,
        keys: Object.keys(parsed.value).filter((key) => /^[A-Za-z0-9_-]{1,80}$/.test(key) && !isSensitiveName(key) && !/private/i.test(key)).sort(),
        source_type: 'capcut_report_structure',
    };
}

function detectVariant(root) {
    if (existsFile(path.join(root, 'story_scene_bundle.json'))
        && existsFile(path.join(root, 'SUMMARY.md'))
        && existsDir(path.join(root, 'dreamina_outputs'))) {
        return 'gangnam_scene_bundle';
    }
    if (existsFile(path.join(root, 'script.md'))
        && existsDir(path.join(root, 'storyboard'))
        && existsDir(path.join(root, 'motion_board'))
        && existsDir(path.join(root, 'prompts'))) {
        return 'markdown_scene_pack';
    }
    return '';
}

function detectLayout(root) {
    const base = path.basename(root);
    const parent = path.basename(path.dirname(root));
    const looksLikeRun = /^\d{8}-.+/.test(base) || parent === 'short_drama_pipeline_runs';
    const hasLayoutADirs = ['intake', 'storyboard', 'prompts', 'generated', 'final', 'qa'].filter((name) => existsDir(path.join(root, name))).length >= 3;
    const variant = detectVariant(root);
    const hasLayoutBMarkers = Boolean(variant) || existsFile(path.join(root, 'brief.md')) || existsDir(path.join(root, 'assets')) || existsDir(path.join(root, 'dreamina_outputs'));
    const nestedProduction = path.join(root, 'production');

    if (!hasLayoutBMarkers && existsDir(nestedProduction) && (existsFile(path.join(nestedProduction, 'brief.md')) || existsDir(path.join(nestedProduction, 'assets')))) {
        return { layout: 'B', variant: detectVariant(nestedProduction) || 'classic', root: nestedProduction, selectedRoot: root };
    }
    if (hasLayoutBMarkers) return { layout: 'B', variant: variant || 'classic', root, selectedRoot: root };
    if (looksLikeRun || hasLayoutADirs) return { layout: 'A', variant: 'dated_run', root, selectedRoot: root };
    return { layout: 'unknown', variant: '', root, selectedRoot: root };
}

function deriveMarkdown(root, layout, files) {
    const markdown = {};
    if (layout === 'A') {
        markdown.intake = markdownRecord(root, findFirst(root, ['intake/brief.md', 'intake/intake.md', 'brief.md']), 'intake');
        markdown.script = markdownRecord(root, findFirst(root, ['intake/script.txt', 'intake/script.md', 'script.md']), 'script');
        markdown.report = markdownRecord(root, findFirst(root, ['report.md', 'final/report.md']), 'report');
    } else {
        markdown.brief = markdownRecord(root, findFirst(root, ['brief.md', 'SUMMARY.md']), 'brief');
        markdown.script = markdownRecord(root, findFirst(root, ['script.md']), 'script');
        markdown.report = markdownRecord(root, findFirst(root, ['report.md', 'final/report.md', 'edit/report.md']), 'report');
    }

    for (const file of files.filter((item) => item.extension === '.md')) {
        if (!Object.values(markdown).some((record) => record?.path === file.path)) {
            markdown[file.relative_path] = markdownRecord(root, file.path, file.relative_path);
        }
    }
    return Object.fromEntries(Object.entries(markdown).filter(([, value]) => Boolean(value)));
}

function readProductionFolder(rootPath, options = {}) {
    const selectedRoot = assertDirectory(rootPath);
    const detected = detectLayout(selectedRoot);
    const root = detected.root;
    const walkResult = walkFiles(root, options);
    const files = walkResult.files;
    const markdown = deriveMarkdown(root, detected.layout, files);

    const storyboardJson = parseJsonFile(root, findFirst(root, [
        'storyboard/storyboard.json',
        'storyboard/clips.json',
        'storyboard.json',
    ]) || findByName(files, ['storyboard.json']), 'storyboard JSON');
    const storySceneBundle = parseStorySceneBundle(root, findFirst(root, ['story_scene_bundle.json']) || findByName(files, ['story_scene_bundle.json']));
    const motionBoardJson = parseJsonFile(root, findFirst(root, [
        'motion_board/motion_board.json',
        'motion_board/shots.json',
        'motion_board.json',
    ]) || findByName(files, ['motion_board.json']), 'motion board JSON');
    const storyboardMarkdown = parseStructuralMarkdown(
        root,
        files.filter((file) => file.extension === '.md' && /(^|\/)storyboard\//.test(file.relative_path)),
        'storyboard markdown structure',
        'storyboard',
    );
    const motionBoardMarkdown = parseStructuralMarkdown(
        root,
        files.filter((file) => file.extension === '.md' && /(^|\/)motion_board\//.test(file.relative_path)),
        'motion board markdown structure',
        'motion_board',
    );
    const imageDashboard = parseImageDashboardJs(root, findFirst(root, [
        'image_dashboard/image-dashboard-data.js',
        'image_dashboard/image_dashboard_data.js',
        'image-dashboard-data.js',
    ]) || findByName(files, ['image-dashboard-data.js', 'image_dashboard_data.js']));
    const submitRecords = parseJsonl(root, findByName(files, ['submit_records.jsonl']), 'submit_records.jsonl');
    const submitArtifacts = parseSubmitArtifacts(files);
    const heartbeatLog = parseJsonl(root, findByName(files, ['heartbeat_log.jsonl']), 'heartbeat_log.jsonl');
    const costLedgerJsonl = parseJsonl(root, findByName(files, ['cost_ledger.jsonl']), 'cost_ledger.jsonl');
    const ledgerCsv = parseCostCsv(root, findFirst(root, ['ledger.csv', 'cost_ledger.csv']) || findByName(files, ['ledger.csv', 'cost_ledger.csv']));
    const acceptedSeconds = parseAcceptedSeconds(root, findFirst(root, ['edit/accepted_seconds.md', 'qa/accepted_seconds.md', 'accepted_seconds.md']) || findByName(files, ['accepted_seconds.md']));
    const blockersMd = parseBlockers(root, findFirst(root, ['blockers.md', 'qa/blockers.md', 'reviews/blockers.md']) || findByName(files, ['blockers.md']));
    const report = markdownRecord(root, findFirst(root, ['report.md', 'final/report.md', 'edit/report.md']) || findByName(files, ['report.md']), 'report.md');
    const capcutReport = parseReportSummary(root, findFirst(root, ['reports/capcut_report.json']) || findByName(files, ['capcut_report.json']));
    const pipelinePackReport = parseCanonicalJson(root, 'pipeline_pack_report.json', 'pipeline_pack_report.json', sanitizePipelinePackReport);
    const submissionManifest = parseCanonicalJson(root, 'submission_manifest.json', 'submission_manifest.json', sanitizeSubmissionManifest);
    const jimengState = parseCanonicalJson(root, 'jimeng_state.json', 'jimeng_state.json', sanitizeJimengState);
    const downloadManifest = parseCanonicalJson(root, 'download_manifest.json', 'download_manifest.json', (value) => sanitizeDownloadManifest(root, value));
    const shotManifest = parseCanonicalJson(root, 'shot_manifest.json', 'shot_manifest.json', sanitizeShotManifest);
    const selectedTakes = parseCanonicalJson(root, 'selected_takes.json', 'selected_takes.json', (value) => sanitizeSelectedTakes(root, value));
    const qcReport = parseCanonicalJson(root, 'qc_report.json', 'qc_report.json', sanitizeQcReport);

    const storyboardParsed = storyboardJson.parsed || storySceneBundle.parsed || storyboardMarkdown.parsed;
    const motionBoardParsed = motionBoardJson.parsed || motionBoardMarkdown.parsed;
    const structuralStoryboard = storySceneBundle.parsed || storyboardMarkdown.parsed;
    const structuralMotionBoard = motionBoardMarkdown.parsed;
    const briefEvidence = markdown.brief || markdown.intake || markdown.script;

    const blockers = [];
    if (!briefEvidence) blockers.push(BLOCKERS.MISSING_PRODUCTION_BRIEF);
    if (!storyboardParsed || structuralStoryboard) blockers.push(BLOCKERS.MISSING_STORYBOARD_CONTINUITY_PACKET);
    if (!motionBoardParsed || structuralMotionBoard) blockers.push(BLOCKERS.MISSING_MOTION_BOARD);
    if (!imageDashboard.parsed) blockers.push(BLOCKERS.MISSING_IMAGE_DASHBOARD);
    if (!acceptedSeconds.records?.length) blockers.push(BLOCKERS.MISSING_ACCEPTED_SECONDS);
    if (!report?.exists || capcutReport.parsed) blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
    const canonicalRecordsExist = submissionManifest.records.length > 0
        || (jimengState.value?.submitted_indices?.length || 0) > 0
        || downloadManifest.records.length > 0;
    const canonicalInconsistencies = [];
    for (const record of [pipelinePackReport, submissionManifest, jimengState, downloadManifest]) {
        if (record.exists && !record.parsed) canonicalInconsistencies.push(`${record.relative_path}:malformed_or_oversized`);
    }
    if (pipelinePackReport.parsed
        && pipelinePackReport.value.actual_generation_submitted === false
        && canonicalRecordsExist) {
        canonicalInconsistencies.push('pipeline_report_submission_state_stale');
    }
    if (pipelinePackReport.parsed
        && pipelinePackReport.value.canonical_production_id
        && pipelinePackReport.value.canonical_production_id !== path.basename(root)) {
        canonicalInconsistencies.push('canonical_production_id_mismatch');
    }
    if (pipelinePackReport.parsed
        && !['seedance', 'flow', 'both'].includes(pipelinePackReport.value.target_generator)) {
        canonicalInconsistencies.push('unsupported_target_generator');
    }
    if (pipelinePackReport.parsed
        && (pipelinePackReport.value.scene_count === null
            || pipelinePackReport.value.actual_generation_submitted === null)) {
        canonicalInconsistencies.push('pipeline_report_required_metadata_missing');
    }
    if (canonicalInconsistencies.length && !blockers.includes(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN)) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
    }
    const finishingInconsistencies = [];
    for (const record of [shotManifest, selectedTakes, qcReport]) {
        if (!record.exists) finishingInconsistencies.push(`${record.relative_path}:missing`);
        else if (!record.parsed) finishingInconsistencies.push(`${record.relative_path}:malformed_or_oversized`);
        finishingInconsistencies.push(...(record.issues || []));
    }
    const selectedMetadata = selectedTakes.value || {};
    const qcMetadata = qcReport.value || {};
    const manifestMetadata = shotManifest.value || {};
    if (selectedTakes.parsed && qcReport.parsed) {
        if (selectedMetadata.project_id !== qcMetadata.project_id) finishingInconsistencies.push('canonical_finishing_project_id_mismatch');
        if (selectedMetadata.episode_id !== qcMetadata.episode_id) finishingInconsistencies.push('canonical_finishing_episode_id_mismatch');
        const selectedByShot = new Map(selectedTakes.records.map((record) => [record.shot_id, record]));
        const qcByShot = new Map(qcReport.records.map((record) => [record.shot_id, record]));
        for (const [shotId, take] of selectedByShot) {
            const qc = qcByShot.get(shotId);
            if (!qc) finishingInconsistencies.push(`qc_report:missing_for_shot:${shotId}`);
            else if (take.provider && qc.provider && take.provider !== qc.provider) {
                finishingInconsistencies.push(`canonical_finishing_provider_mismatch:${shotId}`);
            }
        }
        for (const shotId of qcByShot.keys()) {
            if (!selectedByShot.has(shotId)) finishingInconsistencies.push(`qc_report:unknown_selected_shot:${shotId}`);
        }
        const selectedUpdatedAt = Date.parse(selectedTakes.updated_at || '');
        const qcUpdatedAt = Date.parse(qcReport.updated_at || '');
        if (Number.isFinite(selectedUpdatedAt) && Number.isFinite(qcUpdatedAt) && qcUpdatedAt < selectedUpdatedAt) {
            finishingInconsistencies.push('qc_report:stale_for_selected_takes');
        }
    }
    if (shotManifest.parsed && selectedTakes.parsed) {
        if (manifestMetadata.project_id !== selectedMetadata.project_id) finishingInconsistencies.push('shot_manifest:selected_takes_project_id_mismatch');
        if (manifestMetadata.episode_id !== selectedMetadata.episode_id) finishingInconsistencies.push('shot_manifest:selected_takes_episode_id_mismatch');
        const knownShotIds = new Set(shotManifest.records.map((record) => record.shot_id).filter(Boolean));
        for (const take of selectedTakes.records) {
            if (take.shot_id && !knownShotIds.has(take.shot_id)) finishingInconsistencies.push(`selected_takes:unknown_manifest_shot:${take.shot_id}`);
        }
    }
    if (finishingInconsistencies.length && !blockers.includes(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN)) {
        blockers.push(BLOCKERS.OUTPUT_QUALITY_NOT_PROVEN);
    }
    blockers.push(...(blockersMd.blockers || []));

    return {
        ok: true,
        rootPath: root,
        selectedRoot: detected.selectedRoot,
        layout: detected.layout,
        variant: detected.variant,
        readAt: new Date().toISOString(),
        files,
        markdown,
        parsed: {
            storyboardJson,
            storySceneBundle,
            storyboardMarkdown,
            motionBoardJson,
            motionBoardMarkdown,
            imageDashboard,
            submitRecords,
            submitArtifacts,
            heartbeatLog,
            costLedgerJsonl,
            ledgerCsv,
            acceptedSeconds,
            blockersMd,
            report,
            capcutReport,
            pipelinePackReport,
            submissionManifest,
            jimengState,
            downloadManifest,
            shotManifest,
            selectedTakes,
            qcReport,
        },
        canonical: {
            contract: 'happyVideoFactory_short_drama_pipeline_pack',
            inconsistencies: canonicalInconsistencies,
            finishing_inconsistencies: Array.from(new Set(finishingInconsistencies)),
            final_ready: false,
        },
        blockers: Array.from(new Set(blockers)),
        security: {
            skipped_sensitive_patterns: SENSITIVE_NAME_PATTERNS.map((pattern) => pattern.toString()),
            max_text_bytes: MAX_TEXT_BYTES,
            max_canonical_json_bytes: MAX_CANONICAL_JSON_BYTES,
            max_walk_files: walkResult.maxFiles,
            max_walk_depth: walkResult.maxDepth,
            skipped: walkResult.skipped,
            skipped_total: Object.values(walkResult.skipped).reduce((sum, value) => sum + value, 0),
            walk_truncated: walkResult.truncated,
            walk_errors: walkResult.errors,
        },
    };
}

module.exports = {
    readProductionFolder,
    detectLayout,
    isSensitiveName,
    MAX_WALK_FILES,
    MAX_WALK_DEPTH,
};
