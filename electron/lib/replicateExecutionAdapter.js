const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PRODUCTION_SUBMIT_URL = 'https://api.replicate.com/v1/models/bytedance/seedance-1-pro/predictions';
const MAX_DOWNLOAD_BYTES = 512 * 1024 * 1024;
const PREDICTION_ID = /^[A-Za-z0-9_-]{1,160}$/;
const PROVIDER_STATUSES = new Set([
    'starting', 'processing', 'succeeded', 'failed', 'canceled', 'aborted',
]);

function adapterFailure(code, facts = {}) {
    const error = new Error(code);
    error.code = code;
    Object.assign(error, facts);
    return error;
}

function isLoopback(url) {
    return url.protocol === 'http:' && (url.hostname === '127.0.0.1' || url.hostname === '::1');
}

function checkedUrl(value, kind, context, predictionId = '') {
    let url;
    try { url = new URL(value); } catch { throw adapterFailure('RESULT_INVALID'); }
    if (url.username || url.password || url.hash) throw adapterFailure('RESULT_INVALID');
    const testLoopback = context.replicateLoopbackTestOnly === true && isLoopback(url);
    if (testLoopback) return url.toString();
    if (url.protocol !== 'https:') throw adapterFailure('RESULT_INVALID');
    if (kind === 'submit') {
        if (url.toString() !== PRODUCTION_SUBMIT_URL) throw adapterFailure('RESULT_INVALID');
        return url.toString();
    }
    if (kind === 'poll') {
        if (url.hostname !== 'api.replicate.com' || url.port
            || url.pathname !== `/v1/predictions/${predictionId}`) throw adapterFailure('RESULT_INVALID');
        return url.toString();
    }
    if (kind === 'output') {
        if (url.port || (url.hostname !== 'replicate.delivery'
            && !url.hostname.endsWith('.replicate.delivery'))) throw adapterFailure('RESULT_INVALID');
        return url.toString();
    }
    throw adapterFailure('RESULT_INVALID');
}

function requestTimeout(context) {
    if (context.replicateLoopbackTestOnly === true
        && Number.isInteger(context.replicateTestRequestTimeoutMs)
        && context.replicateTestRequestTimeoutMs >= 10
        && context.replicateTestRequestTimeoutMs <= 30000) {
        return context.replicateTestRequestTimeoutMs;
    }
    return 30000;
}

function pollSettings(context) {
    if (context.replicateLoopbackTestOnly === true) {
        return {
            attempts: Number.isInteger(context.replicateTestPollAttempts)
                && context.replicateTestPollAttempts > 0 && context.replicateTestPollAttempts <= 100
                ? context.replicateTestPollAttempts : 20,
            interval: Number.isInteger(context.replicateTestPollIntervalMs)
                && context.replicateTestPollIntervalMs >= 0 && context.replicateTestPollIntervalMs <= 1000
                ? context.replicateTestPollIntervalMs : 5,
        };
    }
    return { attempts: 120, interval: 2000 };
}

async function fetchBounded(url, init, context) {
    const fetchFn = context.replicateFetch || globalThis.fetch;
    if (typeof fetchFn !== 'function') throw adapterFailure('PROVIDER_UNAVAILABLE');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeout(context));
    try {
        const response = await fetchFn(url, { ...init, redirect: 'error', signal: controller.signal });
        return { response, finish: () => clearTimeout(timer) };
    } catch {
        clearTimeout(timer);
        throw adapterFailure('PROVIDER_UNAVAILABLE', { externalCallPerformed: true });
    }
}

function responseFailure(status) {
    if (status === 401 || status === 403) return adapterFailure('AUTH_REQUIRED', {
        externalCallPerformed: true, definitiveRejection: true,
    });
    if (status === 429) return adapterFailure('RATE_LIMITED', {
        externalCallPerformed: true, definitiveRejection: true,
    });
    if (status >= 500) return adapterFailure('PROVIDER_UNAVAILABLE', { externalCallPerformed: true });
    return adapterFailure('GENERATION_FAILED', { externalCallPerformed: true });
}

