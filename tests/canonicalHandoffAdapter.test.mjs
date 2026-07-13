import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildCanonicalPackBuildCommand,
    buildCanonicalPackValidationCommand,
    buildPipelineCommandSpecs,
    canonicalGeneratorRoute,
} from '../src/lib/pipeline/commandBuilders.js';
import { classifySideEffect, renderShellCommand, SIDE_EFFECT_TYPES } from '../src/lib/pipeline/sideEffects.js';

const harnessRoot = '/Users/jessiek/StudioProjects/happyVideoFactory';
const validatorPath = `${harnessRoot}/scripts/validate_short_drama_pipeline_pack.py`;
const builderPath = `${harnessRoot}/scripts/build_short_drama_pipeline_pack.py`;
const productionRoot = '/tmp/canonical-production';

function harnessStatus() {
    return {
        ready: true,
        readiness: 'available',
        rootPath: harnessRoot,
        entries: [
            { id: 'pack_builder', path: builderPath, ready: true },
            { id: 'pack_validator', path: validatorPath, ready: true },
        ],
    };
}

function state(route = 'both') {
    return {
        project: { production_id: 'canonical-production', root_path: productionRoot, route },
        canonicalHandoff: { validation_input_ready: true },
        assets: [],
        submitRecords: [],
        heartbeatRecords: [],
        qaRecords: [],
        finalReport: {},
    };
}

test('canonical validator preview uses the exact absolute entrypoint, cwd, root argument, and JSON flag', () => {
    const command = buildCanonicalPackValidationCommand(state(), {
        harnessStatus: harnessStatus(),
        configuredProductionRoot: productionRoot,
    });

    assert.equal(command.command, 'python3');
    assert.deepEqual(command.args, [validatorPath, productionRoot, '--json']);
    assert.equal(command.cwd, harnessRoot);
    assert.equal(command.side_effect_type, SIDE_EFFECT_TYPES.LOCAL_READ);
    assert.equal(command.preview_only, true);
    assert.equal(command.copy_allowed, true);
    assert.equal(command.disabled_reason, '');
    assert.equal(command.evidence_output_path, '', 'validator stdout must not be claimed as a persisted evidence file');
    assert.equal(renderShellCommand(command), `cd ${harnessRoot} && python3 ${validatorPath} ${productionRoot} --json`);
    assert.equal(classifySideEffect(command).mode, 'allowed');
});

test('canonical route mapping is exact and unsupported values fail closed', () => {
    assert.equal(canonicalGeneratorRoute('seedance'), 'seedance');
    assert.equal(canonicalGeneratorRoute('flow_omni'), 'flow');
    assert.equal(canonicalGeneratorRoute('both'), 'both');
    assert.equal(canonicalGeneratorRoute('flow'), '');
    assert.equal(canonicalGeneratorRoute('unknown'), '');

    const command = buildCanonicalPackBuildCommand(state('unknown'), { harnessStatus: harnessStatus() });
    assert.equal(command.copy_allowed, false);
    assert.equal(command.disabled_reason, 'UNSUPPORTED_GENERATOR_ROUTE');
    assert.equal(command.command, '');
});

test('existing production never receives a build or overwrite command', () => {
    for (const route of ['seedance', 'flow_omni', 'both']) {
        const command = buildCanonicalPackBuildCommand(state(route), { harnessStatus: harnessStatus() });
        assert.equal(command.copy_allowed, false);
        assert.equal(command.disabled_reason, 'NEW_PACK_OUTPUT_SAFETY_UNPROVEN');
        assert.equal(command.canonical_target_generator, canonicalGeneratorRoute(route));
        assert.equal(command.command, '');
        assert.deepEqual(command.args, []);
        assert.equal(JSON.stringify(command).includes('--overwrite'), false);
    }
});

test('missing harness, main-owned root mismatch, and incomplete canonical inputs disable validation copy', () => {
    const cases = [
        [state(), { harnessStatus: { readiness: 'blocked', entries: [] }, configuredProductionRoot: productionRoot }, 'CANONICAL_HARNESS_CONTRACT_UNAVAILABLE'],
        [state(), { harnessStatus: harnessStatus(), configuredProductionRoot: '/tmp/renderer-injected' }, 'MAIN_OWNED_PRODUCTION_ROOT_REQUIRED'],
        [{ ...state(), canonicalHandoff: { validation_input_ready: false } }, { harnessStatus: harnessStatus(), configuredProductionRoot: productionRoot }, 'CANONICAL_PACK_INPUT_INCOMPLETE'],
    ];
    for (const [inputState, options, reason] of cases) {
        const command = buildCanonicalPackValidationCommand(inputState, options);
        assert.equal(command.copy_allowed, false);
        assert.equal(command.disabled_reason, reason);
        assert.equal(classifySideEffect(command).copyAllowed, false);
    }
});

test('pipeline command set contains canonical handoff only and no live or legacy generic pipeline surface', () => {
    const commands = buildPipelineCommandSpecs(state(), {
        harnessStatus: harnessStatus(),
        configuredProductionRoot: productionRoot,
        now: new Date('2026-07-13T00:00:00.000Z'),
    });
    const serialized = JSON.stringify(commands);

    assert.equal(commands[0].id, 'canonical_pack_build');
    assert.equal(commands[1].id, 'canonical_pack_validate');
    assert.equal(serialized.includes('build_ai_video_pipeline_plan.py'), false);
    assert.equal(serialized.includes('run_ai_video_pipeline.py'), false);
    assert.equal(serialized.includes('--allow-side-effects'), false);
    assert.equal(serialized.includes('--overwrite'), false);
    assert.equal(serialized.includes('submit generation'), false);
    assert.equal(commands.some((command) => command.run === true || command.execute === true), false);
});
