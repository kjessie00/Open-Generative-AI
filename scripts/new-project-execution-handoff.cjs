#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const process = require('process');

const executionProvider = require('../electron/lib/newProjectExecutionProvider');

const MAX_INPUT_BYTES = 64 * 1024;

function cliError(code) {
    const error = new Error(code);
    error.code = code;
    return error;
}

function parseArguments(argv) {
    const [command, ...rest] = argv;
    const values = {};
    for (let index = 0; index < rest.length; index += 1) {
        const key = rest[index];
        if (key === '--new-attempt' && !values[key]) {
            values[key] = true;
            continue;
        }
        const value = rest[index + 1];
        if (!['--user-data', '--input'].includes(key) || value === undefined || values[key]) {
            throw cliError('EXECUTION_CLI_ARGUMENT_INVALID');
        }
        values[key] = value;
        index += 1;
    }
    const userDataPath = values['--user-data'];
    if (!['inspect', 'publish', 'publish-replicate-result'].includes(command) || typeof userDataPath !== 'string'
        || !path.isAbsolute(userDataPath) || path.normalize(userDataPath) !== userDataPath) {
        throw cliError('EXECUTION_CLI_ARGUMENT_INVALID');
    }
    const actual = Object.keys(values).sort().join(',');
    if ((command === 'inspect' && !['--user-data', '--new-attempt,--user-data'].includes(actual))
        || (['publish', 'publish-replicate-result'].includes(command)
            && actual !== '--input,--user-data')) {
        throw cliError('EXECUTION_CLI_ARGUMENT_INVALID');
    }
    return {
        command, userDataPath, inputPath: values['--input'], newAttempt: values['--new-attempt'] === true,
    };
}

function sameFile(left, right) {
    return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode
        && left.size === right.size && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
}

function readStableInput(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)
        || path.normalize(filePath) !== filePath || typeof fs.constants.O_NOFOLLOW !== 'number') {
        throw cliError('EXECUTION_CLI_INPUT_UNSAFE');
    }
    let before;
    try { before = fs.lstatSync(filePath); } catch { throw cliError('EXECUTION_CLI_INPUT_UNSAFE'); }
    if (!before.isFile() || before.isSymbolicLink() || (before.mode & 0o777) !== 0o600
        || before.size <= 0 || before.size > MAX_INPUT_BYTES) throw cliError('EXECUTION_CLI_INPUT_UNSAFE');
    const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
        const opened = fs.fstatSync(descriptor);
        if (!sameFile(before, opened)) throw cliError('EXECUTION_CLI_INPUT_CHANGED');
        const buffer = fs.readFileSync(descriptor);
        const after = fs.fstatSync(descriptor);
        const final = fs.lstatSync(filePath);
        if (buffer.byteLength !== before.size || !sameFile(opened, after) || !sameFile(opened, final)) {
            throw cliError('EXECUTION_CLI_INPUT_CHANGED');
        }
        return buffer;
    } finally { fs.closeSync(descriptor); }
}

function inspect(args) {
    const handoff = executionProvider.inspectExecutionHandoff(
        { userDataPath: args.userDataPath },
        { new_attempt: args.newAttempt },
    );
    process.stdout.write(`${JSON.stringify({ ok: true, handoff })}\n`);
}

function publish(args) {
    let receipt;
    try { receipt = JSON.parse(readStableInput(args.inputPath).toString('utf8')); }
    catch (error) { if (error.code) throw error; throw cliError('EXECUTION_CLI_INPUT_INVALID'); }
    const result = executionProvider.publishExecutionReceipt(receipt, { userDataPath: args.userDataPath });
    process.stdout.write(`${JSON.stringify({
        ok: true,
        task_token: receipt.task_token,
        status: receipt.status,
        progress: receipt.progress,
        already_published: result.already_published,
    })}\n`);
}

function publishReplicateResult(args) {
    let metadata;
    try { metadata = JSON.parse(readStableInput(args.inputPath).toString('utf8')); }
    catch (error) { if (error.code) throw error; throw cliError('EXECUTION_CLI_INPUT_INVALID'); }
    const result = executionProvider.publishReplicateResultReceipt(metadata, {
        userDataPath: args.userDataPath,
    });
    process.stdout.write(`${JSON.stringify({
        ok: true,
        task_token: metadata.task_token,
        prediction_id: metadata.prediction_id,
        result_locator: result.result_locator,
        already_published: result.already_published,
    })}\n`);
}

try {
    const args = parseArguments(process.argv.slice(2));
    if (args.command === 'inspect') inspect(args);
    else if (args.command === 'publish') publish(args);
    else publishReplicateResult(args);
} catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error.code || 'EXECUTION_CLI_FAILED' })}\n`);
    process.exitCode = 1;
}
