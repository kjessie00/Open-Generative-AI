import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import filmProvider from '../electron/lib/filmPipelineProvider.js';

const {
    decideDesignAgentSuggestion,
    enqueueDesignAgentRequest,
    exactPaths,
    getNewProjectDesignState,
    prepareDesignAgentHandoff,
    publishDesignAgentSuggestion,
    saveNewProjectDesignBoard,
    validateBoard,
} = designProvider;

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-design-')));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath };
}

function context(parts, overrides = {}) {
    return { userDataPath: parts.userDataPath, ...overrides };
}

function planningDraft(overrides = {}) {
    return {
        production_id: 'design-project-01',
        brief: '좁은 작업실에서 마지막 선택을 앞둔 주인공의 이야기.',
        script: '주인공은 문 앞에 멈춰 서서 방 안을 돌아본다.',
        route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 4,
        ...overrides,
    };
}

function savePlanning(parts, overrides = {}) {
    return draftProvider.saveNewProjectDraft(planningDraft(overrides), context(parts));
}

function minimalBoard(overrides = {}) {
    return {
        characters: [{
            id: 'hero', name: '주인공', role: '', appearance: '', wardrobe: '', continuity: '',
        }],
        locations: [{
            id: 'workroom', name: '작업실', space: '', lighting: '', props: '', continuity: '',
        }],
        scenes: [{
            id: 'scene_01', title: '마지막 선택', dramatic_beat: '문을 열지 망설인다.',
            characters: [], location_id: 'workroom', duration: 5, first_frame: '',
            action: '문고리를 잡고 멈춘다.', camera: '', lighting: '', audio_sfx_dialogue: '',
        }],
        ...overrides,
    };
}

function revisedBoard() {
    const board = structuredClone(minimalBoard());
    board.scenes[0].action = '문고리를 잡고 숨을 고른 뒤 천천히 문을 연다.';
    return board;
}

function saveBoard(parts, board = minimalBoard()) {
    const state = getNewProjectDesignState(context(parts));
    return saveNewProjectDesignBoard({
        board,
        expected_planning_revision_sha256: state.planning_revision_sha256,
        expected_design_revision_sha256: state.revision_sha256,
    }, context(parts));
}

function queue(parts, state = getNewProjectDesignState(context(parts)), instruction = '장면 행동을 더 선명하게 다듬어 주세요.') {
    return enqueueDesignAgentRequest({
        instruction,
        expected_planning_revision_sha256: state.planning_revision_sha256,
        expected_design_revision_sha256: state.revision_sha256,
    }, context(parts));
}

function publish(parts, requestId, board = revisedBoard(), summary = '장면의 선택과 행동을 구체화했습니다.') {
    return publishDesignAgentSuggestion({ request_id: requestId, proposed_board: board, summary }, context(parts));
}

test('design state requires a saved planning source and minimally saves/restores the exact private board', (t) => {
    const parts = fixture(t);
    const blocked = getNewProjectDesignState(context(parts));
    assert.equal(blocked.status, 'blocked');
    assert.deepEqual(blocked.blockers, ['DESIGN_PLANNING_DRAFT_REQUIRED']);

    const planning = savePlanning(parts);
    const empty = getNewProjectDesignState(context(parts));
    assert.equal(empty.status, 'empty');
    assert.equal(empty.planning_revision_sha256, planning.revision_sha256);
    assert.match(empty.revision_sha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(empty.board, { characters: [], locations: [], scenes: [] });

    const saved = saveNewProjectDesignBoard({
        board: minimalBoard(),
        expected_planning_revision_sha256: empty.planning_revision_sha256,
        expected_design_revision_sha256: empty.revision_sha256,
    }, context(parts));
    assert.equal(saved.status, 'saved');
    assert.deepEqual(saved.board, minimalBoard());
    assert.notEqual(saved.revision_sha256, empty.revision_sha256);

    const paths = exactPaths(parts.userDataPath);
    assert.equal(fs.lstatSync(paths.designRoot).mode & 0o777, 0o700);
    assert.equal(fs.lstatSync(paths.boardPath).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(paths.boardPath, 'utf8')), minimalBoard());
    const restored = getNewProjectDesignState(context(parts));
    assert.equal(restored.status, 'restored');
    assert.equal(restored.revision_sha256, saved.revision_sha256);
    assert.equal(JSON.stringify(restored).includes(parts.base), false, 'public state is pathless');
});

