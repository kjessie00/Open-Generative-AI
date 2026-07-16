const fs = require('fs');
const { Readable } = require('stream');

const SCHEME = 'film-preview';
const MIME_TYPE = 'video/mp4';
const DEFAULT_TTL_MS = 60 * 60 * 1000;
const DEFAULT_FD_CAP = 8;
const MAX_STREAMS_PER_TOKEN = 4;
const TOKEN_PATTERN = /^[a-f0-9]{64}$/;
const URL_PATTERN = /^film-preview:\/\/final-render\/([a-f0-9]{64})\/video\.mp4$/;

function registerSchemePrivileges(protocolApi) {
    protocolApi.registerSchemesAsPrivileged([{
        scheme: SCHEME,
        privileges: { standard: true, secure: true, stream: true },
    }]);
}

function sameIdentity(left, right) {
    return Boolean(left && right)
        && left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function identityOf(stats) {
    return {
        dev: stats.dev,
        ino: stats.ino,
        mode: stats.mode,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs,
    };
}

function responseHeaders(length) {
    return {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store',
        'Content-Length': String(length),
        'Content-Type': MIME_TYPE,
        'X-Content-Type-Options': 'nosniff',
    };
}

function emptyResponse(status, extra = {}) {
    return new Response(null, {
        status,
        headers: {
            'Cache-Control': 'no-store',
            'Content-Length': '0',
            'Content-Type': MIME_TYPE,
            'Accept-Ranges': 'bytes',
            'X-Content-Type-Options': 'nosniff',
            ...extra,
        },
    });
}

function parseRange(header, size) {
    if (header === null) return { start: 0, end: size - 1, partial: false };
    if (typeof header !== 'string' || header.includes(',') || !/^bytes=\d*-\d*$/.test(header)) return null;
    const [startText, endText] = header.slice(6).split('-');
    if (!startText && !endText) return null;
    if (!startText) {
        const suffix = Number(endText);
        if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
        return { start: Math.max(0, size - suffix), end: size - 1, partial: true };
    }
    const start = Number(startText);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) return null;
    const requestedEnd = endText ? Number(endText) : size - 1;
    if (!Number.isSafeInteger(requestedEnd) || requestedEnd < start) return null;
    return { start, end: Math.min(requestedEnd, size - 1), partial: true };
}

function createPinnedFdReadable(fsApi, fd, start, end) {
    let position = start;
    let reading = false;
    return new Readable({
        read(requestedSize) {
            if (reading || this.destroyed) return;
            if (position > end) {
                this.push(null);
                return;
            }
            const length = Math.min(Math.max(1, requestedSize || 64 * 1024), end - position + 1);
            const buffer = Buffer.allocUnsafe(length);
            reading = true;
            fsApi.read(fd, buffer, 0, length, position, (error, bytesRead) => {
                reading = false;
                if (this.destroyed) return;
                if (error || bytesRead <= 0) {
                    this.destroy(error || new Error('FILM_PREVIEW_READ_FAILED'));
                    return;
                }
                position += bytesRead;
                this.push(buffer.subarray(0, bytesRead));
            });
        },
        destroy(error, callback) {
            callback(error);
        },
    });
}

