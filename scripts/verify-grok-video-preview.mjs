import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import videoPlanProvider from '../electron/lib/newProjectVideoPlanProvider.js';
import executionProvider from '../electron/lib/newProjectExecutionProvider.js';
import filmPipelineProvider from '../electron/lib/filmPipelineProvider.js';

const evidenceRoot = path.resolve(process.argv[2] || 'tmp/grok-video-preview');
const mode = process.argv[3] || 'seed';
const userDataPath = path.join(evidenceRoot, 'user-data');
const context = { userDataPath };
const cliPath = path.resolve('scripts/new-project-execution-handoff.cjs');
const grokRoot = '/Users/jessiek/StudioProjects/grok-auto/grok-browser';
const grokCli = path.join(grokRoot, 'grok_imagine_bot.py');
const grokPython = '/Users/jessiek/.pyenv/versions/3.11.7/bin/python3';
const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
    'base64',
);

function writeReceipt(name, value) {
    fs.writeFileSync(path.join(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function revisions(state) {
    return {
        expected_design_revision_sha256: state.design_revision_sha256,
        expected_image_plan_revision_sha256: state.image_plan_revision_sha256,
        expected_video_plan_revision_sha256: state.revision_sha256,
    };
}

function inspect() {
    const result = spawnSync(process.execPath, [cliPath, 'inspect', '--user-data', userDataPath], {
        cwd: path.resolve('.'), encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`GROK_VIDEO_PREVIEW_CLI_FAILED:${result.stderr.trim()}`);
    return JSON.parse(result.stdout).handoff;
}

function imageContext() {
    return {
        ...context,
        getDstBundleImportPreview: () => ({
            ready: true,
            preview: { mime_type: 'image/png', byte_length: png.byteLength, base64: png.toString('base64') },
            blockers: [],
        }),
    };
}

if (mode === 'seed') {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
    fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    fs.chmodSync(evidenceRoot, 0o700);
    fs.chmodSync(userDataPath, 0o700);

    draftProvider.saveNewProjectDraft({
        production_id: 'grok-video-preview-proof',
        brief: '비 오는 네온 골목에서 오래 헤어진 두 사람이 다시 만난다.',
        script: '붉은 우산을 든 주인공이 걸음을 멈추고 골목 끝의 친구를 바라본다.',
        route: 'both', aspect_ratio: '9:16', scene_duration: 6, max_scenes: 1,
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
                characters: ['hero'], location_id: 'alley', duration: 6,
                first_frame: '붉은 우산 아래 멈춘 주인공', action: '천천히 고개를 들어 골목 끝을 바라본다.',
                camera: '허리 높이 미디엄 숏', lighting: '푸른 네온 역광', audio_sfx_dialogue: '빗소리',
            }],
        },
        expected_planning_revision_sha256: emptyDesign.planning_revision_sha256,
        expected_design_revision_sha256: emptyDesign.revision_sha256,
    }, context);

    const connectedContext = imageContext();
    let imageState = imagePlanProvider.getNewProjectImagePlan(connectedContext);
    imageState = imagePlanProvider.saveNewProjectImagePlan({
        tasks: imageState.tasks,
        expected_design_revision_sha256: imageState.design_revision_sha256,
        expected_image_plan_revision_sha256: imageState.revision_sha256,
    }, connectedContext);
    for (let index = 0; index < imageState.tasks.length; index += 1) {
        const task = imageState.tasks[index];
        imageState = imagePlanProvider.connectNewProjectImageResult({
            task_token: task.task_token,
            candidate_token: `grok-preview-${index + 1}`,
            image_index: index + 1,
            expected_design_revision_sha256: imageState.design_revision_sha256,
            expected_image_plan_revision_sha256: imageState.revision_sha256,
        }, connectedContext).state;
    }

    let videoState = videoPlanProvider.getNewProjectVideoPlan(context);
    const editedTasks = structuredClone(videoState.tasks);
    editedTasks[0].provider = 'grok';
    editedTasks[0].provider_label = '플로우';
    videoState = videoPlanProvider.saveNewProjectVideoPlan({
        tasks: editedTasks, ...revisions(videoState),
    }, context);
    if (videoState.tasks[0].provider_label !== '그록') throw new Error('GROK_PROVIDER_LABEL_NOT_CANONICAL');
    const queued = videoPlanProvider.prepareNewProjectVideoPlan(revisions(videoState), context);
    const state = executionProvider.getNewProjectExecutionState(context);
    if (!state.ok || state.prepared || state.task_count !== 1 || queued.task_count !== 1
        || queued.tasks[0].provider !== 'grok') throw new Error('GROK_VIDEO_PREVIEW_SEED_NOT_READY');
    const receipt = {
        mode, prepared: state.prepared, task_count: state.task_count, provider: queued.tasks[0].provider,
        duration_seconds: 6, connected_image_count: imageState.tasks.length,
        external_call_performed: state.external_call_performed, model_called: state.model_called,
        generation_executed: state.generation_executed, provider_generation_calls: 0,
        user_data_path: userDataPath,
    };
    writeReceipt('seed.json', receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} else if (mode === 'verify') {
    const state = executionProvider.getNewProjectExecutionState(context);
    if (!state.ok || !state.prepared || state.task_count !== 1) {
        throw new Error('GROK_VIDEO_PREVIEW_DESKTOP_ACTION_MISSING');
    }
    const firstHandoff = inspect();
    const task = firstHandoff.tasks[0];
    const preview = task.provider_execution_preview;
    const command = preview.command_spec;
    const outputIndex = command.args.indexOf('--output');
    const outputPath = command.args[outputIndex + 1];
    const imageIndex = command.args.indexOf('--image');
    const durationIndex = command.args.indexOf('--duration');
    const paths = executionProvider.exactPaths(userDataPath, `run_${task.run_revision_sha256}`);
    const expectedArgs = [
        fs.realpathSync.native(grokCli), 'i2v', '--image', task.reference_files[0].path,
        '--prompt', task.prompt, '--duration', '6', '--output', outputPath, '--timeout', '180',
    ];
    const help = spawnSync(grokPython, [grokCli, 'i2v', '--help'], {
        cwd: grokRoot, encoding: 'utf8', timeout: 30_000,
    });
    const secondHandoff = inspect();
    const rendererState = filmPipelineProvider.getNewProjectExecutionState(context);
    const publicJson = JSON.stringify(rendererState);
    const receipt = {
        mode, prepared: state.prepared, handoff_schema: firstHandoff.schema_version,
        task_count: firstHandoff.tasks.length, provider: task.provider,
        reference_count: task.reference_files.length,
        preview_readiness: preview.readiness, blockers: preview.blockers,
        command: command.command, args: command.args, cwd: command.cwd,
        preview_only: command.preview_only, live_submit_allowed: command.live_submit_allowed,
        copy_allowed: command.copy_allowed,
        output_directory_mode: fs.lstatSync(paths.outputsRoot).mode & 0o777,
        output_target_absent: !fs.existsSync(outputPath),
        output_parent_matches: path.dirname(outputPath) === paths.outputsRoot,
        output_name_matches: path.basename(outputPath) === `${task.task_token}.mp4`,
        image_argument_matches: command.args[imageIndex + 1] === task.reference_files[0].path,
        duration_argument_matches: command.args[durationIndex + 1] === '6',
        exact_args_match: JSON.stringify(command.args) === JSON.stringify(expectedArgs),
        forbidden_submit_flags_absent: !command.args.includes('--submit'),
        unsupported_i2v_flags_absent: !command.args.includes('--ratio') && !command.args.includes('--quality'),
        stable_handoff: JSON.stringify(firstHandoff.tasks) === JSON.stringify(secondHandoff.tasks),
        help_exit_code: help.status, help_mentions_duration: /--duration/.test(help.stdout),
        receipt_count: firstHandoff.receipts.length,
        public_review_required: rendererState.tasks[0].execution_preview?.mode === 'review_required',
        public_private_data_absent: !/\/Users\/|task_[a-f0-9]{64}|run_[a-f0-9]{64}|GROK_|command_spec|output_path/.test(publicJson),
        external_call_performed: firstHandoff.external_call_performed,
        model_called: firstHandoff.model_called, generation_executed: firstHandoff.generation_executed,
        provider_generation_calls: 0,
    };
    const expectedBlockers = [
        'GROK_NO_NONSUBMIT_MODE',
        'GROK_ACCOUNT_ROTATION_CANNOT_BE_DISABLED',
        'GROK_I2V_RATIO_NOT_CONFIGURABLE',
    ];
    if (receipt.handoff_schema !== 'film_pipeline.new_project_execution_handoff.v4'
        || receipt.task_count !== 1 || receipt.provider !== 'grok' || receipt.reference_count !== 1
        || receipt.preview_readiness !== 'preview_ready_live_blocked'
        || JSON.stringify(receipt.blockers) !== JSON.stringify(expectedBlockers)
        || command.command !== fs.realpathSync.native(grokPython)
        || command.cwd !== fs.realpathSync.native(grokRoot)
        || !receipt.preview_only || receipt.live_submit_allowed || receipt.copy_allowed
        || receipt.output_directory_mode !== 0o700 || !receipt.output_target_absent
        || !receipt.output_parent_matches || !receipt.output_name_matches
        || !receipt.image_argument_matches || !receipt.duration_argument_matches || !receipt.exact_args_match
        || !receipt.forbidden_submit_flags_absent || !receipt.unsupported_i2v_flags_absent
        || !receipt.stable_handoff || receipt.help_exit_code !== 0 || !receipt.help_mentions_duration
        || receipt.receipt_count !== 0 || !receipt.public_review_required || !receipt.public_private_data_absent
        || receipt.external_call_performed || receipt.model_called || receipt.generation_executed) {
        throw new Error(`GROK_VIDEO_PREVIEW_VERIFICATION_FAILED:${JSON.stringify(receipt)}`);
    }
    writeReceipt('result.json', receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} else {
    throw new Error('GROK_VIDEO_PREVIEW_MODE_INVALID');
}
