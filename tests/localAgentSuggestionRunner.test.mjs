import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import filmProvider from '../electron/lib/filmPipelineProvider.js';
import runnerModule from '../electron/lib/localAgentSuggestionRunner.js';

const { createLocalAgentSuggestionRunner, designSchema, runCodexStructured } = runnerModule;

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-local-agent-')));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath };
}

function context(parts) {
    return { userDataPath: parts.userDataPath, config: {}, harnessStatus: { ready: false, entries: [] } };
}

function planningDraft() {
    return {
        production_id: 'local-agent-01',
        brief: '비 오는 골목에서 두 사람이 다시 만난다.',
        script: '문이 열리고 두 사람은 말없이 서로를 바라본다.',
        route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 4,
    };
}

function board() {
    return {
        characters: [{ id: 'hero', name: '주인공', role: '', appearance: '', wardrobe: '', continuity: '' }],
        locations: [{ id: 'alley', name: '골목', space: '', lighting: '', props: '', continuity: '' }],
        scenes: [{
            id: 'scene_01', title: '재회', dramatic_beat: '두 사람이 마주친다.', characters: ['hero'],
            location_id: 'alley', duration: 5, first_frame: '', action: '걸음을 멈춘다.',
            camera: '', lighting: '', audio_sfx_dialogue: '',
        }],
    };
}

function savedDesign(parts) {
    draftProvider.saveNewProjectDraft(planningDraft(), context(parts));
    const empty = designProvider.getNewProjectDesignState(context(parts));
    return designProvider.saveNewProjectDesignBoard({
        board: board(),
        expected_planning_revision_sha256: empty.planning_revision_sha256,
        expected_design_revision_sha256: empty.revision_sha256,
    }, context(parts));
}

