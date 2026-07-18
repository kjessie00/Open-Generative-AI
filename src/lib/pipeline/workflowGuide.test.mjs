import assert from 'node:assert/strict';
import test from 'node:test';

import {
    deriveNewProjectWorkflowProjection,
    deriveWorkflowGuide,
    deriveWorkflowMetrics,
    WORKFLOW_STAGES,
} from './workflowGuide.js';

const plainFixture = (overrides = {}) => ({
    assets: [{ asset_id: 'asset-1' }],
    storyboard: [{}],
    motionBoard: [{}],
    promptPacks: [{}, {}],
    submitRecords: [{}],
    heartbeatRecords: [{}],
    reviewGates: [
        { status: 'PASS' }, { status: 'PASS' }, { status: 'PASS' }, { status: 'PASS' },
        { status: 'BLOCK' },
    ],
    acceptedSeconds: [{ clip_id: 'clip-1', source_file: '', in_time: 0, out_time: 0 }],
    ...overrides,
});

test('plain fixture derives the current 1/5/4/0 clip-selection guidance', () => {
    const guide = deriveWorkflowGuide(plainFixture());
    assert.deepEqual(guide.metrics, { files: 1, parsed: 5, reviewed: 4, accepted: 0 });
    assert.equal(guide.activeStageId, 'select');
    assert.equal(guide.message, '클립을 검토하고 사용할 구간을 선택하세요');
    assert.equal(guide.actionLabel, '클립 QA 열기');
    assert.equal(guide.actionTab, 'qa');
    assert.match(guide.explanation, /채택한 구간이 0개/);
    assert.deepEqual(guide.stages.map(({ label, status }) => [label, status]), [
        ['기획·대본', 'complete'], ['설계', 'complete'], ['생성 준비', 'complete'], ['클립 선택', 'current'], ['마무리', 'pending'],
    ]);
});

test('workflow metrics prefer normalized fileStatus and keep accepted evidence strict', () => {
    const state = plainFixture({
        fileStatus: { files_found: 7, content_parsed: 3, review_passed: 2, quality_accepted: 1 },
    });
    assert.deepEqual(deriveWorkflowMetrics(state), { files: 7, parsed: 3, reviewed: 2, accepted: 1 });
    assert.equal(deriveWorkflowGuide(state).activeStageId, 'finish');
});

test('new project stays at stage 4 until every clip has an explicit accepted range', () => {
    const partial = plainFixture({
        fileStatus: { files_found: 7, content_parsed: 3, review_passed: 2, quality_accepted: 4 },
        newProjectClipSelection: { accepted_count: 1, total_count: 2 },
    });
    assert.equal(deriveWorkflowGuide(partial).activeStageId, 'select');
    assert.equal(deriveWorkflowGuide({
        ...partial, newProjectClipSelection: { accepted_count: 2, total_count: 2 },
    }).activeStageId, 'finish');
});

function newProjectFixture(overrides = {}) {
    const imageTasks = [{ task_token: 'image-1', status: '결과연결', result_token: 'image-result-1' }];
    const videoTasks = [{ task_token: 'video-1', status: '결과연결', result_token: 'video-result-1' }];
    return plainFixture({
        fileStatus: { files_found: 7, content_parsed: 3, review_passed: 2, quality_accepted: 1 },
        newProjectDraftState: { status: 'empty', draft: {} },
        newProjectDesignState: { status: 'empty', board: { characters: [], locations: [], scenes: [] } },
        newProjectImagePlanState: { status: 'empty', tasks: [], review_decisions: [] },
        newProjectVideoPlanState: { status: 'empty', tasks: [], review_decisions: [] },
        newProjectClipSelectionState: { status: 'empty', accepted_count: 0, total_count: 0 },
        newProjectFinalStitchState: { status: 'blocked', staged: false },
        newProjectFinalRenderState: { status: 'empty', review_decision: 'pending' },
        fixtureParts: { imageTasks, videoTasks },
        ...overrides,
    });
}

test('new-project workflow overrides completed legacy evidence from empty draft through design', () => {
    const empty = newProjectFixture();
    assert.equal(deriveWorkflowGuide(empty).activeStageId, 'start');

    const drafted = newProjectFixture({
        newProjectDraftState: {
            status: 'saved',
            draft: { production_id: 'new-film', brief: '기획', script: '대본' },
        },
    });
    assert.equal(deriveWorkflowGuide(drafted).activeStageId, 'design');
});

