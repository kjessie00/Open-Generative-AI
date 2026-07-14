const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const STORE_DIRECTORY = '.film-pipeline-state-v1';
const PAYLOAD_DIRECTORY = 'payloads';
const COMMIT_DIRECTORY = 'commits';
const PAYLOAD_SCHEMA = 'film_pipeline.canonical_payload.v1';
const COMMIT_SCHEMA = 'film_pipeline.canonical_commit.v1';
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const MAX_RECORDS = 10_000;
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const RECORD_NAME_PATTERN = /^[a-f0-9]{64}\.json$/;
const NAMESPACES = Object.freeze({
    SELECTED_TAKES: 'selected-takes',
    FINISHING_CURRENT: 'finishing-current',
});
const ALLOWED_NAMESPACES = new Set(Object.values(NAMESPACES));
const COMPATIBILITY_PATHS = new Set([
    'selected_takes.json',
    'final/workbench_runs/current.json',
]);

function storeError(prefix, suffix, message = suffix) {
    const error = new Error(`${prefix}_${suffix}: ${message}`);
    error.code = `${prefix}_${suffix}`;
    return error;
}

function codePrefix(value) {
    if (typeof value !== 'string' || !/^[A-Z][A-Z0-9_]{1,80}$/.test(value)) {
        throw storeError('CANONICAL_GRAPH', 'CODE_PREFIX_INVALID');
    }
    return value;
}

function sha256(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function assertNamespace(namespace, prefix) {
    if (!ALLOWED_NAMESPACES.has(namespace)) throw storeError(prefix, 'NAMESPACE_INVALID');
    return namespace;
}

function canonicalValue(value, state = { depth: 0, nodes: 0 }) {
    state.nodes += 1;
    if (state.nodes > 100_000 || state.depth > 64) throw new Error('canonical value is too complex');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (Array.isArray(value)) {
        return value.map((entry) => canonicalValue(entry, { ...state, depth: state.depth + 1 }));
    }
    if (value && typeof value === 'object') {
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) throw new Error('plain object required');
        const result = {};
        for (const key of Object.keys(value).sort()) {
            if (typeof value[key] === 'undefined') throw new Error('undefined is not canonical JSON');
            result[key] = canonicalValue(value[key], { ...state, depth: state.depth + 1 });
        }
        return result;
    }
    throw new Error('unsupported canonical JSON value');
}

function recordBuffer(value, prefix = 'CANONICAL_GRAPH') {
    let buffer;
    try {
        buffer = Buffer.from(`${JSON.stringify(canonicalValue(value))}\n`, 'utf8');
    } catch {
        throw storeError(prefix, 'RECORD_MALFORMED');
    }
    if (buffer.byteLength <= 0 || buffer.byteLength > MAX_RECORD_BYTES) {
        throw storeError(prefix, 'RECORD_TOO_LARGE');
    }
    return buffer;
}

function compatibilityBuffer(value, prefix = 'CANONICAL_GRAPH') {
    let buffer;
    try {
        buffer = Buffer.from(`${JSON.stringify(canonicalValue(value), null, 2)}\n`, 'utf8');
    } catch {
        throw storeError(prefix, 'CACHE_VALUE_INVALID');
    }
    if (buffer.byteLength <= 0 || buffer.byteLength > MAX_RECORD_BYTES) {
        throw storeError(prefix, 'CACHE_VALUE_INVALID');
    }
    return buffer;
}

function assertProductionRoot(productionRoot, prefix) {
    if (typeof productionRoot !== 'string' || !productionRoot || productionRoot.includes('\0')
        || !path.isAbsolute(productionRoot) || path.normalize(productionRoot) !== productionRoot) {
        throw storeError(prefix, 'PRODUCTION_ROOT_INVALID');
    }
    let stats;
    try { stats = fs.lstatSync(productionRoot); } catch { throw storeError(prefix, 'PRODUCTION_ROOT_MISSING'); }
    if (stats.isSymbolicLink() || !stats.isDirectory()) {
        throw storeError(prefix, 'PRODUCTION_ROOT_UNSAFE');
    }
    return { path: productionRoot, dev: stats.dev, ino: stats.ino };
}

