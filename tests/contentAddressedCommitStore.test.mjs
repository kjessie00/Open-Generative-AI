import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const store = require('../electron/lib/contentAddressedCommitStore.js');

const PREFIX = 'TEST_CANONICAL_GRAPH';
const NAMESPACE = store.NAMESPACES.SELECTED_TAKES;

function fixture(t) {
    const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'open-ga-commit-store-')));
    const root = path.join(base, 'production');
    fs.mkdirSync(root, { mode: 0o700 });
    t.after(() => fs.rmSync(base, { recursive: true, force: true }));
    return { base, root };
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function payload(value) {
    return { schema_version: store.PAYLOAD_SCHEMA, namespace: NAMESPACE, value };
}

function commit(parent, payloadHash) {
    return { schema_version: store.COMMIT_SCHEMA, namespace: NAMESPACE, parent, payload_hash: payloadHash };
}

function directRecord(directory, value, mode = 0o600, nameId = '') {
    const buffer = Buffer.isBuffer(value) ? value : store.recordBuffer(value, PREFIX);
    const id = nameId || sha256(buffer);
    fs.writeFileSync(path.join(directory, `${id}.json`), buffer, { mode });
    fs.chmodSync(path.join(directory, `${id}.json`), mode);
    return { id, buffer };
}

test('read-only absence creates nothing; root/child append is deterministic and idempotent', (t) => {
    const { root } = fixture(t);
    assert.deepEqual(store.inspectGraph(root, NAMESPACE, { codePrefix: PREFIX }), {
        exists: false,
        namespace: NAMESPACE,
    });
    assert.equal(fs.existsSync(path.join(root, store.STORE_DIRECTORY)), false);

    const firstValue = { revision: 1, nested: { b: 2, a: 1 } };
    const rootCommit = store.appendValue(root, NAMESPACE, firstValue, {
        expectedParent: null,
        codePrefix: PREFIX,
        randomBytes: (size) => Buffer.alloc(size, 1),
    });
    assert.equal(rootCommit.appended, true);
    assert.equal(rootCommit.commitCount, 1);
    assert.deepEqual(rootCommit.payload, firstValue);

    const sameRoot = store.appendValue(root, NAMESPACE, { nested: { a: 1, b: 2 }, revision: 1 }, {
        expectedParent: null,
        codePrefix: PREFIX,
        randomBytes: (size) => Buffer.alloc(size, 2),
    });
    assert.equal(sameRoot.appended, false);
    assert.equal(sameRoot.idempotent, true);
    assert.equal(sameRoot.headCommitId, rootCommit.headCommitId);

    const child = store.appendValue(root, NAMESPACE, { revision: 2 }, {
        expectedParent: rootCommit.headCommitId,
        codePrefix: PREFIX,
        randomBytes: (size) => Buffer.alloc(size, 3),
    });
    assert.equal(child.appended, true);
    assert.equal(child.commitCount, 2);
    assert.deepEqual(child.payload, { revision: 2 });

    const repeatedTransition = store.appendValue(root, NAMESPACE, { revision: 2 }, {
        expectedParent: rootCommit.headCommitId,
        codePrefix: PREFIX,
        randomBytes: (size) => Buffer.alloc(size, 4),
    });
    assert.equal(repeatedTransition.appended, false);
    assert.equal(repeatedTransition.idempotent, true);
    assert.equal(repeatedTransition.headCommitId, child.headCommitId);
});

test('immutable publication is no-replace and validates an EEXIST object byte-for-byte', (t) => {
    const { root } = fixture(t);
    const first = store.appendValue(root, NAMESPACE, { revision: 1 }, {
        expectedParent: null,
        codePrefix: PREFIX,
    });
    const paths = store.graphPaths(root, NAMESPACE, { codePrefix: PREFIX });
    const buffer = Buffer.from('immutable-record\n');
    const firstPublish = store.publishImmutable(paths.payloadRoot, buffer, { codePrefix: PREFIX });
    assert.equal(firstPublish.created, true);
    const secondPublish = store.publishImmutable(paths.payloadRoot, buffer, { codePrefix: PREFIX });
    assert.deepEqual(secondPublish, { id: firstPublish.id, created: false });

    const collisionBuffer = Buffer.from('different-record\n');
    const collisionId = sha256(collisionBuffer);
    fs.writeFileSync(path.join(paths.payloadRoot, `${collisionId}.json`), 'wrong-bytes\n', { mode: 0o600 });
    assert.throws(() => store.publishImmutable(paths.payloadRoot, collisionBuffer, {
        expectedId: collisionId,
        codePrefix: PREFIX,
    }), { code: `${PREFIX}_HASH_NAME_MISMATCH` });
    assert.throws(() => store.inspectGraph(root, NAMESPACE, { codePrefix: PREFIX }), {
        code: `${PREFIX}_HASH_NAME_MISMATCH`,
    });
    assert.match(first.headCommitId, /^[a-f0-9]{64}$/);
});

