import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import provider from '../electron/lib/filmPipelineProvider.js';
import draftProvider from '../electron/lib/newProjectDraftProvider.js';
import cinematicTemplateProvider from '../electron/lib/cinematicTemplateProvider.js';

const { getHarnessContractStatus, HARNESS_CONTRACT_ALLOWLIST, register } = provider;
const {
    exactDraftPaths, getNewProjectDraftState, saveNewProjectDraft, validateNewProjectDraft,
} = draftProvider;
const { saveNewProjectCinematicTemplate } = cinematicTemplateProvider;

const markerContent = Object.freeze({
    pack_builder: '#!/usr/bin/env python3\n--brief --script --production-id --output-root --target-generator\n',
    pack_validator: '#!/usr/bin/env python3\nvalidate_pipeline_pack production_dir --json\n',
    room_plan_builder: '#!/usr/bin/env python3\nbuild_drama_selection_plan --package-dir --ledger-output\n',
    room_verifier: '#!/usr/bin/env python3\nrun_drama_room_pipeline_verification selected_takes_contract_matches_edit_render_consumer\n',
    canonical_pack_contract: 'PACK_CONTRACT_VERSION\nactual_generation_submitted\ncanonical_production_id_mismatch\n',
});

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-new-project-')));
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
        production_id: 'spring-campaign-01',
        brief: '따뜻한 봄날의 동네 이야기를 세로형 숏폼으로 제작한다.',
        script: '문을 열자 햇빛이 들어왔다. 오늘은 새로운 하루다.',
        route: 'flow_omni',
        aspect_ratio: '9:16',
        scene_duration: 6,
        max_scenes: 4,
        ...overrides,
    };
}

function config(parentRoot) {
    return {
        productionRoot: '',
        productionParentRoot: parentRoot,
        recentProductionRoots: [],
        pathProvenanceVersion: 1,
        dryRunMode: true,
        allowSafeCommandExecution: false,
    };
}

function createRegisteredHarness(parts) {
    const handlers = new Map();
    let clipboardText = '';
    let clipboardWrites = 0;
    let currentConfig = config(parts.productionParentRoot);
    register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
        userDataPath: parts.userDataPath,
        harnessRoot: parts.harnessRoot,
        readConfigFn: () => structuredClone(currentConfig),
        clipboardApi: {
            writeText(value) { clipboardWrites += 1; clipboardText = value; },
            readText() { return clipboardText; },
        },
    });
    return {
        handlers,
        invoke(channel, payload) {
            const handler = handlers.get(channel);
            assert.ok(handler, `missing handler ${channel}`);
            return handler({}, payload);
        },
        getClipboard: () => clipboardText,
        getClipboardWrites: () => clipboardWrites,
        setParentRoot(value) { currentConfig = config(value); },
    };
}

function directContext(parts, overrides = {}) {
    return {
        userDataPath: parts.userDataPath,
        config: config(parts.productionParentRoot),
        harnessStatus: getHarnessContractStatus({ harnessRoot: parts.harnessRoot }),
        ...overrides,
    };
}

