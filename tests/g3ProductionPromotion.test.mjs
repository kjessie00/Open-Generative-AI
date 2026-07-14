import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const review = require('../electron/lib/g3ReviewDraftProvider.js');
const promotion = require('../electron/lib/g3ProductionPromotionProvider.js');
const promotionStore = require('../electron/lib/g3PromotionStore.js');
const canonicalStore = require('../electron/lib/contentAddressedCommitStore.js');
const filmProvider = require('../electron/lib/filmPipelineProvider.js');

const NOW = '2026-07-14T12:30:00.000Z';
const CLOCK = Date.parse(NOW);

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function fixture(t, { existing = 'absent' } = {}) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-g3-promotion-')));
    const root = path.join(base, 'production');
    const userDataPath = path.join(base, 'user-data');
    for (const directory of ['intake', 'storyboard', 'generated/downloads', 'final', 'qa']) {
        fs.mkdirSync(path.join(root, directory), { recursive: true });
    }
    fs.mkdirSync(userDataPath, { mode: 0o700 });
    fs.chmodSync(userDataPath, 0o700);
    fs.writeFileSync(path.join(root, 'intake/brief.md'), '# promotion fixture\n');
    fs.writeFileSync(path.join(root, 'storyboard/storyboard.json'), JSON.stringify({ clips: [] }));
    fs.writeFileSync(path.join(root, 'generated/downloads/SH01_take_a.mp4'), 'fixture-a');
    fs.writeFileSync(path.join(root, 'generated/downloads/SH02_take_b.webm'), 'fixture-b');
    fs.writeFileSync(path.join(root, 'shot_manifest.json'), JSON.stringify({
        schema_version: 'short-drama-room-shot-manifest-v1',
        project_id: 'project_01',
        episode_id: 'episode_01',
        shots: [{ shot_id: 'SH01' }, { shot_id: 'SH02' }],
    }));
    fs.writeFileSync(path.join(root, 'beats.json'), JSON.stringify({
        schema_version: 'short-drama-room-beats-v1',
        project_id: 'project_01',
        episode_id: 'episode_01',
        beats: [{ beat_id: 'BEAT01' }, { beat_id: 'BEAT02' }],
    }));
    fs.writeFileSync(path.join(root, 'qc_report.json'), JSON.stringify({
        schema_version: 'short-drama-room-qc-report-v1',
        project_id: 'project_01',
        episode_id: 'episode_01',
        subtitle_audio_drift_s: 0.05,
        shot_qc: ['SH01', 'SH02'].map((shotId) => ({
            shot_id: shotId,
            provider: 'seedance',
            deterministic_checks_passed: true,
            gemini_findings: [],
            dialogue_intelligibility_score: 0.98,
            pronunciation_risk_flag: false,
            decision: 'accept',
        })),
    }));
    let clock = CLOCK;
    const context = {
        config: { productionRoot: root },
        userDataPath,
        tokenSecret: Buffer.alloc(32, 4),
        now: () => NOW,
        promotionNowMs: () => clock,
        promotionPlanStore: new Map(),
        durationByRelativePath: {
            'generated/downloads/SH01_take_a.mp4': 6,
            'generated/downloads/SH02_take_b.webm': 7,
        },
    };
    const initial = review.getG3ReviewWorkspace(context);
    const payload = {
        draft_id: initial.draft_id,
        selections: initial.shots.map((shot, index) => ({
            shot_id: shot.shot_id,
            candidate_token: initial.candidates[index].candidate_token,
            chosen_provider: 'seedance',
            dialogue_source: 'native_video_lipsync',
            beat_id: `BEAT0${index + 1}`,
            take_id: `${shot.shot_id}_human_take`,
            source_in_sec: 0.25,
            source_out_sec: 4.5,
            transition_in: index ? { type: 'crossfade', dur: 0.2 } : null,
            selection_reason: `사람이 확인한 ${shot.shot_id}`,
            notes: '',
        })),
        overall_notes: '사람 검토 완료',
    };
    review.exportG3ReviewPacket(payload, context);
    const internal = review.contextState(context);
    const privateSelected = fs.readFileSync(internal.paths.selectedTakesPath);
    if (existing === 'canonical') {
        const previous = JSON.parse(privateSelected.toString('utf8'));
        previous.takes = previous.takes.map((take) => ({ ...take, selected_at: '2026-07-14T11:00:00.000Z' }));
        fs.writeFileSync(path.join(root, 'selected_takes.json'), `${JSON.stringify(previous, null, 2)}\n`);
    }
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return {
        base,
        root,
        userDataPath,
        context,
        internal,
        privateSelected,
        setClock(value) { clock = value; },
    };
}