test('board validation accepts optional empty fields and rejects shape, limits, duplicates, and unknown references', () => {
    assert.deepEqual(validateBoard(minimalBoard()), minimalBoard());
    const invalid = [
        [{ ...minimalBoard(), extra: true }, 'DESIGN_BOARD_SHAPE_INVALID'],
        [{ ...minimalBoard(), characters: Array.from({ length: 13 }, (_, index) => ({
            ...minimalBoard().characters[0], id: `hero_${index}`,
        })) }, 'DESIGN_CHARACTERS_INVALID'],
        [{ ...minimalBoard(), locations: Array.from({ length: 13 }, (_, index) => ({
            ...minimalBoard().locations[0], id: `room_${index}`,
        })) }, 'DESIGN_LOCATIONS_INVALID'],
        [{ ...minimalBoard(), scenes: Array.from({ length: 21 }, (_, index) => ({
            ...minimalBoard().scenes[0], id: `scene_${index}`,
        })) }, 'DESIGN_SCENES_INVALID'],
        [{ ...minimalBoard(), characters: [{ ...minimalBoard().characters[0] }, { ...minimalBoard().characters[0] }] }, 'DESIGN_CHARACTER_ID_DUPLICATE'],
        [{ ...minimalBoard(), scenes: [{ ...minimalBoard().scenes[0], location_id: 'missing' }] }, 'DESIGN_SCENE_LOCATION_UNKNOWN'],
        [{ ...minimalBoard(), scenes: [{ ...minimalBoard().scenes[0], characters: ['missing'] }] }, 'DESIGN_SCENE_CHARACTER_UNKNOWN'],
        [{ ...minimalBoard(), scenes: [{ ...minimalBoard().scenes[0], duration: 0 }] }, 'DESIGN_SCENE_DURATION_INVALID'],
        [{ ...minimalBoard(), scenes: [] }, 'DESIGN_BOARD_INCOMPLETE'],
    ];
    for (const [board, code] of invalid) {
        assert.throws(() => validateBoard(board), (error) => error.code === code, code);
    }
});

test('empty design request publishes an exact immutable snapshot before its pathless queue marker', (t) => {
    const parts = fixture(t);
    savePlanning(parts);
    const initial = getNewProjectDesignState(context(parts));
    const queued = queue(parts, initial);
    const paths = exactPaths(parts.userDataPath);
    const requestPath = path.join(paths.queueRoot, `${queued.request_id}.json`);
    const requestBefore = fs.readFileSync(requestPath);
    const record = JSON.parse(requestBefore);
    assert.equal(record.executed, false);
    assert.equal(record.model_called, false);
    assert.equal(Object.hasOwn(record, 'path'), false);
    assert.equal(Object.hasOwn(record, 'brief'), false);
    assert.equal(Object.hasOwn(record, 'board'), false);

    const snapshotRoot = path.join(paths.snapshotsRoot, `revision_${initial.revision_sha256}`);
    assert.equal(fs.lstatSync(snapshotRoot).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(snapshotRoot).sort(), ['brief.md', 'design.json', 'manifest.json', 'script.txt']);
    for (const name of fs.readdirSync(snapshotRoot)) assert.equal(fs.lstatSync(path.join(snapshotRoot, name)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(snapshotRoot, 'design.json'), 'utf8')), initial.board);
    const handoff = prepareDesignAgentHandoff({ request_id: queued.request_id }, context(parts));
    assert.deepEqual(handoff.snapshot.board, initial.board);
    assert.equal(handoff.snapshot.brief, planningDraft().brief);
    assert.equal(handoff.snapshot.script, planningDraft().script);
    assert.deepEqual(fs.readFileSync(requestPath), requestBefore, 'prepare never mutates the immutable request');
});