test('MOCK local planning agent de-duplicates one request and publishes model-call truth', async (t) => {
    const parts = fixture(t);
    const saved = draftProvider.saveNewProjectDraft(planningDraft(), context(parts));
    const queued = draftProvider.enqueuePlanningAgentRequest({
        stage: 'brief', instruction: '갈등을 더 선명하게 다듬어 주세요.',
        expected_revision_sha256: saved.revision_sha256,
    }, context(parts));
    let calls = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const runner = createLocalAgentSuggestionRunner({
        executeStructured: async ({ kind, prompt }) => {
            calls += 1;
            assert.equal(kind, 'planning');
            assert.match(prompt, /갈등을 더 선명하게/);
            assert.doesNotMatch(prompt, new RegExp(parts.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
            await gate;
            return {
                proposed_text: '비 오는 골목에서 헤어진 두 사람이 마지막 약속을 지키기 위해 다시 만난다.',
                summary: '재회의 목적과 갈등을 선명하게 앞세웠습니다.',
            };
        },
    });
    const first = runner.runPlanning({ requestId: queued.request_id, context: context(parts) });
    const second = runner.runPlanning({ requestId: queued.request_id, context: context(parts) });
    release();
    const [left, right] = await Promise.all([first, second]);
    assert.equal(calls, 1);
    assert.equal(left.suggestion_token, right.suggestion_token);
    assert.equal(left.app_model_called, true);
    const state = draftProvider.getNewProjectDraftState(context(parts));
    assert.equal(state.collaboration.status, 'suggestion_ready');
    assert.equal(state.collaboration.recent_requests[0].suggestion.proposed_text, '비 오는 골목에서 헤어진 두 사람이 마지막 약속을 지키기 위해 다시 만난다.');
    assert.equal(Object.hasOwn(state.collaboration.recent_requests[0].suggestion, 'app_model_called'), false);
    const paths = draftProvider.exactDraftPaths(parts.userDataPath);
    const record = JSON.parse(fs.readFileSync(path.join(paths.planningAgentSuggestionsRoot, `${queued.request_id}.json`), 'utf8'));
    assert.equal(record.app_model_called, true);
    assert.equal(fs.lstatSync(path.join(paths.planningAgentSuggestionsRoot, `${queued.request_id}.json`)).mode & 0o777, 0o600);
});

test('MOCK local design agent publishes a full validated board with model-call truth', async (t) => {
    const parts = fixture(t);
    const saved = savedDesign(parts);
    const queued = designProvider.enqueueDesignAgentRequest({
        instruction: '장면 행동과 조명을 더 구체적으로 다듬어 주세요.',
        expected_planning_revision_sha256: saved.planning_revision_sha256,
        expected_design_revision_sha256: saved.revision_sha256,
    }, context(parts));
    const proposed = structuredClone(board());
    proposed.scenes[0].action = '빗소리를 듣고 걸음을 멈춘 뒤 천천히 고개를 든다.';
    proposed.scenes[0].lighting = '젖은 아스팔트에 간판 불빛이 반사된다.';
    const runner = createLocalAgentSuggestionRunner({
        executeStructured: async ({ kind, prompt }) => {
            assert.equal(kind, 'design');
            assert.match(prompt, /장면 행동과 조명/);
            return { proposed_board: proposed, summary: '행동과 조명 연속성을 구체화했습니다.' };
        },
    });
    const result = await runner.runDesign({ requestId: queued.request_id, context: context(parts) });
    assert.equal(result.app_model_called, true);
    const state = designProvider.getNewProjectDesignState(context(parts));
    assert.equal(state.collaboration.status, 'suggestion_ready');
    assert.equal(state.collaboration.recent_requests[0].suggestion.proposed_board.scenes[0].action, proposed.scenes[0].action);
    const paths = designProvider.exactPaths(parts.userDataPath);
    const record = JSON.parse(fs.readFileSync(path.join(paths.suggestionsRoot, `${queued.request_id}.json`), 'utf8'));
    assert.equal(record.app_model_called, true);
});

test('design output schema matches required provider text fields without unsupported uniqueness keywords', () => {
    const schema = designSchema();
    const boardSchema = schema.properties.proposed_board.properties;
    assert.equal(JSON.stringify(schema).includes('uniqueItems'), false);
    assert.equal(boardSchema.characters.items.properties.name.minLength, 1);
    assert.equal(boardSchema.locations.items.properties.name.minLength, 1);
    assert.equal(boardSchema.scenes.items.properties.title.minLength, 1);
    assert.equal(boardSchema.scenes.items.properties.dramatic_beat.minLength, 1);
    assert.equal(boardSchema.scenes.items.properties.action.minLength, 1);
    assert.equal(schema.properties.summary.minLength, 1);
});

test('REAL local fixture process receives the fixed no-tool Codex contract and returns private structured output', async (t) => {
    const parts = fixture(t);
    const executable = path.join(parts.base, 'fixture-codex');
    fs.writeFileSync(executable, `#!/usr/bin/env node
const fs = require('fs');
const args = process.argv.slice(2);
for (const required of ['-a', 'never', 'exec', '--strict-config', '--ephemeral', '--ignore-user-config', '--ignore-rules', '--sandbox', 'read-only']) {
  if (!args.includes(required)) process.exit(41);
}
if (process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY) process.exit(42);
const output = args[args.indexOf('-o') + 1];
process.stdin.resume();
process.stdin.on('end', () => fs.writeFileSync(output, JSON.stringify({ proposed_text: '더 자연스러운 문장입니다.', summary: '문장을 다듬었습니다.' })));
`, { mode: 0o700 });
    fs.chmodSync(executable, 0o700);
    const result = await runCodexStructured({
        kind: 'planning', prompt: 'fixture prompt', timeoutMs: 2000,
        options: {
            codexPath: executable, tempRoot: parts.base,
            env: { HOME: process.env.HOME, PATH: process.env.PATH, OPENAI_API_KEY: undefined },
        },
    });
    assert.deepEqual(result, { proposed_text: '더 자연스러운 문장입니다.', summary: '문장을 다듬었습니다.' });
    assert.equal(fs.readdirSync(parts.base).some((name) => name.startsWith('open-ga-agent-run-')), false);
});

test('MOCK invalid agent output is rejected before publishing a suggestion', async (t) => {
    const parts = fixture(t);
    const saved = draftProvider.saveNewProjectDraft(planningDraft(), context(parts));
    const queued = draftProvider.enqueuePlanningAgentRequest({
        stage: 'script', instruction: '첫 문장을 다듬어 주세요.', expected_revision_sha256: saved.revision_sha256,
    }, context(parts));
    const runner = createLocalAgentSuggestionRunner({
        executeStructured: async () => ({ proposed_text: '새 문장', summary: '수정', path: '/private/secret' }),
    });
    await assert.rejects(
        runner.runPlanning({ requestId: queued.request_id, context: context(parts) }),
        (error) => error.code === 'AGENT_OUTPUT_INVALID' && !error.message.includes(parts.base),
    );
    assert.equal(draftProvider.getNewProjectDraftState(context(parts)).collaboration.ready_suggestion_count, 0);
});

test('MOCK planning agent rejects a nested JSON bundle instead of replacing the editable body', async (t) => {
    const parts = fixture(t);
    const saved = draftProvider.saveNewProjectDraft(planningDraft(), context(parts));
    const queued = draftProvider.enqueuePlanningAgentRequest({
        stage: 'brief', instruction: '기획을 선명하게 해 주세요.', expected_revision_sha256: saved.revision_sha256,
    }, context(parts));
    const runner = createLocalAgentSuggestionRunner({
        executeStructured: async () => ({
            proposed_text: JSON.stringify({ current_brief: '수정 기획', current_script: '기존 대본' }),
            summary: '수정했습니다.',
        }),
    });
    await assert.rejects(
        runner.runPlanning({ requestId: queued.request_id, context: context(parts) }),
        (error) => error.code === 'AGENT_OUTPUT_INVALID' && error.modelCalled === true,
    );
    assert.equal(draftProvider.getNewProjectDraftState(context(parts)).collaboration.ready_suggestion_count, 0);
});

test('MOCK main-owned run IPC contract selects the queued planning request without renderer paths', async (t) => {
    const parts = fixture(t);
    const saved = draftProvider.saveNewProjectDraft(planningDraft(), context(parts));
    const queued = draftProvider.enqueuePlanningAgentRequest({
        stage: 'brief', instruction: '목표를 선명하게 해 주세요.', expected_revision_sha256: saved.revision_sha256,
    }, context(parts));
    let received;
    const localAgentSuggestionRunner = {
        async runPlanning({ requestId, context: trustedContext }) {
            received = { requestId, userDataPath: trustedContext.userDataPath };
            return draftProvider.publishPlanningAgentSuggestion({
                request_id: requestId,
                proposed_text: '비 오는 골목에서 마지막 약속을 되찾으려는 두 사람이 다시 만난다.',
                summary: '주인공의 목표를 앞에 배치했습니다.',
            }, { ...trustedContext, appModelCalled: true });
        },
    };
    const result = await filmProvider.runPlanningAgentRequest({ stage: 'brief' }, {
        ...context(parts), localAgentSuggestionRunner, readConfigFn: () => ({}), harnessRoot: path.join(parts.base, 'missing-harness'),
    });
    assert.equal(result.ok, true);
    assert.equal(result.model_called, true);
    assert.deepEqual(received, { requestId: queued.request_id, userDataPath: parts.userDataPath });
    assert.equal(result.state.collaboration.status, 'suggestion_ready');
    assert.equal(Object.hasOwn(result, 'path'), false);
    await assert.rejects(
        filmProvider.runPlanningAgentRequest({ stage: 'brief', cwd: parts.base }, {
            ...context(parts), localAgentSuggestionRunner, readConfigFn: () => ({}), harnessRoot: path.join(parts.base, 'missing-harness'),
        }),
        (error) => error.code === 'PLANNING_AGENT_RUN_SHAPE_INVALID',
    );
});

test('MOCK main-owned design run contract returns a short failure projection and preserves the request', async (t) => {
    const parts = fixture(t);
    const saved = savedDesign(parts);
    designProvider.enqueueDesignAgentRequest({
        instruction: '장면을 정리해 주세요.',
        expected_planning_revision_sha256: saved.planning_revision_sha256,
        expected_design_revision_sha256: saved.revision_sha256,
    }, context(parts));
    const localAgentSuggestionRunner = {
        async runDesign() {
            const error = new Error('private prompt and path must not escape');
            error.code = 'AGENT_OUTPUT_INVALID';
            error.modelCalled = true;
            throw error;
        },
    };
    const result = await filmProvider.runDesignAgentRequest({}, {
        ...context(parts), localAgentSuggestionRunner, readConfigFn: () => ({}), harnessRoot: path.join(parts.base, 'missing-harness'),
    });
    assert.deepEqual(
        { ok: result.ok, status: result.status, error: result.error, model_called: result.model_called },
        { ok: false, status: 'failed', error: 'AGENT_OUTPUT_INVALID', model_called: true },
    );
    assert.equal(result.state.collaboration.status, 'queued');
    assert.doesNotMatch(JSON.stringify(result), /private prompt|user-data|open-ga-local-agent/);
});
