import samplePipelineState from '../../lib/pipeline/mockData.js';
import { pipelineClient } from '../../lib/pipeline/client.js';
import { normalizeProductionReaderState } from '../../lib/pipeline/productionNormalizer.js';
import { PipelineSidebar } from './PipelineSidebar.js';
import { IntakePanel } from './IntakePanel.js';
import { StoryboardPanel } from './StoryboardPanel.js';
import { ShotDesignerPanel } from './ShotDesignerPanel.js';
import { MotionBoardPanel } from './MotionBoardPanel.js';
import { AssetDashboardPanel } from './AssetDashboardPanel.js';
import { PromptPackPanel } from './PromptPackPanel.js';
import { ReviewGatesPanel } from './ReviewGatesPanel.js';
import { QueuePanel } from './QueuePanel.js';
import { QAPanel } from './QAPanel.js';
import { FinalReportPanel } from './FinalReportPanel.js';
import { PipelineSettingsPanel } from './PipelineSettingsPanel.js';
import { actionButton, card, el, statusBadge } from './ui.js';

const TABS = Object.freeze([
    { id: 'intake', label: 'Intake' },
    { id: 'storyboard', label: 'Storyboard' },
    { id: 'shot-designer', label: 'Shot Designer' },
    { id: 'motion', label: 'Motion Board' },
    { id: 'assets', label: 'Assets' },
    { id: 'prompts', label: 'Prompt Packs' },
    { id: 'gates', label: 'Review Gates' },
    { id: 'queue', label: 'Queue' },
    { id: 'qa', label: 'QA' },
    { id: 'final', label: 'Final' },
    { id: 'settings', label: 'Settings' },
]);

function normalizeState(state) {
    if (state?.project && state?.brief) return state;
    const normalized = normalizeProductionReaderState(state);
    if (normalized) return normalized;
    return {
        ...samplePipelineState,
        bridgeState: state || null,
    };
}

function sideEffectsIndicator() {
    const rows = [
        ['planning files', 'allowed', 'PASS'],
        ['local reads/writes', 'allowed', 'PASS'],
        ['non-consuming status commands', 'preview only', 'PREVIEW'],
        ['image generation', 'blocked', 'BLOCK'],
        ['Dreamina submit', 'blocked', 'BLOCK'],
        ['Gemini review', 'blocked', 'BLOCK'],
        ['external upload', 'blocked', 'BLOCK'],
    ];

    return card([
        el('div', { className: 'mb-3 flex flex-wrap items-center gap-2' }, [
            statusBadge('LOCAL PIPELINE UI — DRY RUN MODE', 'BLOCK'),
            statusBadge(pipelineClient.hasFilmPipelineBridge() ? 'Electron bridge' : 'Mock fallback', 'PREVIEW'),
        ]),
        el('div', { className: 'grid grid-cols-1 gap-2 text-sm md:grid-cols-2 xl:grid-cols-4' }, rows.map(([label, value, status]) => (
            el('div', { className: 'flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 px-3 py-2' }, [
                el('span', { text: label, className: 'text-secondary' }),
                statusBadge(value, status),
            ])
        ))),
    ]);
}

