import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import filmPipelineProvider from '../electron/lib/filmPipelineProvider.js';
import cinematicTemplateProvider from '../electron/lib/cinematicTemplateProvider.js';
import {
    getNewProjectCinematicTemplateState as getClientTemplateState,
    saveNewProjectCinematicTemplate as saveClientTemplate,
} from '../src/lib/pipeline/client.js';

const {
    CINEMATIC_TEMPLATE_SCHEMA,
    MAX_TEMPLATE_TEXT_BYTES,
    exactPaths,
    getNewProjectCinematicTemplateState,
    saveNewProjectCinematicTemplate,
    validateSavePayload,
} = cinematicTemplateProvider;

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-cinematic-template-')));
    const userDataPath = path.join(base, 'user-data');
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, userDataPath };
}

function payload(overrides = {}) {
    return {
        mode: 'cinematic',
        director_intent: '인물의 선택을 정적인 프레임으로 따라간다.',
        visual_thesis: '따뜻한 실내와 차가운 바깥의 대비',
        must_preserve: '마지막 시선과 붉은 우산',
        must_avoid: '과도한 카메라 회전과 네온 색감',
        expected_revision_sha256: '',
        ...overrides,
    };
}

test('missing companion returns a pathless basic template without creating files', (t) => {
    const parts = fixture(t);
    const state = getNewProjectCinematicTemplateState(parts);

    assert.deepEqual(state, {
        ok: true,
        status: 'empty',
        template: {
            mode: 'basic',
            director_intent: '',
            visual_thesis: '',
            must_preserve: '',
            must_avoid: '',
        },
        savedAt: '',
        revision_sha256: '',
        blockers: [],
        executed: false,
    });
    assert.equal(fs.existsSync(path.join(parts.userDataPath, 'film-pipeline')), false);
    assert.equal(Object.keys(state).some((key) => /path|root|command/i.test(key)), false);
});

test('cinematic template saves atomically as 0600 and restores with content revision', (t) => {
    const parts = fixture(t);
    const saved = saveNewProjectCinematicTemplate(payload(), parts);
    const paths = exactPaths(parts.userDataPath);

    assert.equal(saved.ok, true);
    assert.equal(saved.status, 'saved');
    assert.match(saved.revision_sha256, /^[a-f0-9]{64}$/);
    assert.equal(saved.executed, false);
    assert.equal(fs.lstatSync(paths.templatePath).mode & 0o777, 0o600);
    assert.equal(fs.lstatSync(paths.templatePath).isSymbolicLink(), false);
    const record = JSON.parse(fs.readFileSync(paths.templatePath, 'utf8'));
    assert.equal(record.schema_version, CINEMATIC_TEMPLATE_SCHEMA);
    assert.deepEqual(Object.keys(record).sort(), [
        'director_intent', 'mode', 'must_avoid', 'must_preserve', 'saved_at',
        'schema_version', 'visual_thesis',
    ]);

    const restarted = getNewProjectCinematicTemplateState(parts);
    assert.equal(restarted.status, 'restored');
    assert.deepEqual(restarted.template, saved.template);
    assert.equal(restarted.revision_sha256, saved.revision_sha256);
    assert.equal(Object.hasOwn(restarted, 'templatePath'), false);
});

test('save contract rejects unknown keys, malformed text, oversized UTF-8, invalid modes and revisions before writing', (t) => {
    const parts = fixture(t);
    const invalidCases = [
        [{ ...payload(), output_path: '/tmp/out' }, 'CINEMATIC_TEMPLATE_SAVE_SHAPE_INVALID'],
        [payload({ mode: 'dreamina' }), 'CINEMATIC_TEMPLATE_MODE_INVALID'],
        [payload({ director_intent: 'bad\0text' }), 'CINEMATIC_TEMPLATE_DIRECTOR_INTENT_INVALID'],
        [payload({ visual_thesis: '\uD800' }), 'CINEMATIC_TEMPLATE_VISUAL_THESIS_INVALID'],
        [payload({ must_preserve: '가'.repeat(Math.floor(MAX_TEMPLATE_TEXT_BYTES / 3) + 1) }), 'CINEMATIC_TEMPLATE_MUST_PRESERVE_INVALID'],
        [payload({ must_avoid: 10 }), 'CINEMATIC_TEMPLATE_MUST_AVOID_INVALID'],
        [payload({ expected_revision_sha256: 'not-a-revision' }), 'CINEMATIC_TEMPLATE_REVISION_INVALID'],
    ];
    for (const [candidate, code] of invalidCases) {
        assert.throws(() => validateSavePayload(candidate), (error) => error.code === code, code);
        assert.throws(() => saveNewProjectCinematicTemplate(candidate, parts), (error) => error.code === code, code);
    }
    assert.equal(fs.existsSync(path.join(parts.userDataPath, 'film-pipeline')), false);
});

test('basic mode clears cinematic text and stale revisions cannot overwrite the saved companion', (t) => {
    const parts = fixture(t);
    const first = saveNewProjectCinematicTemplate(payload(), parts);
    assert.throws(
        () => saveNewProjectCinematicTemplate(payload({ director_intent: 'stale update' }), parts),
        (error) => error.code === 'CINEMATIC_TEMPLATE_REVISION_STALE',
    );
    assert.deepEqual(getNewProjectCinematicTemplateState(parts).template, first.template);

    const basic = saveNewProjectCinematicTemplate(payload({
        mode: 'basic',
        director_intent: 'discard me',
        visual_thesis: 'discard me',
        must_preserve: 'discard me',
        must_avoid: 'discard me',
        expected_revision_sha256: first.revision_sha256,
    }), parts);
    assert.deepEqual(basic.template, {
        mode: 'basic', director_intent: '', visual_thesis: '', must_preserve: '', must_avoid: '',
    });
    assert.equal(getNewProjectCinematicTemplateState(parts).revision_sha256, basic.revision_sha256);
});

