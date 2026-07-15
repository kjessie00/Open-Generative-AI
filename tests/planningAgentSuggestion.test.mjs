import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';

const {
    decidePlanningAgentSuggestion,
    enqueuePlanningAgentRequest,
    exactDraftPaths,
    getNewProjectDraftState,
    preparePlanningAgentHandoff,
    publishPlanningAgentSuggestion,
    saveNewProjectDraft,
} = draftProvider;

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-planning-suggestion-')));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath };
}

function context(parts, overrides = {}) {
    return {
        userDataPath: parts.userDataPath,
        config: {},
        harnessStatus: { ready: false, readiness: 'blocked', entries: [] },
        ...overrides,
    };
}

function draft(overrides = {}) {
    return {
        production_id: 'planning-suggestion-01',
        brief: '비 오는 골목에서 두 사람이 다시 만난다.',
        script: '문이 열리고 두 사람은 말없이 서로를 바라본다.',
        route: 'both',
        aspect_ratio: '9:16',
        scene_duration: 5,
        max_scenes: 4,
        ...overrides,
    };
}

function queueBrief(parts) {
    const saved = saveNewProjectDraft(draft(), context(parts));
    const queued = enqueuePlanningAgentRequest({
        stage: 'brief',
        instruction: '갈등과 관객 약속을 더 선명하게 다듬어 주세요.',
        expected_revision_sha256: saved.revision_sha256,
    }, context(parts));
    return { saved, queued };
}

function publishMock(parts, requestId, overrides = {}) {
    return publishPlanningAgentSuggestion({
        request_id: requestId,
        proposed_text: '비 오는 골목에서 헤어진 두 사람이 마지막 약속을 지키기 위해 다시 만난다.',
        summary: '핵심 갈등과 재회의 목적을 앞에 배치했습니다.',
        ...overrides,
    }, context(parts));
}

test('v2 request commits an immutable private snapshot before the queue marker and prepares exact source', (t) => {
    const parts = fixture(t);
    const { queued } = queueBrief(parts);
    const paths = exactDraftPaths(parts.userDataPath);
    const requestPath = path.join(paths.planningAgentQueueRoot, `${queued.request_id}.json`);
    const requestBefore = fs.readFileSync(requestPath);
    const request = JSON.parse(requestBefore);
    assert.equal(request.schema_version, 'film_pipeline.planning_agent_request.v2');
    assert.equal(request.snapshot_revision_sha256, request.draft_revision_sha256);

    const snapshotRoot = path.join(paths.planningAgentSnapshotsRoot, `revision_${request.draft_revision_sha256}`);
    assert.equal(fs.lstatSync(snapshotRoot).mode & 0o777, 0o700);
    assert.deepEqual(fs.readdirSync(snapshotRoot).sort(), ['brief.md', 'manifest.json', 'script.txt']);
    for (const name of fs.readdirSync(snapshotRoot)) {
        assert.equal(fs.lstatSync(path.join(snapshotRoot, name)).mode & 0o777, 0o600);
    }
    const handoff = preparePlanningAgentHandoff({ request_id: queued.request_id }, context(parts));
    assert.equal(handoff.legacy_fallback, false);
    assert.equal(handoff.snapshot.brief, draft().brief);
    assert.equal(handoff.snapshot.script, draft().script);
    assert.deepEqual(fs.readFileSync(requestPath), requestBefore, 'prepare must not mutate the request');
});

