import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import provider from '../electron/lib/filmPipelineProvider.js';
import draftProvider from '../electron/lib/newProjectDraftProvider.js';

const { HARNESS_CONTRACT_ALLOWLIST, getHarnessContractStatus, register } = provider;
const {
    enqueuePlanningAgentRequest, exactDraftPaths, getNewProjectDraftState, saveNewProjectDraft,
} = draftProvider;

const markerContent = Object.freeze({
    pack_builder: '#!/usr/bin/env python3\n--brief --script --production-id --output-root --target-generator\n',
    pack_validator: '#!/usr/bin/env python3\nvalidate_pipeline_pack production_dir --json\n',
    room_plan_builder: '#!/usr/bin/env python3\nbuild_drama_selection_plan --package-dir --ledger-output\n',
    room_verifier: '#!/usr/bin/env python3\nrun_drama_room_pipeline_verification selected_takes_contract_matches_edit_render_consumer\n',
    canonical_pack_contract: 'PACK_CONTRACT_VERSION\nactual_generation_submitted\ncanonical_production_id_mismatch\n',
});

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-planning-agent-')));
    const userDataPath = path.join(base, 'user-data');
    const harnessRoot = path.join(base, 'happyVideoFactory');
    const productionParentRoot = path.join(base, 'productions');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    fs.mkdirSync(harnessRoot);
    fs.mkdirSync(productionParentRoot);
    for (const contract of HARNESS_CONTRACT_ALLOWLIST) {
        const filePath = path.join(harnessRoot, contract.relativePath);
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        fs.writeFileSync(filePath, markerContent[contract.id]);
    }
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath, harnessRoot, productionParentRoot };
}

function validDraft(overrides = {}) {
    return {
        production_id: 'planning-collab-01',
        brief: '비 오는 골목에서 다시 만나는 두 사람의 짧은 이야기.',
        script: '문이 열리고 두 사람은 잠시 서로를 바라본다.',
        route: 'both',
        aspect_ratio: '9:16',
        scene_duration: 5,
        max_scenes: 4,
        ...overrides,
    };
}

function context(parts, overrides = {}) {
    return {
        userDataPath: parts.userDataPath,
        config: {
            productionRoot: '',
            productionParentRoot: parts.productionParentRoot,
            recentProductionRoots: [],
            pathProvenanceVersion: 1,
            dryRunMode: true,
            allowSafeCommandExecution: false,
        },
        harnessStatus: getHarnessContractStatus({ harnessRoot: parts.harnessRoot }),
        ...overrides,
    };
}

function request(state, overrides = {}) {
    return {
        stage: 'brief',
        instruction: '로그라인을 더 분명하게 다듬어 주세요.',
        expected_revision_sha256: state.revision_sha256,
        ...overrides,
    };
}

