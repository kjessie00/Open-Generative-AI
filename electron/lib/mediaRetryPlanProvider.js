const fs = require('fs');
const path = require('path');

const { readProductionFolder } = require('./productionReader');

const PLAN_SCHEMA = 'film_pipeline.media_retry_plan.v1';
const REVIEW_SCHEMA = 'film_pipeline.media_review_draft.v1';
const PYTHON_311 = '/Users/jessiek/.pyenv/versions/3.11.7/bin/python';
const DEEPSEARCH_ROOT = '/Users/jessiek/StudioProjects/deepSearchTeam';
const FLOW_ROOT = '/Users/jessiek/StudioProjects/google_labs_flow_auto';
const GROK_ROOT = '/Users/jessiek/StudioProjects/grok-auto/grok-browser';
const VALID_KINDS = new Set(['character_sheet', 'location_sheet', 'scene_image', 'video']);
const VALID_PROVIDERS = new Set(['dst', 'flow', 'grok', 'replicate', 'bytedance', 'seedance']);
const VALID_ASPECTS = new Set(['9:16', '16:9', '3:4', '1:1', '3:2', '2:3']);
const DST_ASPECTS = new Set(['9:16', '16:9', '3:4', '1:1']);
const DST_PROFILE = 'kjessie003';
const FLOW_ASPECTS = new Set(['9:16', '16:9']);
const MAX_PROMPT_LENGTH = 12000;
const MAX_QUEUE_ITEMS = 100;

function emptyPlan(blockers = [], status = 'blocked') {
    return {
        schema: PLAN_SCHEMA,
        execution: 'not_run',
        status,
        ready: false,
        preview_ready: false,
        execution_ready: false,
        blockers: Array.from(new Set(blockers)),
        items: [],
        executed: false,
    };
}

function safeId(value) {
    return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value) ? value : '';
}

function safeText(value, maxLength = MAX_PROMPT_LENGTH) {
    if (typeof value !== 'string' || value.includes('\0')) return '';
    const normalized = value.trim();
    return normalized && normalized.length <= maxLength ? normalized : '';
}

function safePositiveInteger(value, maximum = Number.MAX_SAFE_INTEGER) {
    const number = Number(value);
    return Number.isSafeInteger(number) && number > 0 && number <= maximum ? number : 0;
}

function safeAspect(value, fallback = '9:16') {
    return VALID_ASPECTS.has(value) ? value : fallback;
}

function safeDuration(value) {
    return [6, 10, 15].includes(Number(value)) ? Number(value) : 6;
}

function safeQuality(value) {
    return ['480p', '720p'].includes(value) ? value : '480p';
}

function commandSpec(base = {}) {
    return {
        preview_only: true,
        command: '',
        args: [],
        cwd: '',
        side_effect_type: 'credit_consuming_generation',
        requires_confirmation: true,
        copy_allowed: false,
        disabled_reason: '',
        disabled_detail: '',
        ...base,
    };
}

function pathInsideRoot(root, value) {
    if (typeof value !== 'string' || !value.trim() || value.includes('\0')) return '';
    const trimmed = value.trim();
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(trimmed)) return '';
    const candidate = path.isAbsolute(trimmed) ? path.normalize(trimmed) : path.resolve(root, trimmed);
    if (candidate === root || !candidate.startsWith(root + path.sep)) return '';

    let cursor = root;
    const parts = path.relative(root, candidate).split(path.sep).filter(Boolean);
    for (let index = 0; index < parts.length; index += 1) {
        cursor = path.join(cursor, parts[index]);
        let stats;
        try {
            stats = fs.lstatSync(cursor);
        } catch {
            return '';
        }
        if (stats.isSymbolicLink()) return '';
        if (index < parts.length - 1 && !stats.isDirectory()) return '';
        if (index === parts.length - 1 && !stats.isFile()) return '';
    }
    return candidate;
}

function resolveReferences(root, referenceIds, attemptsById) {
    const paths = [];
    const blockers = [];
    const requestedCount = Array.isArray(referenceIds) ? referenceIds.length : 0;
    for (const rawId of Array.isArray(referenceIds) ? referenceIds.slice(0, 8) : []) {
        const referenceId = safeId(rawId);
        const reference = referenceId ? attemptsById.get(referenceId) : null;
        if (!reference) {
            blockers.push('MISSING_REFERENCE_MEDIA');
            continue;
        }
        const resolved = pathInsideRoot(root, reference.relative_path || reference.path);
        if (!resolved) {
            blockers.push('UNSAFE_REFERENCE_PATH');
            continue;
        }
        paths.push(resolved);
    }
    if (Array.isArray(referenceIds) && referenceIds.length > 8) blockers.push('TOO_MANY_REFERENCE_MEDIA');
    return { paths, blockers: Array.from(new Set(blockers)), requestedCount };
}