test('MOCK external publication is pathless in UI state; hold preserves draft and later apply changes only target stage', (t) => {
    const parts = fixture(t);
    const { saved, queued } = queueBrief(parts);
    const suggestion = publishMock(parts, queued.request_id);
    assert.equal(suggestion.app_model_called, false);
    const ready = getNewProjectDraftState(context(parts));
    assert.equal(ready.collaboration.status, 'suggestion_ready');
    assert.equal(ready.collaboration.ready_suggestion_count, 1);
    const publicSuggestion = ready.collaboration.recent_requests[0].suggestion;
    assert.equal(publicSuggestion.review_status, 'ready');
    assert.equal(Object.hasOwn(publicSuggestion, 'path'), false);
    assert.equal(Object.hasOwn(publicSuggestion, 'model'), false);

    const held = decidePlanningAgentSuggestion({
        suggestion_token: suggestion.suggestion_token,
        action: 'hold',
        expected_revision_sha256: saved.revision_sha256,
    }, context(parts));
    assert.equal(held.held, true);
    assert.equal(held.state.draft.brief, draft().brief);

    const changedOtherStage = saveNewProjectDraft(draft({ script: '사용자가 직접 바꾼 스크립트.' }), context(parts));
    const applied = decidePlanningAgentSuggestion({
        suggestion_token: suggestion.suggestion_token,
        action: 'apply',
        expected_revision_sha256: changedOtherStage.revision_sha256,
    }, context(parts));
    assert.equal(applied.applied, true);
    assert.equal(applied.state.draft.brief, '비 오는 골목에서 헤어진 두 사람이 마지막 약속을 지키기 위해 다시 만난다.');
    assert.equal(applied.state.draft.script, '사용자가 직접 바꾼 스크립트.');

    const duplicate = decidePlanningAgentSuggestion({
        suggestion_token: suggestion.suggestion_token,
        action: 'apply',
        expected_revision_sha256: changedOtherStage.revision_sha256,
    }, context(parts));
    assert.equal(duplicate.status, 'already_applied');
    assert.equal(duplicate.reapply_allowed, false);

    saveNewProjectDraft({ ...duplicate.state.draft, brief: '적용 후 사용자가 다시 직접 수정했다.' }, context(parts));
    const afterEdit = getNewProjectDraftState(context(parts));
    assert.equal(afterEdit.collaboration.recent_requests[0].suggestion.review_status, 'applied_then_edited');
});

test('apply fails closed on target drift while allowing refreshed non-target drift', (t) => {
    const parts = fixture(t);
    const { queued } = queueBrief(parts);
    const suggestion = publishMock(parts, queued.request_id);
    const changedTarget = saveNewProjectDraft(draft({ brief: '사용자가 직접 바꾼 기획.' }), context(parts));
    assert.throws(
        () => decidePlanningAgentSuggestion({
            suggestion_token: suggestion.suggestion_token,
            action: 'apply',
            expected_revision_sha256: changedTarget.revision_sha256,
        }, context(parts)),
        (error) => error.code === 'PLANNING_AGENT_SUGGESTION_STALE',
    );
    assert.equal(getNewProjectDraftState(context(parts)).draft.brief, '사용자가 직접 바꾼 기획.');
});

test('apply retry recovers an immutable receipt after draft write succeeded and receipt publish failed', (t) => {
    const parts = fixture(t);
    const { saved, queued } = queueBrief(parts);
    const suggestion = publishMock(parts, queued.request_id);
    assert.throws(
        () => decidePlanningAgentSuggestion({
            suggestion_token: suggestion.suggestion_token,
            action: 'apply',
            expected_revision_sha256: saved.revision_sha256,
        }, context(parts, {
            linkFile() { throw Object.assign(new Error('receipt publish failed'), { code: 'EIO' }); },
        })),
        (error) => error.code === 'EIO',
    );
    const written = getNewProjectDraftState(context(parts));
    assert.equal(written.draft.brief, '비 오는 골목에서 헤어진 두 사람이 마지막 약속을 지키기 위해 다시 만난다.');
    const recovered = decidePlanningAgentSuggestion({
        suggestion_token: suggestion.suggestion_token,
        action: 'apply',
        expected_revision_sha256: saved.revision_sha256,
    }, context(parts));
    assert.equal(recovered.receipt_recovered, true);
    assert.equal(recovered.status, 'applied');
    assert.equal(recovered.reapply_allowed, false);
});

test('MOCK publication rejects no-op, malformed Unicode, and a conflicting second suggestion', (t) => {
    const parts = fixture(t);
    const { queued } = queueBrief(parts);
    assert.throws(
        () => publishMock(parts, queued.request_id, { proposed_text: draft().brief }),
        (error) => error.code === 'PLANNING_AGENT_SUGGESTION_NOOP',
    );
    assert.throws(
        () => publishMock(parts, queued.request_id, { proposed_text: '\uD800' }),
        (error) => error.code === 'PLANNING_AGENT_SUGGESTION_TEXT_INVALID',
    );
    const first = publishMock(parts, queued.request_id);
    const again = publishMock(parts, queued.request_id);
    assert.equal(again.suggestion_token, first.suggestion_token);
    assert.equal(again.already_published, true);
    assert.throws(
        () => publishMock(parts, queued.request_id, { proposed_text: '서로 다른 수정안입니다.' }),
        (error) => error.code === 'PLANNING_AGENT_SUGGESTION_CONFLICT',
    );
});
