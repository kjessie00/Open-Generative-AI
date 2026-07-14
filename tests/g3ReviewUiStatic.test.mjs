import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const componentPaths = [
    'src/components/pipeline/G3ReviewWorkspace.js',
    'src/components/pipeline/G3ShotNavigator.js',
    'src/components/pipeline/G3CandidatePanel.js',
    'src/components/pipeline/G3SelectionEditor.js',
    'src/components/pipeline/G3PromotionPanel.js',
];

async function source(relativePath) {
    return readFile(new URL(`../${relativePath}`, import.meta.url), 'utf8');
}

test('G3 UI stays focused, responsive, Korean-first, and uses native semantic controls', async () => {
    const components = await Promise.all(componentPaths.map(async (relativePath) => ({
        relativePath,
        content: await source(relativePath),
    })));
    for (const { relativePath, content } of components) {
        assert.ok(content.split(/\r?\n/).length < 200, `${relativePath} must remain a focused component`);
    }
    const combined = components.map(({ content }) => content).join('\n');
    for (const label of [
        'G3 인간 검토 작업대', '초안/비승격', '기계 QC · 읽기 전용', '인간 선택 기록',
        'Production 반영 · 명시적 확인', '프로젝트 ID', 'production에 반영',
    ]) {
        assert.match(combined, new RegExp(label));
    }
    assert.match(combined, /grid-cols-1/);
    assert.match(combined, /md:grid-cols-/);
    assert.match(combined, /min-h-11/);
    assert.match(combined, /el\('(?:button|select|input|textarea|fieldset|label|nav)'/);
    assert.doesNotMatch(combined, /innerHTML\s*=\s*[^'";]*(?:candidate|display_path|notes|reason)/);
    assert.doesNotMatch(combined, /runSafeCommand|previewCommand|child_process|fetch\(/);
    assert.match(combined, /createG3PreviewObjectUrl/);
    assert.doesNotMatch(combined, /data:video|g3PreviewDataUrl/);
});

test('G3 preview CSP permits only local and Blob media while network remains disabled', async () => {
    const html = await source('index.html');
    const csp = html.match(/Content-Security-Policy" content="([^"]+)"/)?.[1] || '';
    assert.match(csp, /media-src 'self' blob: file:/);
    assert.doesNotMatch(csp, /media-src[^;]*(?:data:|https?:)/);
    assert.match(csp, /connect-src 'none'/);
});

test('G3 IPC keeps promotion planning pathless and exposes no generation, upload, ledger, or command channel', async () => {
    const [preload, provider] = await Promise.all([
        source('electron/preload.js'),
        source('electron/lib/filmPipelineProvider.js'),
    ]);
    assert.match(preload, /getG3ReviewWorkspace:\s*\(\)\s*=>/);
    assert.match(preload, /planG3ProductionPromotion:\s*\(\)\s*=>/);
    assert.match(provider, /get-g3-review-workspace'[\s\S]*assertNoRendererPathArgument/);
    assert.match(provider, /plan-g3-production-promotion'[\s\S]*assertNoRendererPathArgument/);
    for (const channel of [
        'get-g3-review-workspace',
        'load-g3-candidate-preview',
        'save-g3-review-draft',
        'export-g3-review-packet',
        'plan-g3-production-promotion',
        'promote-g3-production-selection',
    ]) {
        assert.match(preload, new RegExp(`film-pipeline:${channel}`));
        assert.match(provider, new RegExp(`film-pipeline:${channel}`));
    }
    assert.doesNotMatch(`${preload}\n${provider}`, /film-pipeline:(?:generate|submit|upload|write-ledger|run-g3-command)/i);
});