test('registered bootstrap saves a private restorable draft and copies only the exact main-owned builder preview', (t) => {
    const parts = fixture(t);
    const ipc = createRegisteredHarness(parts);
    const draft = validDraft();
    const before = fs.readdirSync(parts.productionParentRoot);

    const saved = ipc.invoke('film-pipeline:save-new-project-draft', draft);
    assert.equal(saved.ok, true);
    assert.equal(saved.status, 'saved');
    assert.equal(saved.readiness, 'ready_to_copy');
    assert.equal(saved.executed, false);
    assert.equal(saved.preview.executed, false);
    assert.equal(saved.preview.previewOnly, true);
    assert.equal(saved.preview.command, 'python3');
    assert.equal(saved.preview.cwd, parts.harnessRoot);
    assert.deepEqual(saved.preview.args, [
        path.join(parts.harnessRoot, 'scripts/build_short_drama_pipeline_pack.py'),
        '--brief', exactDraftPaths(parts.userDataPath).briefPath,
        '--script', exactDraftPaths(parts.userDataPath).scriptPath,
        '--production-id', draft.production_id,
        '--output-root', parts.productionParentRoot,
        '--target-generator', 'flow',
        '--aspect-ratio', '9:16',
        '--scene-duration', '6',
        '--max-scenes', '4',
    ]);
    assert.doesNotMatch(saved.preview.shellSafeCommand, /--overwrite|submit|upload|generate\b/i);
    assert.equal(saved.preview.targetPath, path.join(parts.productionParentRoot, draft.production_id));
    assert.deepEqual(fs.readdirSync(parts.productionParentRoot), before, 'saving must not create a production');

    const paths = exactDraftPaths(parts.userDataPath);
    for (const filePath of [paths.metadataPath, paths.briefPath, paths.scriptPath]) {
        assert.equal(fs.lstatSync(filePath).mode & 0o777, 0o600, `${path.basename(filePath)} must be mode 0600`);
    }
    const metadata = JSON.parse(fs.readFileSync(paths.metadataPath, 'utf8'));
    assert.equal(metadata.schema_version, 'film_pipeline.new_project_draft.v1');
    assert.equal(Object.hasOwn(metadata, 'brief'), false);
    assert.equal(Object.hasOwn(metadata, 'script'), false);

    const restored = ipc.invoke('film-pipeline:get-new-project-draft-state');
    assert.equal(restored.status, 'restored');
    assert.deepEqual(restored.draft, draft);
    assert.equal(restored.readiness, 'ready_to_copy');
    const copied = ipc.invoke('film-pipeline:copy-new-project-build-command');
    assert.equal(copied.ok, true);
    assert.equal(copied.copied, true);
    assert.equal(copied.verified, true);
    assert.equal(copied.executed, false);
    assert.equal(ipc.getClipboard(), restored.preview.shellSafeCommand);
    assert.equal(ipc.getClipboardWrites(), 1);
    assert.equal(copied.sha256, restored.preview.sha256);
});

test('cinematic companion-only draft root stays empty while partial canonical drafts fail closed', (t) => {
    const companionOnly = fixture(t);
    saveNewProjectCinematicTemplate({
        mode: 'cinematic',
        director_intent: '인물의 선택을 정적인 프레임으로 따라간다.',
        visual_thesis: '따뜻한 실내와 차가운 바깥의 대비',
        must_preserve: '마지막 시선과 붉은 우산',
        must_avoid: '과도한 카메라 회전과 네온 색감',
        expected_revision_sha256: '',
    }, companionOnly);
    const companionState = getNewProjectDraftState(directContext(companionOnly));

    assert.equal(companionState.ok, true);
    assert.equal(companionState.status, 'empty');
    assert.deepEqual(companionState.blockers, ['NEW_PROJECT_DRAFT_EMPTY']);

    for (const remainingFile of ['metadataPath', 'briefPath', 'scriptPath']) {
        const partial = fixture(t);
        saveNewProjectDraft(validDraft(), directContext(partial));
        const paths = exactDraftPaths(partial.userDataPath);
        for (const filePath of [paths.metadataPath, paths.briefPath, paths.scriptPath]) {
            if (filePath !== paths[remainingFile]) fs.rmSync(filePath);
        }
        const state = getNewProjectDraftState(directContext(partial));

        assert.equal(state.ok, false, `${remainingFile} alone must not restore a draft`);
        assert.equal(state.status, 'error');
        assert.deepEqual(state.blockers, ['NEW_PROJECT_DRAFT_INCOMPLETE']);
    }
});