test('new-project workflow remains in preparation until every image and video result is approved', () => {
    const base = newProjectFixture();
    const { imageTasks, videoTasks } = base.fixtureParts;
    const state = {
        ...base,
        newProjectDraftState: {
            status: 'restored',
            draft: { production_id: 'new-film', brief: '기획', script: '대본' },
        },
        newProjectDesignState: {
            status: 'saved', board: { characters: [], locations: [], scenes: [{ scene_id: 'scene-1' }] },
        },
        newProjectImagePlanState: {
            status: 'restored', tasks: imageTasks,
            review_decisions: [{ task_token: 'image-1', decision: 'use' }],
        },
        newProjectVideoPlanState: {
            status: 'restored', tasks: videoTasks,
            review_decisions: [{ task_token: 'video-1', decision: 'pending' }],
        },
    };
    assert.equal(deriveWorkflowGuide(state).activeStageId, 'prepare');
    assert.equal(deriveNewProjectWorkflowProjection(state).mediaReady, false);
});

test('approved new-project media advances to selection, then complete ranges stay in finishing', () => {
    const base = newProjectFixture();
    const { imageTasks, videoTasks } = base.fixtureParts;
    const ready = {
        ...base,
        newProjectDraftState: {
            status: 'restored',
            draft: { production_id: 'new-film', brief: '기획', script: '대본' },
        },
        newProjectDesignState: {
            status: 'restored', board: { characters: [], locations: [], scenes: [{ scene_id: 'scene-1' }] },
        },
        newProjectImagePlanState: {
            status: 'restored', tasks: imageTasks,
            review_decisions: [{ task_token: 'image-1', decision: 'use' }],
        },
        newProjectVideoPlanState: {
            status: 'restored', tasks: videoTasks,
            review_decisions: [{ task_token: 'video-1', decision: 'use' }],
        },
        newProjectClipSelectionState: { status: 'empty', accepted_count: 0, total_count: 1 },
    };
    assert.equal(deriveWorkflowGuide(ready).activeStageId, 'select');

    for (const reviewDecision of ['pending', 'use']) {
        const finishing = {
            ...ready,
            newProjectClipSelectionState: { status: 'restored', accepted_count: 1, total_count: 1 },
            newProjectFinalStitchState: { status: 'ready', staged: false },
            newProjectFinalRenderState: { status: 'restored', review_decision: reviewDecision },
        };
        assert.equal(deriveWorkflowGuide(finishing).activeStageId, 'finish');
    }
});

test('five stages retain every existing work panel and exclude settings', () => {
    assert.deepEqual(WORKFLOW_STAGES.map((stage) => stage.label), ['기획·대본', '설계', '생성 준비', '클립 선택', '마무리']);
    assert.deepEqual(WORKFLOW_STAGES[0].tabs.map((tab) => tab.label), ['기획·대본']);
    assert.deepEqual(WORKFLOW_STAGES.flatMap((stage) => stage.tabs.map((tab) => tab.id)), [
        'intake', 'storyboard', 'shot-designer', 'motion', 'progress', 'assets', 'videos', 'prompts', 'gates', 'queue', 'qa', 'final',
    ]);
    assert.equal(WORKFLOW_STAGES[2].tabs.find((tab) => tab.id === 'queue').hidden, true);
});

test('cinematic companion never changes workflow completion metrics or active stage', () => {
    const base = newProjectFixture({
        newProjectDraftState: {
            status: 'saved',
            draft: { production_id: 'cinematic-film', brief: '기획', script: '대본' },
        },
    });
    const cinematic = {
        ...base,
        newProjectCinematicTemplateState: {
            status: 'saved', mode: 'cinematic', director_intent: '연출 의도',
            visual_thesis: '화면 핵심', must_preserve: '지킬 점', must_avoid: '피할 점',
        },
    };
    assert.deepEqual(deriveWorkflowMetrics(cinematic), deriveWorkflowMetrics(base));
    assert.equal(deriveWorkflowGuide(cinematic).activeStageId, deriveWorkflowGuide(base).activeStageId);
});