function confirmation(plan, overrides = {}) {
    return {
        planToken: plan.plan_token,
        projectIdConfirmation: plan.project_id,
        confirmed: true,
        ...overrides,
    };
}

function promotionFiles(fx) {
    const paths = promotionStore.exactPromotionPaths(
        fx.userDataPath,
        review.contextState(fx.context).source.inventory.rootFingerprint,
    );
    return { paths, names: fs.existsSync(paths.promotionRoot) ? fs.readdirSync(paths.promotionRoot).sort() : [] };
}

function productionTemps(root) {
    return fs.readdirSync(root).filter((name) => name.startsWith(promotionStore.PRODUCTION_TEMP_PREFIX));
}

function selectedGraph(root) {
    return canonicalStore.inspectGraph(root, canonicalStore.NAMESPACES.SELECTED_TAKES, {
        codePrefix: 'G3_SELECTED_TAKES_GRAPH',
    });
}

test('pathless plan and confirmed promotion atomically create exact canonical target and private receipt', (t) => {
    const fx = fixture(t);
    const plan = promotion.planG3ProductionPromotion(fx.context);
    assert.equal(plan.ok, true);
    assert.equal(plan.status, 'ready');
    assert.equal(plan.target_state, '새 root commit 생성 예정');
    assert.match(plan.plan_token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(JSON.stringify(plan).includes(fx.root), false);
    assert.equal(JSON.stringify(plan).includes(fx.base), false);
    assert.equal(fs.existsSync(path.join(fx.userDataPath, 'film-pipeline', 'promotions')), false, 'planning is filesystem read-only');

    const result = promotion.promoteG3ProductionSelection(confirmation(plan), fx.context);
    const targetPath = path.join(fx.root, 'selected_takes.json');
    assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), JSON.parse(fx.privateSelected.toString('utf8')));
    assert.equal(fs.statSync(targetPath).mode & 0o777, 0o600);
    assert.deepEqual({ promoted: result.promoted, executed: result.executed, receipt: result.receipt_written }, {
        promoted: true, executed: true, receipt: true,
    });
    const { paths, names } = promotionFiles(fx);
    assert.deepEqual(names, ['promotion_receipt.json']);
    assert.equal(fs.statSync(paths.promotionRoot).mode & 0o777, 0o700);
    assert.equal(fs.statSync(paths.receiptPath).mode & 0o777, 0o600);
    assert.deepEqual(productionTemps(fx.root), []);
    const graph = selectedGraph(fx.root);
    assert.equal(graph.commitCount, 1);
    assert.equal(graph.headCommitId, result.graph_head_commit_id);
    assert.deepEqual(graph.payload, JSON.parse(fx.privateSelected.toString('utf8')));
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(plan), fx.context), { code: 'G3_PROMOTION_TOKEN_INVALID' });
});

test('canonical existing target is CAS-replaced with private backup; same hash becomes no-op', (t) => {
    const fx = fixture(t, { existing: 'canonical' });
    const targetPath = path.join(fx.root, 'selected_takes.json');
    const previous = fs.readFileSync(targetPath);
    const plan = promotion.planG3ProductionPromotion(fx.context);
    assert.equal(plan.target_state, 'legacy root import 후 새 선택 commit 추가 예정');
    const result = promotion.promoteG3ProductionSelection(confirmation(plan), fx.context);
    assert.equal(result.executed, true);
    const { paths, names } = promotionFiles(fx);
    assert.deepEqual(names, ['previous_selected_takes.json', 'promotion_receipt.json']);
    assert.deepEqual(fs.readFileSync(paths.backupPath), previous);
    assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), JSON.parse(fx.privateSelected.toString('utf8')));
    assert.equal(selectedGraph(fx.root).commitCount, 2, 'legacy root plus changed child are preserved');

    const currentPlan = promotion.planG3ProductionPromotion(fx.context);
    assert.equal(currentPlan.status, 'already_current');
    const before = sha256(fs.readFileSync(targetPath));
    const noop = promotion.promoteG3ProductionSelection(confirmation(currentPlan), fx.context);
    assert.deepEqual({ promoted: noop.promoted, already: noop.already_current, executed: noop.executed }, {
        promoted: false, already: true, executed: false,
    });
    assert.equal(sha256(fs.readFileSync(targetPath)), before);
});

