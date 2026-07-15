import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import executionProvider from '../electron/lib/newProjectExecutionProvider.js';

const evidenceRoot = path.resolve(process.argv[2] || 'tmp/execution-handoff-stage');
const mode = process.argv[3] || 'seed';
const userDataPath = path.join(evidenceRoot, 'user-data');
const context = { userDataPath };

function writeReceipt(name, value) {
    fs.writeFileSync(path.join(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

if (mode === 'seed') {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
    fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    fs.chmodSync(evidenceRoot, 0o700);
    fs.chmodSync(userDataPath, 0o700);

    draftProvider.saveNewProjectDraft({
        production_id: 'execution-stage-proof',
        brief: '비 오는 골목에서 오래 헤어진 두 사람이 다시 만난다.',
        script: '붉은 우산을 든 주인공이 네온 골목에서 걸음을 멈추고 친구를 바라본다.',
        route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 2,
    }, context);
    const emptyDesign = designProvider.getNewProjectDesignState(context);
    designProvider.saveNewProjectDesignBoard({
        board: {
            characters: [{
                id: 'hero', name: '주인공', role: '오래 헤어진 친구', appearance: '짧은 검은 머리',
                wardrobe: '검은 코트', continuity: '붉은 우산',
            }],
            locations: [{
                id: 'alley', name: '비 오는 골목', space: '좁고 깊은 골목', lighting: '푸른 네온 역광',
                props: '젖은 간판과 물웅덩이', continuity: '젖은 아스팔트',
            }],
            scenes: [{
                id: 'scene_01', title: '재회', dramatic_beat: '주인공이 친구를 알아보고 멈춘다.',
                characters: ['hero'], location_id: 'alley', duration: 5,
                first_frame: '붉은 우산 아래 멈춘 주인공', action: '천천히 고개를 들어 골목 끝을 바라본다.',
                camera: '허리 높이 미디엄 숏', lighting: '푸른 네온 역광', audio_sfx_dialogue: '빗소리',
            }],
        },
        expected_planning_revision_sha256: emptyDesign.planning_revision_sha256,
        expected_design_revision_sha256: emptyDesign.revision_sha256,
    }, context);
    let image = imagePlanProvider.getNewProjectImagePlan(context);
    image = imagePlanProvider.saveNewProjectImagePlan({
        tasks: image.tasks,
        expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, context);
    imagePlanProvider.prepareNewProjectImagePlan({
        expected_design_revision_sha256: image.design_revision_sha256,
        expected_image_plan_revision_sha256: image.revision_sha256,
    }, context);
    const state = executionProvider.getNewProjectExecutionState(context);
    if (!state.ok || state.prepared || !state.tasks.length) throw new Error('EXECUTION_SEED_NOT_READY');
    const receipt = {
        verified_at: new Date().toISOString(), mode, prepared: state.prepared,
        task_count: state.task_count, lanes: [...new Set(state.tasks.map((task) => task.lane))],
        external_call_performed: state.external_call_performed,
        model_called: state.model_called, generation_executed: state.generation_executed,
        user_data_path: userDataPath,
    };
    writeReceipt('seed.json', receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} else if (mode === 'verify') {
    const state = executionProvider.getNewProjectExecutionState(context);
    if (!state.ok || !state.prepared || !state.tasks.length) throw new Error('EXECUTION_HANDOFF_NOT_STAGED');
    const cli = spawnSync(process.execPath, [
        path.resolve('scripts/new-project-execution-handoff.cjs'), 'inspect', '--user-data', userDataPath,
    ], { cwd: path.resolve('.'), encoding: 'utf8' });
    if (cli.status !== 0) throw new Error(`EXECUTION_CLI_FAILED:${cli.stderr.trim()}`);
    const handoff = JSON.parse(cli.stdout).handoff;
    const runTokens = [...new Set(handoff.tasks.map((task) => `run_${task.run_revision_sha256}`))];
    const permissions = runTokens.map((runToken) => {
        const paths = executionProvider.exactPaths(userDataPath, runToken);
        return {
            manifest: fs.lstatSync(paths.manifestPath).mode & 0o777,
            run_directory: fs.lstatSync(paths.runRoot).mode & 0o777,
            receipts_directory: fs.lstatSync(paths.receiptsRoot).mode & 0o777,
        };
    });
    const receipt = {
        verified_at: new Date().toISOString(), mode, prepared: state.prepared,
        task_count: handoff.tasks.length, receipt_count: handoff.receipts.length,
        handoff_schema: handoff.schema_version,
        aspect_ratios: [...new Set(handoff.tasks.map((task) => task.aspect_ratio))],
        source_ids: handoff.tasks.map((task) => task.source_id),
        durations: handoff.tasks.map((task) => task.duration_seconds),
        permissions, external_call_performed: handoff.external_call_performed,
        model_called: handoff.model_called, generation_executed: handoff.generation_executed,
        provider_generation_calls: 0,
    };
    if (receipt.handoff_schema !== 'film_pipeline.new_project_execution_handoff.v2'
        || receipt.aspect_ratios.length !== 1 || receipt.aspect_ratios[0] !== '9:16'
        || receipt.source_ids.some((sourceId) => typeof sourceId !== 'string' || !sourceId)
        || receipt.durations.some((duration) => duration !== null)
        || receipt.external_call_performed || receipt.model_called || receipt.generation_executed
        || permissions.some((item) => item.manifest !== 0o600
            || item.run_directory !== 0o700 || item.receipts_directory !== 0o700)) {
        throw new Error('EXECUTION_HANDOFF_VERIFICATION_FAILED');
    }
    writeReceipt('result.json', receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} else {
    throw new Error('MODE_INVALID');
}