test('draft validation rejects path injection, malformed text, oversized content, and invalid bounded fields before writing', (t) => {
    const parts = fixture(t);
    const paths = exactDraftPaths(parts.userDataPath);
    const outside = path.join(parts.base, 'outside-sentinel.txt');
    fs.writeFileSync(outside, 'unchanged');
    const invalidCases = [
        [validDraft({ production_id: '../escape' }), 'NEW_PROJECT_ID_INVALID'],
        [validDraft({ production_id: 'UPPERCASE' }), 'NEW_PROJECT_ID_INVALID'],
        [validDraft({ production_id: 'ab' }), 'NEW_PROJECT_ID_INVALID'],
        [validDraft({ brief: 'bad\0brief' }), 'NEW_PROJECT_BRIEF_INVALID'],
        [validDraft({ script: '\uD800' }), 'NEW_PROJECT_SCRIPT_INVALID'],
        [validDraft({ brief: '가'.repeat(22000) }), 'NEW_PROJECT_BRIEF_INVALID'],
        [validDraft({ script: '가'.repeat(88000) }), 'NEW_PROJECT_SCRIPT_INVALID'],
        [validDraft({ route: 'dreamina_submit' }), 'NEW_PROJECT_ROUTE_INVALID'],
        [validDraft({ aspect_ratio: '1:1' }), 'NEW_PROJECT_ASPECT_INVALID'],
        [validDraft({ scene_duration: 3 }), 'NEW_PROJECT_SCENE_DURATION_INVALID'],
        [validDraft({ scene_duration: '6' }), 'NEW_PROJECT_SCENE_DURATION_INVALID'],
        [validDraft({ max_scenes: 11 }), 'NEW_PROJECT_MAX_SCENES_INVALID'],
        [{ ...validDraft(), output_root: parts.productionParentRoot }, 'NEW_PROJECT_DRAFT_SHAPE_INVALID'],
        [{ ...validDraft(), cwd: parts.harnessRoot }, 'NEW_PROJECT_DRAFT_SHAPE_INVALID'],
        [{ ...validDraft(), command: 'python3' }, 'NEW_PROJECT_DRAFT_SHAPE_INVALID'],
    ];
    for (const [payload, code] of invalidCases) {
        assert.throws(() => validateNewProjectDraft(payload), (error) => error.code === code, code);
        assert.throws(() => saveNewProjectDraft(payload, directContext(parts)), (error) => error.code === code, code);
    }
    assert.equal(fs.existsSync(paths.draftRoot), false, 'invalid drafts must fail before draft directory creation');
    assert.equal(fs.readFileSync(outside, 'utf8'), 'unchanged');
    assert.deepEqual(fs.readdirSync(parts.productionParentRoot), []);
});

test('path-free IPC rejects unsolicited renderer path and command arguments', (t) => {
    const parts = fixture(t);
    const ipc = createRegisteredHarness(parts);
    ipc.invoke('film-pipeline:save-new-project-draft', validDraft());
    for (const channel of [
        'film-pipeline:get-new-project-draft-state',
        'film-pipeline:copy-new-project-build-command',
    ]) {
        for (const injected of [parts.productionParentRoot, { rootPath: parts.productionParentRoot }, { command: 'rm' }, null]) {
            assert.throws(
                () => ipc.invoke(channel, injected),
                (error) => error.code === 'RENDERER_PATH_ARGUMENT_FORBIDDEN',
                `${channel} must reject renderer arguments`,
            );
        }
    }
    assert.equal(ipc.getClipboardWrites(), 0);
});

test('every existing target kind blocks preview and clipboard, including empty directories and symlinks', (t) => {
    const parts = fixture(t);
    const ipc = createRegisteredHarness(parts);
    const draft = validDraft();
    ipc.invoke('film-pipeline:save-new-project-draft', draft);
    const target = path.join(parts.productionParentRoot, draft.production_id);
    const outside = path.join(parts.base, 'outside-target');
    fs.mkdirSync(outside);
    const cases = [
        ['NEW_PROJECT_TARGET_FILE_EXISTS', () => fs.writeFileSync(target, 'occupied')],
        ['NEW_PROJECT_TARGET_EMPTY_DIRECTORY_EXISTS', () => fs.mkdirSync(target)],
        ['NEW_PROJECT_TARGET_NONEMPTY_DIRECTORY_EXISTS', () => { fs.mkdirSync(target); fs.writeFileSync(path.join(target, 'file'), 'occupied'); }],
        ['NEW_PROJECT_TARGET_SYMLINK', () => fs.symlinkSync(outside, target, 'dir')],
    ];
    for (const [reason, create] of cases) {
        create();
        const state = ipc.invoke('film-pipeline:get-new-project-draft-state');
        assert.equal(state.preview.copyAllowed, false);
        assert.ok(state.blockers.includes(reason));
        const copied = ipc.invoke('film-pipeline:copy-new-project-build-command');
        assert.equal(copied.copied, false);
        assert.equal(copied.executed, false);
        assert.equal(ipc.getClipboardWrites(), 0);
        fs.rmSync(target, { recursive: true, force: true });
    }
});