test('graph head wins over stale or missing cache and confirmed no-op regenerates mode-0600 cache', (t) => {
    const fx = fixture(t);
    const firstPlan = promotion.planG3ProductionPromotion(fx.context);
    promotion.promoteG3ProductionSelection(confirmation(firstPlan), fx.context);
    const graphBefore = selectedGraph(fx.root);
    const targetPath = path.join(fx.root, 'selected_takes.json');

    fs.writeFileSync(targetPath, '{"tampered":true}\n', { mode: 0o644 });
    const repairPlan = promotion.planG3ProductionPromotion(fx.context);
    assert.equal(repairPlan.ok, true);
    assert.equal(repairPlan.status, 'cache_repair_ready');
    assert.equal(repairPlan.already_current, true);
    assert.equal(repairPlan.ready, true);
    const repaired = promotion.promoteG3ProductionSelection(confirmation(repairPlan), fx.context);
    assert.equal(repaired.canonical_committed, false);
    assert.equal(repaired.cache_synchronized, true);
    assert.equal(selectedGraph(fx.root).headCommitId, graphBefore.headCommitId);
    assert.deepEqual(JSON.parse(fs.readFileSync(targetPath, 'utf8')), JSON.parse(fx.privateSelected.toString('utf8')));
    assert.equal(fs.statSync(targetPath).mode & 0o777, 0o600);

    fs.unlinkSync(targetPath);
    const missingPlan = promotion.planG3ProductionPromotion(fx.context);
    assert.equal(missingPlan.ready, true);
    const regenerated = promotion.promoteG3ProductionSelection(confirmation(missingPlan), fx.context);
    assert.equal(regenerated.cache_synchronized, true);
    assert.equal(regenerated.canonical_committed, false);
    assert.equal(selectedGraph(fx.root).headCommitId, graphBefore.headCommitId);
});

test('preserved sibling fork blocks G3 planning with a stable graph code', (t) => {
    const fx = fixture(t);
    const selected = JSON.parse(fx.privateSelected.toString('utf8'));
    const rootCommit = canonicalStore.appendValue(fx.root, canonicalStore.NAMESPACES.SELECTED_TAKES, selected, {
        expectedParent: null,
        codePrefix: 'G3_SELECTED_TAKES_GRAPH',
    });
    const branch = structuredClone(selected);
    branch.takes[0].selected_at = '2026-07-14T12:31:00.000Z';
    assert.throws(() => canonicalStore.appendValue(fx.root, canonicalStore.NAMESPACES.SELECTED_TAKES, branch, {
        expectedParent: rootCommit.headCommitId,
        codePrefix: 'G3_SELECTED_TAKES_GRAPH',
        beforeCommitPublish({ parent, payloadRoot, commitRoot }) {
            const sibling = structuredClone(selected);
            sibling.takes[0].selected_at = '2026-07-14T12:32:00.000Z';
            const payloadRecord = {
                schema_version: canonicalStore.PAYLOAD_SCHEMA,
                namespace: canonicalStore.NAMESPACES.SELECTED_TAKES,
                value: sibling,
            };
            const payloadBuffer = canonicalStore.recordBuffer(payloadRecord, 'G3_SELECTED_TAKES_GRAPH');
            const payloadHash = canonicalStore.sha256(payloadBuffer);
            canonicalStore.publishImmutable(payloadRoot, payloadBuffer, {
                expectedId: payloadHash,
                codePrefix: 'G3_SELECTED_TAKES_GRAPH',
            });
            const commitBuffer = canonicalStore.recordBuffer({
                schema_version: canonicalStore.COMMIT_SCHEMA,
                namespace: canonicalStore.NAMESPACES.SELECTED_TAKES,
                parent,
                payload_hash: payloadHash,
            }, 'G3_SELECTED_TAKES_GRAPH');
            canonicalStore.publishImmutable(commitRoot, commitBuffer, {
                expectedId: canonicalStore.sha256(commitBuffer),
                codePrefix: 'G3_SELECTED_TAKES_GRAPH',
            });
        },
    }), { code: 'G3_SELECTED_TAKES_GRAPH_FORK' });
    const plan = promotion.planG3ProductionPromotion(fx.context);
    assert.equal(plan.status, 'blocked');
    assert.deepEqual(plan.blockers, ['G3_SELECTED_TAKES_GRAPH_FORK']);
});