test('real design handoff CLI keeps packets private and publishes only opaque receipt metadata', (t) => {
    const parts = fixture(t);
    savePlanning(parts);
    const queued = queue(parts);
    const cli = path.resolve('scripts/design_agent_handoff.mjs');
    const prepared = spawnSync(process.execPath, [cli, 'prepare', '--user-data', parts.userDataPath, '--request-id', queued.request_id], {
        encoding: 'utf8', cwd: path.resolve('.'),
    });
    assert.equal(prepared.status, 0, prepared.stderr);
    const prepareOutput = JSON.parse(prepared.stdout);
    assert.deepEqual(Object.keys(prepareOutput).sort(), ['handle', 'ok', 'request_id', 'stage']);
    assert.equal(prepareOutput.stage, 'design');
    assert.equal(prepared.stdout.includes(planningDraft().brief), false);
    assert.equal(fs.lstatSync(prepareOutput.handle).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(prepareOutput.handle).sort(), ['brief.md', 'design.json', 'request.json', 'script.txt']);
    for (const name of fs.readdirSync(prepareOutput.handle)) assert.equal(fs.lstatSync(path.join(prepareOutput.handle, name)).mode & 0o777, 0o600);
    t.after(() => fs.rmSync(prepareOutput.handle, { recursive: true, force: true }));

    const inputPath = path.join(parts.base, 'suggestion-input.json');
    fs.writeFileSync(inputPath, JSON.stringify({
        request_id: queued.request_id, proposed_board: minimalBoard(), summary: '첫 설계안을 구성했습니다.',
    }), { mode: 0o600 });
    const published = spawnSync(process.execPath, [cli, 'publish', '--user-data', parts.userDataPath, '--input', inputPath], {
        encoding: 'utf8', cwd: path.resolve('.'),
    });
    assert.equal(published.status, 0, published.stderr);
    const publishOutput = JSON.parse(published.stdout);
    assert.deepEqual(Object.keys(publishOutput).sort(), [
        'already_published', 'ok', 'proposed_board_bytes', 'proposed_board_sha256',
        'request_id', 'status', 'suggestion_token',
    ]);
    assert.equal(published.stdout.includes('주인공'), false);
    assert.equal(published.stdout.includes(inputPath), false);
    const ready = getNewProjectDesignState(context(parts));
    assert.equal(ready.collaboration.status, 'suggestion_ready');
    assert.equal(ready.collaboration.recent_requests[0].suggestion.review_status, 'ready');
    assert.equal(JSON.stringify(ready.collaboration).includes(parts.base), false);
});