function fileStatusIndicator(state) {
    const status = state.fileStatus || {
        files_found: state.assets?.length || 0,
        content_parsed: [
            state.storyboard?.length,
            state.motionBoard?.length,
            state.promptPacks?.length,
            state.submitRecords?.length,
            state.heartbeatRecords?.length,
        ].filter(Boolean).length,
        review_passed: (state.reviewGates || []).filter((gate) => gate.status === 'PASS').length,
        quality_accepted: (state.acceptedSeconds || []).filter((record) => record.source_file && record.out_time > record.in_time).length,
    };

    return card([
        el('div', { className: 'mb-3 flex flex-wrap items-center gap-2' }, [
            statusBadge('file exists', status.files_found > 0 ? 'PASS' : 'UNREVIEWED'),
            statusBadge('content parsed', status.content_parsed > 0 ? 'PASS' : 'UNREVIEWED'),
            statusBadge('review passed', status.review_passed > 0 ? 'PASS' : 'UNREVIEWED'),
            statusBadge('quality accepted', status.quality_accepted > 0 ? 'PASS' : 'BLOCK'),
        ]),
        el('div', { className: 'grid grid-cols-2 gap-3 text-sm lg:grid-cols-4' }, [
            el('div', { text: `files: ${status.files_found || 0}`, className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-secondary' }),
            el('div', { text: `parsed: ${status.content_parsed || 0}`, className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-secondary' }),
            el('div', { text: `review pass: ${status.review_passed || 0}`, className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-secondary' }),
            el('div', { text: `accepted: ${status.quality_accepted || 0}`, className: 'rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-secondary' }),
        ]),
    ]);
}

function renderPanel(tabId, state, config, actions) {
    const props = { state, config, ...actions };
    if (tabId === 'intake') return IntakePanel(props);
    if (tabId === 'storyboard') return StoryboardPanel(props);
    if (tabId === 'shot-designer') return ShotDesignerPanel(props);
    if (tabId === 'motion') return MotionBoardPanel(props);
    if (tabId === 'assets') return AssetDashboardPanel(props);
    if (tabId === 'prompts') return PromptPackPanel(props);
    if (tabId === 'gates') return ReviewGatesPanel(props);
    if (tabId === 'queue') return QueuePanel(props);
    if (tabId === 'qa') return QAPanel(props);
    if (tabId === 'final') return FinalReportPanel(props);
    if (tabId === 'settings') return PipelineSettingsPanel(props);
    return IntakePanel(props);
}

export function PipelineStudio() {
    const container = el('div', { className: 'flex h-full w-full flex-col overflow-hidden bg-app-bg text-white' });
    let activeTab = 'intake';
    let state = samplePipelineState;
    let config = {
        productionRoot: samplePipelineState.project.root_path,
        productionParentRoot: '',
        dryRunMode: true,
        allowSafeCommandExecution: false,
    };
    let productions = [];
    let productionsState = { status: 'idle', reason: '' };

    const KNOWN_PRODUCTION_PARENT = '/Users/jessiek/StudioProjects/happyVideoFactory/production';

    const render = () => {
        container.innerHTML = '';

        const openProductionFolder = async () => {
            const selected = await pipelineClient.selectProductionRoot();
            if (!selected?.ok || selected.canceled) return;
            config = {
                ...config,
                ...(selected.config || {}),
                productionRoot: selected.rootPath || config.productionRoot,
                dryRunMode: true,
                allowSafeCommandExecution: false,
            };
            const loaded = await pipelineClient.readProductionState(selected.rootPath);
            state = normalizeState(loaded?.state);
            render();
        };

        const refreshProductions = async () => {
            const parentPath = config.productionParentRoot;
            if (!parentPath) {
                productionsState = { status: 'idle', reason: '' };
                productions = [];
                render();
                return;
            }
            productionsState = { status: 'scanning', reason: '' };
            render();
            const result = await pipelineClient.listProductionChildren(parentPath);
            if (result?.ok) {
                productions = Array.isArray(result.entries) ? result.entries : [];
                productionsState = { status: 'ok', reason: '' };
            } else {
                productions = [];
                productionsState = { status: 'error', reason: result?.reason || result?.error || 'unknown' };
            }
            render();
        };

        const pickParentFolder = async () => {
            const selected = await pipelineClient.selectProductionRoot();
            if (!selected?.ok || selected.canceled) return;
            config = {
                ...config,
                ...(selected.config || {}),
                productionParentRoot: selected.rootPath || config.productionParentRoot,
                dryRunMode: true,
                allowSafeCommandExecution: false,
            };
            // Persist to disk via the same bridge
            try {
                await pipelineClient.setConfig(config);
            } catch {}
            await refreshProductions();
        };

        const selectProduction = async (path) => {
            if (!path) return;
            try {
                const loaded = await pipelineClient.readProductionState(path);
                state = normalizeState(loaded?.state);
            } catch {}
            config = {
                ...config,
                productionRoot: path,
            };
            try {
                await pipelineClient.setConfig(config);
            } catch {}
            render();
        };

        const switchTab = (tabId) => {
            activeTab = tabId;
            render();
        };

        const header = el('header', { className: 'shrink-0 border-b border-white/10 bg-black/30 p-5' }, [
            el('div', { className: 'flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between' }, [
                el('div', {}, [
                    el('h1', { text: 'Cinematic Pipeline Studio', className: 'text-3xl font-black tracking-tight text-white' }),
                    el('p', { text: `${state.project?.title || 'Mock production'} · ${state.project?.route || 'seedance'} · ${state.project?.aspect_ratio || '9:16'}`, className: 'mt-2 text-sm text-secondary' }),
                ]),
                el('div', { className: 'flex flex-wrap gap-2' }, [
                    actionButton('Open Production Folder', { onClick: openProductionFolder }),
                    actionButton('Refresh productions', { onClick: refreshProductions, variant: 'muted' }),
                    statusBadge('No live generation', 'BLOCK'),
                    statusBadge('Validators active', 'PASS'),
                    statusBadge(config.dryRunMode !== false ? 'Dry-run locked' : 'Dry-run disabled', config.dryRunMode !== false ? 'PREVIEW' : 'BLOCK'),
                ]),
            ]),
        ]);

        const body = el('div', { className: 'flex min-h-0 flex-1 flex-col lg:flex-row' });
        const panelHost = el('main', { className: 'min-w-0 flex-1 overflow-auto p-5' });
        const panelContent = el('div', { className: 'mx-auto flex max-w-7xl flex-col gap-5' }, [
            sideEffectsIndicator(),
            fileStatusIndicator(state),
            renderPanel(activeTab, state, config, {
                onSavePlanningFile: async (payload) => {
                    const result = await pipelineClient.writePlanningFile(payload);
                    window.alert(result.ok ? `Planning file saved: ${result.relativePath}` : `Save blocked: ${result.error || result.reason}`);
                },
                onPreviewCommand: (commandSpec) => pipelineClient.previewCommand(commandSpec),
                onPickParent: pickParentFolder,
                onRefresh: refreshProductions,
            }),
        ]);

        panelHost.appendChild(panelContent);
        body.appendChild(PipelineSidebar({
            tabs: TABS,
            activeTab,
            productions,
            productionsState,
            onSelect: switchTab,
            onSelectProduction: selectProduction,
            onOpenSettings: () => switchTab('settings'),
            onRefreshProductions: refreshProductions,
        }));
        body.appendChild(panelHost);

        container.appendChild(header);
        container.appendChild(body);
    };

    render();

    (async () => {
        let loadedConfig = config;
        try {
            const result = await pipelineClient.getConfig();
            loadedConfig = result?.config || result || loadedConfig;
        } catch {}
        config = {
            ...config,
            ...loadedConfig,
            productionRoot: typeof loadedConfig.productionRoot === 'string' ? loadedConfig.productionRoot : '',
            productionParentRoot: typeof loadedConfig.productionParentRoot === 'string' ? loadedConfig.productionParentRoot : '',
            dryRunMode: true,
            allowSafeCommandExecution: false,
        };

        // Default-guess: if productionParentRoot is empty and we are in Electron, try
        // the canonical happyVideoFactory path. Silently skip if it does not exist.
        if (!config.productionParentRoot && pipelineClient.hasFilmPipelineBridge()) {
            try {
                const probe = await pipelineClient.listProductionChildren(KNOWN_PRODUCTION_PARENT);
                if (probe?.ok) {
                    config = { ...config, productionParentRoot: KNOWN_PRODUCTION_PARENT };
                    const persisted = await pipelineClient.setConfig(config);
                    config = {
                        ...config,
                        ...(persisted?.config || {}),
                        dryRunMode: true,
                        allowSafeCommandExecution: false,
                    };
                    productions = Array.isArray(probe.entries) ? probe.entries : [];
                    productionsState = { status: 'ok', reason: '' };
                }
            } catch {
                // silently ignore — parent path may not exist on this machine
            }
        }

        if (config.productionRoot) {
            const loadedState = await pipelineClient.readProductionState(config.productionRoot)
                .catch(() => ({ state: samplePipelineState }));
            state = normalizeState(loadedState?.state);
        } else {
            state = samplePipelineState;
        }
        render();
    })();

    return container;
}