test('private planning request is atomic, restorable, pathless, and idempotent without executing an agent', (t) => {
    const parts = fixture(t);
    const saved = saveNewProjectDraft(validDraft(), context(parts));
    assert.match(saved.revision_sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(saved.collaboration, {
        status: 'empty', total_request_count: 0, recent_requests: [], truncated: false, blockers: [],
    });

    const first = enqueuePlanningAgentRequest(request(saved), context(parts));
    assert.equal(first.ok, true);
    assert.equal(first.queued, true);
    assert.equal(first.already_queued, false);
    assert.equal(first.status, 'queued_local_handoff');
    assert.equal(first.executed, false);
    assert.equal(first.model_called, false);
    assert.match(first.request_id, /^request_[a-f0-9]{64}$/);

    const paths = exactDraftPaths(parts.userDataPath);
    assert.equal(fs.lstatSync(paths.collaborationRoot).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(paths.planningAgentQueueRoot).mode & 0o777, 0o700);
    const entries = fs.readdirSync(paths.planningAgentQueueRoot);
    assert.deepEqual(entries, [`${first.request_id}.json`]);
    const requestPath = path.join(paths.planningAgentQueueRoot, entries[0]);
    assert.equal(fs.lstatSync(requestPath).mode & 0o777, 0o600);
    const record = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
    assert.deepEqual(Object.keys(record).sort(), [
        'brief_sha256', 'draft_revision_sha256', 'executed', 'instruction', 'model_called',
        'production_id', 'request_id', 'requested_at', 'schema_version', 'script_sha256', 'stage', 'status',
    ].sort());
    assert.equal(record.schema_version, 'film_pipeline.planning_agent_request.v1');
    assert.equal(record.executed, false);
    assert.equal(record.model_called, false);
    assert.equal(Object.hasOwn(record, 'rootPath'), false);
    assert.equal(Object.hasOwn(record, 'command'), false);
    assert.equal(Object.hasOwn(record, 'brief'), false);
    assert.equal(Object.hasOwn(record, 'script'), false);

    const originalRequestText = fs.readFileSync(requestPath, 'utf8');
    const second = enqueuePlanningAgentRequest(request(saved), context(parts));
    assert.equal(second.already_queued, true);
    assert.equal(second.request_id, first.request_id);
    assert.deepEqual(fs.readdirSync(paths.planningAgentQueueRoot), entries);
    assert.equal(fs.readFileSync(requestPath, 'utf8'), originalRequestText);

    const restored = getNewProjectDraftState(context(parts));
    assert.equal(restored.collaboration.status, 'queued');
    assert.equal(restored.collaboration.total_request_count, 1);
    assert.equal(restored.collaboration.recent_requests[0].request_id, first.request_id);
    assert.equal(restored.collaboration.recent_requests[0].status, 'queued_local_handoff');
});

test('request validation rejects stale revisions, injection fields, malformed text, and oversized instructions before queue writes', (t) => {
    const parts = fixture(t);
    assert.throws(
        () => enqueuePlanningAgentRequest({
            stage: 'brief', instruction: '먼저 저장해 주세요.', expected_revision_sha256: 'a'.repeat(64),
        }, context(parts)),
        (error) => error.code === 'PLANNING_AGENT_DRAFT_NOT_SAVED',
    );
    const saved = saveNewProjectDraft(validDraft(), context(parts));
    const paths = exactDraftPaths(parts.userDataPath);
    const invalid = [
        [request(saved, { stage: 'storyboard' }), 'PLANNING_AGENT_REQUEST_STAGE_INVALID'],
        [request(saved, { instruction: '' }), 'PLANNING_AGENT_REQUEST_INSTRUCTION_INVALID'],
        [request(saved, { instruction: 'bad\0instruction' }), 'PLANNING_AGENT_REQUEST_INSTRUCTION_INVALID'],
        [request(saved, { instruction: '\uD800' }), 'PLANNING_AGENT_REQUEST_INSTRUCTION_INVALID'],
        [request(saved, { instruction: 'x'.repeat(16 * 1024 + 1) }), 'PLANNING_AGENT_REQUEST_INSTRUCTION_INVALID'],
        [request(saved, { expected_revision_sha256: 'bad' }), 'PLANNING_AGENT_REQUEST_REVISION_INVALID'],
        [{ ...request(saved), rootPath: parts.productionParentRoot }, 'PLANNING_AGENT_REQUEST_SHAPE_INVALID'],
        [{ ...request(saved), command: 'run-agent' }, 'PLANNING_AGENT_REQUEST_SHAPE_INVALID'],
        [{ ...request(saved), model: 'remote-model' }, 'PLANNING_AGENT_REQUEST_SHAPE_INVALID'],
    ];
    for (const [payload, code] of invalid) {
        assert.throws(
            () => enqueuePlanningAgentRequest(payload, context(parts)),
            (error) => error.code === code,
            code,
        );
    }
    assert.equal(fs.existsSync(paths.collaborationRoot), false);

    saveNewProjectDraft(validDraft({ brief: '수정된 기획입니다.' }), context(parts));
    assert.throws(
        () => enqueuePlanningAgentRequest(request(saved), context(parts)),
        (error) => error.code === 'PLANNING_AGENT_REQUEST_STALE',
    );
    assert.equal(fs.existsSync(paths.collaborationRoot), false);
});

test('collaboration reconstruction keeps the complete count but returns only the newest twenty requests', (t) => {
    const parts = fixture(t);
    const saved = saveNewProjectDraft(validDraft(), context(parts));
    for (let index = 0; index < 21; index += 1) {
        enqueuePlanningAgentRequest(request(saved, {
            instruction: `기획 검토 요청 ${String(index).padStart(2, '0')}`,
        }), context(parts));
    }
    const state = getNewProjectDraftState(context(parts));
    assert.equal(state.collaboration.status, 'queued');
    assert.equal(state.collaboration.total_request_count, 21);
    assert.equal(state.collaboration.recent_requests.length, 20);
    assert.equal(state.collaboration.truncated, true);
    assert.equal(state.collaboration.recent_requests.every((item) => item.executed === false), true);
    assert.equal(state.collaboration.recent_requests.every((item) => item.model_called === false), true);
});

test('queue symlinks, broad permissions, and rename failure fail closed without outside writes or temp residue', (t) => {
    const linked = fixture(t);
    const linkedSaved = saveNewProjectDraft(validDraft(), context(linked));
    const linkedPaths = exactDraftPaths(linked.userDataPath);
    const outside = path.join(linked.base, 'outside');
    fs.mkdirSync(outside);
    const sentinel = path.join(outside, 'sentinel');
    fs.writeFileSync(sentinel, 'unchanged');
    fs.symlinkSync(outside, linkedPaths.collaborationRoot, 'dir');
    assert.throws(
        () => enqueuePlanningAgentRequest(request(linkedSaved), context(linked)),
        (error) => error.code === 'PLANNING_AGENT_QUEUE_DIRECTORY_UNSAFE',
    );
    assert.equal(fs.readFileSync(sentinel, 'utf8'), 'unchanged');
    assert.deepEqual(fs.readdirSync(outside), ['sentinel']);

    const failed = fixture(t);
    const failedSaved = saveNewProjectDraft(validDraft(), context(failed));
    const failedPaths = exactDraftPaths(failed.userDataPath);
    assert.throws(
        () => enqueuePlanningAgentRequest(request(failedSaved), context(failed, {
            renameFile() { throw Object.assign(new Error('injected queue rename failure'), { code: 'EIO' }); },
        })),
        (error) => error.code === 'EIO',
    );
    assert.deepEqual(fs.readdirSync(failedPaths.planningAgentQueueRoot), []);

    const unsafe = fixture(t);
    const unsafeSaved = saveNewProjectDraft(validDraft(), context(unsafe));
    const queued = enqueuePlanningAgentRequest(request(unsafeSaved), context(unsafe));
    const unsafePaths = exactDraftPaths(unsafe.userDataPath);
    const unsafeRequest = path.join(unsafePaths.planningAgentQueueRoot, `${queued.request_id}.json`);
    fs.chmodSync(unsafeRequest, 0o644);
    const blocked = getNewProjectDraftState(context(unsafe));
    assert.equal(blocked.ok, true, 'unsafe collaboration must not poison direct draft editing');
    assert.equal(blocked.collaboration.status, 'blocked');
    assert.ok(blocked.collaboration.blockers.includes('NEW_PROJECT_DRAFT_FILE_UNSAFE'));
    assert.throws(
        () => enqueuePlanningAgentRequest(request(unsafeSaved), context(unsafe)),
        (error) => error.code === 'NEW_PROJECT_DRAFT_FILE_UNSAFE',
    );
});

test('registered enqueue IPC accepts only request data and exposes no path or execution result', (t) => {
    const parts = fixture(t);
    const handlers = new Map();
    register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
        userDataPath: parts.userDataPath,
        harnessRoot: parts.harnessRoot,
        readConfigFn: () => context(parts).config,
    });
    const invoke = (channel, payload) => handlers.get(channel)({}, payload);
    const saved = invoke('film-pipeline:save-new-project-draft', validDraft());
    const result = invoke('film-pipeline:enqueue-planning-agent-request', request(saved));
    assert.equal(result.queued, true);
    assert.equal(result.executed, false);
    assert.equal(result.model_called, false);
    assert.equal(Object.hasOwn(result, 'rootPath'), false);
    assert.equal(Object.hasOwn(result, 'relativePath'), false);
    assert.throws(
        () => invoke('film-pipeline:enqueue-planning-agent-request', { ...request(saved), cwd: parts.base }),
        (error) => error.code === 'PLANNING_AGENT_REQUEST_SHAPE_INVALID',
    );
});