test('MOCK suggestion is immutable, rejects no-op/conflict, and supports hold then whole-board apply', (t) => {
    const parts = fixture(t);
    savePlanning(parts);
    const saved = saveBoard(parts);
    const queued = queue(parts, saved);
    assert.throws(
        () => publish(parts, queued.request_id, minimalBoard()),
        (error) => error.code === 'DESIGN_AGENT_SUGGESTION_NOOP',
    );
    const suggestion = publish(parts, queued.request_id);
    const paths = exactPaths(parts.userDataPath);
    assert.equal(fs.lstatSync(path.join(paths.suggestionsRoot, `${queued.request_id}.json`)).mode & 0o777, 0o600);
    const duplicate = publish(parts, queued.request_id);
    assert.equal(duplicate.already_published, true);
    assert.throws(
        () => publish(parts, queued.request_id, { ...revisedBoard(), scenes: [{ ...revisedBoard().scenes[0], title: '다른 수정안' }] }),
        (error) => error.code === 'DESIGN_AGENT_SUGGESTION_CONFLICT',
    );
    let ready = getNewProjectDesignState(context(parts));
    assert.equal(ready.collaboration.recent_requests[0].suggestion.apply_allowed, true);
    const held = decideDesignAgentSuggestion({
        suggestion_token: suggestion.suggestion_token, action: 'hold',
        expected_design_revision_sha256: ready.revision_sha256,
    }, context(parts));
    assert.equal(held.held, true);
    assert.deepEqual(held.state.board, minimalBoard());
    assert.equal(fs.lstatSync(path.join(paths.receiptsRoot, `hold_${suggestion.suggestion_token}.json`)).mode & 0o777, 0o600);
    ready = getNewProjectDesignState(context(parts));
    assert.equal(ready.collaboration.recent_requests[0].suggestion.review_status, 'held');
    const applied = decideDesignAgentSuggestion({
        suggestion_token: suggestion.suggestion_token, action: 'apply',
        expected_design_revision_sha256: ready.revision_sha256,
    }, context(parts));
    assert.equal(applied.applied, true);
    assert.deepEqual(applied.state.board, revisedBoard());
    assert.equal(fs.lstatSync(path.join(paths.receiptsRoot, `apply_${suggestion.suggestion_token}.json`)).mode & 0o777, 0o600);
    const restarted = getNewProjectDesignState(context(parts));
    assert.equal(restarted.collaboration.recent_requests[0].suggestion.review_status, 'applied');
    assert.deepEqual(restarted.board, revisedBoard());
});

test('apply fails on whole-board drift, recovers save-before-receipt, and tracks later design or planning edits', (t) => {
    const staleParts = fixture(t);
    savePlanning(staleParts);
    const staleSaved = saveBoard(staleParts);
    const staleQueued = queue(staleParts, staleSaved);
    const staleSuggestion = publish(staleParts, staleQueued.request_id);
    const userBoard = structuredClone(minimalBoard());
    userBoard.scenes[0].action = '사용자가 직접 바꾼 행동.';
    const changed = saveNewProjectDesignBoard({
        board: userBoard,
        expected_planning_revision_sha256: staleSaved.planning_revision_sha256,
        expected_design_revision_sha256: staleSaved.revision_sha256,
    }, context(staleParts));
    assert.throws(() => decideDesignAgentSuggestion({
        suggestion_token: staleSuggestion.suggestion_token, action: 'apply',
        expected_design_revision_sha256: changed.revision_sha256,
    }, context(staleParts)), (error) => error.code === 'DESIGN_AGENT_SUGGESTION_STALE');

    const recoveryParts = fixture(t);
    savePlanning(recoveryParts);
    const recoverySaved = saveBoard(recoveryParts);
    const recoveryQueued = queue(recoveryParts, recoverySaved);
    const recoverySuggestion = publish(recoveryParts, recoveryQueued.request_id);
    assert.throws(() => decideDesignAgentSuggestion({
        suggestion_token: recoverySuggestion.suggestion_token, action: 'apply',
        expected_design_revision_sha256: recoverySaved.revision_sha256,
    }, context(recoveryParts, {
        linkFile() { throw Object.assign(new Error('receipt publish failed'), { code: 'EIO' }); },
    })), (error) => error.code === 'EIO');
    assert.deepEqual(getNewProjectDesignState(context(recoveryParts)).board, revisedBoard());
    const recovered = decideDesignAgentSuggestion({
        suggestion_token: recoverySuggestion.suggestion_token, action: 'apply',
        expected_design_revision_sha256: recoverySaved.revision_sha256,
    }, context(recoveryParts));
    assert.equal(recovered.receipt_recovered, true);
    assert.equal(recovered.state.collaboration.recent_requests[0].suggestion.review_status, 'applied');

    savePlanning(recoveryParts, { brief: '기획을 사용자가 직접 수정했습니다.' });
    const planningEdited = getNewProjectDesignState(context(recoveryParts));
    assert.equal(planningEdited.collaboration.recent_requests[0].suggestion.review_status, 'applied_then_edited');
    const duplicate = decideDesignAgentSuggestion({
        suggestion_token: recoverySuggestion.suggestion_token, action: 'apply',
        expected_design_revision_sha256: planningEdited.revision_sha256,
    }, context(recoveryParts));
    assert.equal(duplicate.status, 'applied_then_edited');
});