function dstPlan(record, prompt, references) {
    const blockers = [...references.blockers];
    const aspect = DST_ASPECTS.has(record.aspect_ratio) ? record.aspect_ratio : '';
    const args = ['-m', 'dst', 'image', prompt, '-p', DST_PROFILE];
    if (aspect) args.push('-a', aspect);
    references.paths.forEach((referencePath) => args.push('--attach', referencePath));
    const previewReady = blockers.length === 0 && references.paths.length === references.requestedCount;
    return {
        readiness: previewReady ? 'preview_ready' : 'blocked_reference_contract',
        preview_ready: previewReady,
        execution_ready: false,
        blockers,
        command_spec: commandSpec({
            id: `retry_${record.media_id}`,
            label: `DeepSearchTeam dst image · ${record.target_id || record.media_id}`,
            command: previewReady ? PYTHON_311 : '',
            args: previewReady ? args : [],
            cwd: DEEPSEARCH_ROOT,
            copy_allowed: false,
            disabled_reason: blockers[0] || 'CREDIT_CONSUMING_GENERATION_PREVIEW_ONLY',
            disabled_detail: 'Thinking 이미지 생성 명령 미리보기입니다. 이 작업대에서는 실행하지 않습니다.',
        }),
    };
}

function flowPlan(record, prompt, references) {
    const blockers = [...references.blockers];
    let script = '';
    let args = [];
    let referenceContractReady = false;
    if (references.requestedCount === 0) {
        script = 'scripts/flow_cdp_video_text_smoke.py';
        referenceContractReady = true;
    } else if (references.requestedCount === 2 && references.paths.length === 2 && blockers.length === 0) {
        script = 'scripts/flow_cdp_video_refs_smoke.py';
        referenceContractReady = true;
    } else {
        blockers.push('FLOW_REFERENCE_COUNT_MUST_BE_TWO');
    }
    blockers.push('MISSING_FLOW_RUNTIME_CONTEXT');
    if (referenceContractReady) {
        args = [script];
        references.paths.forEach((referencePath) => args.push('--image', referencePath));
        args.push(
            '--cdp-url', '<FLOW_CDP_URL>',
            '--project-url', '<FLOW_PROJECT_URL>',
            '--model', 'Omni Flash',
            '--aspect-ratio', FLOW_ASPECTS.has(record.aspect_ratio) ? record.aspect_ratio : '9:16',
            '--batch-size', '1',
            '--prompt', prompt,
            '--no-submit',
        );
    }
    return {
        readiness: referenceContractReady ? 'blocked_runtime_context' : 'blocked_reference_contract',
        preview_ready: referenceContractReady,
        execution_ready: false,
        blockers: Array.from(new Set(blockers)),
        command_spec: commandSpec({
            id: `retry_${record.media_id}`,
            label: `Google Labs Flow --no-submit · ${record.target_id || record.media_id}`,
            command: referenceContractReady ? 'venv/bin/python' : '',
            args,
            cwd: FLOW_ROOT,
            copy_allowed: false,
            disabled_reason: blockers[0],
            disabled_detail: 'CDP endpoint와 Flow project는 main/production에서 받지 않습니다. placeholder no-submit 미리보기만 표시합니다.',
        }),
    };
}

function grokOutputPath(record, extension) {
    const target = safeId(record.media_id) || 'media_retry';
    return path.join(GROK_ROOT, 'outputs', `${target}_retry_${record.attempt + 1}.${extension}`);
}

