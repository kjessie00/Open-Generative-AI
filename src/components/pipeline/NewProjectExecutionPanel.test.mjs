import assert from 'node:assert/strict';
import test from 'node:test';

import { deriveExecutionDisplayState } from './NewProjectExecutionPanel.js';

function connectedTask(taskToken, sequence, label, kind = 'scene_image') {
    return {
        task_token: taskToken,
        kind,
        sequence,
        label,
        status: '결과연결',
        result_token: `result-${taskToken}`,
    };
}

test('empty execution receipts project connected approved image and video plans into visible progress', () => {
    const imageTasks = [
        connectedTask('image-1', 1, '주인공'),
        connectedTask('image-2', 2, '사무실'),
        connectedTask('image-3', 3, '첫 장면'),
    ];
    const videoTasks = [connectedTask('video-1', 1, '첫 장면', 'scene_video')];
    const display = deriveExecutionDisplayState({
        executionState: { tasks: [], summary: { queued: 0, running: 0, succeeded: 0, failed: 0 } },
        imagePlanState: {
            tasks: imageTasks,
            review_decisions: imageTasks.map((task) => ({ task_token: task.task_token, decision: 'use' })),
        },
        videoPlanState: {
            tasks: videoTasks,
            review_decisions: [{ task_token: 'video-1', decision: 'use' }],
        },
    });

    assert.equal(display.source, 'plans');
    assert.deepEqual(display.summary, { queued: 0, running: 0, succeeded: 4, failed: 0 });
    assert.deepEqual(display.laneSummary, {
        image: { total: 3, connected: 3 },
        video: { total: 1, connected: 1 },
    });
    assert.deepEqual(display.nextAction, { id: 'clip-selection', label: '클립 선택', tab: 'qa' });
});

test('connected media with a pending decision points to result review', () => {
    const image = connectedTask('image-1', 1, '주인공');
    const video = connectedTask('video-1', 1, '첫 장면', 'scene_video');
    const display = deriveExecutionDisplayState({
        executionState: { tasks: [] },
        imagePlanState: { tasks: [image], review_decisions: [{ task_token: 'image-1', decision: 'use' }] },
        videoPlanState: { tasks: [video], review_decisions: [{ task_token: 'video-1', decision: 'pending' }] },
    });

    assert.deepEqual(display.nextAction, { id: 'result-review', label: '결과 검토', tab: 'storyboard' });
});

test('execution receipts remain authoritative when they contain tasks', () => {
    const receipt = {
        task_token: 'receipt-1', lane: 'image', sequence: 1, label: '인물', status: 'running', progress: 25,
    };
    const display = deriveExecutionDisplayState({
        executionState: { tasks: [receipt], summary: { queued: 0, running: 1, succeeded: 0, failed: 0 } },
    });

    assert.equal(display.source, 'execution');
    assert.equal(display.tasks.length, 1);
    assert.equal(display.tasks[0].task_token, 'receipt-1');
    assert.deepEqual(display.summary, { queued: 0, running: 1, succeeded: 0, failed: 0 });
});

test('current plans filter historical receipts, overlay connection review, and fill a missing lane', () => {
    const currentImage = connectedTask('image-current', 1, '주인공');
    const currentVideo = {
        task_token: 'video-current', kind: 'scene_video', sequence: 1, label: '첫 장면',
        status: '준비', result_token: '',
    };
    const display = deriveExecutionDisplayState({
        executionState: {
            tasks: [
                {
                    task_token: 'image-old', lane: 'image', sequence: 1, label: '이전 인물',
                    status: 'failed', progress: 80, result_match_status: 'waiting',
                },
                {
                    task_token: 'image-current', lane: 'image', sequence: 1, label: '이전 이름',
                    status: 'running', progress: 45, result_received: false, result_match_status: 'waiting',
                    quality_decision: 'pending',
                },
            ],
            summary: { queued: 0, running: 1, succeeded: 0, failed: 1 },
        },
        imagePlanState: {
            tasks: [currentImage],
            review_decisions: [{ task_token: 'image-current', decision: 'use' }],
        },
        videoPlanState: { tasks: [currentVideo], review_decisions: [] },
    });

    assert.deepEqual(display.tasks.map((task) => [task.lane, task.task_token]), [
        ['image', 'image-current'], ['video', 'video-current'],
    ]);
    assert.deepEqual(display.tasks[0], {
        ...display.tasks[0],
        label: '주인공', status: 'succeeded', progress: 100, result_received: true,
        result_match_status: 'connected', quality_decision: 'use',
    });
    assert.equal(display.tasks[1].status, 'queued');
    assert.deepEqual(display.summary, { queued: 1, running: 0, succeeded: 1, failed: 0 });
});

test('connected current plans beat queued receipts for next action while retry stays in review', () => {
    const image = connectedTask('image-current', 1, '주인공');
    const video = connectedTask('video-current', 1, '첫 장면', 'scene_video');
    const receipt = (lane, taskToken) => ({
        task_token: taskToken, lane, sequence: 1, label: '이전 이름',
        status: 'queued', progress: 0, result_received: false, result_match_status: '',
    });
    const base = {
        executionState: { tasks: [receipt('image', image.task_token), receipt('video', video.task_token)] },
        imagePlanState: {
            tasks: [image], review_decisions: [{ task_token: image.task_token, decision: 'use' }],
        },
        videoPlanState: {
            tasks: [video], review_decisions: [{ task_token: video.task_token, decision: 'use' }],
        },
    };

    const ready = deriveExecutionDisplayState(base);
    assert.deepEqual(ready.summary, { queued: 0, running: 0, succeeded: 2, failed: 0 });
    assert.deepEqual(ready.nextAction, { id: 'clip-selection', label: '클립 선택', tab: 'qa' });

    const retry = deriveExecutionDisplayState({
        ...base,
        videoPlanState: {
            tasks: [{ ...video, status: '재제작' }],
            review_decisions: [{ task_token: video.task_token, decision: 'retry' }],
        },
    });
    assert.equal(retry.tasks.find((task) => task.lane === 'video').quality_decision, 'retry');
    assert.deepEqual(retry.nextAction, { id: 'result-review', label: '결과 검토', tab: 'storyboard' });
});

test('an authoritative empty lane removes historical receipts from that lane', () => {
    const display = deriveExecutionDisplayState({
        executionState: {
            tasks: [{ task_token: 'old-video', lane: 'video', sequence: 1, status: 'succeeded' }],
        },
        videoPlanTasks: [],
    });

    assert.deepEqual(display.tasks, []);
    assert.deepEqual(display.summary, { queued: 0, running: 0, succeeded: 0, failed: 0 });
    assert.deepEqual(display.nextAction, { id: 'image-work', label: '이미지 작업 준비', tab: 'assets' });
});