test('parent and harness are re-evaluated on restart and immediately before copy', (t) => {
    const parts = fixture(t);
    const first = createRegisteredHarness(parts);
    const draft = validDraft();
    first.invoke('film-pipeline:save-new-project-draft', draft);

    const restarted = createRegisteredHarness(parts);
    assert.equal(restarted.invoke('film-pipeline:get-new-project-draft-state').status, 'restored');
    fs.mkdirSync(path.join(parts.productionParentRoot, draft.production_id));
    const targetBlocked = restarted.invoke('film-pipeline:copy-new-project-build-command');
    assert.equal(targetBlocked.copied, false);
    assert.ok(targetBlocked.state.blockers.includes('NEW_PROJECT_TARGET_EMPTY_DIRECTORY_EXISTS'));
    fs.rmSync(path.join(parts.productionParentRoot, draft.production_id), { recursive: true });

    fs.writeFileSync(path.join(parts.harnessRoot, 'scripts/build_short_drama_pipeline_pack.py'), 'corrupt');
    const harnessBlocked = restarted.invoke('film-pipeline:copy-new-project-build-command');
    assert.equal(harnessBlocked.copied, false);
    assert.ok(harnessBlocked.state.blockers.includes('NEW_PROJECT_HARNESS_NOT_READY'));
    assert.equal(restarted.getClipboardWrites(), 0);

    const missingParent = path.join(parts.base, 'missing-parent');
    restarted.setParentRoot(missingParent);
    const missingState = restarted.invoke('film-pipeline:get-new-project-draft-state');
    assert.ok(missingState.blockers.includes('NEW_PROJECT_PARENT_MISSING'));
    const fileParent = path.join(parts.base, 'file-parent');
    fs.writeFileSync(fileParent, 'not a directory');
    restarted.setParentRoot(fileParent);
    assert.ok(restarted.invoke('film-pipeline:get-new-project-draft-state').blockers.includes('NEW_PROJECT_PARENT_UNSAFE'));
    const linkedParent = path.join(parts.base, 'linked-parent');
    fs.symlinkSync(parts.productionParentRoot, linkedParent, 'dir');
    restarted.setParentRoot(linkedParent);
    assert.ok(restarted.invoke('film-pipeline:get-new-project-draft-state').blockers.includes('NEW_PROJECT_PARENT_UNSAFE'));
});

test('symlinked draft ancestors and failed atomic rename fail closed without outside writes or temp residue', (t) => {
    const linked = fixture(t);
    const outsideDrafts = path.join(linked.base, 'outside-drafts');
    fs.mkdirSync(outsideDrafts);
    fs.writeFileSync(path.join(outsideDrafts, 'sentinel'), 'unchanged');
    fs.mkdirSync(path.join(linked.userDataPath, 'film-pipeline'));
    fs.symlinkSync(outsideDrafts, path.join(linked.userDataPath, 'film-pipeline', 'drafts'), 'dir');
    assert.throws(
        () => saveNewProjectDraft(validDraft(), directContext(linked)),
        (error) => error.code === 'NEW_PROJECT_DRAFT_DIRECTORY_UNSAFE',
    );
    assert.equal(fs.readFileSync(path.join(outsideDrafts, 'sentinel'), 'utf8'), 'unchanged');
    assert.deepEqual(fs.readdirSync(outsideDrafts), ['sentinel']);

    const failed = fixture(t);
    assert.throws(
        () => saveNewProjectDraft(validDraft(), directContext(failed, {
            renameFile() { throw Object.assign(new Error('injected rename failure'), { code: 'EIO' }); },
        })),
        (error) => error.code === 'EIO',
    );
    const draftRoot = exactDraftPaths(failed.userDataPath).draftRoot;
    assert.deepEqual(fs.readdirSync(draftRoot), [], 'failed rename must leave no temporary or partial file');
    assert.deepEqual(fs.readdirSync(failed.productionParentRoot), []);
});

test('maximum UTF-8 draft sizes remain readable after the canonical trailing newline', (t) => {
    const parts = fixture(t);
    const draft = validDraft({ brief: 'b'.repeat(64 * 1024), script: 's'.repeat(256 * 1024) });
    const saved = saveNewProjectDraft(draft, directContext(parts));
    assert.equal(saved.status, 'saved');
    const restored = getNewProjectDraftState(directContext(parts));
    assert.equal(restored.status, 'restored');
    assert.equal(restored.draft.brief.length, 64 * 1024);
    assert.equal(restored.draft.script.length, 256 * 1024);
});