function grokPlan(record, prompt, references) {
    const blockers = [...references.blockers, 'GROK_RUNTIME_UNVERIFIED'];
    const ratio = safeAspect(record.aspect_ratio);
    const output = grokOutputPath(record, record.kind === 'video' ? 'mp4' : 'jpg');
    let mode = 'image';
    let args;
    if (record.kind !== 'video') {
        if (references.paths.length) blockers.push('GROK_REFERENCE_STAGING_REQUIRED');
        args = blockers.includes('GROK_REFERENCE_STAGING_REQUIRED')
            ? []
            : ['grok_imagine_bot.py', mode, '--prompt', prompt, '--ratio', ratio, '--output', output];
    } else if (references.paths.length === 0) {
        mode = 'video';
        args = [
            'grok_imagine_bot.py', mode, '--prompt', prompt, '--ratio', ratio,
            '--duration', String(safeDuration(record.duration)), '--quality', safeQuality(record.quality), '--output', output,
        ];
    } else if (references.paths.length === 1) {
        mode = 'i2v';
        blockers.push('GROK_REFERENCE_STAGING_REQUIRED');
        args = [];
    } else {
        blockers.push('GROK_REFERENCE_COUNT_UNSUPPORTED');
        args = [];
    }
    return {
        readiness: 'blocked_runtime_unverified',
        preview_ready: args.length > 0,
        execution_ready: false,
        blockers: Array.from(new Set(blockers)),
        command_spec: commandSpec({
            id: `retry_${record.media_id}`,
            label: `Grok Imagine ${mode} · ${record.target_id || record.media_id}`,
            command: args.length ? 'python3' : '',
            args,
            cwd: GROK_ROOT,
            copy_allowed: false,
            disabled_reason: blockers[0],
            disabled_detail: '현재 Selenium 런타임을 검증하지 않았으므로 정확한 CLI 형태만 보여주며 실행·복사를 막습니다.',
        }),
    };
}

function missingProviderPlan(record) {
    const provider = record.provider || 'unknown';
    return {
        readiness: 'blocked_adapter_missing',
        preview_ready: false,
        execution_ready: false,
        blockers: ['MISSING_PROVIDER_ADAPTER'],
        command_spec: commandSpec({
            id: `retry_${record.media_id}`,
            label: `${provider} 외부 생성 후보 · ${record.target_id || record.media_id}`,
            disabled_reason: 'MISSING_PROVIDER_ADAPTER',
            disabled_detail: `${provider}는 외부 생성 후보이지만 현재 Open-Generative-AI에 검증된 실행 어댑터가 없습니다.`,
        }),
    };
}

function buildProviderPlan(root, record, attemptsById) {
    const prompt = safeText(record.prompt);
    if (!prompt) {
        return {
            readiness: 'blocked_missing_prompt',
            preview_ready: false,
            execution_ready: false,
            blockers: ['MISSING_RETRY_PROMPT'],
            command_spec: commandSpec({
                id: `retry_${record.media_id}`,
                label: `${record.provider || 'provider'} · ${record.target_id || record.media_id}`,
                disabled_reason: 'MISSING_RETRY_PROMPT',
                disabled_detail: 'media_attempts.jsonl의 원본 시도에 유효한 prompt가 필요합니다.',
            }),
        };
    }
    const references = resolveReferences(root, record.reference_ids, attemptsById);
    if (record.provider === 'dst' && record.kind !== 'video') return dstPlan(record, prompt, references);
    if (record.provider === 'flow' && record.kind === 'video') return flowPlan(record, prompt, references);
    if (record.provider === 'grok') return grokPlan(record, prompt, references);
    return missingProviderPlan(record);
}

function normalizedAttempt(record) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    const mediaId = safeId(record.media_id);
    const attempt = safePositiveInteger(record.attempt, 10000);
    if (!mediaId || !attempt || !VALID_KINDS.has(record.kind) || !VALID_PROVIDERS.has(record.provider)) return null;
    return {
        ...record,
        media_id: mediaId,
        kind: record.kind,
        target_id: safeId(record.target_id),
        target_label: safeText(record.target_label, 256) || safeId(record.target_id),
        provider: record.provider,
        attempt,
        prompt: safeText(record.prompt),
        reference_ids: Array.isArray(record.reference_ids) ? record.reference_ids.slice(0, 9) : [],
        aspect_ratio: VALID_ASPECTS.has(record.aspect_ratio) ? record.aspect_ratio : '',
        duration: safePositiveInteger(record.duration, 30),
        quality: safeText(record.quality, 16),
    };
}