async function responseJson(transport) {
    const { response, finish } = transport;
    try {
        if (!response.ok) throw responseFailure(response.status);
        const length = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(length) && length > 1024 * 1024) throw adapterFailure('RESULT_INVALID');
        if (!response.body) throw adapterFailure('RESULT_INVALID');
        const chunks = [];
        let total = 0;
        for await (const value of response.body) {
            const chunk = Buffer.from(value);
            total += chunk.byteLength;
            if (total > 1024 * 1024) throw adapterFailure('RESULT_INVALID');
            chunks.push(chunk);
        }
        let parsed;
        try { parsed = JSON.parse(Buffer.concat(chunks, total).toString('utf8')); }
        catch { throw adapterFailure('RESULT_INVALID'); }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw adapterFailure('RESULT_INVALID');
        return parsed;
    } catch (error) {
        if (error.name === 'AbortError') {
            throw adapterFailure('PROVIDER_UNAVAILABLE', { externalCallPerformed: true });
        }
        throw error;
    } finally { finish(); }
}

function predictionSnapshot(value, context, expectedId = '') {
    const predictionId = value.id;
    if (!PREDICTION_ID.test(predictionId || '') || (expectedId && predictionId !== expectedId)
        || !PROVIDER_STATUSES.has(value.status)) throw adapterFailure('RESULT_INVALID');
    const getUrl = checkedUrl(value.urls?.get, 'poll', context, predictionId);
    let output = value.output;
    if (Array.isArray(output)) {
        if (output.length !== 1) throw adapterFailure('RESULT_INVALID');
        [output] = output;
    }
    return {
        predictionId,
        getUrl,
        status: value.status,
        outputUrl: value.status === 'succeeded'
            ? checkedUrl(output, 'output', context)
            : '',
        completedAt: value.status === 'succeeded' ? validateCompletedAt(value.completed_at) : '',
    };
}

function validateCompletedAt(value) {
    if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > 64
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        || !Number.isFinite(Date.parse(value))) throw adapterFailure('RESULT_INVALID');
    return value;
}

function validateExistingOutput(outputPath) {
    let before;
    try { before = fs.lstatSync(outputPath); } catch { throw adapterFailure('RESULT_INVALID'); }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size < 12 || before.size > MAX_DOWNLOAD_BYTES
        || fs.realpathSync.native(outputPath) !== outputPath) throw adapterFailure('RESULT_INVALID');
    const descriptor = fs.openSync(outputPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        const header = Buffer.alloc(12);
        const count = fs.readSync(descriptor, header, 0, header.byteLength, 0);
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(outputPath);
        if (count !== header.byteLength || header.subarray(4, 8).toString('ascii') !== 'ftyp'
            || before.dev !== opened.dev || before.ino !== opened.ino || before.size !== opened.size
            || opened.dev !== after.dev || opened.ino !== after.ino || opened.size !== after.size
            || after.dev !== final.dev || after.ino !== final.ino || after.size !== final.size) {
            throw adapterFailure('RESULT_INVALID');
        }
    } finally { fs.closeSync(descriptor); }
}