test('direct save, queue, and registered IPC reject stale or path-bearing renderer payloads', (t) => {
    const parts = fixture(t);
    savePlanning(parts);
    const empty = getNewProjectDesignState(context(parts));
    assert.throws(() => saveNewProjectDesignBoard({
        board: minimalBoard(), expected_planning_revision_sha256: 'a'.repeat(64),
        expected_design_revision_sha256: empty.revision_sha256,
    }, context(parts)), (error) => error.code === 'DESIGN_PLANNING_REVISION_STALE');
    assert.throws(() => queue(parts, { ...empty, revision_sha256: 'b'.repeat(64) }), (error) => error.code === 'DESIGN_REVISION_STALE');
    assert.throws(() => enqueueDesignAgentRequest({
        instruction: '설계', expected_planning_revision_sha256: empty.planning_revision_sha256,
        expected_design_revision_sha256: empty.revision_sha256, rootPath: parts.base,
    }, context(parts)), (error) => error.code === 'DESIGN_AGENT_REQUEST_SHAPE_INVALID');

    const handlers = new Map();
    filmProvider.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
        userDataPath: parts.userDataPath,
        harnessRoot: path.join(parts.base, 'missing-harness'),
        readConfigFn: () => ({ productionRoot: '', productionParentRoot: '', recentProductionRoots: [] }),
    });
    const state = handlers.get('film-pipeline:get-new-project-design-state')({}, undefined);
    assert.equal(Object.hasOwn(state, 'rootPath'), false);
    assert.equal(Object.hasOwn(state, 'path'), false);
    const ipcQueued = handlers.get('film-pipeline:enqueue-design-agent-request')({}, {
        instruction: '첫 설계를 작성해 주세요.',
        expected_planning_revision_sha256: state.planning_revision_sha256,
        expected_design_revision_sha256: state.revision_sha256,
    });
    assert.equal(ipcQueued.executed, false);
    assert.equal(ipcQueued.model_called, false);
    assert.equal(JSON.stringify(ipcQueued).includes(parts.base), false);
});

test('queue rejects unexpected, symlinked, or unsafe-mode entries before publishing another request', (t) => {
    const parts = fixture(t);
    savePlanning(parts);
    const state = getNewProjectDesignState(context(parts));
    queue(parts, state, '첫 요청');
    const paths = exactPaths(parts.userDataPath);
    fs.writeFileSync(path.join(paths.queueRoot, 'unexpected.json'), '{}', { mode: 0o600 });
    assert.throws(
        () => queue(parts, state, '두 번째 요청'),
        (error) => error.code === 'DESIGN_AGENT_DIRECTORY_UNSAFE',
    );
    fs.unlinkSync(path.join(paths.queueRoot, 'unexpected.json'));
    const outside = path.join(parts.base, 'outside-request.json');
    fs.writeFileSync(outside, '{}', { mode: 0o600 });
    const linkedName = `request_${'a'.repeat(64)}.json`;
    fs.symlinkSync(outside, path.join(paths.queueRoot, linkedName));
    assert.throws(
        () => queue(parts, state, '두 번째 요청'),
        (error) => error.code === 'DESIGN_AGENT_DIRECTORY_UNSAFE',
    );
    fs.unlinkSync(path.join(paths.queueRoot, linkedName));
    const existing = fs.readdirSync(paths.queueRoot)[0];
    fs.chmodSync(path.join(paths.queueRoot, existing), 0o644);
    assert.throws(
        () => queue(parts, state, '두 번째 요청'),
        (error) => error.code === 'DESIGN_FILE_UNSAFE',
    );
    assert.equal(fs.readdirSync(paths.queueRoot).length, 1);
});

