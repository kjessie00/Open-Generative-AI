const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REQUEST_SCHEMA = 'film_pipeline.prompt_agent_request.v1';
const SNAPSHOT_SCHEMA = 'film_pipeline.prompt_agent_snapshot.v1';
const SUGGESTION_SCHEMA = 'film_pipeline.prompt_agent_suggestion.v1';
const RECEIPT_SCHEMA = 'film_pipeline.prompt_agent_receipt.v1';
const MAX_FILE_BYTES = 1250 * 1024;
const MAX_INSTRUCTION_BYTES = 16 * 1024;
const MAX_PROMPT_BYTES = 32 * 1024;
const MAX_SUMMARY_BYTES = 2 * 1024;
const SAFE_REQUEST = /^request_[a-f0-9]{64}$/;
const SAFE_SUGGESTION = /^suggestion_[a-f0-9]{64}$/;

function failure(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function exactKeys(value, expected, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) throw failure(code);
}

function boundedText(value, maximum, code) {
    if (typeof value !== 'string' || value.includes('\0')) throw failure(code);
    const normalized = value.trim();
    if (!normalized || Buffer.byteLength(normalized, 'utf8') > maximum) throw failure(code);
    return normalized;
}

function pathsFor(planPaths) {
    const root = path.join(planPaths.root, 'collaboration');
    return {
        root,
        requests: path.join(root, 'requests'),
        snapshots: path.join(root, 'snapshots'),
        suggestions: path.join(root, 'suggestions'),
        receipts: path.join(root, 'receipts'),
    };
}

function assertDirectory(directoryPath, code) {
    let stats;
    try { stats = fs.lstatSync(directoryPath); } catch { throw failure(code); }
    if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700
        || fs.realpathSync.native(directoryPath) !== directoryPath) throw failure(code);
    return stats;
}