async function downloadOutput(
    outputUrl,
    outputPath,
    context,
    reconcileExistingOutput,
    heartbeat,
    heartbeatIntervalMs,
) {
    try {
        fs.lstatSync(outputPath);
        if (reconcileExistingOutput === true) {
            validateExistingOutput(outputPath);
            return;
        }
        throw adapterFailure('RESULT_INVALID');
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }
    await heartbeat();
    let lastHeartbeatAt = Date.now();
    const transport = await fetchBounded(outputUrl, { method: 'GET', headers: { Accept: 'video/mp4' } }, context);
    const { response, finish } = transport;
    const parent = path.dirname(outputPath);
    const ownerNonce = typeof context.replicateExecutionOwnerNonce === 'string'
        && /^[a-f0-9]{32}$/.test(context.replicateExecutionOwnerNonce)
        ? context.replicateExecutionOwnerNonce : crypto.randomBytes(16).toString('hex');
    const temporary = path.join(parent,
        `.${path.basename(outputPath)}.${process.pid}.${ownerNonce}.partial`);
    let descriptor;
    let total = 0;
    const header = Buffer.alloc(12);
    let headerBytes = 0;
    try {
        if (!response.ok) throw responseFailure(response.status);
        const contentLength = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(contentLength) && contentLength > MAX_DOWNLOAD_BYTES) throw adapterFailure('RESULT_INVALID');
        if (!response.body) throw adapterFailure('RESULT_INVALID');
        descriptor = fs.openSync(temporary, fs.constants.O_WRONLY | fs.constants.O_CREAT
            | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
        for await (const value of response.body) {
            if (Date.now() - lastHeartbeatAt >= heartbeatIntervalMs) {
                await heartbeat();
                lastHeartbeatAt = Date.now();
            }
            const chunk = Buffer.from(value);
            total += chunk.byteLength;
            if (total > MAX_DOWNLOAD_BYTES) throw adapterFailure('RESULT_INVALID');
            if (headerBytes < header.byteLength) {
                const copied = Math.min(chunk.byteLength, header.byteLength - headerBytes);
                chunk.copy(header, headerBytes, 0, copied);
                headerBytes += copied;
            }
            let offset = 0;
            while (offset < chunk.byteLength) {
                const written = fs.writeSync(descriptor, chunk, offset, chunk.byteLength - offset);
                if (!Number.isInteger(written) || written <= 0) throw adapterFailure('RESULT_INVALID');
                offset += written;
            }
        }
        if (total < 12 || header.subarray(4, 8).toString('ascii') !== 'ftyp') {
            throw adapterFailure('RESULT_INVALID');
        }
        fs.fsyncSync(descriptor);
        fs.closeSync(descriptor);
        descriptor = undefined;
        if (context.replicateLoopbackTestOnly === true
            && typeof context.replicateTestBeforeOutputPublish === 'function') {
            context.replicateTestBeforeOutputPublish(outputPath);
        }
        const staged = fs.lstatSync(temporary);
        try { fs.linkSync(temporary, outputPath); }
        catch (error) {
            if (error.code === 'EEXIST') throw adapterFailure('RESULT_INVALID');
            throw error;
        }
        const published = fs.lstatSync(outputPath);
        if (!staged.isFile() || staged.isSymbolicLink() || (staged.mode & 0o777) !== 0o600
            || !published.isFile() || published.isSymbolicLink() || (published.mode & 0o777) !== 0o600
            || staged.dev !== published.dev || staged.ino !== published.ino
            || staged.size !== total || published.size !== total) {
            try {
                const current = fs.lstatSync(outputPath);
                if (current.dev === staged.dev && current.ino === staged.ino) fs.unlinkSync(outputPath);
            } catch { /* preserve any replacement */ }
            throw adapterFailure('RESULT_INVALID');
        }
        const directory = fs.openSync(parent, fs.constants.O_RDONLY);
        try {
            fs.fsyncSync(directory);
            fs.unlinkSync(temporary);
            fs.fsyncSync(directory);
        } finally { fs.closeSync(directory); }
    } catch (error) {
        if (descriptor !== undefined) try { fs.closeSync(descriptor); } catch { /* already closed */ }
        try { fs.unlinkSync(temporary); } catch { /* absent or already renamed */ }
        if (error.name === 'AbortError') {
            throw adapterFailure('PROVIDER_UNAVAILABLE', { externalCallPerformed: true });
        }
        throw error.code ? error : adapterFailure('RESULT_INVALID');
    } finally { finish(); }
    await heartbeat();
}

