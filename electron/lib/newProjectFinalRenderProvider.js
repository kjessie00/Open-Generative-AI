const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const finalStitchProvider = require('./newProjectFinalStitchProvider');
const { createFixedRoughcutRuntime } = require('./finishingWorkbenchProvider');

const RECEIPT_SCHEMA = 'film_pipeline.new_project_final_render_receipt.v1';
const PROBE_SCHEMA = 'film_pipeline.new_project_final_render_probe.v1';
const POINTER_SCHEMA = 'film_pipeline.new_project_final_render_pointer.v1';
const PLAN_TTL_MS = 2 * 60 * 1000;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const RUN_PATTERN = /^[a-f0-9]{24}$/;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_MEDIA_BYTES = 16 * 1024 * 1024 * 1024;
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;
const DURATION_TOLERANCE_SECONDS = 0.35;
const defaultPlanStore = new Map();

function failure(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJson(value) {
    if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
    if (value && typeof value === 'object') return `{${Object.keys(value).sort()
        .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

function exactKeys(value, expected, code) {
    if (!value || typeof value !== 'object' || Array.isArray(value)
        || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) throw failure(code);
}

function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function pathsFor(userDataPath) {
    const stitch = finalStitchProvider.exactPaths(userDataPath);
    const runsRoot = path.join(stitch.root, 'runs');
    return {
        stitchRoot: stitch.root,
        runsRoot,
        currentPath: path.join(runsRoot, 'current.json'),
        lockPath: path.join(runsRoot, '.render.lock'),
    };
}

function assertPrivateDirectory(target, code) {
    let stats;
    try { stats = fs.lstatSync(target); } catch { throw failure(code); }
    if (!stats.isDirectory() || stats.isSymbolicLink() || (stats.mode & 0o777) !== 0o700
        || fs.realpathSync.native(target) !== target) throw failure(code);
    return stats;
}

function ensureDirectory(target, parent, code) {
    const parentStats = assertPrivateDirectory(parent, code);
    try { fs.mkdirSync(target, { mode: 0o700 }); } catch (error) {
        if (error.code !== 'EEXIST') throw error;
    }
    const stats = assertPrivateDirectory(target, code);
    if (stats.dev !== parentStats.dev || path.dirname(fs.realpathSync.native(target)) !== parent) throw failure(code);
}

function readStableFile(target, maxBytes, code) {
    let before;
    try { before = fs.lstatSync(target); } catch (error) {
        if (error.code === 'ENOENT') throw failure(`${code}_MISSING`);
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > maxBytes || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure(`${code}_UNSAFE`);
    }
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!sameFile(before, opened)) throw failure(`${code}_CHANGED`);
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(target);
        if (buffer.byteLength !== before.size || !sameFile(opened, after) || !sameFile(opened, final)) {
            throw failure(`${code}_CHANGED`);
        }
        return { buffer, sha256: sha256(buffer), size: buffer.byteLength };
    } finally { fs.closeSync(descriptor); }
}

function readJson(target, code) {
    try { return JSON.parse(readStableFile(target, MAX_JSON_BYTES, code).buffer.toString('utf8')); }
    catch (error) { if (error.code) throw error; throw failure(`${code}_INVALID`); }
}

function hashStableFile(target, maxBytes, code) {
    let before;
    try { before = fs.lstatSync(target); } catch (error) {
        if (error.code === 'ENOENT') throw failure(`${code}_MISSING`);
        throw error;
    }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > maxBytes || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw failure(`${code}_UNSAFE`);
    }
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!sameFile(before, opened)) throw failure(`${code}_CHANGED`);
        const digest = crypto.createHash('sha256');
        const chunk = Buffer.allocUnsafe(1024 * 1024);
        let offset = 0;
        while (offset < opened.size) {
            const bytesRead = fs.readSync(descriptor, chunk, 0, Math.min(chunk.length, opened.size - offset), offset);
            if (bytesRead <= 0) throw failure(`${code}_CHANGED`);
            digest.update(chunk.subarray(0, bytesRead));
            offset += bytesRead;
        }
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(target);
        if (!sameFile(opened, after) || !sameFile(opened, final)) throw failure(`${code}_CHANGED`);
        return { sha256: digest.digest('hex'), size: opened.size };
    } finally { fs.closeSync(descriptor); }
}

function writeExclusive(target, buffer) {
    const descriptor = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT
        | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(descriptor, buffer); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function writeAtomic(target, buffer, parent, randomBytes) {
    assertPrivateDirectory(parent, 'FINAL_RENDER_DIRECTORY_UNSAFE');
    const temporary = path.join(parent, `.current-${randomBytes(12).toString('hex')}.tmp`);
    writeExclusive(temporary, buffer);
    try {
        let existing;
        try { existing = fs.lstatSync(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (existing && (!existing.isFile() || existing.isSymbolicLink() || (existing.mode & 0o777) !== 0o600)) {
            throw failure('FINAL_RENDER_POINTER_UNSAFE');
        }
        fs.renameSync(temporary, target);
        fsyncDirectory(parent);
    } finally { try { fs.unlinkSync(temporary); } catch { /* renamed */ } }
}

function fsyncDirectory(target) {
    const descriptor = fs.openSync(target, fs.constants.O_RDONLY);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function selectedDuration(renderPayload) {
    const order = renderPayload?.expected_order;
    if (!Array.isArray(order) || !order.length) throw failure('FINAL_RENDER_HANDOFF_INVALID');
    const total = order.reduce((sum, item) => {
        const start = Number(item?.source_in_sec);
        const end = Number(item?.source_out_sec);
        if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end <= start) {
            throw failure('FINAL_RENDER_HANDOFF_INVALID');
        }
        return sum + end - start;
    }, 0);
    return Number(total.toFixed(6));
}

function inputIdentity(staged, runtimeInspection) {
    const privateSnapshot = {
        project_id: staged.project_id,
        input_revision: staged.input_revision,
        render_payload: staged.render_payload,
        sources: staged.sources,
        runtime_fingerprint: runtimeInspection.fingerprint,
    };
    const snapshotId = sha256(stableJson(privateSnapshot));
    return { snapshotId, runId: snapshotId.slice(0, 24) };
}

function publicState(inspection, current, status = 'ready', executed = false) {
    const rendered = current?.valid === true;
    return {
        ok: true,
        status: rendered ? 'already_current' : status,
        can_render: !rendered,
        rendered,
        selected_count: inspection.staged.render_payload.expected_order.length,
        selected_duration_seconds: inspection.duration,
        output_duration_seconds: rendered ? current.probe.duration_seconds : 0,
        fresh_probe_verified: rendered,
        has_video: rendered,
        has_audio: rendered,
        preview_ready: rendered && current.outputSize <= MAX_PREVIEW_BYTES,
        executed,
        output_quality_approved: false,
        generation_executed: false,
        legacy_production_modified: false,
        canonical_delivery_modified: false,
        notice: rendered
            ? '검토용 영상이 준비되었습니다. 영상 품질은 아직 승인되지 않았습니다.'
            : '선택한 구간으로 검토용 영상을 만들 수 있습니다.',
    };
}

function blockedState() {
    return {
        ok: false,
        status: 'blocked',
        can_render: false,
        rendered: false,
        selected_count: 0,
        selected_duration_seconds: 0,
        output_duration_seconds: 0,
        fresh_probe_verified: false,
        has_video: false,
        has_audio: false,
        preview_ready: false,
        executed: false,
        output_quality_approved: false,
        generation_executed: false,
        legacy_production_modified: false,
        canonical_delivery_modified: false,
        notice: '최종 편집 준비를 먼저 저장하세요.',
    };
}

function validateRenderSummary(summary, inspection) {
    const expected = inspection.staged.render_payload.expected_order;
    if (!summary || summary.success !== true
        || !Array.isArray(summary.shot_ids) || !Array.isArray(summary.beat_ids) || !Array.isArray(summary.ranges)
        || summary.shot_ids.join('\0') !== expected.map((entry) => entry.shot_id).join('\0')
        || summary.beat_ids.join('\0') !== expected.map((entry) => entry.beat_id).join('\0')
        || summary.ranges.length !== expected.length
        || summary.ranges.some((range, index) => !Array.isArray(range) || range.length !== 2
            || range[0] !== expected[index].source_in_sec || range[1] !== expected[index].source_out_sec)
        || Math.abs(Number(summary.total_duration_seconds) - inspection.duration) > 0.001) {
        throw failure('FINAL_RENDER_SUMMARY_MISMATCH');
    }
}

async function inspectRunRoot(paths, inspection, runtime, runId, expectedReceiptSha = '') {
    if (runId !== inspection.runId || !RUN_PATTERN.test(runId)) throw failure('FINAL_RENDER_OUTPUT_ID_INVALID');
    const runRoot = path.join(paths.runsRoot, runId);
    assertPrivateDirectory(runRoot, 'FINAL_RENDER_OUTPUT_DIRECTORY_UNSAFE');
    const names = fs.readdirSync(runRoot).sort();
    if (names.join(',') !== 'fresh_probe.json,receipt.json,roughcut.mp4') throw failure('FINAL_RENDER_OUTPUT_SET_INVALID');
    const receiptRead = readStableFile(path.join(runRoot, 'receipt.json'), MAX_JSON_BYTES, 'FINAL_RENDER_RECEIPT');
    if (expectedReceiptSha && receiptRead.sha256 !== expectedReceiptSha) throw failure('FINAL_RENDER_RECEIPT_MISMATCH');
    const receipt = JSON.parse(receiptRead.buffer.toString('utf8'));
    exactKeys(receipt, [
        'schema_version', 'snapshot_id', 'project_id', 'selected_count', 'selected_duration_seconds',
        'output_sha256', 'output_size_bytes', 'probe_sha256', 'render_started_at', 'render_completed_at',
        'rendered', 'fresh_probe_verified', 'output_quality_approved', 'generation_executed',
        'legacy_production_modified', 'canonical_delivery_modified',
    ], 'FINAL_RENDER_RECEIPT_INVALID');
    if (receipt.schema_version !== RECEIPT_SCHEMA || receipt.snapshot_id !== inspection.snapshotId
        || receipt.project_id !== inspection.staged.project_id || receipt.rendered !== true
        || receipt.fresh_probe_verified !== true || receipt.output_quality_approved !== false
        || receipt.generation_executed !== false || receipt.legacy_production_modified !== false
        || receipt.canonical_delivery_modified !== false) throw failure('FINAL_RENDER_RECEIPT_INVALID');
    const output = hashStableFile(path.join(runRoot, 'roughcut.mp4'), MAX_MEDIA_BYTES, 'FINAL_RENDER_OUTPUT');
    if (output.sha256 !== receipt.output_sha256 || output.size !== receipt.output_size_bytes) {
        throw failure('FINAL_RENDER_OUTPUT_MISMATCH');
    }
    const probeRead = readStableFile(path.join(runRoot, 'fresh_probe.json'), MAX_JSON_BYTES, 'FINAL_RENDER_PROBE');
    if (probeRead.sha256 !== receipt.probe_sha256) throw failure('FINAL_RENDER_PROBE_MISMATCH');
    const probe = JSON.parse(probeRead.buffer.toString('utf8'));
    if (probe.schema_version !== PROBE_SCHEMA || probe.snapshot_id !== inspection.snapshotId
        || probe.output_sha256 !== output.sha256 || probe.output_size_bytes !== output.size
        || probe.has_video !== true || probe.has_audio !== true || probe.fresh_probe_verified !== true
        || probe.output_quality_approved !== false
        || Math.abs(Number(probe.duration_seconds) - inspection.duration) > DURATION_TOLERANCE_SECONDS) {
        throw failure('FINAL_RENDER_PROBE_INVALID');
    }
    const fresh = await runtime.probe(path.join(runRoot, 'roughcut.mp4'), inspection.runtimeInspection);
    if (!fresh || fresh.has_video !== true || fresh.has_audio !== true
        || Math.abs(Number(fresh.duration_seconds) - inspection.duration) > DURATION_TOLERANCE_SECONDS) {
        throw failure('FINAL_RENDER_FRESH_PROBE_FAILED');
    }
    return {
        valid: true,
        outputPath: path.join(runRoot, 'roughcut.mp4'),
        outputSize: output.size,
        receiptSha256: receiptRead.sha256,
        probe,
    };
}

async function inspectCurrent(paths, inspection, runtime) {
    if (!fs.existsSync(paths.currentPath)) return { valid: false };
    const pointer = readJson(paths.currentPath, 'FINAL_RENDER_POINTER');
    exactKeys(pointer, ['schema_version', 'run_id', 'snapshot_id', 'receipt_sha256', 'updated_at'], 'FINAL_RENDER_POINTER_INVALID');
    if (pointer.schema_version !== POINTER_SCHEMA || !RUN_PATTERN.test(pointer.run_id)
        || !/^[a-f0-9]{64}$/.test(pointer.snapshot_id) || !/^[a-f0-9]{64}$/.test(pointer.receipt_sha256)
        || !Number.isFinite(Date.parse(pointer.updated_at))) throw failure('FINAL_RENDER_POINTER_INVALID');
    if (pointer.snapshot_id !== inspection.snapshotId || pointer.run_id !== inspection.runId) return { valid: false };
    return inspectRunRoot(paths, inspection, runtime, pointer.run_id, pointer.receipt_sha256);
}

function writeAtomicNoReplace(target, buffer, parent, randomBytes) {
    assertPrivateDirectory(parent, 'FINAL_RENDER_DIRECTORY_UNSAFE');
    const temporary = path.join(parent, `.recover-${randomBytes(12).toString('hex')}.tmp`);
    writeExclusive(temporary, buffer);
    try {
        fs.linkSync(temporary, target);
        fs.unlinkSync(temporary);
        fsyncDirectory(parent);
    } catch (error) {
        if (error.code === 'EEXIST') throw failure('FINAL_RENDER_POINTER_RACE');
        throw error;
    } finally { try { fs.unlinkSync(temporary); } catch { /* linked and removed */ } }
}

function createNewProjectFinalRenderProvider(options = {}) {
    const context = {
        userDataPath: options.userDataPath,
        getStagedInput: options.getStagedInput || finalStitchProvider.getStagedNewProjectFinalStitchInput,
        runtime: options.runtime || createFixedRoughcutRuntime({
            harnessRoot: options.harnessRoot,
            adapterPath: options.adapterPath,
            runtimeResolver: options.runtimeResolver,
            mediaProbe: options.mediaProbe,
            render: options.render,
        }),
        now: options.now || (() => new Date()),
        nowMs: options.nowMs || (() => Date.now()),
        randomBytes: options.randomBytes || crypto.randomBytes,
        planStore: options.planStore || defaultPlanStore,
        planTtlMs: options.planTtlMs || PLAN_TTL_MS,
        onInternalError: typeof options.onInternalError === 'function' ? options.onInternalError : () => {},
    };

    async function inspectInputs() {
        const staged = context.getStagedInput(options);
        const runtimeInspection = await context.runtime.inspect();
        const identity = inputIdentity(staged, runtimeInspection);
        const inspection = {
            staged,
            runtimeInspection,
            duration: selectedDuration(staged.render_payload),
            ...identity,
        };
        const paths = pathsFor(context.userDataPath);
        if (fs.existsSync(paths.runsRoot)) assertPrivateDirectory(paths.runsRoot, 'FINAL_RENDER_DIRECTORY_UNSAFE');
        return { inspection, paths };
    }

    async function recoverOrphan(initial) {
        let lock;
        try {
            lock = fs.openSync(initial.paths.lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT
                | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        } catch { throw failure('FINAL_RENDER_BUSY'); }
        try {
            const value = await inspectInputs();
            if (value.inspection.snapshotId !== initial.inspection.snapshotId
                || value.inspection.runId !== initial.inspection.runId) throw failure('FINAL_RENDER_INPUT_CHANGED');
            let current = await inspectCurrent(value.paths, value.inspection, context.runtime);
            if (current.valid) return current;
            const orphanRoot = path.join(value.paths.runsRoot, value.inspection.runId);
            if (!fs.existsSync(orphanRoot)) return current;
            const recovered = await inspectRunRoot(value.paths, value.inspection, context.runtime, value.inspection.runId);
            const pointer = {
                schema_version: POINTER_SCHEMA,
                run_id: value.inspection.runId,
                snapshot_id: value.inspection.snapshotId,
                receipt_sha256: recovered.receiptSha256,
                updated_at: context.now().toISOString(),
            };
            const pointerBuffer = Buffer.from(`${JSON.stringify(pointer, null, 2)}\n`);
            if (fs.existsSync(value.paths.currentPath)) {
                // inspectCurrent above proved that this is an exact, safe pointer
                // for a different snapshot. The cooperative lock serializes this
                // replacement against both render publication and other recovery.
                writeAtomic(value.paths.currentPath, pointerBuffer, value.paths.runsRoot, context.randomBytes);
            } else {
                try {
                    writeAtomicNoReplace(value.paths.currentPath, pointerBuffer,
                        value.paths.runsRoot, context.randomBytes);
                } catch (error) {
                    if (error.code !== 'FINAL_RENDER_POINTER_RACE') throw error;
                }
            }
            current = await inspectCurrent(value.paths, value.inspection, context.runtime);
            if (!current.valid) throw failure('FINAL_RENDER_RECOVERY_FAILED');
            return current;
        } finally {
            try { if (lock !== undefined) fs.closeSync(lock); } catch { /* best effort */ }
            try { fs.unlinkSync(initial.paths.lockPath); } catch { /* best effort */ }
            try { fsyncDirectory(initial.paths.runsRoot); } catch { /* best effort */ }
        }
    }

    async function inspect() {
        const value = await inspectInputs();
        const { inspection, paths } = value;
        let current = fs.existsSync(paths.runsRoot)
            ? await inspectCurrent(paths, inspection, context.runtime)
            : { valid: false };
        const orphanRoot = path.join(paths.runsRoot, inspection.runId);
        if (!current.valid && fs.existsSync(paths.runsRoot) && fs.existsSync(orphanRoot)) {
            current = await recoverOrphan(value);
        }
        return { inspection, paths, current };
    }

    async function get() {
        try {
            const value = await inspect();
            return publicState(value.inspection, value.current);
        } catch (error) {
            context.onInternalError(error);
            return blockedState();
        }
    }

    async function plan() {
        let value;
        try { value = await inspect(); } catch (error) {
            context.onInternalError(error);
            return { ...blockedState(), ready: false, plan_token: '', expires_at: '' };
        }
        const state = publicState(value.inspection, value.current);
        if (value.current.valid) return { ...state, ready: false, plan_token: '', expires_at: '' };
        const createdAtMs = context.nowMs();
        const expiresAtMs = createdAtMs + context.planTtlMs;
        const token = context.randomBytes(32).toString('hex');
        context.planStore.set(token, {
            snapshotId: value.inspection.snapshotId,
            runId: value.inspection.runId,
            projectId: value.inspection.staged.project_id,
            expiresAtMs,
        });
        return {
            ...state,
            status: 'ready',
            ready: true,
            plan_token: token,
            expires_at: new Date(expiresAtMs).toISOString(),
        };
    }

    async function execute(payload) {
        const token = payload?.planToken;
        if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw failure('FINAL_RENDER_PLAN_INVALID');
        const planned = context.planStore.get(token);
        context.planStore.delete(token);
        if (!planned) throw failure('FINAL_RENDER_PLAN_INVALID');
        exactKeys(payload, ['planToken', 'confirmed', 'projectId'], 'FINAL_RENDER_EXECUTION_ENVELOPE_INVALID');
        if (payload.confirmed !== true) throw failure('FINAL_RENDER_CONFIRMATION_REQUIRED');
        if (payload.projectId !== planned.projectId) throw failure('FINAL_RENDER_PROJECT_MISMATCH');
        if (context.nowMs() > planned.expiresAtMs) throw failure('FINAL_RENDER_PLAN_EXPIRED');
        let value = await inspect();
        if (value.inspection.snapshotId !== planned.snapshotId || value.inspection.runId !== planned.runId) {
            throw failure('FINAL_RENDER_INPUT_CHANGED');
        }
        if (value.current.valid) return publicState(value.inspection, value.current, 'already_current', false);

        assertPrivateDirectory(value.paths.stitchRoot, 'FINAL_RENDER_DIRECTORY_UNSAFE');
        ensureDirectory(value.paths.runsRoot, value.paths.stitchRoot, 'FINAL_RENDER_DIRECTORY_UNSAFE');
        let lock;
        try {
            lock = fs.openSync(value.paths.lockPath, fs.constants.O_WRONLY | fs.constants.O_CREAT
                | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        } catch { throw failure('FINAL_RENDER_BUSY'); }
        const stagingRoot = path.join(value.paths.runsRoot,
            `.staging-${value.inspection.runId}-${context.randomBytes(8).toString('hex')}`);
        const runRoot = path.join(value.paths.runsRoot, value.inspection.runId);
        let published = false;
        try {
            value = await inspect();
            if (value.inspection.snapshotId !== planned.snapshotId || value.current.valid) {
                if (value.current.valid) return publicState(value.inspection, value.current, 'already_current', false);
                throw failure('FINAL_RENDER_INPUT_CHANGED');
            }
            if (fs.existsSync(runRoot)) throw failure('FINAL_RENDER_TARGET_EXISTS');
            fs.mkdirSync(stagingRoot, { mode: 0o700 });
            fs.chmodSync(stagingRoot, 0o700);
            const payloadPath = path.join(stagingRoot, 'render_payload.json');
            const outputPath = path.join(stagingRoot, 'roughcut.mp4');
            writeExclusive(payloadPath, Buffer.from(`${JSON.stringify(value.inspection.staged.render_payload)}\n`));
            const startedAt = context.now().toISOString();
            const summary = await context.runtime.render({
                outputPath,
                payloadPath,
                renderPayload: value.inspection.staged.render_payload,
                synthesizeSilence: true,
            }, value.inspection.runtimeInspection);
            validateRenderSummary(summary, value.inspection);
            fs.chmodSync(outputPath, 0o600);
            const output = hashStableFile(outputPath, MAX_MEDIA_BYTES, 'FINAL_RENDER_OUTPUT');
            const probe = await context.runtime.probe(outputPath, value.inspection.runtimeInspection);
            if (!probe || probe.has_video !== true || probe.has_audio !== true
                || !Number.isFinite(Number(probe.duration_seconds))
                || Math.abs(Number(probe.duration_seconds) - value.inspection.duration) > DURATION_TOLERANCE_SECONDS) {
                throw failure('FINAL_RENDER_FRESH_PROBE_FAILED');
            }
            const completedAt = context.now().toISOString();
            const probeDocument = {
                schema_version: PROBE_SCHEMA,
                snapshot_id: value.inspection.snapshotId,
                probed_at: completedAt,
                duration_seconds: Number(Number(probe.duration_seconds).toFixed(6)),
                selected_duration_seconds: value.inspection.duration,
                has_video: true,
                has_audio: true,
                video_codec: String(probe.video_codec || '').slice(0, 40),
                audio_codec: String(probe.audio_codec || '').slice(0, 40),
                width: Number.isInteger(probe.width) ? probe.width : 0,
                height: Number.isInteger(probe.height) ? probe.height : 0,
                fps: Number.isFinite(Number(probe.fps)) ? Number(probe.fps) : 0,
                output_sha256: output.sha256,
                output_size_bytes: output.size,
                fresh_probe_verified: true,
                output_quality_approved: false,
            };
            const probeBuffer = Buffer.from(`${JSON.stringify(probeDocument, null, 2)}\n`);
            writeExclusive(path.join(stagingRoot, 'fresh_probe.json'), probeBuffer);
            const receiptDocument = {
                schema_version: RECEIPT_SCHEMA,
                snapshot_id: value.inspection.snapshotId,
                project_id: value.inspection.staged.project_id,
                selected_count: value.inspection.staged.render_payload.expected_order.length,
                selected_duration_seconds: value.inspection.duration,
                output_sha256: output.sha256,
                output_size_bytes: output.size,
                probe_sha256: sha256(probeBuffer),
                render_started_at: startedAt,
                render_completed_at: completedAt,
                rendered: true,
                fresh_probe_verified: true,
                output_quality_approved: false,
                generation_executed: false,
                legacy_production_modified: false,
                canonical_delivery_modified: false,
            };
            const receiptBuffer = Buffer.from(`${JSON.stringify(receiptDocument, null, 2)}\n`);
            writeExclusive(path.join(stagingRoot, 'receipt.json'), receiptBuffer);
            fs.unlinkSync(payloadPath);

            const after = await inspect();
            if (after.inspection.snapshotId !== planned.snapshotId || after.current.valid) {
                throw failure('FINAL_RENDER_INPUT_CHANGED');
            }
            fsyncDirectory(stagingRoot);
            fs.renameSync(stagingRoot, runRoot);
            published = true;
            fsyncDirectory(value.paths.runsRoot);
            const pointer = {
                schema_version: POINTER_SCHEMA,
                run_id: planned.runId,
                snapshot_id: planned.snapshotId,
                receipt_sha256: sha256(receiptBuffer),
                updated_at: completedAt,
            };
            writeAtomic(value.paths.currentPath, Buffer.from(`${JSON.stringify(pointer, null, 2)}\n`),
                value.paths.runsRoot, context.randomBytes);
            const verified = await inspect();
            if (!verified.current.valid) throw failure('FINAL_RENDER_PUBLICATION_FAILED');
            return publicState(verified.inspection, verified.current, 'already_current', true);
        } catch (error) {
            if (!published) {
                try { fs.rmSync(stagingRoot, { recursive: true, force: true }); } catch { /* best effort */ }
            }
            throw error.code ? error : failure('FINAL_RENDER_EXECUTION_FAILED');
        } finally {
            try { if (lock !== undefined) fs.closeSync(lock); } catch { /* best effort */ }
            try { fs.unlinkSync(value.paths.lockPath); } catch { /* best effort */ }
            try { fsyncDirectory(value.paths.runsRoot); } catch { /* best effort */ }
        }
    }

    async function preview() {
        try {
            const value = await inspect();
            if (!value.current.valid || value.current.outputSize > MAX_PREVIEW_BYTES) {
                return { ready: false, mime_type: '', byte_length: 0, base64: '' };
            }
            const output = readStableFile(value.current.outputPath, MAX_PREVIEW_BYTES, 'FINAL_RENDER_PREVIEW');
            return {
                ready: true,
                mime_type: 'video/mp4',
                byte_length: output.size,
                base64: output.buffer.toString('base64'),
            };
        } catch (error) {
            context.onInternalError(error);
            return { ready: false, mime_type: '', byte_length: 0, base64: '' };
        }
    }

    return Object.freeze({ get, plan, execute, preview });
}

module.exports = {
    createNewProjectFinalRenderProvider,
    pathsFor,
    RECEIPT_SCHEMA,
    PROBE_SCHEMA,
    POINTER_SCHEMA,
};