function validateSources(raw) {
    const media = raw?.parsed?.mediaAttempts;
    const review = raw?.parsed?.mediaReviewDraft;
    const blockers = [];
    if (!media?.exists) blockers.push('MEDIA_ATTEMPTS_REQUIRED');
    else if (!media.parsed) blockers.push('MEDIA_ATTEMPTS_INVALID');
    if (!review?.exists) blockers.push('MEDIA_REVIEW_DRAFT_REQUIRED');
    else if (!review.parsed) blockers.push('MEDIA_REVIEW_DRAFT_INVALID');
    return blockers;
}

function buildMediaRetryPlan(productionRoot, options = {}) {
    const read = options.readProductionFolderFn || readProductionFolder;
    const raw = read(productionRoot);
    const sourceBlockers = validateSources(raw);
    if (sourceBlockers.length) return emptyPlan(sourceBlockers);

    const draft = raw.parsed.mediaReviewDraft.value;
    if (!draft || typeof draft !== 'object' || Array.isArray(draft)
        || draft.schema !== REVIEW_SCHEMA || draft.execution !== 'not_run'
        || !Array.isArray(draft.retry_queue) || draft.retry_queue.length > MAX_QUEUE_ITEMS) {
        return emptyPlan(['MEDIA_REVIEW_DRAFT_CONTRACT_INVALID']);
    }

    const attempts = raw.parsed.mediaAttempts.records.map(normalizedAttempt);
    if (attempts.some((record) => !record)) return emptyPlan(['MEDIA_ATTEMPT_CONTRACT_INVALID']);
    const attemptsById = new Map();
    for (const record of attempts) {
        if (attemptsById.has(record.media_id)) return emptyPlan(['DUPLICATE_MEDIA_ATTEMPT_ID']);
        attemptsById.set(record.media_id, record);
    }

    const queueIds = new Set();
    const items = [];
    for (let index = 0; index < draft.retry_queue.length; index += 1) {
        const queue = draft.retry_queue[index];
        const mediaId = safeId(queue?.media_id);
        const sequence = safePositiveInteger(queue?.sequence, MAX_QUEUE_ITEMS);
        if (!queue || typeof queue !== 'object' || Array.isArray(queue) || !mediaId
            || sequence !== index + 1 || queueIds.has(mediaId)
            || queue.execution_status !== 'draft_not_executed') {
            return emptyPlan(['MEDIA_RETRY_QUEUE_INVALID']);
        }
        queueIds.add(mediaId);
        const record = attemptsById.get(mediaId);
        if (!record) return emptyPlan(['MEDIA_RETRY_ATTEMPT_NOT_FOUND']);
        const matchBlockers = [];
        if (queue.attempt !== record.attempt) matchBlockers.push('RETRY_ATTEMPT_MISMATCH');
        if (queue.kind !== record.kind || queue.provider !== record.provider
            || queue.target_id !== record.target_id || queue.retry_of !== record.media_id) {
            matchBlockers.push('MEDIA_RETRY_QUEUE_RECORD_MISMATCH');
        }
        const providerPlan = matchBlockers.length
            ? { readiness: 'blocked_record_mismatch', preview_ready: false, execution_ready: false, blockers: matchBlockers, command_spec: commandSpec({
                id: `retry_${record.media_id}`,
                label: `${record.provider} · ${record.target_id || record.media_id}`,
                disabled_reason: matchBlockers[0],
                disabled_detail: '저장된 대기열과 media_attempts.jsonl 원본 시도가 일치하지 않습니다.',
            }) }
            : buildProviderPlan(productionRoot, record, attemptsById);
        items.push({
            sequence,
            media_id: record.media_id,
            kind: record.kind,
            target_id: record.target_id,
            target_label: record.target_label,
            provider: record.provider,
            readiness: providerPlan.readiness,
            preview_ready: providerPlan.preview_ready === true,
            execution_ready: false,
            blockers: providerPlan.blockers,
            executed: false,
            command_spec: providerPlan.command_spec,
        });
    }

    const blockers = Array.from(new Set(items.flatMap((item) => item.blockers)));
    return {
        schema: PLAN_SCHEMA,
        execution: 'not_run',
        status: items.length ? (blockers.length ? 'blocked' : 'preview_ready') : 'empty',
        ready: false,
        preview_ready: items.some((item) => item.preview_ready),
        execution_ready: false,
        blockers,
        items,
        executed: false,
    };
}

module.exports = {
    buildMediaRetryPlan,
    PLAN_SCHEMA,
    REVIEW_SCHEMA,
};