test('malformed, symlink, oversized, wrong-mode, and hash/name-mismatched records fail closed', (t) => {
    const cases = [
        ['malformed', (paths) => directRecord(paths.payloadRoot, Buffer.from('{bad\n')), 'RECORD_MALFORMED'],
        ['symlink', (paths, base) => {
            const outside = path.join(base, 'outside.json');
            const buffer = Buffer.from('{}\n');
            fs.writeFileSync(outside, buffer);
            fs.symlinkSync(outside, path.join(paths.payloadRoot, `${sha256(buffer)}.json`));
        }, 'SYMLINK_FORBIDDEN'],
        ['oversized', (paths) => {
            const buffer = Buffer.alloc(store.MAX_RECORD_BYTES + 1, 0x20);
            directRecord(paths.payloadRoot, buffer);
        }, 'RECORD_TOO_LARGE'],
        ['wrong-mode', (paths) => directRecord(paths.payloadRoot, payload({ orphan: true }), 0o644), 'RECORD_MODE_INVALID'],
        ['hash-mismatch', (paths) => directRecord(paths.payloadRoot, payload({ orphan: true }), 0o600, '0'.repeat(64)), 'HASH_NAME_MISMATCH'],
    ];
    for (const [name, corrupt, suffix] of cases) {
        const { root, base } = fixture(t);
        store.appendValue(root, NAMESPACE, { case: name }, { expectedParent: null, codePrefix: PREFIX });
        const paths = store.graphPaths(root, NAMESPACE, { codePrefix: PREFIX });
        corrupt(paths, base);
        assert.throws(() => store.inspectGraph(root, NAMESPACE, { codePrefix: PREFIX }), {
            code: `${PREFIX}_${suffix}`,
        }, name);
    }
});

test('wrong-mode graph directories and symlinked namespaces fail closed', (t) => {
    const wrongMode = fixture(t);
    store.appendValue(wrongMode.root, NAMESPACE, { revision: 1 }, { expectedParent: null, codePrefix: PREFIX });
    const wrongModePaths = store.graphPaths(wrongMode.root, NAMESPACE, { codePrefix: PREFIX });
    fs.chmodSync(wrongModePaths.payloadRoot, 0o755);
    assert.throws(() => store.inspectGraph(wrongMode.root, NAMESPACE, { codePrefix: PREFIX }), {
        code: `${PREFIX}_DIRECTORY_UNSAFE`,
    });

    const linked = fixture(t);
    store.appendValue(linked.root, NAMESPACE, { revision: 1 }, { expectedParent: null, codePrefix: PREFIX });
    const linkedPaths = store.graphPaths(linked.root, NAMESPACE, { codePrefix: PREFIX });
    const moved = path.join(linked.base, 'moved-namespace');
    fs.renameSync(linkedPaths.namespaceRoot, moved);
    fs.symlinkSync(moved, linkedPaths.namespaceRoot);
    assert.throws(() => store.inspectGraph(linked.root, NAMESPACE, { codePrefix: PREFIX }), {
        code: `${PREFIX}_DIRECTORY_UNSAFE`,
    });
});

test('missing parent and multiple roots fail closed with stable path-free codes', (t) => {
    const missing = fixture(t);
    store.appendValue(missing.root, NAMESPACE, { revision: 1 }, { expectedParent: null, codePrefix: PREFIX });
    const missingPaths = store.graphPaths(missing.root, NAMESPACE, { codePrefix: PREFIX });
    const orphanPayload = directRecord(missingPaths.payloadRoot, payload({ orphan: true }));
    directRecord(missingPaths.commitRoot, commit('f'.repeat(64), orphanPayload.id));
    assert.throws(() => store.inspectGraph(missing.root, NAMESPACE, { codePrefix: PREFIX }), {
        code: `${PREFIX}_PARENT_MISSING`,
    });

    const multiple = fixture(t);
    store.appendValue(multiple.root, NAMESPACE, { revision: 1 }, { expectedParent: null, codePrefix: PREFIX });
    const multiplePaths = store.graphPaths(multiple.root, NAMESPACE, { codePrefix: PREFIX });
    const secondPayload = directRecord(multiplePaths.payloadRoot, payload({ revision: 2 }));
    directRecord(multiplePaths.commitRoot, commit(null, secondPayload.id));
    assert.throws(() => store.inspectGraph(multiple.root, NAMESPACE, { codePrefix: PREFIX }), {
        code: `${PREFIX}_MULTIPLE_ROOTS`,
    });
});

