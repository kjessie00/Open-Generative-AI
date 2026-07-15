#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import designProvider from '../electron/lib/newProjectDesignProvider.js';

const MAX_INPUT_BYTES = 768 * 1024;

function cliError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function parseArguments(argv) {
    const [command, ...rest] = argv;
    const values = {};
    for (let index = 0; index < rest.length; index += 2) {
        const key = rest[index];
        const value = rest[index + 1];
        if (!['--user-data', '--request-id', '--input'].includes(key) || value === undefined || values[key]) {
            throw cliError('DESIGN_AGENT_CLI_ARGUMENT_INVALID');
        }
        values[key] = value;
    }
    const userDataPath = values['--user-data'];
    if (!['prepare', 'publish'].includes(command) || typeof userDataPath !== 'string'
        || !path.isAbsolute(userDataPath) || path.normalize(userDataPath) !== userDataPath) {
        throw cliError('DESIGN_AGENT_CLI_ARGUMENT_INVALID');
    }
    if (command === 'prepare' && Object.keys(values).sort().join(',') !== '--request-id,--user-data') {
        throw cliError('DESIGN_AGENT_CLI_ARGUMENT_INVALID');
    }
    if (command === 'publish' && Object.keys(values).sort().join(',') !== '--input,--user-data') {
        throw cliError('DESIGN_AGENT_CLI_ARGUMENT_INVALID');
    }
    return {
        command,
        userDataPath,
        requestId: values['--request-id'],
        inputPath: values['--input'],
    };
}

function writePrivate(filePath, content) {
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

function readStableInput(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)
        || path.normalize(filePath) !== filePath || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw cliError('DESIGN_AGENT_CLI_INPUT_UNSAFE');
    }
    const before = fs.lstatSync(filePath);
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > MAX_INPUT_BYTES) throw cliError('DESIGN_AGENT_CLI_INPUT_UNSAFE');
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size
            || opened.mtimeMs !== before.mtimeMs || opened.ctimeMs !== before.ctimeMs) {
            throw cliError('DESIGN_AGENT_CLI_INPUT_CHANGED');
        }
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        if (after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) {
            throw cliError('DESIGN_AGENT_CLI_INPUT_CHANGED');
        }
        return buffer;
    } finally { fs.closeSync(descriptor); }
}

function prepare(args) {
    const handoff = designProvider.prepareDesignAgentHandoff(
        { request_id: args.requestId },
        { userDataPath: args.userDataPath },
    );
    const temporaryRoot = fs.realpathSync.native(os.tmpdir());
    const packetRoot = fs.mkdtempSync(path.join(temporaryRoot, 'open-ga-design-handoff-'));
    fs.chmodSync(packetRoot, 0o700);
    writePrivate(
        path.join(packetRoot, 'request.json'),
        `${JSON.stringify({ request: handoff.request, snapshot_manifest: handoff.snapshot.manifest }, null, 2)}\n`,
    );
    writePrivate(path.join(packetRoot, 'brief.md'), `${handoff.snapshot.brief}\n`);
    writePrivate(path.join(packetRoot, 'script.txt'), `${handoff.snapshot.script}\n`);
    writePrivate(path.join(packetRoot, 'design.json'), `${JSON.stringify(handoff.snapshot.board, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify({
        ok: true,
        handle: packetRoot,
        request_id: handoff.request.request_id,
        stage: 'design',
    })}\n`);
}

function publish(args) {
    let input;
    try { input = JSON.parse(readStableInput(args.inputPath).toString('utf8')); }
    catch (error) { if (error.code) throw error; throw cliError('DESIGN_AGENT_CLI_INPUT_INVALID'); }
    const result = designProvider.publishDesignAgentSuggestion(input, { userDataPath: args.userDataPath });
    process.stdout.write(`${JSON.stringify({
        ok: true,
        request_id: result.request_id,
        suggestion_token: result.suggestion_token,
        proposed_board_sha256: result.proposed_board_sha256,
        proposed_board_bytes: result.proposed_board_bytes,
        status: result.status,
        already_published: result.already_published,
    })}\n`);
}

try {
    const args = parseArguments(process.argv.slice(2));
    if (args.command === 'prepare') prepare(args);
    else publish(args);
} catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.code || 'DESIGN_AGENT_CLI_FAILED' })}\n`);
    process.exitCode = 1;
}
