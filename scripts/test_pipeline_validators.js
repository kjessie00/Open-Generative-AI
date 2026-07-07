#!/usr/bin/env node

const { existsSync, readdirSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const repoRoot = path.resolve(__dirname, '..');
const testFiles = [];
const testsDir = path.join(repoRoot, 'tests');

if (existsSync(testsDir)) {
    readdirSync(testsDir)
        .filter((file) => file.endsWith('.test.js') || file.endsWith('.test.mjs'))
        .sort()
        .forEach((file) => {
            testFiles.push(path.join('tests', file));
        });
}

const pipelineTestsDir = path.join(repoRoot, 'src', 'lib', 'pipeline');
if (existsSync(pipelineTestsDir)) {
    readdirSync(pipelineTestsDir)
        .filter((file) => file.endsWith('.test.js') || file.endsWith('.test.mjs'))
        .sort()
        .forEach((file) => {
            testFiles.push(path.join('src', 'lib', 'pipeline', file));
        });
}

const result = spawnSync(process.execPath, ['--test', ...testFiles], {
    cwd: repoRoot,
    stdio: 'inherit',
});

process.exit(result.status ?? 1);