test('token is one-shot, short-lived, and bound to exact typed project confirmation', (t) => {
    const fx = fixture(t);
    const wrong = promotion.planG3ProductionPromotion(fx.context);
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(wrong, {
        projectIdConfirmation: 'project_02',
    }), fx.context), { code: 'G3_PROMOTION_CONFIRMATION_MISMATCH' });
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(wrong), fx.context), { code: 'G3_PROMOTION_TOKEN_INVALID' });

    const whitespace = promotion.planG3ProductionPromotion(fx.context);
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(whitespace, {
        projectIdConfirmation: ` ${whitespace.project_id} `,
    }), fx.context), { code: 'G3_PROMOTION_CONFIRMATION_MISMATCH' });
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(whitespace), fx.context), { code: 'G3_PROMOTION_TOKEN_INVALID' });

    const expired = promotion.planG3ProductionPromotion(fx.context);
    fx.setClock(CLOCK + promotion.DEFAULT_PLAN_TTL_MS + 1);
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(expired), fx.context), { code: 'G3_PROMOTION_TOKEN_EXPIRED' });
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(expired), fx.context), { code: 'G3_PROMOTION_TOKEN_INVALID' });
    assert.equal(fs.existsSync(path.join(fx.root, 'selected_takes.json')), false);
});

test('confirmed false consumes the valid raw token before confirmation rejection', (t) => {
    const fx = fixture(t);
    const plan = promotion.planG3ProductionPromotion(fx.context);
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(plan, { confirmed: false }), fx.context), {
        code: 'G3_PROMOTION_CONFIRMATION_REQUIRED',
    });
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(plan), fx.context), {
        code: 'G3_PROMOTION_TOKEN_INVALID',
    });
    assert.equal(fs.existsSync(path.join(fx.root, 'selected_takes.json')), false);
});

test('extra envelope field consumes the valid raw token before shape rejection', (t) => {
    const fx = fixture(t);
    const plan = promotion.planG3ProductionPromotion(fx.context);
    assert.throws(() => promotion.promoteG3ProductionSelection({
        ...confirmation(plan),
        targetPath: path.join(fx.root, 'selected_takes.json'),
    }, fx.context), { code: 'G3_PROMOTION_REQUEST_INVALID' });
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(plan), fx.context), {
        code: 'G3_PROMOTION_TOKEN_INVALID',
    });
    assert.equal(fs.existsSync(path.join(fx.root, 'selected_takes.json')), false);
});

test('malformed confirmation consumes the valid raw token before confirmation parsing rejection', (t) => {
    const fx = fixture(t);
    const plan = promotion.planG3ProductionPromotion(fx.context);
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(plan, {
        projectIdConfirmation: 'project 01',
    }), fx.context), { code: 'G3_PROMOTION_CONFIRMATION_INVALID' });
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(plan), fx.context), {
        code: 'G3_PROMOTION_TOKEN_INVALID',
    });
    assert.equal(fs.existsSync(path.join(fx.root, 'selected_takes.json')), false);
});

test('invalid and nonexistent raw tokens do not consume an unrelated valid plan', (t) => {
    const fx = fixture(t);
    const plan = promotion.planG3ProductionPromotion(fx.context);
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(plan, { planToken: 'invalid' }), fx.context), {
        code: 'G3_PROMOTION_TOKEN_INVALID',
    });
    const nonexistent = plan.plan_token === 'Z'.repeat(43) ? 'Y'.repeat(43) : 'Z'.repeat(43);
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(plan, { planToken: nonexistent }), fx.context), {
        code: 'G3_PROMOTION_TOKEN_INVALID',
    });
    const result = promotion.promoteG3ProductionSelection(confirmation(plan), fx.context);
    assert.equal(result.executed, true);
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(plan), fx.context), {
        code: 'G3_PROMOTION_TOKEN_INVALID',
    });
});