test('pure topology validator rejects cycles and disconnected components deterministically', () => {
    const a = 'a'.repeat(64);
    const b = 'b'.repeat(64);
    const c = 'c'.repeat(64);
    assert.throws(() => store.validateCommitTopology(new Map([
        [a, { parent: b }],
        [b, { parent: a }],
    ]), PREFIX), { code: `${PREFIX}_CYCLE` });
    assert.throws(() => store.validateCommitTopology(new Map([
        [a, { parent: null }],
        [b, { parent: c }],
        [c, { parent: b }],
    ]), PREFIX), { code: `${PREFIX}_DISCONNECTED` });
});

test('a racing sibling is preserved and resolution fails closed as a fork', (t) => {
    const { root } = fixture(t);
    const graphRoot = store.appendValue(root, NAMESPACE, { revision: 1 }, {
        expectedParent: null,
        codePrefix: PREFIX,
    });
    let siblingCommitId = '';
    assert.throws(() => store.appendValue(root, NAMESPACE, { revision: 2 }, {
        expectedParent: graphRoot.headCommitId,
        codePrefix: PREFIX,
        beforeCommitPublish({ parent, payloadRoot, commitRoot }) {
            const siblingPayload = payload({ revision: 'sibling' });
            const siblingPayloadBuffer = store.recordBuffer(siblingPayload, PREFIX);
            const siblingPayloadHash = sha256(siblingPayloadBuffer);
            store.publishImmutable(payloadRoot, siblingPayloadBuffer, {
                expectedId: siblingPayloadHash,
                codePrefix: PREFIX,
            });
            const siblingCommitBuffer = store.recordBuffer(commit(parent, siblingPayloadHash), PREFIX);
            siblingCommitId = sha256(siblingCommitBuffer);
            store.publishImmutable(commitRoot, siblingCommitBuffer, {
                expectedId: siblingCommitId,
                codePrefix: PREFIX,
            });
        },
    }), { code: `${PREFIX}_FORK` });
    const paths = store.graphPaths(root, NAMESPACE, { codePrefix: PREFIX });
    assert.equal(fs.existsSync(path.join(paths.commitRoot, `${siblingCommitId}.json`)), true);
    assert.equal(fs.readdirSync(paths.commitRoot).filter((name) => name.endsWith('.json')).length, 3);
    assert.throws(() => store.inspectGraph(root, NAMESPACE, { codePrefix: PREFIX }), {
        code: `${PREFIX}_FORK`,
    });
});

test('compatibility cache is mode 0600, regenerable, and cannot replace a symlink', (t) => {
    const { root, base } = fixture(t);
    const value = { schema_version: 'fixture.v1', value: 1 };
    const first = store.syncCompatibilityCache(root, 'selected_takes.json', value, {
        codePrefix: PREFIX,
        randomBytes: (size) => Buffer.alloc(size, 8),
    });
    assert.equal(first.written, true);
    assert.equal(fs.statSync(path.join(root, 'selected_takes.json')).mode & 0o777, 0o600);
    assert.equal(store.syncCompatibilityCache(root, 'selected_takes.json', value, {
        codePrefix: PREFIX,
    }).written, false);

    fs.unlinkSync(path.join(root, 'selected_takes.json'));
    const outside = path.join(base, 'outside.json');
    fs.writeFileSync(outside, 'outside');
    fs.symlinkSync(outside, path.join(root, 'selected_takes.json'));
    assert.throws(() => store.syncCompatibilityCache(root, 'selected_takes.json', value, {
        codePrefix: PREFIX,
    }), { code: `${PREFIX}_CACHE_UNSAFE` });
    assert.equal(fs.readFileSync(outside, 'utf8'), 'outside');
});
