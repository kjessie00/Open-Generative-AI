import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { listProductionChildren } = require('../electron/lib/filmPipelineProvider');

function makeTempDir(prefix) {
    return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function touchFile(filePath, content = '') {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content);
}

function setMtime(filePath, mtime) {
    fs.utimesSync(filePath, mtime, mtime);
}

test('happy path: 3 subdirs mixed with files, sorted by mtime descending', () => {
    const root = makeTempDir('film-list-happy-');

    // Subdir A: oldest, no brief/ledger
    const a = path.join(root, 'ep01_apologist');
    touchFile(path.join(a, 'script.md'), 'a');
    touchFile(path.join(a, 'notes.txt'), 'b');
    fs.utimesSync(a, new Date('2026-07-01T10:00:00Z'), new Date('2026-07-01T10:00:00Z'));

    // Subdir B: middle, has brief.md + jsonl
    const b = path.join(root, 'ep02_rooftop');
    touchFile(path.join(b, 'brief.md'), '# plan');
    touchFile(path.join(b, 'plan.jsonl'), '{}');
    touchFile(path.join(b, 'extra.png'), '');
    fs.utimesSync(b, new Date('2026-07-05T10:00:00Z'), new Date('2026-07-05T10:00:00Z'));

    // Subdir C: newest, has master_plan.md + ledger.csv
    const c = path.join(root, 'ep03_park');
    touchFile(path.join(c, 'master_plan.md'), '# master');
    touchFile(path.join(c, 'ledger.csv'), 'a,b\n1,2');
    fs.utimesSync(c, new Date('2026-07-07T10:00:00Z'), new Date('2026-07-07T10:00:00Z'));

    // Add a non-subdir file (should be ignored)
    touchFile(path.join(root, 'README.md'), 'irrelevant');

    const result = listProductionChildren(root);

    assert.equal(result.ok, true);
    assert.equal(result.rootPath, root);
    assert.equal(result.entries.length, 3);
    assert.deepEqual(
        result.entries.map((entry) => entry.name),
        ['ep03_park', 'ep02_rooftop', 'ep01_apologist'],
    );

    // Verify per-entry fields
    const ep03 = result.entries[0];
    assert.equal(ep03.path, c);
    assert.equal(ep03.fileCount, 2);
    assert.equal(ep03.hasMarkdownBrief, true);
    assert.equal(ep03.hasJsonlLedger, true);

    const ep02 = result.entries[1];
    assert.equal(ep02.path, b);
    assert.equal(ep02.fileCount, 3);
    assert.equal(ep02.hasMarkdownBrief, true);
    assert.equal(ep02.hasJsonlLedger, true);

    const ep01 = result.entries[2];
    assert.equal(ep01.path, a);
    assert.equal(ep01.fileCount, 2);
    assert.equal(ep01.hasMarkdownBrief, false);
    assert.equal(ep01.hasJsonlLedger, false);

    fs.rmSync(root, { recursive: true, force: true });
});

test('edge: parent path does not exist throws a clear error', () => {
    const missing = path.join(os.tmpdir(), `film-list-missing-${Date.now()}-${Math.random().toString(36).slice(2)}`);

    assert.throws(
        () => listProductionChildren(missing),
        /Production root does not exist or is not a directory/,
    );
});

test('edge: zero subdirs returns empty array', () => {
    const root = makeTempDir('film-list-empty-');
    // Only a loose file, no subdirs at all
    touchFile(path.join(root, 'lone.md'), 'lone');

    const result = listProductionChildren(root);

    assert.equal(result.ok, true);
    assert.equal(result.rootPath, root);
    assert.deepEqual(result.entries, []);

    fs.rmSync(root, { recursive: true, force: true });
});

test('edge: subdirs whose stat fails are skipped, others are still returned', () => {
    const root = makeTempDir('film-list-skip-');

    // A readable subdir
    const a = path.join(root, 'good_subdir');
    touchFile(path.join(a, 'a.md'), 'a');
    fs.utimesSync(a, new Date('2026-07-01T10:00:00Z'), new Date('2026-07-01T10:00:00Z'));

    // A subdir that is deleted between readdir and stat (race-like condition)
    const b = path.join(root, 'ghost_subdir');
    fs.mkdirSync(b);
    fs.rmSync(b, { recursive: true, force: true });

    // Another readable subdir to ensure sorting still works
    const c = path.join(root, 'better_subdir');
    touchFile(path.join(c, 'c.md'), 'c');
    fs.utimesSync(c, new Date('2026-07-08T10:00:00Z'), new Date('2026-07-08T10:00:00Z'));

    const result = listProductionChildren(root);

    assert.equal(result.ok, true);
    assert.equal(result.entries.length, 2);
    const names = result.entries.map((entry) => entry.name);
    assert.deepEqual(names, ['better_subdir', 'good_subdir']);
    assert.ok(!names.includes('ghost_subdir'));

    fs.rmSync(root, { recursive: true, force: true });
});

test('edge: parent passed as relative path is resolved and listed', () => {
    const root = makeTempDir('film-list-rel-');
    const sub = path.join(root, 'relprod');
    touchFile(path.join(sub, 'brief.md'), '# plan');
    fs.utimesSync(sub, new Date('2026-07-02T10:00:00Z'), new Date('2026-07-02T10:00:00Z'));

    const rel = path.relative(process.cwd(), root);
    const result = listProductionChildren(rel);

    assert.equal(result.ok, true);
    assert.equal(result.entries.length, 1);
    assert.equal(result.entries[0].name, 'relprod');
    assert.equal(result.entries[0].hasMarkdownBrief, true);

    fs.rmSync(root, { recursive: true, force: true });
});