test('forged renderer shape, path fields, and missing explicit confirmation fail before production write', (t) => {
    const fx = fixture(t);
    const forged = promotion.planG3ProductionPromotion(fx.context);
    assert.throws(() => promotion.promoteG3ProductionSelection({
        ...confirmation(forged),
        targetPath: path.join(fx.root, 'selected_takes.json'),
    }, fx.context), { code: 'G3_PROMOTION_REQUEST_INVALID' });
    const unconfirmed = promotion.planG3ProductionPromotion(fx.context);
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(unconfirmed, { confirmed: false }), fx.context), {
        code: 'G3_PROMOTION_CONFIRMATION_REQUIRED',
    });
    assert.equal(fs.existsSync(path.join(fx.root, 'selected_takes.json')), false);
});

test('source, private export, and target changes after plan fail closed', (t) => {
    const sourceFx = fixture(t);
    const sourcePlan = promotion.planG3ProductionPromotion(sourceFx.context);
    fs.appendFileSync(path.join(sourceFx.root, 'generated/downloads/SH01_take_a.mp4'), '-changed');
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(sourcePlan), sourceFx.context));
    assert.equal(fs.existsSync(path.join(sourceFx.root, 'selected_takes.json')), false);

    const manifestFx = fixture(t);
    const manifestPlan = promotion.planG3ProductionPromotion(manifestFx.context);
    fs.appendFileSync(path.join(manifestFx.root, 'shot_manifest.json'), ' ');
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(manifestPlan), manifestFx.context));
    assert.equal(fs.existsSync(path.join(manifestFx.root, 'selected_takes.json')), false);

    const qcFx = fixture(t);
    const qcPlan = promotion.planG3ProductionPromotion(qcFx.context);
    fs.appendFileSync(path.join(qcFx.root, 'qc_report.json'), ' ');
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(qcPlan), qcFx.context));
    assert.equal(fs.existsSync(path.join(qcFx.root, 'selected_takes.json')), false);

    const exportFx = fixture(t);
    const exportPlan = promotion.planG3ProductionPromotion(exportFx.context);
    fs.appendFileSync(exportFx.internal.paths.selectedTakesPath, ' ');
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(exportPlan), exportFx.context), {
        code: 'G3_PROMOTION_EXPORT_STALE',
    });
    assert.equal(fs.existsSync(path.join(exportFx.root, 'selected_takes.json')), false);

    const envelopeFx = fixture(t);
    const envelopePlan = promotion.planG3ProductionPromotion(envelopeFx.context);
    fs.appendFileSync(envelopeFx.internal.paths.exportPath, ' ');
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(envelopePlan), envelopeFx.context), {
        code: 'G3_PROMOTION_EXPORT_STALE',
    });
    assert.equal(fs.existsSync(path.join(envelopeFx.root, 'selected_takes.json')), false);

    const targetFx = fixture(t);
    const targetPlan = promotion.planG3ProductionPromotion(targetFx.context);
    const canonical = JSON.parse(targetFx.privateSelected.toString('utf8'));
    canonical.takes = canonical.takes.map((take) => ({ ...take, selected_at: '2026-07-14T11:00:00.000Z' }));
    fs.writeFileSync(path.join(targetFx.root, 'selected_takes.json'), `${JSON.stringify(canonical, null, 2)}\n`);
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(targetPlan), targetFx.context), {
        code: 'G3_PROMOTION_PLAN_STALE',
    });
});

