import samplePipelineState from '../../lib/pipeline/mockData.js';
import { pipelineClient } from '../../lib/pipeline/client.js';
import { normalizeProductionReaderState } from '../../lib/pipeline/productionNormalizer.js';
import {
    emptyG3ReviewState,
    g3DraftPayload,
    normalizeG3ReviewState,
    updateG3Selection,
} from '../../lib/pipeline/g3ReviewWorkspace.js';
import {
    emptyG3PromotionPlan,
    normalizeG3PromotionPlan,
    staleG3PromotionPlan,
} from '../../lib/pipeline/g3PromotionState.js';
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
    let harnessStatus = {
        readOnly: true,
        readiness: 'blocked',
        ready: false,
        reason: 'status_not_loaded',
        rootPath: '',
        entries: [],
    };
    let newProjectDraftState = {
        status: 'loading',
        draft: {
            production_id: '', brief: '', script: '', route: 'both', aspect_ratio: '9:16', scene_duration: 5, max_scenes: 10,
        },
        readiness: 'blocked',
        blockers: [],
        preview: { ready: false, copyAllowed: false, previewOnly: true, executed: false, shellSafeCommand: '' },
    };
    let newProjectDraftValue = { ...newProjectDraftState.draft };
    let g3Workspace = emptyG3ReviewState();
    let g3ActiveShotId = '';
    let g3PromotionPlan = emptyG3PromotionPlan();

    const render = () => {
        container.innerHTML = '';

        const showPathSelectionBlocked = () => window.alert(p('Folder selection blocked by the local path safety policy.'));

        const refreshNewProjectDraft = async () => {
            try {
                const result = await pipelineClient.getNewProjectDraftState();
                newProjectDraftState = result;
                if (result?.draft) newProjectDraftValue = { ...result.draft };
            } catch {
                newProjectDraftState = {
                    ...newProjectDraftState,
                    status: 'error',
                    readiness: 'blocked',
                    blockers: ['NEW_PROJECT_DRAFT_READ_FAILED'],
                    preview: { ready: false, copyAllowed: false, previewOnly: true, executed: false, shellSafeCommand: '' },
                };
            }
        };

        const openProductionFolder = async () => {
            try {
                const selected = await pipelineClient.selectProductionRoot({ mode: 'production' });
                if (!selected?.ok || selected.canceled) return;
                config = {
                    ...config,
                    ...(selected.config || {}),
                    dryRunMode: true,
                    allowSafeCommandExecution: false,
                };
                const [loaded, g3Loaded, promotionLoaded] = await Promise.all([
                    pipelineClient.readProductionState(),
                    pipelineClient.getG3ReviewWorkspace(),
                    pipelineClient.planG3ProductionPromotion(),
                ]);
                state = normalizeState(loaded?.state);
                g3Workspace = normalizeG3ReviewState(g3Loaded);
                g3PromotionPlan = normalizeG3PromotionPlan(promotionLoaded);
                g3ActiveShotId = g3Workspace.shots[0]?.shot_id || '';
                render();
            } catch {
                showPathSelectionBlocked();
            }
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
            try {
                const result = await pipelineClient.listProductionChildren();
                if (!result?.ok) throw new Error('LIST_PRODUCTIONS_BLOCKED');
                productions = Array.isArray(result.entries) ? result.entries : [];
                productionsState = { status: 'ok', reason: '' };
            } catch {
                productions = [];
                productionsState = { status: 'error', reason: p('Local path safety policy blocked the request.') };
            }
            render();
        };

        const pickParentFolder = async () => {
            try {
                const selected = await pipelineClient.selectProductionRoot({ mode: 'parent' });
                if (!selected?.ok || selected.canceled) return;
                config = {
                    ...config,
                    ...(selected.config || {}),
                    dryRunMode: true,
                    allowSafeCommandExecution: false,
                };
                await refreshProductions();
                await refreshNewProjectDraft();
                render();
            } catch {
                showPathSelectionBlocked();
            }
        };

        const selectProduction = async (path) => {
            if (!path) return;
            try {
                const selected = await pipelineClient.selectProductionRoot({ mode: 'child', rootPath: path });
                if (!selected?.ok) throw new Error('CHILD_SELECTION_BLOCKED');
                config = {
                    ...config,
                    ...(selected.config || {}),
                    dryRunMode: true,
                    allowSafeCommandExecution: false,
                };
                const [loaded, g3Loaded, promotionLoaded] = await Promise.all([
                    pipelineClient.readProductionState(),
                    pipelineClient.getG3ReviewWorkspace(),
                    pipelineClient.planG3ProductionPromotion(),
                ]);
                state = normalizeState(loaded?.state);
                g3Workspace = normalizeG3ReviewState(g3Loaded);
                g3PromotionPlan = normalizeG3PromotionPlan(promotionLoaded);
                g3ActiveShotId = g3Workspace.shots[0]?.shot_id || '';
                render();
            } catch {
                showPathSelectionBlocked();
            }
        };

        const switchTab = (tabId) => {
            if (!TABS.some((tab) => tab.id === tabId)) return;
            activeTab = tabId;
            render();
        };

        const body = el('div', { className: 'pipeline-layout' });
        // The inner panelShell already owns the named section landmark. Keep
        // this scroll container neutral so assistive tech does not announce a
        // duplicate region with the same panel title.
        const panelHost = el('div', { className: 'pipeline-panel-host' });
        const panelContent = el('div', { className: 'pipeline-panel-content' }, [
            PipelineStatusStrip({ state }),
            PipelineSafetySummary(),
            renderPanel(activeTab, state, config, {
                harnessStatus,
                newProjectDraftState,
                newProjectDraftValue,
                onNewProjectDraftChange: (field, value) => {
                    newProjectDraftValue[field] = value;
                },
                onSaveNewProjectDraft: async (draft) => {
                    newProjectDraftState = { ...newProjectDraftState, status: 'saving' };
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectDraft(draft);
                        newProjectDraftState = result;
                        if (result?.draft) newProjectDraftValue = { ...result.draft };
                        window.alert(result?.ok
                            ? p('New project draft saved.')
                            : p('New project draft save was blocked.'));
                    } catch {
                        newProjectDraftState = {
                            ...newProjectDraftState,
                            status: 'error',
                            readiness: 'blocked',
                            blockers: ['NEW_PROJECT_DRAFT_SAVE_FAILED'],
                            preview: { ready: false, copyAllowed: false, previewOnly: true, executed: false, shellSafeCommand: '' },
                        };
                        window.alert(p('New project draft save was blocked.'));
                    }
                    render();
                },
                onCopyNewProjectBuildCommand: async () => {
                    newProjectDraftState = { ...newProjectDraftState, status: 'copying' };
                    render();
                    try {
                        const result = await pipelineClient.copyNewProjectBuildCommand();
                        if (result?.state) {
                            newProjectDraftState = result.state;
                            if (result.state.draft) newProjectDraftValue = { ...result.state.draft };
                        }
                        window.alert(result?.copied && result?.verified
                            ? p('Canonical build command copied.')
                            : p('Canonical build command copy was blocked.'));
                    } catch {
                        newProjectDraftState = {
                            ...newProjectDraftState,
                            status: 'error',
                            readiness: 'blocked',
                            blockers: ['NEW_PROJECT_COMMAND_COPY_FAILED'],
                            preview: { ready: false, copyAllowed: false, previewOnly: true, executed: false, shellSafeCommand: '' },
                        };
                        window.alert(p('Canonical build command copy was blocked.'));
                    }
                    render();
                },
                onSavePlanningFile: async (payload) => {
                    try {
                        const result = await pipelineClient.writePlanningFile(payload);
                        window.alert(result?.ok
                            ? p('Planning file saved: {path}', { path: result.relativePath })
                            : p('Save blocked: {reason}', { reason: p('Planning write safety policy rejected the request.') }));
                    } catch {
                        window.alert(p('Save blocked: {reason}', {
                            reason: p('Planning write safety policy rejected the request.'),
                        }));
                    }
                },
                onPreviewCommand: (commandSpec) => pipelineClient.previewCommand(commandSpec),
                onPickParent: pickParentFolder,
                onRefresh: refreshProductions,
                g3Workspace,
                g3PromotionPlan,
                g3ActiveShotId,
                onG3ActiveShotChange: (shotId) => {
                    g3ActiveShotId = shotId;
                    render();
                },
                onG3SelectionChange: (shotId, field, value) => {
                    g3Workspace = updateG3Selection(g3Workspace, shotId, field, value);
                    g3Workspace = {
                        ...g3Workspace,
                        export_ready: false,
                        validation_blockers: Array.from(new Set([...g3Workspace.validation_blockers, 'G3_UNSAVED_CHANGES'])),
                    };
                    g3PromotionPlan = staleG3PromotionPlan();
                },
                onG3OverallNotesChange: (value) => {
                    g3Workspace = {
                        ...g3Workspace,
                        overall_notes: value,
                        export_ready: false,
                        validation_blockers: Array.from(new Set([...g3Workspace.validation_blockers, 'G3_UNSAVED_CHANGES'])),
                    };
                    g3PromotionPlan = staleG3PromotionPlan();
                },
                onG3Preview: (candidateToken) => pipelineClient.loadG3CandidatePreview({ candidateToken }),
                onG3Save: async () => {
                    const payload = g3DraftPayload(g3Workspace);
                    try {
                        const result = await pipelineClient.saveG3ReviewDraft(payload);
                        g3Workspace = normalizeG3ReviewState(result?.state);
                        g3PromotionPlan = normalizeG3PromotionPlan(await pipelineClient.planG3ProductionPromotion());
                        window.alert(result?.saved ? 'G3 로컬 검토 초안을 저장했습니다.' : 'G3 초안 저장이 차단되었습니다.');
                    } catch {
                        window.alert('G3 초안 저장이 안전 정책에 따라 차단되었습니다.');
                    }
                    render();
                },
                onG3Export: async () => {
                    const payload = g3DraftPayload(g3Workspace);
                    try {
                        const result = await pipelineClient.exportG3ReviewPacket(payload);
                        g3Workspace = normalizeG3ReviewState(result?.state);
                        g3PromotionPlan = normalizeG3PromotionPlan(await pipelineClient.planG3ProductionPromotion());
                        window.alert(result?.exported
                            ? 'canonical 형태의 비승격 G3 초안을 내보냈습니다.'
                            : 'G3 초안 내보내기가 차단되었습니다.');
                    } catch {
                        window.alert('G3 초안 내보내기가 안전 정책에 따라 차단되었습니다.');
                    }
                    render();
                },
                onG3PromotionRefresh: async () => {
                    g3PromotionPlan = emptyG3PromotionPlan();
                    render();
                    try {
                        g3PromotionPlan = normalizeG3PromotionPlan(await pipelineClient.planG3ProductionPromotion());
                    } catch {
                        g3PromotionPlan = staleG3PromotionPlan('G3_PROMOTION_PLAN_FAILED');
                    }
                    render();
                },
                onG3Promote: async (promotionPayload) => {
                    try {
                        const result = await pipelineClient.promoteG3ProductionSelection(promotionPayload);
                        const [loadedState, loadedG3, promotionLoaded] = await Promise.all([
                            pipelineClient.readProductionState(),
                            pipelineClient.getG3ReviewWorkspace(),
                            pipelineClient.planG3ProductionPromotion(),
                        ]);
                        state = normalizeState(loadedState?.state);
                        g3Workspace = normalizeG3ReviewState(loadedG3);
                        g3PromotionPlan = normalizeG3PromotionPlan(promotionLoaded);
                        window.alert(result?.already_current
                            ? 'production selected_takes.json이 이미 현재 선택과 같습니다.'
                            : result?.promoted && result?.executed
                                ? '확인한 사람 선택을 production selected_takes.json에 반영했습니다.'
                                : 'G3 production 반영이 차단되었습니다.');
                    } catch {
                        g3PromotionPlan = staleG3PromotionPlan('G3_PROMOTION_FAILED');
                        window.alert('G3 production 반영이 안전 정책에 따라 차단되었습니다. 계획을 다시 확인하세요.');
                    }
                    render();
                },
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
            onNewProject: () => {
                activeTab = 'intake';
                render();
            },
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
        const [configResult, harnessResult, newProjectResult] = await Promise.allSettled([
            pipelineClient.getConfig(),
            pipelineClient.getHarnessContractStatus(),
            pipelineClient.getNewProjectDraftState(),
        ]);
        if (configResult.status === 'fulfilled') {
            const result = configResult.value;
            loadedConfig = result?.config || result || loadedConfig;
        }
        if (harnessResult.status === 'fulfilled' && harnessResult.value) {
            harnessStatus = harnessResult.value;
        }
        if (newProjectResult.status === 'fulfilled' && newProjectResult.value) {
            newProjectDraftState = newProjectResult.value;
            if (newProjectResult.value.draft) newProjectDraftValue = { ...newProjectResult.value.draft };
        } else {
            newProjectDraftState = {
                ...newProjectDraftState,
                status: 'error',
                blockers: ['NEW_PROJECT_DRAFT_READ_FAILED'],
            };
        }
        config = {
            ...config,
            ...loadedConfig,
            productionRoot: typeof loadedConfig.productionRoot === 'string' ? loadedConfig.productionRoot : '',
            productionParentRoot: typeof loadedConfig.productionParentRoot === 'string' ? loadedConfig.productionParentRoot : '',
            dryRunMode: true,
            allowSafeCommandExecution: false,
        };

        if (config.productionRoot) {
            const [loadedState, loadedG3, loadedPromotion] = await Promise.all([
                pipelineClient.readProductionState().catch(() => ({ state: samplePipelineState })),
                pipelineClient.getG3ReviewWorkspace().catch(() => emptyG3ReviewState('error')),
                pipelineClient.planG3ProductionPromotion().catch(() => staleG3PromotionPlan('G3_PROMOTION_PLAN_FAILED')),
            ]);
            state = normalizeState(loadedState?.state);
            g3Workspace = normalizeG3ReviewState(loadedG3);
            g3PromotionPlan = normalizeG3PromotionPlan(loadedPromotion);
            g3ActiveShotId = g3Workspace.shots[0]?.shot_id || '';
        } else {
            state = samplePipelineState;
            g3Workspace = normalizeG3ReviewState({
                ...emptyG3ReviewState('empty'),
                blockers: ['G3_PRODUCTION_ROOT_NOT_CONFIGURED'],
                validation_blockers: ['G3_PRODUCTION_ROOT_NOT_CONFIGURED'],
            });
            g3PromotionPlan = staleG3PromotionPlan('G3_PRODUCTION_ROOT_NOT_CONFIGURED');
        }
        render();
    })();

    return container;
}
