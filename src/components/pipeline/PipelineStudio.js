import samplePipelineState from '../../lib/pipeline/mockData.js';
import { pipelineClient } from '../../lib/pipeline/client.js';
import { normalizeProductionReaderState } from '../../lib/pipeline/productionNormalizer.js';
import { PipelineSidebar } from './PipelineSidebar.js';
import { PipelineProjectBar } from './PipelineProjectBar.js';
import { PipelineSafetySummary } from './PipelineSafetySummary.js';
import { PipelineStatusStrip } from './PipelineStatusStrip.js';
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
import { el } from './ui.js';
import { p } from './copy.js';

const TABS = Object.freeze([
    { id: 'intake', label: p('Project'), panelTitle: p('Project overview'), group: 'planning', groupLabel: p('Planning') },
    { id: 'storyboard', label: p('Storyboard'), panelTitle: p('Storyboard'), group: 'planning', groupLabel: p('Planning') },
    { id: 'shot-designer', label: p('Shot design'), panelTitle: p('Shot Design'), group: 'planning', groupLabel: p('Planning') },
    { id: 'motion', label: p('Motion board'), panelTitle: p('Motion Board'), group: 'prep', groupLabel: p('Production prep') },
    { id: 'assets', label: p('Reference images'), panelTitle: p('First Frames And References'), group: 'prep', groupLabel: p('Production prep') },
    { id: 'prompts', label: p('Prompt packs'), panelTitle: p('Prompt Packs'), group: 'prep', groupLabel: p('Production prep') },
    { id: 'gates', label: p('Review gates'), panelTitle: p('Review Gates'), group: 'review', groupLabel: p('Generation and review') },
    { id: 'queue', label: p('Generation queue'), panelTitle: p('Generation Queue'), group: 'review', groupLabel: p('Generation and review') },
    { id: 'qa', label: p('Clip QA'), panelTitle: p('Clip QA And Accepted Ranges'), group: 'review', groupLabel: p('Generation and review') },
    { id: 'final', label: p('Final edit'), panelTitle: p('Final Edit And Report'), group: 'finish', groupLabel: p('Finishing') },
    { id: 'settings', label: p('Settings'), panelTitle: p('Pipeline Settings'), group: 'finish', groupLabel: p('Finishing') },
]);

function normalizeState(state) {
    if (state?.project && state?.brief) return state;
    const normalized = normalizeProductionReaderState(state);
    if (normalized) return normalized;
    return { ...samplePipelineState, bridgeState: state || null };
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
    const container = el('div', { className: 'pipeline-studio' });
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
    const knownProductionParent = '/Users/jessiek/StudioProjects/happyVideoFactory/production';

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
            config = { ...config, productionRoot: path };
            try {
                await pipelineClient.setConfig(config);
            } catch {}
            render();
        };

        const switchTab = (tabId) => {
            if (!TABS.some((tab) => tab.id === tabId)) return;
            activeTab = tabId;
            render();
        };

        const body = el('div', { className: 'pipeline-layout' });
        const panelHost = el('section', {
            className: 'pipeline-panel-host',
            attrs: { 'aria-label': TABS.find((tab) => tab.id === activeTab)?.panelTitle },
        });
        const panelContent = el('div', { className: 'pipeline-panel-content' }, [
            PipelineStatusStrip({ state }),
            PipelineSafetySummary(),
            renderPanel(activeTab, state, config, {
                onSavePlanningFile: async (payload) => {
                    const result = await pipelineClient.writePlanningFile(payload);
                    window.alert(result.ok
                        ? p('Planning file saved: {path}', { path: result.relativePath })
                        : p('Save blocked: {reason}', { reason: result.error || result.reason }));
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

        container.appendChild(PipelineProjectBar({
            state,
            onOpenProduction: openProductionFolder,
            onRefreshProductions: refreshProductions,
        }));
        container.appendChild(body);
    };

    const onPipelineNavigate = (event) => {
        if (event?.detail?.tab && TABS.some((tab) => tab.id === event.detail.tab)) {
            activeTab = event.detail.tab;
            render();
        }
    };
    container.addEventListener('pipeline:navigate', onPipelineNavigate);
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

        if (!config.productionParentRoot && pipelineClient.hasFilmPipelineBridge()) {
            try {
                const probe = await pipelineClient.listProductionChildren(knownProductionParent);
                if (probe?.ok) {
                    config = { ...config, productionParentRoot: knownProductionParent };
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
            } catch {}
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