test('symlinked ancestors and targets fail closed without outside writes', (t) => {
    const linked = fixture(t);
    const outside = path.join(linked.base, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'sentinel'), 'unchanged');
    fs.mkdirSync(path.join(linked.userDataPath, 'film-pipeline'));
    fs.symlinkSync(outside, path.join(linked.userDataPath, 'film-pipeline', 'drafts'), 'dir');
    assert.throws(
        () => saveNewProjectCinematicTemplate(payload(), linked),
        (error) => error.code === 'CINEMATIC_TEMPLATE_DIRECTORY_UNSAFE',
    );
    assert.deepEqual(fs.readdirSync(outside), ['sentinel']);
    assert.equal(fs.readFileSync(path.join(outside, 'sentinel'), 'utf8'), 'unchanged');

    const target = fixture(t);
    const initial = saveNewProjectCinematicTemplate(payload(), target);
    const paths = exactPaths(target.userDataPath);
    fs.unlinkSync(paths.templatePath);
    const outsideFile = path.join(target.base, 'outside-template.json');
    fs.writeFileSync(outsideFile, 'unchanged');
    fs.symlinkSync(outsideFile, paths.templatePath);
    const blocked = getNewProjectCinematicTemplateState(target);
    assert.equal(blocked.ok, false);
    assert.deepEqual(blocked.blockers, ['CINEMATIC_TEMPLATE_FILE_UNSAFE']);
    assert.throws(
        () => saveNewProjectCinematicTemplate(payload({ expected_revision_sha256: initial.revision_sha256 }), target),
        (error) => error.code === 'CINEMATIC_TEMPLATE_FILE_UNSAFE',
    );
    assert.equal(fs.readFileSync(outsideFile, 'utf8'), 'unchanged');
});

test('failed atomic rename leaves no temporary file and preserves an existing companion', (t) => {
    const parts = fixture(t);
    const first = saveNewProjectCinematicTemplate(payload(), parts);
    const paths = exactPaths(parts.userDataPath);
    const before = fs.readFileSync(paths.templatePath);

    assert.throws(
        () => saveNewProjectCinematicTemplate(payload({
            director_intent: '새 연출 의도',
            expected_revision_sha256: first.revision_sha256,
        }), {
            ...parts,
            renameFile() { throw Object.assign(new Error('injected rename failure'), { code: 'EIO' }); },
        }),
        (error) => error.code === 'EIO',
    );
    assert.deepEqual(fs.readFileSync(paths.templatePath), before);
    assert.deepEqual(fs.readdirSync(paths.draftRoot), ['cinematic-template.json']);
});

test('main IPC exposes pathless get and exact save without command or provider execution', (t) => {
    const parts = fixture(t);
    const handlers = new Map();
    filmPipelineProvider.register({
        handle(channel, handler) { handlers.set(channel, handler); },
    }, {
        userDataPath: parts.userDataPath,
        readConfigFn: () => ({
            productionRoot: '', productionParentRoot: '', recentProductionRoots: [],
            externalMediaRoots: { dst: '', flow: '', grok: '', replicate: '', bytedance: '' },
            pathProvenanceVersion: 1, externalMediaRootProvenanceVersion: 1,
            dryRunMode: true, allowSafeCommandExecution: false,
        }),
        harnessRoot: path.join(parts.base, 'missing-harness'),
    });
    const getHandler = handlers.get('film-pipeline:get-new-project-cinematic-template-state');
    const saveHandler = handlers.get('film-pipeline:save-new-project-cinematic-template');
    assert.equal(typeof getHandler, 'function');
    assert.equal(typeof saveHandler, 'function');
    assert.throws(
        () => getHandler({}, '/tmp/injected'),
        (error) => error.code === 'RENDERER_PATH_ARGUMENT_FORBIDDEN',
    );
    const empty = getHandler({}, undefined);
    const saved = saveHandler({}, payload());
    assert.equal(empty.status, 'empty');
    assert.equal(saved.status, 'saved');
    assert.equal(saved.template.mode, 'cinematic');
    assert.equal(saved.executed, false);
    assert.equal(Object.keys(saved).some((key) => /path|root|command|provider/i.test(key)), false);
});

test('renderer client uses only the narrow pathless bridge and has a safe basic fallback', async (t) => {
    const priorWindow = globalThis.window;
    t.after(() => {
        if (priorWindow === undefined) delete globalThis.window;
        else globalThis.window = priorWindow;
    });
    const calls = [];
    const candidate = payload();
    globalThis.window = {
        filmPipeline: {
            getNewProjectCinematicTemplateState(...args) {
                calls.push(['get', args]);
                return Promise.resolve({ status: 'restored' });
            },
            saveNewProjectCinematicTemplate(value) {
                calls.push(['save', value]);
                return Promise.resolve({ status: 'saved' });
            },
        },
    };
    assert.deepEqual(await getClientTemplateState(), { status: 'restored' });
    assert.deepEqual(await saveClientTemplate(candidate), { status: 'saved' });
    assert.deepEqual(calls, [['get', []], ['save', candidate]]);

    delete globalThis.window;
    const fallback = await getClientTemplateState();
    assert.equal(fallback.ok, false);
    assert.equal(fallback.status, 'empty');
    assert.equal(fallback.template.mode, 'basic');
    assert.equal(fallback.revision_sha256, '');
    assert.deepEqual(fallback.blockers, ['FILM_PIPELINE_BRIDGE_UNAVAILABLE']);
});
