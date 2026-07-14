import assert from 'node:assert/strict';
import test from 'node:test';

import { createG3PreviewObjectUrl } from '../src/lib/pipeline/g3PreviewObjectUrl.js';

function preview(bytes, mimeType = 'video/mp4') {
    return {
        loaded: true,
        mime_type: mimeType,
        byte_length: bytes.length,
        base64: Buffer.from(bytes).toString('base64'),
    };
}

function runtime(overrides = {}) {
    const state = { blobs: [], decodedInputs: [], revoked: [] };
    class TestBlob {
        constructor(parts, options) {
            this.bytes = Uint8Array.from(parts.flatMap((part) => Array.from(part)));
            this.size = this.bytes.byteLength;
            this.type = options.type;
            state.blobs.push(this);
        }
    }
    const dependencies = {
        atob(value) {
            state.decodedInputs.push(value);
            return Buffer.from(value, 'base64').toString('latin1');
        },
        Blob: TestBlob,
        URL: {
            createObjectURL: () => `blob:test-${state.blobs.length}`,
            revokeObjectURL: (value) => state.revoked.push(value),
        },
        ...overrides,
    };
    return { state, dependencies };
}

test('default browser dependencies call atob with the globalThis receiver', () => {
    const names = ['atob', 'Blob', 'URL'];
    const previous = new Map(names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
    const receivers = [];
    const revoked = [];
    class BoundBlob {
        constructor(parts, options) {
            this.size = parts.reduce((total, part) => total + part.byteLength, 0);
            this.type = options.type;
        }
    }

    try {
        Object.defineProperties(globalThis, {
            atob: {
                configurable: true,
                writable: true,
                value(value) {
                    receivers.push(this);
                    if (this !== globalThis) throw new TypeError('Illegal invocation');
                    return Buffer.from(value, 'base64').toString('latin1');
                },
            },
            Blob: { configurable: true, writable: true, value: BoundBlob },
            URL: {
                configurable: true,
                writable: true,
                value: {
                    createObjectURL: () => 'blob:bound-default-runtime',
                    revokeObjectURL: (value) => revoked.push(value),
                },
            },
        });

        const result = createG3PreviewObjectUrl(preview(Buffer.from('fixture')));
        assert.equal(result.ok, true);
        assert.deepEqual(receivers, [globalThis]);
        result.dispose();
        assert.deepEqual(revoked, ['blob:bound-default-runtime']);
    } finally {
        for (const [name, descriptor] of previous) {
            if (descriptor) Object.defineProperty(globalThis, name, descriptor);
            else delete globalThis[name];
        }
    }
});

test('valid G3 preview MIME types create exact bounded Blob bytes and revoke once', () => {
    const bytes = Uint8Array.from([0, 1, 2, 3, 127, 128, 255]);
    for (const mimeType of ['video/mp4', 'video/webm', 'video/quicktime', 'video/x-m4v']) {
        const { state, dependencies } = runtime();
        const result = createG3PreviewObjectUrl(preview(bytes, mimeType), dependencies);
        assert.equal(result.ok, true);
        assert.match(result.url, /^blob:/);
        assert.equal(result.mimeType, mimeType);
        assert.equal(result.byteLength, bytes.byteLength);
        assert.equal(state.blobs[0].type, mimeType);
        assert.deepEqual(state.blobs[0].bytes, bytes);
        result.dispose();
        result.dispose();
        assert.deepEqual(state.revoked, [result.url]);
    }
});

test('base64 decoding stays in aligned bounded chunks', () => {
    const bytes = Buffer.alloc(30_000, 173);
    const { state, dependencies } = runtime();
    const result = createG3PreviewObjectUrl(preview(bytes), dependencies);
    assert.equal(result.ok, true);
    assert.ok(state.decodedInputs.length > 1);
    assert.equal(state.decodedInputs.every((value) => value.length <= 32 * 1024 && value.length % 4 === 0), true);
    assert.deepEqual(state.blobs[0].bytes, Uint8Array.from(bytes));
    result.dispose();
});

test('invalid MIME, base64, padding, and byte lengths fail closed before URL creation', () => {
    const valid = preview(Buffer.from('fixture'));
    const invalid = [
        { ...valid, loaded: false },
        { ...valid, mime_type: 'video/ogg' },
        { ...valid, base64: '' },
        { ...valid, base64: '@@@=' },
        { ...valid, base64: 'Zg=' },
        { ...valid, base64: 'Zh==', byte_length: 1 },
        { ...valid, base64: 'Zm8=', byte_length: 1 },
        { ...valid, byte_length: undefined },
        { ...valid, byte_length: Number.NaN },
        { ...valid, byte_length: Number.POSITIVE_INFINITY },
        { ...valid, byte_length: 0 },
        { ...valid, byte_length: 1.5 },
        { ...valid, byte_length: (32 * 1024 * 1024) + 1 },
        { ...valid, byte_length: valid.byte_length + 1 },
    ];
    for (const value of invalid) {
        const { state, dependencies } = runtime();
        const result = createG3PreviewObjectUrl(value, dependencies);
        assert.deepEqual({ ok: result.ok, url: result.url, byteLength: result.byteLength }, { ok: false, url: '', byteLength: 0 });
        result.dispose();
        assert.equal(state.blobs.length, 0);
        assert.equal(state.revoked.length, 0);
    }
});

test('missing browser APIs and decoder or Blob failures return no source', () => {
    const value = preview(Buffer.from('fixture'));
    for (const dependencies of [
        {},
        { atob() {}, Blob() {}, URL: {} },
        runtime({ atob: () => { throw new Error('decode'); } }).dependencies,
        runtime({ Blob: class { constructor() { throw new Error('blob'); } } }).dependencies,
        runtime({ Blob: class { constructor() { this.size = 0; this.type = 'video/mp4'; } } }).dependencies,
        runtime({ Blob: class { constructor(parts) { this.size = parts[0].byteLength; this.type = 'text/plain'; } } }).dependencies,
    ]) {
        const result = createG3PreviewObjectUrl(value, dependencies);
        assert.equal(result.ok, false);
        assert.equal(result.url, '');
    }
});

test('URL creation failures fail closed and a non-blob created URL is revoked', () => {
    const value = preview(Buffer.from('fixture'));
    const throwing = runtime();
    throwing.dependencies.URL.createObjectURL = () => { throw new Error('create'); };
    assert.equal(createG3PreviewObjectUrl(value, throwing.dependencies).ok, false);
    assert.deepEqual(throwing.state.revoked, []);

    const wrongScheme = runtime();
    wrongScheme.dependencies.URL.createObjectURL = () => 'data:video/mp4;base64,AAAA';
    const result = createG3PreviewObjectUrl(value, wrongScheme.dependencies);
    assert.equal(result.ok, false);
    assert.equal(result.url, '');
    assert.deepEqual(wrongScheme.state.revoked, ['data:video/mp4;base64,AAAA']);
});
