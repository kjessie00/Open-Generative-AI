import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import designProvider from '../electron/lib/newProjectDesignProvider.js';
import imagePlanProvider from '../electron/lib/newProjectImagePlanProvider.js';
import executionProvider from '../electron/lib/newProjectExecutionProvider.js';

const evidenceRoot = path.resolve(process.argv[2] || 'tmp/reference-staging');
const mode = process.argv[3] || 'seed';
const userDataPath = path.join(evidenceRoot, 'user-data');
const context = { userDataPath };
const cliPath = path.resolve('scripts/new-project-execution-handoff.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const jpeg = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=', 'base64');

function sha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function writeReceipt(name, value) {
    fs.writeFileSync(path.join(evidenceRoot, name), `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
}

function inspect() {
    const result = spawnSync(process.execPath, [cliPath, 'inspect', '--user-data', userDataPath], {
        cwd: path.resolve('.'), encoding: 'utf8',
    });
    if (result.status !== 0) throw new Error(`REFERENCE_STAGING_CLI_FAILED:${result.stderr.trim()}`);
    return JSON.parse(result.stdout).handoff;
}

function exactMode(filePath) {
    return fs.lstatSync(filePath).mode & 0o777;
}

function imageSignatureMatches(buffer, mimeType) {
    if (mimeType === 'image/png') return buffer.subarray(0, 8).equals(png.subarray(0, 8));
    if (mimeType === 'image/jpeg') return buffer.length >= 3
        && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
    return false;
}

if (mode === 'seed') {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
    fs.mkdirSync(userDataPath, { recursive: true, mode: 0o700 });
    fs.chmodSync(evidenceRoot, 0o700);
    fs.chmodSync(userDataPath, 0o700);

    draftProvider.saveNewProjectDraft({
        production_id: 'reference-staging-proof',
        brief: '비 오는 골목에서 오래 헤어진 두 사람이 다시 만난다.',
        script: '붉은 우산을 든 주인공이 네온 골목에서 걸음을 멈추고 친구를 바라본다.',
        route: 'both', aspect_ratio: '16:9', scene_duration: 5, max_scenes: 1,
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

    let imageState = imagePlanProvider.getNewProjectImagePlan(context);
    imageState = imagePlanProvider.saveNewProjectImagePlan({
        tasks: imageState.tasks,
        expected_design_revision_sha256: imageState.design_revision_sha256,
        expected_image_plan_revision_sha256: imageState.revision_sha256,
    }, context);
    const referenceTasks = imageState.tasks.filter((task) => task.kind.endsWith('_sheet'));
    const previews = [
        { buffer: png, mime_type: 'image/png' },
        { buffer: jpeg, mime_type: 'image/jpeg' },
    ];
    if (referenceTasks.length !== previews.length) throw new Error('REFERENCE_STAGING_SEED_TASKS_INVALID');
    for (let index = 0; index < referenceTasks.length; index += 1) {
        const preview = previews[index];
        imageState = imagePlanProvider.connectNewProjectImageResult({
            task_token: referenceTasks[index].task_token,
            candidate_token: `reference-staging-${index + 1}`,
            image_index: index + 1,
            expected_design_revision_sha256: imageState.design_revision_sha256,
            expected_image_plan_revision_sha256: imageState.revision_sha256,
        }, {
            ...context,
            getDstBundleImportPreview: () => ({
                ready: true,
                preview: {
                    mime_type: preview.mime_type,
                    byte_length: preview.buffer.byteLength,
                    base64: preview.buffer.toString('base64'),
                },
                blockers: [],
            }),
        }).state;
    }
    const queued = imagePlanProvider.prepareNewProjectImagePlan({
        expected_design_revision_sha256: imageState.design_revision_sha256,
        expected_image_plan_revision_sha256: imageState.revision_sha256,
    }, context);
    const state = executionProvider.getNewProjectExecutionState(context);
    if (!state.ok || state.prepared || queued.task_count !== 1
        || queued.tasks[0].kind !== 'scene_image' || state.task_count !== 1) {
        throw new Error('REFERENCE_STAGING_SEED_NOT_READY');
    }
    const receipt = {
        mode, prepared: state.prepared, task_count: state.task_count,
        task_kind: queued.tasks[0].kind, connected_reference_count: referenceTasks.length,
        external_call_performed: state.external_call_performed,
        model_called: state.model_called, generation_executed: state.generation_executed,
        provider_generation_calls: 0, user_data_path: userDataPath,
    };
    writeReceipt('seed.json', receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} else if (mode === 'verify') {
    const state = executionProvider.getNewProjectExecutionState(context);
    if (!state.ok || !state.prepared || state.task_count !== 1) {
        throw new Error('REFERENCE_STAGING_DESKTOP_ACTION_MISSING');
    }
    const firstHandoff = inspect();
    const scene = firstHandoff.tasks[0];
    if (firstHandoff.schema_version !== 'film_pipeline.new_project_execution_handoff.v4'
        || firstHandoff.tasks.length !== 1 || scene.kind !== 'scene_image'
        || scene.reference_files.length !== 2) throw new Error('REFERENCE_STAGING_HANDOFF_INVALID');
    const paths = executionProvider.exactPaths(userDataPath, `run_${scene.run_revision_sha256}`);
    const manifestBytes = fs.readFileSync(paths.referencesManifestPath);
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    const firstInodes = scene.reference_files.map((reference) => fs.lstatSync(reference.path).ino);
    const attachedPaths = scene.provider_execution_preview.command_spec.args.flatMap((value, index, values) => (
        value === '--attach' ? [values[index + 1]] : []
    ));
    const files = scene.reference_files.map((reference) => {
        const stats = fs.lstatSync(reference.path);
        const bytes = fs.readFileSync(reference.path);
        const manifestReference = manifest.references.find((item) => item.result_token === reference.result_token);
        return {
            path: reference.path,
            mode: stats.mode & 0o777,
            symlink: stats.isSymbolicLink(),
            mime_type: reference.mime_type,
            byte_length: bytes.byteLength,
            sha256: sha256(bytes),
            valid_signature: imageSignatureMatches(bytes, reference.mime_type),
            manifest_match: Boolean(manifestReference)
                && manifestReference.byte_length === bytes.byteLength
                && manifestReference.sha256 === sha256(bytes),
        };
    });
    const secondHandoff = inspect();
    const stableInodes = secondHandoff.tasks[0].reference_files.map(
        (reference) => fs.lstatSync(reference.path).ino,
    );
    const stableManifest = fs.readFileSync(paths.referencesManifestPath).equals(manifestBytes);
    const receipt = {
        mode, prepared: state.prepared, handoff_schema: firstHandoff.schema_version,
        task_count: firstHandoff.tasks.length, reference_count: scene.reference_files.length,
        reference_manifest_schema: manifest.schema_version,
        reference_directory_mode: exactMode(paths.referencesRoot),
        reference_manifest_mode: exactMode(paths.referencesManifestPath),
        attached_paths_match: JSON.stringify(attachedPaths)
            === JSON.stringify(scene.reference_files.map((reference) => reference.path)),
        preview_readiness: scene.provider_execution_preview.readiness,
        preview_only: scene.provider_execution_preview.command_spec.preview_only,
        live_submit_allowed: scene.provider_execution_preview.command_spec.live_submit_allowed,
        copy_allowed: scene.provider_execution_preview.command_spec.copy_allowed,
        files, stable_inodes: JSON.stringify(firstInodes) === JSON.stringify(stableInodes),
        stable_manifest: stableManifest, receipt_count: firstHandoff.receipts.length,
        external_call_performed: firstHandoff.external_call_performed,
        model_called: firstHandoff.model_called, generation_executed: firstHandoff.generation_executed,
        provider_generation_calls: 0,
    };
    if (receipt.reference_manifest_schema !== executionProvider.REFERENCES_SCHEMA
        || receipt.reference_directory_mode !== 0o700 || receipt.reference_manifest_mode !== 0o600
        || !receipt.attached_paths_match || receipt.preview_readiness !== 'preview_ready'
        || receipt.preview_only !== true || receipt.live_submit_allowed !== false || receipt.copy_allowed !== false
        || files.some((file) => file.mode !== 0o600 || file.symlink || !file.valid_signature
            || !file.manifest_match || !['image/png', 'image/jpeg'].includes(file.mime_type))
        || !receipt.stable_inodes || !receipt.stable_manifest || receipt.receipt_count !== 0
        || receipt.external_call_performed || receipt.model_called || receipt.generation_executed) {
        throw new Error('REFERENCE_STAGING_VERIFICATION_FAILED');
    }
    writeReceipt('result.json', receipt);
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
} else {
    throw new Error('REFERENCE_STAGING_MODE_INVALID');
}