test('snapshot is durable but queue remains empty when the request-last exclusive publish fails', (t) => {
    const parts = fixture(t);
    savePlanning(parts);
    const state = getNewProjectDesignState(context(parts));
    let linkCount = 0;
    assert.throws(() => enqueueDesignAgentRequest({
        instruction: '첫 설계를 작성해 주세요.',
        expected_planning_revision_sha256: state.planning_revision_sha256,
        expected_design_revision_sha256: state.revision_sha256,
    }, context(parts, {
        linkFile(source, target) {
            linkCount += 1;
            if (linkCount === 5) throw Object.assign(new Error('request publish failed'), { code: 'EIO' });
            fs.linkSync(source, target);
        },
    })), (error) => error.code === 'EIO');
    const paths = exactPaths(parts.userDataPath);
    assert.equal(linkCount, 5);
    assert.equal(fs.readdirSync(paths.queueRoot).length, 0);
    assert.deepEqual(
        fs.readdirSync(path.join(paths.snapshotsRoot, `revision_${state.revision_sha256}`)).sort(),
        ['brief.md', 'design.json', 'manifest.json', 'script.txt'],
    );
    assert.equal(fs.readdirSync(paths.queueRoot).some((name) => name.startsWith('.design-')), false);
});

test('save-before-receipt recovery stays stale when planning changes before retry', (t) => {
    const parts = fixture(t);
    savePlanning(parts);
    const saved = saveBoard(parts);
    const queued = queue(parts, saved);
    const suggestion = publish(parts, queued.request_id);
    assert.throws(() => decideDesignAgentSuggestion({
        suggestion_token: suggestion.suggestion_token,
        action: 'apply',
        expected_design_revision_sha256: saved.revision_sha256,
    }, context(parts, {
        linkFile() { throw Object.assign(new Error('receipt publish failed'), { code: 'EIO' }); },
    })), (error) => error.code === 'EIO');
    savePlanning(parts, { brief: '적용 직후 기획이 달라졌습니다.' });
    const changed = getNewProjectDesignState(context(parts));
    assert.equal(changed.collaboration.recent_requests[0].suggestion.review_status, 'stale');
    assert.throws(() => decideDesignAgentSuggestion({
        suggestion_token: suggestion.suggestion_token,
        action: 'apply',
        expected_design_revision_sha256: changed.revision_sha256,
    }, context(parts)), (error) => error.code === 'DESIGN_AGENT_SUGGESTION_STALE');
    assert.equal(getNewProjectDesignState(context(parts)).collaboration.recent_requests[0].suggestion.review_status, 'stale');
});

test('unsafe design directory and files fail closed without changing outside data', (t) => {
    const parts = fixture(t);
    savePlanning(parts);
    const paths = exactPaths(parts.userDataPath);
    const outside = path.join(parts.base, 'outside');
    fs.mkdirSync(outside, { mode: 0o700 });
    const sentinel = path.join(outside, 'sentinel.json');
    fs.writeFileSync(sentinel, '{}');
    fs.symlinkSync(outside, paths.designRoot, 'dir');
    const state = getNewProjectDesignState(context(parts));
    assert.equal(state.status, 'blocked');
    assert.ok(state.blockers.includes('DESIGN_FILE_MISSING') || state.blockers.includes('DESIGN_DIRECTORY_UNSAFE'));
    assert.deepEqual(fs.readdirSync(outside), ['sentinel.json']);
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(sentinel)).digest('hex'), crypto.createHash('sha256').update('{}').digest('hex'));
});