function createFinalRenderPreviewProtocol(options = {}) {
    const fsApi = options.fs || fs;
    const nowMs = options.nowMs || (() => Date.now());
    const randomBytes = options.randomBytes || require('crypto').randomBytes;
    const ttlMs = options.ttlMs || DEFAULT_TTL_MS;
    const fdCap = options.fdCap || DEFAULT_FD_CAP;
    const createReadStream = options.createReadStream || ((_filePath, streamOptions) => (
        createPinnedFdReadable(fsApi, streamOptions.fd, streamOptions.start, streamOptions.end)
    ));
    const toWeb = options.toWeb || Readable.toWeb;
    const scheduleTimeout = options.setTimeout || setTimeout;
    const cancelTimeout = options.clearTimeout || clearTimeout;
    const entries = new Map();
    const draining = new Set();
    const owners = new Map();
    const issuedTokens = new Set();
    let registeredProtocol = null;

    function closeEntry(entry) {
        if (entry.closed) return;
        entry.closed = true;
        if (entry.expiryTimer) cancelTimeout(entry.expiryTimer);
        draining.delete(entry);
        try { fsApi.closeSync(entry.fd); } catch { /* already closed */ }
    }

    function destroyActiveStreams(entry) {
        for (const active of [...entry.activeStreams]) {
            try { active.stream.destroy(); } catch { /* best effort */ }
            active.finish();
        }
    }

    function revoke(entry, destroyStreams = false) {
        if (!entry) return;
        if (!entry.revoked) {
            entry.revoked = true;
            entries.delete(entry.token);
            const owner = owners.get(entry.owner);
            if (owner?.current === entry) owner.current = null;
        }
        if (destroyStreams) {
            destroyActiveStreams(entry);
        }
        if (entry.activeStreams.size > 0) draining.add(entry);
        else closeEntry(entry);
    }

    function releaseOwner(sender) {
        const owner = owners.get(sender);
        if (!owner) return;
        revoke(owner.current, true);
        for (const [token, entry] of entries) {
            if (entry.owner === sender) revoke(entry, true);
            void token;
        }
        for (const entry of [...draining]) {
            if (entry.owner === sender) revoke(entry, true);
        }
        owners.delete(sender);
        for (const [event, listener] of owner.listeners) {
            try { sender.removeListener?.(event, listener); } catch { /* best effort */ }
        }
    }

    function attachOwner(sender, owner) {
        if (owner.attached || !sender || typeof sender.on !== 'function') return;
        owner.attached = true;
        const cleanup = () => releaseOwner(sender);
        const navigation = (_event, _url, _isInPlace, isMainFrame) => {
            if (isMainFrame !== false) cleanup();
        };
        owner.listeners = [
            ['destroyed', cleanup],
            ['render-process-gone', cleanup],
            ['did-start-navigation', navigation],
        ];
        for (const [event, listener] of owner.listeners) sender.on(event, listener);
    }

    function sweepExpired() {
        const current = nowMs();
        for (const entry of [...entries.values()]) {
            if (current >= entry.expiresAt) revoke(entry, true);
        }
    }

    function descriptorCount() {
        return entries.size + draining.size;
    }

    function publicPreview(entry) {
        return {
            ready: true,
            mime_type: MIME_TYPE,
            byte_length: entry.size,
            stream_url: `${SCHEME}://final-render/${entry.token}/video.mp4`,
        };
    }

    function armExpiry(entry) {
        if (entry.expiryTimer) cancelTimeout(entry.expiryTimer);
        const delay = Math.max(1, entry.expiresAt - nowMs());
        entry.expiryTimer = scheduleTimeout(() => {
            entry.expiryTimer = null;
            if (nowMs() >= entry.expiresAt) revoke(entry, true);
            else armExpiry(entry);
        }, delay);
        entry.expiryTimer?.unref?.();
    }

    function issueToken() {
        for (let attempt = 0; attempt < 32; attempt += 1) {
            let token;
            try { token = randomBytes(32).toString('hex'); } catch { return null; }
            if (TOKEN_PATTERN.test(token) && !issuedTokens.has(token)) {
                issuedTokens.add(token);
                return token;
            }
        }
        return null;
    }

    function commit(sender, generation, source) {
        sweepExpired();
        const owner = owners.get(sender);
        if (!owner || owner.generation !== generation) return null;
        if (!source || typeof source.outputPath !== 'string' || source.outputPath.includes('\0')
            || !TOKEN_PATTERN.test(source.outputSha256 || '')
            || !Number.isSafeInteger(source.outputSize) || source.outputSize <= 0
            || !sameIdentity(source.outputIdentity, { ...source.outputIdentity, size: source.outputSize })) return null;

        const current = owner.current;
        if (current && !current.revoked && current.expiresAt > nowMs()
            && sameIdentity(current.identity, source.outputIdentity)) {
            let opened;
            try { opened = identityOf(fsApi.fstatSync(current.fd)); } catch { return null; }
            if (!sameIdentity(opened, source.outputIdentity)) return null;
            current.expiresAt = nowMs() + ttlMs;
            armExpiry(current);
            return publicPreview(current);
        }

        if (descriptorCount() >= fdCap && current && current.activeStreams.size === 0) revoke(current);
        if (descriptorCount() >= fdCap || typeof fsApi.constants.O_NOFOLLOW !== 'number') return null;

        let before;
        let fd;
        try {
            before = fsApi.lstatSync(source.outputPath);
            if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
                || !sameIdentity(identityOf(before), source.outputIdentity)) return null;
            fd = fsApi.openSync(source.outputPath, fsApi.constants.O_RDONLY | fsApi.constants.O_NOFOLLOW);
            const opened = fsApi.fstatSync(fd);
            if (!opened.isFile() || !sameIdentity(identityOf(opened), source.outputIdentity)) {
                fsApi.closeSync(fd);
                return null;
            }
        } catch {
            if (fd !== undefined) try { fsApi.closeSync(fd); } catch { /* best effort */ }
            return null;
        }

        if (owners.get(sender)?.generation !== generation) {
            try { fsApi.closeSync(fd); } catch { /* best effort */ }
            return null;
        }
        const token = issueToken();
        if (!token) {
            try { fsApi.closeSync(fd); } catch { /* best effort */ }
            return null;
        }
        const entry = {
            token,
            owner: sender,
            fd,
            identity: source.outputIdentity,
            size: source.outputSize,
            expiresAt: nowMs() + ttlMs,
            activeStreams: new Set(),
            revoked: false,
            closed: false,
            expiryTimer: null,
        };
        entries.set(token, entry);
        revoke(current);
        owner.current = entry;
        armExpiry(entry);
        return publicPreview(entry);
    }

    function begin(sender) {
        if (!sender || (typeof sender !== 'object' && typeof sender !== 'function')) {
            return Object.freeze({ commit: () => null, release() {} });
        }
        let owner = owners.get(sender);
        if (!owner) {
            owner = { generation: 0, current: null, attached: false, listeners: [] };
            owners.set(sender, owner);
            attachOwner(sender, owner);
        }
        owner.generation += 1;
        const generation = owner.generation;
        return Object.freeze({
            commit: (source) => commit(sender, generation, source),
            release() {
                const latest = owners.get(sender);
                if (latest?.generation === generation) revoke(latest.current, true);
            },
        });
    }

    async function handle(request) {
        sweepExpired();
        const match = typeof request?.url === 'string' ? request.url.match(URL_PATTERN) : null;
        if (!match) return emptyResponse(404);
        const method = String(request.method || 'GET').toUpperCase();
        if (!['GET', 'HEAD'].includes(method)) return emptyResponse(405, { Allow: 'GET, HEAD' });
        if (request.destination && !['video', 'audio', 'media'].includes(request.destination)) return emptyResponse(403);
        const entry = entries.get(match[1]);
        if (!entry || entry.revoked || nowMs() >= entry.expiresAt) {
            if (entry) revoke(entry, true);
            return emptyResponse(404);
        }
        let liveIdentity;
        try { liveIdentity = identityOf(fsApi.fstatSync(entry.fd)); } catch { revoke(entry, true); return emptyResponse(404); }
        if (!sameIdentity(liveIdentity, entry.identity)) { revoke(entry, true); return emptyResponse(404); }

        const range = parseRange(request.headers?.get?.('range') ?? null, entry.size);
        if (!range) return emptyResponse(416, {
            'Accept-Ranges': 'bytes',
            'Content-Range': `bytes */${entry.size}`,
        });
        const length = range.end - range.start + 1;
        const headers = responseHeaders(length);
        if (range.partial) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${entry.size}`;
        const status = range.partial ? 206 : 200;
        if (method === 'HEAD') return new Response(null, { status, headers });

        if (entry.activeStreams.size >= MAX_STREAMS_PER_TOKEN) return emptyResponse(429);

        let nodeStream;
        try {
            nodeStream = createReadStream('film-preview.mp4', {
                fd: entry.fd,
                autoClose: false,
                start: range.start,
                end: range.end,
            });
        } catch {
            return emptyResponse(404);
        }
        let finished = false;
        const active = { stream: nodeStream, finish: null };
        const finish = () => {
            if (finished) return;
            finished = true;
            entry.activeStreams.delete(active);
            if (entry.revoked && entry.activeStreams.size === 0) closeEntry(entry);
        };
        active.finish = finish;
        entry.activeStreams.add(active);
        nodeStream.once('end', finish);
        nodeStream.once('error', finish);
        nodeStream.once('close', finish);
        try {
            return new Response(toWeb(nodeStream), { status, headers });
        } catch {
            try { nodeStream.destroy(); } catch { /* best effort */ }
            finish();
            return emptyResponse(404);
        }
    }

    function register(protocolApi) {
        registeredProtocol = protocolApi;
        protocolApi.handle(SCHEME, handle);
    }

    function dispose() {
        for (const sender of [...owners.keys()]) releaseOwner(sender);
        for (const entry of [...entries.values()]) revoke(entry, true);
        for (const entry of [...draining]) {
            destroyActiveStreams(entry);
            if (entry.activeStreams.size === 0) closeEntry(entry);
        }
        if (registeredProtocol?.unhandle) {
            try { registeredProtocol.unhandle(SCHEME); } catch { /* best effort */ }
        }
        registeredProtocol = null;
    }

    return Object.freeze({ begin, register, dispose, handle });
}

module.exports = {
    SCHEME,
    registerSchemePrivileges,
    createFinalRenderPreviewProtocol,
    parseRange,
};
