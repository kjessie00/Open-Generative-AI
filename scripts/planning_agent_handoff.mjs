#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import draftProvider from '../electron/lib/newProjectDraftProvider.js';

const MAX_INPUT_BYTES = 320 * 1024;

function fail(code) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: code })}\n`);
    process.exitCode = 1;
}

function exactArgs(argv) {
    const [command, ...rest] = argv;
    const values = {};
    for (let index = 0; index < rest.length; index += 2) {
        const key = rest[index];
        const value = rest[index + 1];
        if (!['--user-data', '--request-id', '--input'].includes(key) || value === undefined || values[key]) {
            throw Object.assign(new Error('invalid arguments'), { code: 'PLANNING_AGENT_CLI_ARGUMENT_INVALID' });
        }
        values[key] = value;
    }
    if (!['prepare', 'publish'].includes(command)
        || typeof values['--user-data'] !== 'string'
        || !path.isAbsolute(values['--user-data'])
        || path.normalize(values['--user-data']) !== values['--user-data']) {
        throw Object.assign(new Error('invalid arguments'), { code: 'PLANNING_AGENT_CLI_ARGUMENT_INVALID' });
    }
    if (command === 'prepare' && (Object.keys(values).sort().join(',') !== '--request-id,--user-data')) {
        throw Object.assign(new Error('invalid prepare arguments'), { code: 'PLANNING_AGENT_CLI_ARGUMENT_INVALID' });
    }
    if (command === 'publish' && (Object.keys(values).sort().join(',') !== '--input,--user-data')) {
        throw Object.assign(new Error('invalid publish arguments'), { code: 'PLANNING_AGENT_CLI_ARGUMENT_INVALID' });
    }
    return { command, userDataPath: values['--user-data'], requestId: values['--request-id'], inputPath: values['--input'] };
}

function privateWrite(filePath, content) {
    const descriptor = fs.openSync(
        filePath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
        0o600,
    );
    try {
        fs.fchmodSync(descriptor, 0o600);
        fs.writeFileSync(descriptor, content);
        fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
}

function stableInput(filePath) {
    if (!path.isAbsolute(filePath) || path.normalize(filePath) !== filePath || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw Object.assign(new Error('unsafe input'), { code: 'PLANNING_AGENT_CLI_INPUT_UNSAFE' });
    }
    const before = fs.lstatSync(filePath);
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > MAX_INPUT_BYTES) {
        throw Object.assign(new Error('unsafe input'), { code: 'PLANNING_AGENT_CLI_INPUT_UNSAFE' });
    }
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
            || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) {
            throw Object.assign(new Error('changed input'), { code: 'PLANNING_AGENT_CLI_INPUT_CHANGED' });
        }
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
            throw Object.assign(new Error('changed input'), { code: 'PLANNING_AGENT_CLI_INPUT_CHANGED' });
        }
        return buffer;
    } finally { fs.closeSync(descriptor); }
}

function prepare(args) {
    const handoff = draftProvider.preparePlanningAgentHandoff(
        { request_id: args.requestId },
        { userDataPath: args.userDataPath },
    );
    const packetRoot = fs.mkdtempSync('/private/tmp/open-ga-planning-handoff-');
    fs.chmodSync(packetRoot, 0o700);
    privateWrite(
        path.join(packetRoot, 'request.json'),
        `${JSON.stringify({ request: handoff.request, snapshot_manifest: handoff.snapshot.manifest }, null, 2)}\n`,
    );
    privateWrite(path.join(packetRoot, 'brief.md'), `${handoff.snapshot.brief}\n`);
    privateWrite(path.join(packetRoot, 'script.txt'), `${handoff.snapshot.script}\n`);
    process.stdout.write(`${JSON.stringify({
        ok: true,
        handle: packetRoot,
        request_id: handoff.request.request_id,
        stage: handoff.request.stage,
    })}\n`);
}

function publish(args) {
    let input;
    try { input = JSON.parse(stableInput(args.inputPath).toString('utf8')); } catch (error) {
        if (error.code) throw error;
        throw Object.assign(new Error('invalid input'), { code: 'PLANNING_AGENT_CLI_INPUT_INVALID' });
    }
    const result = draftProvider.publishPlanningAgentSuggestion(input, { userDataPath: args.userDataPath });
    process.stdout.write(`${JSON.stringify({
        ok: true,
        request_id: result.request_id,
        suggestion_token: result.suggestion_token,
        proposed_text_sha256: result.proposed_text_sha256,
        proposed_text_bytes: result.proposed_text_bytes,
        status: result.status,
        already_published: result.already_published,
    })}\n`);
}

try {
    const args = exactArgs(process.argv.slice(2));
    if (args.command === 'prepare') prepare(args);
    else publish(args);
} catch (error) {
    fail(error.code || 'PLANNING_AGENT_CLI_FAILED');
}