function delay(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function executeReplicatePrediction(options, context = {}) {
    const {
        requestSpec, apiToken, priorSubmission, allowSubmit, outputPath,
        persistSubmission, persistSucceeded, onStatus, heartbeat, heartbeatIntervalMs,
    } = options;
    if (!requestSpec || requestSpec.method !== 'POST' || requestSpec.url !== PRODUCTION_SUBMIT_URL
        || typeof apiToken !== 'string' || !apiToken.trim() || apiToken.includes('\0')
        || typeof outputPath !== 'string' || !path.isAbsolute(outputPath)
        || typeof persistSubmission !== 'function' || typeof persistSucceeded !== 'function'
        || typeof onStatus !== 'function' || typeof heartbeat !== 'function'
        || !Number.isInteger(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
        throw adapterFailure('AUTH_REQUIRED');
    }
    let snapshot;
    if (priorSubmission) {
        snapshot = {
            predictionId: priorSubmission.prediction_id,
            getUrl: checkedUrl(priorSubmission.get_url, 'poll', context, priorSubmission.prediction_id),
            status: 'starting', outputUrl: '', completedAt: '',
        };
    } else {
        if (allowSubmit !== true) throw adapterFailure('RESULT_INVALID');
        const submitUrl = context.replicateLoopbackTestOnly === true
            ? checkedUrl(context.replicateTestSubmitUrl, 'submit', context)
            : checkedUrl(requestSpec.url, 'submit', context);
        await heartbeat();
        try {
            let value;
            try {
                const response = await fetchBounded(submitUrl, {
                    method: 'POST',
                    headers: {
                        Authorization: `Bearer ${apiToken.trim()}`,
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify(requestSpec.body),
                }, context);
                value = await responseJson(response);
            } finally { await heartbeat(); }
            snapshot = predictionSnapshot(value, context);
            await persistSubmission({
                prediction_id: snapshot.predictionId,
                get_url: snapshot.getUrl,
                submitted_at: new Date().toISOString(),
            });
        } catch (error) {
            error.externalCallPerformed = true;
            throw error;
        }
    }

    await onStatus(snapshot.status);
    const poll = pollSettings(context);
    for (let attempt = 0; !['succeeded', 'failed', 'canceled', 'aborted'].includes(snapshot.status); attempt += 1) {
        if (attempt >= poll.attempts) {
            throw adapterFailure('PROVIDER_UNAVAILABLE', {
                externalCallPerformed: true, modelCalled: true, generationExecuted: true,
            });
        }
        if (poll.interval) await delay(poll.interval);
        await heartbeat();
        let value;
        try {
            const response = await fetchBounded(snapshot.getUrl, {
                method: 'GET', headers: { Authorization: `Bearer ${apiToken.trim()}` },
            }, context);
            value = await responseJson(response);
        } finally { await heartbeat(); }
        snapshot = predictionSnapshot(value, context, snapshot.predictionId);
        await onStatus(snapshot.status);
    }
    if (snapshot.status === 'failed') throw adapterFailure('GENERATION_FAILED', {
        externalCallPerformed: true, modelCalled: true, generationExecuted: true,
        definitivePredictionTerminal: true,
    });
    if (snapshot.status === 'canceled' || snapshot.status === 'aborted') {
        throw adapterFailure('CANCELLED', {
            externalCallPerformed: true, modelCalled: true, generationExecuted: true,
            definitivePredictionTerminal: true,
        });
    }
    await persistSucceeded({
        prediction_id: snapshot.predictionId,
        completed_at: snapshot.completedAt,
        output_url: snapshot.outputUrl,
    });
    await downloadOutput(
        snapshot.outputUrl,
        outputPath,
        context,
        Boolean(priorSubmission),
        heartbeat,
        heartbeatIntervalMs,
    );
    return {
        prediction_id: snapshot.predictionId,
        completed_at: snapshot.completedAt,
    };
}

module.exports = {
    PRODUCTION_SUBMIT_URL,
    MAX_DOWNLOAD_BYTES,
    executeReplicatePrediction,
};
