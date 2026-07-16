import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import protocolModule from '../electron/lib/finalRenderPreviewProtocol.js';

const { createFinalRenderPreviewProtocol, registerSchemePrivileges } = protocolModule;

function fixture(t, bytes = Buffer.from('0123456789')) {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'film-preview-protocol-')));
    const outputPath = path.join(root, 'private.mp4');
    fs.writeFileSync(outputPath, bytes, { mode: 0o600 });
    fs.chmodSync(outputPath, 0o600);
    let clock = 1_000;
    let tokenSeed = 1;
    const service = createFinalRenderPreviewProtocol({
        nowMs: () => clock,
        randomBytes: () => Buffer.alloc(32, tokenSeed++),
    });
    const sender = new EventEmitter();
    const source = (target = outputPath) => {
        const stats = fs.lstatSync(target);
        return {
            outputPath: target,
            outputSha256: 'a'.repeat(64),
            outputSize: stats.size,
            outputIdentity: {
                dev: stats.dev, ino: stats.ino, mode: stats.mode, size: stats.size,
                mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs,
            },
        };
    };
    const request = (url, { method = 'GET', range = null, destination = '' } = {}) => ({
        url, method, destination,
        headers: new Headers(range === null ? {} : { Range: range }),
    });
    t.after(() => { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
    return { root, outputPath, service, sender, source, request, advance(ms) { clock += ms; } };
}

test('MOCK: scheme privileges are exact and protocol registration uses one handler', () => {
    const calls = [];
    registerSchemePrivileges({ registerSchemesAsPrivileged(value) { calls.push(value); } });
    assert.deepEqual(calls, [[{
        scheme: 'film-preview',
        privileges: { standard: true, secure: true, stream: true },
    }]]);
});

test('MOCK: pinned capability serves full, HEAD, closed, open, and suffix byte ranges', async (t) => {
    const fx = fixture(t);
    const preview = fx.service.begin(fx.sender).commit(fx.source());
    assert.equal(preview.ready, true);
    assert.equal(preview.mime_type, 'video/mp4');
    assert.equal(preview.byte_length, 10);
    assert.match(preview.stream_url, /^film-preview:\/\/final-render\/[a-f0-9]{64}\/video\.mp4$/);
    assert.equal(JSON.stringify(preview).includes(fx.root), false);
    assert.equal(JSON.stringify(preview).includes('a'.repeat(64)), false);

    const full = await fx.service.handle(fx.request(preview.stream_url));
    assert.equal(full.status, 200);
    assert.equal(full.headers.get('content-type'), 'video/mp4');
    assert.equal(full.headers.get('cache-control'), 'no-store');
    assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(full.headers.get('accept-ranges'), 'bytes');
    assert.equal(Buffer.from(await full.arrayBuffer()).toString(), '0123456789');

    const head = await fx.service.handle(fx.request(preview.stream_url, { method: 'HEAD' }));
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), '10');
    assert.equal((await head.arrayBuffer()).byteLength, 0);

    for (const [range, status, contentRange, body] of [
        ['bytes=2-5', 206, 'bytes 2-5/10', '2345'],
        ['bytes=6-', 206, 'bytes 6-9/10', '6789'],
        ['bytes=-3', 206, 'bytes 7-9/10', '789'],
        ['bytes=7-99', 206, 'bytes 7-9/10', '789'],
    ]) {
        const response = await fx.service.handle(fx.request(preview.stream_url, { range }));
        assert.equal(response.status, status);
        assert.equal(response.headers.get('content-range'), contentRange);
        assert.equal(Buffer.from(await response.arrayBuffer()).toString(), body);
    }
});