function graphPaths(productionRoot, namespace, options = {}) {
    const prefix = codePrefix(options.codePrefix || 'CANONICAL_GRAPH');
    const root = assertProductionRoot(productionRoot, prefix);
    assertNamespace(namespace, prefix);
    const storeRoot = path.join(root.path, STORE_DIRECTORY);
    const namespaceRoot = path.join(storeRoot, namespace);
    return {
        productionRoot: root.path,
        storeRoot,
        namespaceRoot,
        payloadRoot: path.join(namespaceRoot, PAYLOAD_DIRECTORY),
        commitRoot: path.join(namespaceRoot, COMMIT_DIRECTORY),
    };
}

function lstatOrNull(target, prefix, suffix = 'READ_FAILED') {
    try { return fs.lstatSync(target); } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw storeError(prefix, suffix);
    }
}

function assertDirectory(target, prefix, suffix = 'DIRECTORY_UNSAFE') {
    const stats = lstatOrNull(target, prefix);
    if (!stats || stats.isSymbolicLink() || !stats.isDirectory()
        || (stats.mode & 0o777) !== 0o700) {
        throw storeError(prefix, suffix);
    }
    return stats;
}

function fsyncDirectory(target, prefix) {
    let descriptor;
    try {
        descriptor = fs.openSync(target, fs.constants.O_RDONLY);
        fs.fsyncSync(descriptor);
    } catch {
        throw storeError(prefix, 'DIRECTORY_FSYNC_FAILED');
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function ensureDirectory(target, parent, prefix) {
    let created = false;
    try {
        fs.mkdirSync(target, { mode: 0o700 });
        created = true;
        fs.chmodSync(target, 0o700);
    } catch (error) {
        if (error.code !== 'EEXIST') throw storeError(prefix, 'DIRECTORY_CREATE_FAILED');
    }
    assertDirectory(target, prefix);
    if (created) fsyncDirectory(parent, prefix);
}

function ensureGraphDirectories(paths, prefix) {
    const production = assertProductionRoot(paths.productionRoot, prefix);
    ensureDirectory(paths.storeRoot, production.path, prefix);
    const storeNames = fs.readdirSync(paths.storeRoot);
    if (storeNames.some((name) => !ALLOWED_NAMESPACES.has(name))) throw storeError(prefix, 'STORE_ENTRY_INVALID');
    for (const name of storeNames) assertDirectory(path.join(paths.storeRoot, name), prefix);
    ensureDirectory(paths.namespaceRoot, paths.storeRoot, prefix);
    ensureDirectory(paths.payloadRoot, paths.namespaceRoot, prefix);
    ensureDirectory(paths.commitRoot, paths.namespaceRoot, prefix);
    const namespaceNames = fs.readdirSync(paths.namespaceRoot).sort();
    if (namespaceNames.join(',') !== `${COMMIT_DIRECTORY},${PAYLOAD_DIRECTORY}`) {
        throw storeError(prefix, 'DIRECTORY_LAYOUT_INVALID');
    }
}

function identity(stats) {
    return [stats.dev, stats.ino, stats.mode, stats.size, stats.mtimeMs, stats.ctimeMs].join(':');
}

function readStableRecord(target, expectedId, prefix) {
    const before = lstatOrNull(target, prefix, 'RECORD_READ_FAILED');
    if (!before) throw storeError(prefix, 'RECORD_MISSING');
    if (before.isSymbolicLink()) throw storeError(prefix, 'SYMLINK_FORBIDDEN');
    if (!before.isFile()) throw storeError(prefix, 'RECORD_TYPE_INVALID');
    if ((before.mode & 0o777) !== 0o600) throw storeError(prefix, 'RECORD_MODE_INVALID');
    if (before.size <= 0 || before.size > MAX_RECORD_BYTES) throw storeError(prefix, 'RECORD_TOO_LARGE');
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw storeError(prefix, 'NOFOLLOW_UNAVAILABLE');
    let descriptor;
    try {
        descriptor = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const opened = fs.fstatSync(descriptor);
        if (!opened.isFile() || identity(opened) !== identity(before)) throw storeError(prefix, 'RECORD_CHANGED');
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const pathAfter = fs.lstatSync(target);
        if (buffer.byteLength !== opened.size || identity(opened) !== identity(after)
            || identity(opened) !== identity(pathAfter)) throw storeError(prefix, 'RECORD_CHANGED');
        if (sha256(buffer) !== expectedId) throw storeError(prefix, 'HASH_NAME_MISMATCH');
        return buffer;
    } catch (error) {
        if (error?.code?.startsWith(`${prefix}_`)) throw error;
        throw storeError(prefix, 'RECORD_READ_FAILED');
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function parseCanonicalRecord(buffer, prefix) {
    let value;
    try {
        const text = buffer.toString('utf8');
        if (text.includes('\0')) throw new Error('NUL');
        value = JSON.parse(text);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('object required');
    } catch {
        throw storeError(prefix, 'RECORD_MALFORMED');
    }
    if (!recordBuffer(value, prefix).equals(buffer)) throw storeError(prefix, 'RECORD_NONCANONICAL');
    return value;
}

function scanDirectory(directory, prefix) {
    assertDirectory(directory, prefix);
    let names;
    try { names = fs.readdirSync(directory).sort(); } catch { throw storeError(prefix, 'DIRECTORY_READ_FAILED'); }
    if (names.length > MAX_RECORDS) throw storeError(prefix, 'RECORD_LIMIT_EXCEEDED');
    const records = new Map();
    for (const name of names) {
        if (!RECORD_NAME_PATTERN.test(name)) throw storeError(prefix, 'RECORD_NAME_INVALID');
        const id = name.slice(0, -5);
        records.set(id, parseCanonicalRecord(readStableRecord(path.join(directory, name), id, prefix), prefix));
    }
    return records;
}

function validateCommitTopology(commits, prefix = 'CANONICAL_GRAPH') {
    const checkedPrefix = codePrefix(prefix);
    if (!(commits instanceof Map) || commits.size === 0) throw storeError(checkedPrefix, 'EMPTY');
    const roots = [];
    const referencedParents = new Set();
    for (const [id, commit] of commits) {
        if (!HASH_PATTERN.test(id) || !commit || typeof commit !== 'object') {
            throw storeError(checkedPrefix, 'COMMIT_INVALID');
        }
        if (commit.parent === null) roots.push(id);
        else {
            if (!HASH_PATTERN.test(commit.parent)) throw storeError(checkedPrefix, 'COMMIT_INVALID');
            if (!commits.has(commit.parent)) throw storeError(checkedPrefix, 'PARENT_MISSING');
            referencedParents.add(commit.parent);
        }
    }
    if (roots.length === 0) throw storeError(checkedPrefix, 'CYCLE');
    if (roots.length > 1) throw storeError(checkedPrefix, 'MULTIPLE_ROOTS');
    const heads = [...commits.keys()].filter((id) => !referencedParents.has(id));
    if (heads.length === 0) throw storeError(checkedPrefix, 'CYCLE');
    if (heads.length > 1) throw storeError(checkedPrefix, 'FORK');
    const visited = new Set();
    let cursor = heads[0];
    while (cursor !== null) {
        if (visited.has(cursor)) throw storeError(checkedPrefix, 'CYCLE');
        visited.add(cursor);
        cursor = commits.get(cursor).parent;
    }
    if (visited.size !== commits.size) throw storeError(checkedPrefix, 'DISCONNECTED');
    return { root: roots[0], head: heads[0] };
}

function readGraph(productionRoot, namespace, options = {}, allowEmpty = false) {
    const prefix = codePrefix(options.codePrefix || 'CANONICAL_GRAPH');
    const paths = graphPaths(productionRoot, namespace, { codePrefix: prefix });
    const storeStats = lstatOrNull(paths.storeRoot, prefix);
    if (!storeStats) return { exists: false, namespace, paths };
    assertDirectory(paths.storeRoot, prefix);
    const storeNames = fs.readdirSync(paths.storeRoot).sort();
    if (storeNames.some((name) => !ALLOWED_NAMESPACES.has(name))) throw storeError(prefix, 'STORE_ENTRY_INVALID');
    for (const name of storeNames) assertDirectory(path.join(paths.storeRoot, name), prefix);
    const namespaceStats = lstatOrNull(paths.namespaceRoot, prefix);
    if (!namespaceStats) return { exists: false, namespace, paths };
    assertDirectory(paths.namespaceRoot, prefix);
    const namespaceNames = fs.readdirSync(paths.namespaceRoot).sort();
    if (namespaceNames.join(',') !== `${COMMIT_DIRECTORY},${PAYLOAD_DIRECTORY}`) {
        throw storeError(prefix, 'DIRECTORY_LAYOUT_INVALID');
    }
    const payloads = scanDirectory(paths.payloadRoot, prefix);
    const commits = scanDirectory(paths.commitRoot, prefix);
    if (commits.size === 0) {
        if (allowEmpty) return { exists: true, empty: true, namespace, paths, payloads, commits };
        throw storeError(prefix, 'EMPTY');
    }
    for (const [id, payload] of payloads) {
        if (Object.keys(payload).sort().join(',') !== 'namespace,schema_version,value'
            || payload.schema_version !== PAYLOAD_SCHEMA || payload.namespace !== namespace
            || !payload.value || typeof payload.value !== 'object' || Array.isArray(payload.value)) {
            throw storeError(prefix, 'PAYLOAD_INVALID');
        }
        if (sha256(recordBuffer(payload, prefix)) !== id) throw storeError(prefix, 'HASH_NAME_MISMATCH');
    }
    for (const [id, commit] of commits) {
        if (Object.keys(commit).sort().join(',') !== 'namespace,parent,payload_hash,schema_version'
            || commit.schema_version !== COMMIT_SCHEMA || commit.namespace !== namespace
            || (commit.parent !== null && !HASH_PATTERN.test(commit.parent))
            || !HASH_PATTERN.test(commit.payload_hash)) {
            throw storeError(prefix, 'COMMIT_INVALID');
        }
        if (!payloads.has(commit.payload_hash)) throw storeError(prefix, 'PAYLOAD_MISSING');
        if (commit.parent !== null && !commits.has(commit.parent)) throw storeError(prefix, 'PARENT_MISSING');
    }
    const topology = validateCommitTopology(commits, prefix);
    const headCommitId = topology.head;
    const headCommit = commits.get(headCommitId);
    const payload = payloads.get(headCommit.payload_hash);
    return {
        exists: true,
        empty: false,
        namespace,
        headCommitId,
        payloadHash: headCommit.payload_hash,
        payload: payload.value,
        commitCount: commits.size,
        payloadCount: payloads.size,
        commitIds: [...commits.keys()].sort(),
        paths,
    };
}

function inspectGraph(productionRoot, namespace, options = {}) {
    const graph = readGraph(productionRoot, namespace, options, false);
    if (!graph.exists) return { exists: false, namespace };
    const { paths, ...publicGraph } = graph;
    return publicGraph;
}

function writeExclusive(target, buffer, prefix) {
    if (typeof fs.constants.O_NOFOLLOW !== 'number') throw storeError(prefix, 'NOFOLLOW_UNAVAILABLE');
    let descriptor;
    let created = false;
    try {
        descriptor = fs.openSync(
            target,
            fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
            0o600,
        );
        created = true;
        fs.fchmodSync(descriptor, 0o600);
        fs.writeFileSync(descriptor, buffer);
        fs.fsyncSync(descriptor);
        const stats = fs.fstatSync(descriptor);
        if (!stats.isFile() || (stats.mode & 0o777) !== 0o600 || stats.size !== buffer.byteLength) {
            throw storeError(prefix, 'TEMP_INVALID');
        }
    } catch (error) {
        if (created) {
            if (descriptor !== undefined) {
                try { fs.closeSync(descriptor); } catch { /* cleanup continues */ }
                descriptor = undefined;
            }
            try { fs.unlinkSync(target); } catch { /* best effort for task-owned temp */ }
        }
        if (error?.code?.startsWith(`${prefix}_`)) throw error;
        throw storeError(prefix, 'TEMP_WRITE_FAILED');
    } finally {
        if (descriptor !== undefined) {
            try { fs.closeSync(descriptor); } catch { /* already closed */ }
        }
    }
}

function publishImmutable(directory, buffer, options = {}) {
    const prefix = codePrefix(options.codePrefix || 'CANONICAL_GRAPH');
    assertDirectory(directory, prefix);
    if (!Buffer.isBuffer(buffer) || buffer.byteLength <= 0 || buffer.byteLength > MAX_RECORD_BYTES) {
        throw storeError(prefix, 'RECORD_TOO_LARGE');
    }
    const id = options.expectedId || sha256(buffer);
    if (!HASH_PATTERN.test(id) || sha256(buffer) !== id) throw storeError(prefix, 'HASH_NAME_MISMATCH');
    const randomBytes = options.randomBytes || crypto.randomBytes;
    const linkSync = options.linkSync || fs.linkSync;
    const temp = path.join(directory, `.publish-${process.pid}-${randomBytes(12).toString('hex')}`);
    const target = path.join(directory, `${id}.json`);
    let created = false;
    writeExclusive(temp, buffer, prefix);
    try {
        try {
            linkSync(temp, target);
            created = true;
            fsyncDirectory(directory, prefix);
        } catch (error) {
            if (error.code !== 'EEXIST') throw storeError(prefix, 'PUBLISH_FAILED');
            const existing = readStableRecord(target, id, prefix);
            if (!existing.equals(buffer)) throw storeError(prefix, 'COLLISION');
        }
        const verified = readStableRecord(target, id, prefix);
        if (!verified.equals(buffer)) throw storeError(prefix, 'COLLISION');
        return { id, created };
    } finally {
        try { fs.unlinkSync(temp); } catch (error) {
            if (error.code !== 'ENOENT') throw storeError(prefix, 'TEMP_CLEANUP_FAILED');
        }
        fsyncDirectory(directory, prefix);
    }
}

function appendValue(productionRoot, namespace, value, options = {}) {
    const prefix = codePrefix(options.codePrefix || 'CANONICAL_GRAPH');
    assertNamespace(namespace, prefix);
    const expectedParent = options.expectedParent ?? null;
    if (expectedParent !== null && !HASH_PATTERN.test(expectedParent)) throw storeError(prefix, 'EXPECTED_PARENT_INVALID');
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw storeError(prefix, 'PAYLOAD_INVALID');
    const payloadRecord = { schema_version: PAYLOAD_SCHEMA, namespace, value };
    const payloadBuffer = recordBuffer(payloadRecord, prefix);
    const payloadHash = sha256(payloadBuffer);
    const commitRecord = {
        schema_version: COMMIT_SCHEMA,
        namespace,
        parent: expectedParent,
        payload_hash: payloadHash,
    };
    const commitBuffer = recordBuffer(commitRecord, prefix);
    const commitId = sha256(commitBuffer);
    const paths = graphPaths(productionRoot, namespace, { codePrefix: prefix });
    ensureGraphDirectories(paths, prefix);
    const current = readGraph(productionRoot, namespace, { codePrefix: prefix }, true);
    if (!current.empty) {
        if (current.headCommitId === commitId) {
            return { ...inspectGraph(productionRoot, namespace, { codePrefix: prefix }), appended: false, idempotent: true };
        }
        if (current.headCommitId !== expectedParent) throw storeError(prefix, 'HEAD_CHANGED');
        if (current.payloadHash === payloadHash) {
            const publicCurrent = inspectGraph(productionRoot, namespace, { codePrefix: prefix });
            return { ...publicCurrent, appended: false, idempotent: true };
        }
    } else if (expectedParent !== null) {
        throw storeError(prefix, 'HEAD_CHANGED');
    }
    publishImmutable(paths.payloadRoot, payloadBuffer, {
        ...options,
        expectedId: payloadHash,
        codePrefix: prefix,
    });
    if (typeof options.beforeCommitPublish === 'function') {
        options.beforeCommitPublish(Object.freeze({
            parent: expectedParent,
            payloadHash,
            commitId,
            payloadRoot: paths.payloadRoot,
            commitRoot: paths.commitRoot,
        }));
    }
    publishImmutable(paths.commitRoot, commitBuffer, {
        ...options,
        expectedId: commitId,
        codePrefix: prefix,
    });
    const verified = inspectGraph(productionRoot, namespace, { codePrefix: prefix });
    if (verified.headCommitId !== commitId || verified.payloadHash !== payloadHash) {
        throw storeError(prefix, 'VERIFY_FAILED');
    }
    return { ...verified, appended: true, idempotent: false };
}

function cacheIdentity(stats) {
    return stats ? identity(stats) : '';
}

function syncCompatibilityCache(productionRoot, relativePath, value, options = {}) {
    const prefix = codePrefix(options.codePrefix || 'CANONICAL_GRAPH');
    assertProductionRoot(productionRoot, prefix);
    if (!COMPATIBILITY_PATHS.has(relativePath)) throw storeError(prefix, 'CACHE_PATH_INVALID');
    const target = path.join(productionRoot, ...relativePath.split('/'));
    const parent = path.dirname(target);
    const parentStats = lstatOrNull(parent, prefix, 'CACHE_PARENT_INVALID');
    if (!parentStats || parentStats.isSymbolicLink() || !parentStats.isDirectory()) {
        throw storeError(prefix, 'CACHE_PARENT_INVALID');
    }
    const before = lstatOrNull(target, prefix, 'CACHE_READ_FAILED');
    if (before && (before.isSymbolicLink() || !before.isFile())) throw storeError(prefix, 'CACHE_UNSAFE');
    const buffer = compatibilityBuffer(value, prefix);
    if (before && (before.mode & 0o777) === 0o600 && before.size === buffer.byteLength) {
        try {
            const existing = fs.readFileSync(target);
            if (existing.equals(buffer)) return { sha256: sha256(buffer), size: buffer.byteLength, mode: 0o600, written: false };
        } catch { throw storeError(prefix, 'CACHE_READ_FAILED'); }
    }
    const randomBytes = options.randomBytes || crypto.randomBytes;
    const temp = path.join(parent, `.compat-${process.pid}-${randomBytes(12).toString('hex')}`);
    let renamed = false;
    writeExclusive(temp, buffer, prefix);
    try {
        const current = lstatOrNull(target, prefix, 'CACHE_READ_FAILED');
        if (current && (current.isSymbolicLink() || !current.isFile())) throw storeError(prefix, 'CACHE_UNSAFE');
        if (cacheIdentity(before) !== cacheIdentity(current)) throw storeError(prefix, 'CACHE_CHANGED');
        const renameSync = options.renameSync || fs.renameSync;
        try { renameSync(temp, target); } catch { throw storeError(prefix, 'CACHE_SYNC_FAILED'); }
        renamed = true;
        fs.chmodSync(target, 0o600);
        fsyncDirectory(parent, prefix);
        const written = lstatOrNull(target, prefix, 'CACHE_SYNC_FAILED');
        if (!written || written.isSymbolicLink() || !written.isFile() || (written.mode & 0o777) !== 0o600
            || written.size !== buffer.byteLength || !fs.readFileSync(target).equals(buffer)) {
            throw storeError(prefix, 'CACHE_VERIFY_FAILED');
        }
        return { sha256: sha256(buffer), size: buffer.byteLength, mode: 0o600, written: true };
    } finally {
        if (!renamed) {
            try { fs.unlinkSync(temp); } catch (error) {
                if (error.code !== 'ENOENT') throw storeError(prefix, 'TEMP_CLEANUP_FAILED');
            }
        }
    }
}

module.exports = {
    STORE_DIRECTORY,
    PAYLOAD_SCHEMA,
    COMMIT_SCHEMA,
    MAX_RECORD_BYTES,
    MAX_RECORDS,
    NAMESPACES,
    sha256,
    recordBuffer,
    compatibilityBuffer,
    graphPaths,
    inspectGraph,
    validateCommitTopology,
    appendValue,
    publishImmutable,
    syncCompatibilityCache,
};