test('malformed, symlink, and oversized production targets block read-only planning', (t) => {
    const malformed = fixture(t);
    fs.writeFileSync(path.join(malformed.root, 'selected_takes.json'), '{"not":"canonical"}\n');
    assert.deepEqual(promotion.planG3ProductionPromotion(malformed.context).blockers, ['G3_PROMOTION_TARGET_NONCANONICAL']);

    const linked = fixture(t);
    const outside = path.join(linked.base, 'outside.json');
    fs.writeFileSync(outside, linked.privateSelected);
    fs.symlinkSync(outside, path.join(linked.root, 'selected_takes.json'));
    const linkedPlan = promotion.planG3ProductionPromotion(linked.context);
    assert.equal(linkedPlan.status, 'blocked');
    assert.deepEqual(linkedPlan.blockers, ['G3_PROMOTION_TARGET_UNSAFE']);

    const oversized = fixture(t);
    fs.writeFileSync(path.join(oversized.root, 'selected_takes.json'), Buffer.alloc(promotionStore.MAX_TARGET_BYTES + 1, 0x20));
    assert.deepEqual(promotion.planG3ProductionPromotion(oversized.context).blockers, ['G3_PROMOTION_TARGET_TOO_LARGE']);
});

test('private O_EXCL lock blocks concurrency and cache failure after canonical commit is reported without rollback', (t) => {
    const lockedFx = fixture(t);
    const lockedPlan = promotion.planG3ProductionPromotion(lockedFx.context);
    const lockedPaths = promotionStore.exactPromotionPaths(
        lockedFx.userDataPath,
        review.contextState(lockedFx.context).source.inventory.rootFingerprint,
    );
    promotionStore.ensurePromotionRoot(lockedFx.userDataPath, lockedPaths);
    const release = promotionStore.acquirePromotionLock(lockedPaths, 'a'.repeat(64));
    assert.throws(() => promotion.promoteG3ProductionSelection(confirmation(lockedPlan), lockedFx.context), {
        code: 'G3_PROMOTION_LOCKED',
    });
    release();
    assert.equal(fs.existsSync(path.join(lockedFx.root, 'selected_takes.json')), false);

    const failedFx = fixture(t);
    const failedPlan = promotion.planG3ProductionPromotion(failedFx.context);
    const result = promotion.promoteG3ProductionSelection(confirmation(failedPlan), {
        ...failedFx.context,
        promotionRenameFile() { throw new Error('injected cache rename failure'); },
    });
    assert.equal(result.ok, true);
    assert.equal(result.canonical_committed, true);
    assert.equal(result.cache_synchronized, false);
    assert.equal(result.warning, 'G3_SELECTED_TAKES_CACHE_STALE');
    assert.equal(fs.existsSync(path.join(failedFx.root, 'selected_takes.json')), false);
    assert.equal(selectedGraph(failedFx.root).headCommitId, result.graph_head_commit_id);
    assert.deepEqual(productionTemps(failedFx.root), []);
    const { names } = promotionFiles(failedFx);
    assert.deepEqual(names, ['promotion_receipt.json']);
});

test('registered plan IPC is pathless and registered promote IPC accepts only the exact confirmation envelope', (t) => {
    const fx = fixture(t);
    const handlers = new Map();
    filmProvider.register({ handle(channel, handler) { handlers.set(channel, handler); } }, {
        readConfigFn: () => ({
            productionRoot: fx.root,
            productionParentRoot: '',
            recentProductionRoots: [fx.root],
            pathProvenanceVersion: 1,
            dryRunMode: true,
        }),
        userDataPath: fx.userDataPath,
        g3TokenSecret: fx.context.tokenSecret,
        g3Now: fx.context.now,
        g3PromotionNowMs: fx.context.promotionNowMs,
        g3PromotionPlanStore: fx.context.promotionPlanStore,
        g3DurationByRelativePath: fx.context.durationByRelativePath,
    });
    const planHandler = handlers.get('film-pipeline:plan-g3-production-promotion');
    const promoteHandler = handlers.get('film-pipeline:promote-g3-production-selection');
    assert.equal(typeof planHandler, 'function');
    assert.equal(typeof promoteHandler, 'function');
    assert.throws(() => planHandler({}, fx.root), { code: 'RENDERER_PATH_ARGUMENT_FORBIDDEN' });
    const plan = planHandler({}, undefined);
    assert.equal(plan.ready, true);
    assert.throws(() => promoteHandler({}, {
        ...confirmation(plan),
        path: path.join(fx.root, 'selected_takes.json'),
    }), { code: 'G3_PROMOTION_REQUEST_INVALID' });
    assert.equal(fs.existsSync(path.join(fx.root, 'selected_takes.json')), false);
});
