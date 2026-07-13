import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');

test('Korean pipeline information architecture has 11 steps in four groups', () => {
    const studio = read('src/components/pipeline/PipelineStudio.js');
    const sidebar = read('src/components/pipeline/PipelineSidebar.js');

    const tabIds = [...studio.matchAll(/\{ id: '([^']+)', label:/g)].map((match) => match[1]);
    assert.deepEqual(tabIds, [
        'intake',
        'storyboard',
        'shot-designer',
        'motion',
        'assets',
        'prompts',
        'gates',
        'queue',
        'qa',
        'final',
        'settings',
    ]);
    for (const label of ['Planning', 'Production prep', 'Generation and review', 'Finishing']) {
        assert.match(studio, new RegExp(`groupLabel: p\\('${label}'\\)`));
    }
    assert.match(sidebar, /el\('nav',[\s\S]*'aria-label': p\('Pipeline workflow steps'\)/);
    assert.match(sidebar, /'aria-current': activeTab === tab\.id \? 'page'/);
    assert.match(sidebar, /el\('details'/);
    assert.doesNotMatch(sidebar, /['"]open['"]\s*:/, 'production details must default to collapsed');
    assert.doesNotMatch(studio, /el\('main'/, 'the renderer must not create a nested main landmark');
});

test('responsive and accessibility styles cover the required production breakpoints', () => {
    const css = read('src/styles/pipeline.css');
    const activeUi = [
        read('src/components/Header.js'),
        read('src/components/SettingsModal.js'),
        ...fs.readdirSync(path.join(root, 'src/components/pipeline'))
            .filter((name) => name.endsWith('.js'))
            .map((name) => read(`src/components/pipeline/${name}`)),
    ].join('\n');

    assert.match(css, /@media \(max-width: 23rem\)/, '320px-class layout must have compact controls');
    assert.match(css, /@media \(min-width: 48rem\)/, '768px layout must be explicit');
    assert.match(css, /@media \(min-width: 64rem\)/, '1024px layout must switch to grouped sidebar navigation');
    assert.match(css, /max-width: 80rem/, 'wide 1440px layout must cap readable content width');
    assert.match(css, /button:focus-visible[\s\S]*summary:focus-visible/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.doesNotMatch(activeUi, /hover:scale|style\.cssText/, 'active UI must avoid scale effects and inline styling');

    const modal = read('src/components/SettingsModal.js');
    assert.match(modal, /setAttribute\('role', 'dialog'\)/);
    assert.match(modal, /setAttribute\('aria-modal', 'true'\)/);
    assert.match(modal, /setAttribute\('aria-labelledby', 'settings-dialog-title'\)/);
    assert.match(modal, /event\.key === 'Escape'/);
    assert.match(modal, /previousFocus\?\.focus/);
});

test('Korean shell keeps unsafe execution and technical data outside translation', () => {
    const studio = read('src/components/pipeline/PipelineStudio.js');
    const copy = read('src/components/pipeline/copy.js');
    const header = read('src/components/Header.js');

    assert.doesNotMatch(studio, /runSafeCommand|executeCommand|submitGeneration|uploadMedia/);
    assert.match(studio, /pipelineClient\.previewCommand/);
    assert.match(copy, /getLang\(\) === 'ko-KR'/);
    assert.match(copy, /KO\[source\] \|\| source/);
    assert.match(header, /\['ko-KR', '한국어'\]/);
    assert.match(header, /\['en', 'EN'\]/);
    assert.match(header, /\['zh-CN', '中文'\]/);
    assert.doesNotMatch(header, /SettingsModal/);
});