test('actual temp file: cancelling one Range never closes the master FD and later seeks stay exact', async (t) => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'film-preview-cancel-')));
    const outputPath = path.join(root, 'seekable.mp4');
    const bytes = Buffer.alloc(2 * 1024 * 1024);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 251;
    fs.writeFileSync(outputPath, bytes, { mode: 0o600 });
    let masterFd;
    const fsApi = new Proxy(fs, {
        get(target, property) {
            if (property === 'openSync') return (...args) => {
                const fd = target.openSync(...args);
                masterFd = fd;
                return fd;
            };
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const service = createFinalRenderPreviewProtocol({ fs: fsApi });
    t.after(() => { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
    const sender = new EventEmitter();
    const stats = fs.lstatSync(outputPath);
    const preview = service.begin(sender).commit({
        outputPath,
        outputSha256: '8'.repeat(64),
        outputSize: stats.size,
        outputIdentity: {
            dev: stats.dev, ino: stats.ino, mode: stats.mode, size: stats.size,
            mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs,
        },
    });
    const request = (start) => ({
        url: preview.stream_url,
        method: 'GET',
        destination: 'video',
        headers: new Headers({ Range: `bytes=${start}-` }),
    });

    for (const start of [0, 425984, 65536, 1343488]) {
        const response = await service.handle(request(start));
        assert.equal(response.status, 206);
        assert.equal(response.headers.get('content-range'), `bytes ${start}-${bytes.length - 1}/${bytes.length}`);
        const reader = response.body.getReader();
        const first = await reader.read();
        assert.equal(first.done, false);
        assert.ok(first.value.byteLength > 0 && first.value.byteLength < bytes.length - start);
        assert.deepEqual(
            Buffer.from(first.value),
            bytes.subarray(start, start + first.value.byteLength),
        );
        await reader.cancel();
        assert.equal(fs.fstatSync(masterFd).size, bytes.length, 'cancel must not close the pinned master FD');
    }
});

test('MOCK: malformed URL, method, destination, range, revoked token, and expiry fail closed', async (t) => {
    const fx = fixture(t);
    const preview = fx.service.begin(fx.sender).commit(fx.source());
    const badUrls = [
        preview.stream_url.replace('film-preview:', 'file:'),
        `${preview.stream_url}?path=/private`,
        `${preview.stream_url}#fragment`,
        preview.stream_url.replace('/video.mp4', '/other.mp4'),
        preview.stream_url.replace('final-render', 'elsewhere'),
    ];
    for (const url of badUrls) assert.equal((await fx.service.handle(fx.request(url))).status, 404);
    assert.equal((await fx.service.handle(fx.request(preview.stream_url, { method: 'POST' }))).status, 405);
    assert.equal((await fx.service.handle(fx.request(preview.stream_url, { destination: 'script' }))).status, 403);
    for (const range of ['bytes=', 'bytes=2-1', 'bytes=10-', 'bytes=0-1,3-4', 'bytes =0-1']) {
        const response = await fx.service.handle(fx.request(preview.stream_url, { range }));
        assert.equal(response.status, 416);
        assert.equal(response.headers.get('content-range'), 'bytes */10');
    }

    const otherPath = path.join(fx.root, 'other.mp4');
    fs.writeFileSync(otherPath, 'abcdefghij', { mode: 0o600 });
    const replacement = fx.service.begin(fx.sender).commit(fx.source(otherPath));
    assert.equal(replacement.ready, true);
    assert.equal((await fx.service.handle(fx.request(preview.stream_url))).status, 404);
    fx.advance(60 * 60 * 1000);
    assert.equal((await fx.service.handle(fx.request(replacement.stream_url))).status, 404);
});

test('MOCK: latest main-owned generation wins and same identity reuses its URL', async (t) => {
    const fx = fixture(t);
    const leaseA = fx.service.begin(fx.sender);
    const leaseB = fx.service.begin(fx.sender);
    const previewB = leaseB.commit(fx.source());
    assert.equal(previewB.ready, true);
    assert.equal(leaseA.commit(fx.source()), null);
    leaseA.release();
    assert.equal((await fx.service.handle(fx.request(previewB.stream_url, { method: 'HEAD' }))).status, 200);

    const reused = fx.service.begin(fx.sender).commit(fx.source());
    assert.equal(reused.stream_url, previewB.stream_url);
    fx.sender.emit('did-start-navigation', {}, 'file:///reload', false, true);
    assert.equal((await fx.service.handle(fx.request(previewB.stream_url))).status, 404);
    const afterReload = fx.service.begin(fx.sender).commit(fx.source());
    assert.equal(afterReload.ready, true);
    fx.sender.emit('render-process-gone');
    assert.equal((await fx.service.handle(fx.request(afterReload.stream_url))).status, 404);
});

test('MOCK: an active range remains readable while its revoked descriptor drains', async (t) => {
    const fx = fixture(t, Buffer.alloc(128 * 1024, 11));
    const first = fx.service.begin(fx.sender).commit(fx.source());
    const response = await fx.service.handle(fx.request(first.stream_url, { range: 'bytes=0-65535' }));
    const otherPath = path.join(fx.root, 'next.mp4');
    fs.writeFileSync(otherPath, Buffer.alloc(128 * 1024, 22), { mode: 0o600 });
    const second = fx.service.begin(fx.sender).commit(fx.source(otherPath));
    assert.equal(second.ready, true);
    assert.equal((await fx.service.handle(fx.request(first.stream_url))).status, 404);
    const body = Buffer.from(await response.arrayBuffer());
    assert.equal(body.byteLength, 65536);
    assert.equal(body.every((byte) => byte === 11), true);
});

test('MOCK: global descriptor cap rejects excess owners and lifecycle cleanup closes the pin', (t) => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'film-preview-cap-')));
    const paths = [path.join(root, 'one.mp4'), path.join(root, 'two.mp4')];
    for (const target of paths) fs.writeFileSync(target, 'private', { mode: 0o600 });
    let closes = 0;
    const fsApi = new Proxy(fs, {
        get(target, property) {
            if (property === 'closeSync') return (fd) => { closes += 1; return target.closeSync(fd); };
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    let token = 1;
    const service = createFinalRenderPreviewProtocol({
        fs: fsApi, fdCap: 1, randomBytes: () => Buffer.alloc(32, token++),
    });
    const identity = (outputPath) => {
        const stats = fs.lstatSync(outputPath);
        return {
            outputPath, outputSha256: 'f'.repeat(64), outputSize: stats.size,
            outputIdentity: {
                dev: stats.dev, ino: stats.ino, mode: stats.mode, size: stats.size,
                mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs,
            },
        };
    };
    const senderA = new EventEmitter();
    const senderB = new EventEmitter();
    assert.equal(service.begin(senderA).commit(identity(paths[0])).ready, true);
    assert.equal(service.begin(senderB).commit(identity(paths[1])), null);
    assert.equal(closes, 0);
    senderA.emit('destroyed');
    assert.equal(closes, 1);
    assert.equal(service.begin(senderB).commit(identity(paths[1])).ready, true);
    service.dispose();
    assert.equal(closes, 2);
    fs.rmSync(root, { recursive: true, force: true });
    t.after(() => { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
});

test('MOCK: stream cap is four and lifecycle, TTL, and dispose destroy hanging streams and reclaim FDs', async (t) => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'film-preview-stream-cap-')));
    const outputPath = path.join(root, 'private.mp4');
    fs.writeFileSync(outputPath, Buffer.alloc(1024, 9), { mode: 0o600 });
    let closes = 0;
    let clock = 1_000;
    let token = 1;
    const streams = [];
    const fsApi = new Proxy(fs, {
        get(target, property) {
            if (property === 'closeSync') return (fd) => { closes += 1; return target.closeSync(fd); };
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const service = createFinalRenderPreviewProtocol({
        fs: fsApi,
        fdCap: 1,
        ttlMs: 10,
        nowMs: () => clock,
        randomBytes: () => Buffer.alloc(32, token++),
        createReadStream() {
            const stream = new Readable({ read() {} });
            streams.push(stream);
            return stream;
        },
    });
    const source = () => {
        const stats = fs.lstatSync(outputPath);
        return {
            outputPath, outputSha256: '9'.repeat(64), outputSize: stats.size,
            outputIdentity: {
                dev: stats.dev, ino: stats.ino, mode: stats.mode, size: stats.size,
                mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs,
            },
        };
    };
    const request = (url) => ({ url, method: 'GET', destination: 'video', headers: new Headers() });
    const senderA = new EventEmitter();
    const first = service.begin(senderA).commit(source());
    const openResponses = [];
    for (let index = 0; index < 4; index += 1) {
        const response = await service.handle(request(first.stream_url));
        assert.equal(response.status, 200);
        openResponses.push(response);
    }
    assert.equal((await service.handle(request(first.stream_url))).status, 429);
    assert.equal(streams.filter((stream) => !stream.destroyed).length, 4);
    senderA.emit('destroyed');
    assert.equal(streams.slice(0, 4).every((stream) => stream.destroyed), true);
    assert.equal(closes, 1);

    const senderB = new EventEmitter();
    const second = service.begin(senderB).commit(source());
    assert.equal(second.ready, true, 'destroyed owner must release the global FD slot');
    assert.equal((await service.handle(request(second.stream_url))).status, 200);
    clock += 10;
    assert.equal((await service.handle(request(second.stream_url))).status, 404);
    assert.equal(streams[4].destroyed, true);
    assert.equal(closes, 2);

    const senderC = new EventEmitter();
    const third = service.begin(senderC).commit(source());
    assert.equal(third.ready, true, 'expired capability must release the global FD slot');
    assert.equal((await service.handle(request(third.stream_url))).status, 200);
    service.begin(senderC).release();
    assert.equal(streams[5].destroyed, true);
    assert.equal((await service.handle(request(third.stream_url))).status, 404);
    assert.equal(closes, 3);

    const senderD = new EventEmitter();
    const fourth = service.begin(senderD).commit(source());
    assert.equal(fourth.ready, true, 'latest release must reclaim the global FD slot');
    assert.equal((await service.handle(request(fourth.stream_url))).status, 200);
    service.dispose();
    assert.equal(streams[6].destroyed, true);
    assert.equal(closes, 4);
    void openResponses;
    t.after(() => { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
});

test('MOCK: owner teardown destroys both current and already-draining streams', async (t) => {
    const root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'film-preview-owner-drain-')));
    const paths = [path.join(root, 'a.mp4'), path.join(root, 'b.mp4')];
    for (const target of paths) fs.writeFileSync(target, Buffer.alloc(1024, 4), { mode: 0o600 });
    let closes = 0;
    let token = 1;
    const streams = [];
    const fsApi = new Proxy(fs, {
        get(target, property) {
            if (property === 'closeSync') return (fd) => { closes += 1; return target.closeSync(fd); };
            const value = target[property];
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
    const service = createFinalRenderPreviewProtocol({
        fs: fsApi,
        fdCap: 4,
        randomBytes: () => Buffer.alloc(32, token++),
        createReadStream() {
            const stream = new Readable({ read() {} });
            streams.push(stream);
            return stream;
        },
    });
    const source = (outputPath) => {
        const stats = fs.lstatSync(outputPath);
        return {
            outputPath, outputSha256: '4'.repeat(64), outputSize: stats.size,
            outputIdentity: {
                dev: stats.dev, ino: stats.ino, mode: stats.mode, size: stats.size,
                mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs,
            },
        };
    };
    const request = (url) => ({ url, method: 'GET', destination: 'video', headers: new Headers() });
    const sender = new EventEmitter();
    const first = service.begin(sender).commit(source(paths[0]));
    const firstResponse = await service.handle(request(first.stream_url));
    assert.equal(firstResponse.status, 200);
    const second = service.begin(sender).commit(source(paths[1]));
    const secondResponse = await service.handle(request(second.stream_url));
    assert.equal(secondResponse.status, 200);
    assert.equal(streams.every((stream) => !stream.destroyed), true);
    assert.equal((await service.handle(request(first.stream_url))).status, 404);

    sender.emit('destroyed');
    assert.equal(streams.every((stream) => stream.destroyed), true);
    assert.equal(closes, 2);
    assert.equal((await service.handle(request(second.stream_url))).status, 404);
    void firstResponse;
    void secondResponse;
    t.after(() => { service.dispose(); fs.rmSync(root, { recursive: true, force: true }); });
});
