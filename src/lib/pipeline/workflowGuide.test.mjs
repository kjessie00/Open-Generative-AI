import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveWorkflowGuide, deriveWorkflowMetrics, WORKFLOW_STAGES } from './workflowGuide.js';

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

test('five stages retain every existing work panel and exclude settings', () => {
    assert.deepEqual(WORKFLOW_STAGES.map((stage) => stage.label), ['기획·대본', '설계', '생성 준비', '클립 선택', '마무리']);
    assert.deepEqual(WORKFLOW_STAGES[0].tabs.map((tab) => tab.label), ['기획·대본']);
    assert.deepEqual(WORKFLOW_STAGES.flatMap((stage) => stage.tabs.map((tab) => tab.id)), [
        'intake', 'storyboard', 'shot-designer', 'motion', 'assets', 'prompts', 'gates', 'queue', 'qa', 'final',
    ]);
});