function ensureDirectory(directoryPath, parentPath) {
    const parent = assertDirectory(parentPath, 'PROMPT_AGENT_PARENT_UNSAFE');
    try { fs.mkdirSync(directoryPath, { mode: 0o700 }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const current = assertDirectory(directoryPath, 'PROMPT_AGENT_DIRECTORY_UNSAFE');
    if (current.dev !== parent.dev || path.dirname(fs.realpathSync.native(directoryPath)) !== parentPath) {
        throw failure('PROMPT_AGENT_DIRECTORY_UNSAFE');
    }
}

function ensureRoots(planPaths) {
    assertDirectory(planPaths.root, 'PROMPT_AGENT_PLAN_ROOT_UNSAFE');
    const paths = pathsFor(planPaths);
    ensureDirectory(paths.root, planPaths.root);
    for (const child of [paths.requests, paths.snapshots, paths.suggestions, paths.receipts]) {
        ensureDirectory(child, paths.root);
    }
    return paths;
}

function privateWrite(filePath, value) {
    const buffer = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
    if (!buffer.length || buffer.byteLength > MAX_FILE_BYTES) throw failure('PROMPT_AGENT_FILE_TOO_LARGE');
    const descriptor = fs.openSync(filePath, fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try {
        fs.fchmodSync(descriptor, 0o600);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
}

function readPrivate(filePath) {
    let stats;
    try { stats = fs.lstatSync(filePath); } catch (error) {
        if (error.code === 'ENOENT') throw failure('PROMPT_AGENT_FILE_MISSING');
        throw error;
    }
    if (!stats.isFile() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o600
        || stats.size <= 0 || stats.size > MAX_FILE_BYTES) throw failure('PROMPT_AGENT_FILE_UNSAFE');
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (opened.dev !== stats.dev || opened.ino !== stats.ino || opened.size !== stats.size) {
            throw failure('PROMPT_AGENT_FILE_CHANGED');
        }
        return JSON.parse(fs.readFileSync(descriptor, 'utf8'));
    } catch (error) {
        if (error.code) throw error;
        throw failure('PROMPT_AGENT_FILE_INVALID');
    } finally { fs.closeSync(descriptor); }
}

function revisionsFor(lane, state) {
    const common = {
        design_revision_sha256: state.design_revision_sha256,
        plan_revision_sha256: state.revision_sha256,
    };
    return lane === 'video' ? { ...common, image_plan_revision_sha256: state.image_plan_revision_sha256 } : common;
}

function assertExpected(lane, expected, state) {
    const current = revisionsFor(lane, state);
    if (Object.keys(current).some((key) => expected[key] !== current[key])) {
        throw failure(`${lane.toUpperCase()}_PROMPT_AGENT_PLAN_STALE`);
    }
}

function targetContext(task) {
    return sha256(JSON.stringify({
        task_token: task.task_token,
        prompt: task.prompt,
        provider: task.provider || '',
        status: task.status,
        result_token: task.result_token,
        references: task.reference_task_ids || [task.reference_image_task_token, task.reference_image_result_token],
    }));
}

function enqueue({ lane, payload, state, planPaths }) {
    exactKeys(payload, lane === 'video'
        ? ['task_token', 'instruction', 'expected_design_revision_sha256', 'expected_image_plan_revision_sha256', 'expected_video_plan_revision_sha256']
        : ['task_token', 'instruction', 'expected_design_revision_sha256', 'expected_image_plan_revision_sha256'],
    `${lane.toUpperCase()}_PROMPT_AGENT_REQUEST_SHAPE_INVALID`);
    if (!state?.ok || !Array.isArray(state.tasks)) throw failure(`${lane.toUpperCase()}_PROMPT_AGENT_PLAN_BLOCKED`);
    const expected = lane === 'video' ? {
        design_revision_sha256: payload.expected_design_revision_sha256,
        image_plan_revision_sha256: payload.expected_image_plan_revision_sha256,
        plan_revision_sha256: payload.expected_video_plan_revision_sha256,
    } : {
        design_revision_sha256: payload.expected_design_revision_sha256,
        plan_revision_sha256: payload.expected_image_plan_revision_sha256,
    };
    assertExpected(lane, expected, state);
    const task = state.tasks.find((item) => item.task_token === payload.task_token);
    if (!task) throw failure(`${lane.toUpperCase()}_PROMPT_AGENT_TASK_NOT_FOUND`);
    if (task.result_token && task.status !== '재제작') {
        throw failure(`${lane.toUpperCase()}_PROMPT_AGENT_ACCEPTED_TASK_REQUIRES_RETRY`);
    }
    const instruction = boundedText(payload.instruction, MAX_INSTRUCTION_BYTES, 'PROMPT_AGENT_INSTRUCTION_INVALID');
    const revision = revisionsFor(lane, state);
    const contextSha = targetContext(task);
    const requestId = `request_${sha256(JSON.stringify({ lane, revision, task: task.task_token, contextSha, instruction }))}`;
    const paths = ensureRoots(planPaths);
    const snapshot = {
        schema_version: SNAPSHOT_SCHEMA, lane, request_id: requestId, revisions: revision,
        target_task_token: task.task_token, target_context_sha256: contextSha,
        tasks: state.tasks, captured_at: new Date().toISOString(), generation_executed: false,
    };
    const request = {
        schema_version: REQUEST_SCHEMA, lane, request_id: requestId, instruction,
        target_task_token: task.task_token, target_context_sha256: contextSha, revisions: revision,
        status: 'queued_local_handoff', queued_at: new Date().toISOString(),
        model_called: false, generation_executed: false,
    };
    let alreadyQueued = false;
    try {
        const existing = readPrivate(path.join(paths.requests, `${requestId}.json`));
        if (existing.request_id !== requestId || existing.target_context_sha256 !== contextSha) throw failure('PROMPT_AGENT_REQUEST_CONFLICT');
        alreadyQueued = true;
    } catch (error) {
        if (error.code !== 'PROMPT_AGENT_FILE_MISSING') throw error;
        privateWrite(path.join(paths.snapshots, `${requestId}.json`), snapshot);
        privateWrite(path.join(paths.requests, `${requestId}.json`), request);
    }
    return { ok: true, status: 'queued_local_handoff', request_id: requestId, already_queued: alreadyQueued,
        executed: false, model_called: false, generation_executed: false };
}

function prepare({ lane, requestId, state, planPaths }) {
    if (!SAFE_REQUEST.test(requestId || '')) throw failure('PROMPT_AGENT_REQUEST_ID_INVALID');
    const paths = ensureRoots(planPaths);
    const request = readPrivate(path.join(paths.requests, `${requestId}.json`));
    const snapshot = readPrivate(path.join(paths.snapshots, `${requestId}.json`));
    if (request.lane !== lane || snapshot.lane !== lane || request.request_id !== requestId
        || snapshot.request_id !== requestId) throw failure('PROMPT_AGENT_REQUEST_INVALID');
    assertExpected(lane, request.revisions, state);
    const task = state.tasks.find((item) => item.task_token === request.target_task_token);
    if (!task || targetContext(task) !== request.target_context_sha256) {
        throw failure(`${lane.toUpperCase()}_PROMPT_AGENT_PLAN_STALE`);
    }
    return { request, snapshot, target: task };
}

function publish({ lane, payload, state, planPaths, appModelCalled = false }) {
    exactKeys(payload, ['request_id', 'proposed_prompt', 'summary'], 'PROMPT_AGENT_SUGGESTION_SHAPE_INVALID');
    const handoff = prepare({ lane, requestId: payload.request_id, state, planPaths });
    const proposedPrompt = boundedText(payload.proposed_prompt, MAX_PROMPT_BYTES, 'AGENT_OUTPUT_INVALID');
    const summary = boundedText(payload.summary, MAX_SUMMARY_BYTES, 'AGENT_OUTPUT_INVALID');
    if (proposedPrompt === handoff.target.prompt.trim()) throw failure(`${lane.toUpperCase()}_PROMPT_AGENT_SUGGESTION_NOOP`);
    const token = `suggestion_${sha256(JSON.stringify({ request: payload.request_id, proposedPrompt, summary }))}`;
    const record = {
        schema_version: SUGGESTION_SCHEMA, lane, suggestion_token: token,
        request_id: payload.request_id, target_task_token: handoff.target.task_token,
        source_target_context_sha256: handoff.request.target_context_sha256,
        proposed_prompt: proposedPrompt, summary, created_at: new Date().toISOString(),
        model_called: appModelCalled === true, generation_executed: false,
    };
    const paths = ensureRoots(planPaths);
    try { privateWrite(path.join(paths.suggestions, `${token}.json`), record); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const existing = readPrivate(path.join(paths.suggestions, `${token}.json`));
        if (JSON.stringify({ ...existing, created_at: record.created_at }) !== JSON.stringify(record)) {
            throw failure('PROMPT_AGENT_SUGGESTION_CONFLICT');
        }
    }
    return { ok: true, status: 'suggestion_ready', suggestion_token: token,
        executed: appModelCalled === true, model_called: appModelCalled === true, generation_executed: false };
}

function findSuggestion(paths, token) {
    if (!SAFE_SUGGESTION.test(token || '')) throw failure('PROMPT_AGENT_SUGGESTION_TOKEN_INVALID');
    return readPrivate(path.join(paths.suggestions, `${token}.json`));
}

function receiptFor(paths, token) {
    for (const action of ['apply', 'hold']) {
        try { return readPrivate(path.join(paths.receipts, `${action}_${token}.json`)); }
        catch (error) { if (error.code !== 'PROMPT_AGENT_FILE_MISSING') throw error; }
    }
    return null;
}

function decide({ lane, payload, state, planPaths, save }) {
    exactKeys(payload, lane === 'video'
        ? ['suggestion_token', 'action', 'expected_design_revision_sha256', 'expected_image_plan_revision_sha256', 'expected_video_plan_revision_sha256']
        : ['suggestion_token', 'action', 'expected_design_revision_sha256', 'expected_image_plan_revision_sha256'],
    `${lane.toUpperCase()}_PROMPT_AGENT_DECISION_SHAPE_INVALID`);
    if (!['apply', 'hold'].includes(payload.action)) throw failure('PROMPT_AGENT_DECISION_INVALID');
    const paths = ensureRoots(planPaths);
    const suggestion = findSuggestion(paths, payload.suggestion_token);
    if (suggestion.lane !== lane) throw failure('PROMPT_AGENT_SUGGESTION_INVALID');
    const existingReceipt = receiptFor(paths, suggestion.suggestion_token);
    if (existingReceipt) {
        if (existingReceipt.action !== payload.action) throw failure('PROMPT_AGENT_ALREADY_DECIDED');
        return { ok: true, status: existingReceipt.status, applied: payload.action === 'apply', held: payload.action === 'hold',
            already_decided: true, receipt_recovered: false, executed: false, model_called: false, generation_executed: false };
    }
    const expected = lane === 'video' ? {
        design_revision_sha256: payload.expected_design_revision_sha256,
        image_plan_revision_sha256: payload.expected_image_plan_revision_sha256,
        plan_revision_sha256: payload.expected_video_plan_revision_sha256,
    } : {
        design_revision_sha256: payload.expected_design_revision_sha256,
        plan_revision_sha256: payload.expected_image_plan_revision_sha256,
    };
    assertExpected(lane, expected, state);
    const target = state.tasks.find((task) => task.task_token === suggestion.target_task_token);
    if (!target || targetContext(target) !== suggestion.source_target_context_sha256) {
        throw failure(`${lane.toUpperCase()}_PROMPT_AGENT_PLAN_STALE`);
    }
    let nextState = state;
    if (payload.action === 'apply') {
        if (target.result_token && target.status !== '재제작') {
            throw failure(`${lane.toUpperCase()}_PROMPT_AGENT_ACCEPTED_TASK_REQUIRES_RETRY`);
        }
        const tasks = state.tasks.map((task) => task.task_token === target.task_token
            ? { ...task, prompt: suggestion.proposed_prompt } : task);
        nextState = save(tasks, state);
    }
    const receipt = {
        schema_version: RECEIPT_SCHEMA, lane, suggestion_token: suggestion.suggestion_token,
        action: payload.action, status: payload.action === 'apply' ? 'applied' : 'held',
        decided_at: new Date().toISOString(), generation_executed: false,
    };
    privateWrite(path.join(paths.receipts, `${payload.action}_${suggestion.suggestion_token}.json`), receipt);
    return { ok: true, status: receipt.status, applied: payload.action === 'apply', held: payload.action === 'hold',
        already_decided: false, receipt_recovered: false, executed: false, model_called: false,
        generation_executed: false, state: nextState };
}

function publicState(planPaths) {
    const empty = { recent_requests: [], executed: false, model_called: false, generation_executed: false };
    if (!fs.existsSync(planPaths.root)) return empty;
    let paths;
    try { paths = ensureRoots(planPaths); } catch { return empty; }
    let entries;
    try { entries = fs.readdirSync(paths.requests, { withFileTypes: true }); } catch { return empty; }
    const requests = [];
    for (const entry of entries) {
        if (!entry.isFile() || entry.isSymbolicLink() || !/^request_[a-f0-9]{64}\.json$/.test(entry.name)) continue;
        try {
            const request = readPrivate(path.join(paths.requests, entry.name));
            const suggestionEntries = fs.readdirSync(paths.suggestions).filter((name) => /^suggestion_[a-f0-9]{64}\.json$/.test(name));
            const suggestion = suggestionEntries.map((name) => {
                try { return readPrivate(path.join(paths.suggestions, name)); } catch { return null; }
            }).find((item) => item?.request_id === request.request_id) || null;
            const receipt = suggestion ? receiptFor(paths, suggestion.suggestion_token) : null;
            requests.push({
                request_id: request.request_id, target_task_token: request.target_task_token,
                instruction: request.instruction,
                status: receipt?.status || (suggestion ? 'suggestion_ready' : request.status),
                suggestion: suggestion ? {
                    suggestion_token: suggestion.suggestion_token,
                    proposed_prompt: suggestion.proposed_prompt,
                    summary: suggestion.summary,
                    model_called: suggestion.model_called,
                } : null,
                queued_at: request.queued_at,
            });
        } catch { /* omit malformed private records from renderer */ }
    }
    requests.sort((left, right) => String(right.queued_at).localeCompare(String(left.queued_at)));
    return { recent_requests: requests.slice(0, 20), executed: false,
        model_called: requests.some((item) => item.suggestion?.model_called === true), generation_executed: false };
}

module.exports = { pathsFor, enqueue, prepare, publish, decide, publicState };
