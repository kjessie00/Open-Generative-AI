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
import {
    emptyFinishingWorkspace,
    finishingExecutionState,
    normalizeFinishingWorkspace,
} from '../../lib/pipeline/finishingWorkbenchState.js';
import { deriveWorkflowGuide, stageForTab, WORKFLOW_STAGES } from '../../lib/pipeline/workflowGuide.js';
import { PipelineSidebar } from './PipelineSidebar.js';
import { WorkflowOverview } from './WorkflowOverview.js';
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

const PANEL_IDS = new Set([
    'overview', 'settings',
    ...WORKFLOW_STAGES.flatMap((stage) => stage.tabs.map((tab) => tab.id)),
]);

function normalizeState(state) {
    if (state?.project && state?.brief) return state;
    const normalized = normalizeProductionReaderState(state);
    if (normalized) return normalized;
    return { ...samplePipelineState, bridgeState: state || null };
}

function emptyMediaRetryPlan(status = 'empty', blocker = '') {
    return {
        schema: 'film_pipeline.media_retry_plan.v1',
        execution: 'not_run',
        status,
        ready: false,
        preview_ready: false,
        execution_ready: false,
        blockers: blocker ? [blocker] : [],
        items: [],
        executed: false,
    };
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
    let activeTab = 'overview';
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
    let finishingWorkspace = emptyFinishingWorkspace();
    let finishingExecution = finishingExecutionState();
    let mediaRetryPlan = emptyMediaRetryPlan();
    let mediaReviewSaveStatus = '';

    const render = () => {
        container.innerHTML = '';
        if (typeof CustomEvent === 'function') {
            window.dispatchEvent(new CustomEvent('pipeline:project-title', {
                detail: { title: state.project?.title || '' },
            }));
        }

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
                const [loaded, retryPlanLoaded, g3Loaded, promotionLoaded, finishingLoaded] = await Promise.all([
                    pipelineClient.readProductionState(),
                    pipelineClient.getMediaRetryPlan().catch(() => emptyMediaRetryPlan('blocked', 'MEDIA_RETRY_PLAN_READ_FAILED')),
                    pipelineClient.getG3ReviewWorkspace(),
                    pipelineClient.planG3ProductionPromotion(),
                    pipelineClient.getFinishingWorkspace(),
                ]);
                state = normalizeState(loaded?.state);
                mediaRetryPlan = retryPlanLoaded;
                mediaReviewSaveStatus = '';
                g3Workspace = normalizeG3ReviewState(g3Loaded);
                g3PromotionPlan = normalizeG3PromotionPlan(promotionLoaded);
                finishingWorkspace = normalizeFinishingWorkspace(finishingLoaded);
                finishingExecution = finishingExecutionState();
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
                const [loaded, retryPlanLoaded, g3Loaded, promotionLoaded, finishingLoaded] = await Promise.all([
                    pipelineClient.readProductionState(),
                    pipelineClient.getMediaRetryPlan().catch(() => emptyMediaRetryPlan('blocked', 'MEDIA_RETRY_PLAN_READ_FAILED')),
                    pipelineClient.getG3ReviewWorkspace(),
                    pipelineClient.planG3ProductionPromotion(),
                    pipelineClient.getFinishingWorkspace(),
                ]);
                state = normalizeState(loaded?.state);
                mediaRetryPlan = retryPlanLoaded;
                mediaReviewSaveStatus = '';
                g3Workspace = normalizeG3ReviewState(g3Loaded);
                g3PromotionPlan = normalizeG3PromotionPlan(promotionLoaded);
                finishingWorkspace = normalizeFinishingWorkspace(finishingLoaded);
                finishingExecution = finishingExecutionState();
                g3ActiveShotId = g3Workspace.shots[0]?.shot_id || '';
                render();
            } catch {
                showPathSelectionBlocked();
            }
        };

        const switchTab = (tabId) => {
            if (!PANEL_IDS.has(tabId)) return;
            activeTab = tabId;
            render();
        };

        const guide = deriveWorkflowGuide(state);
        const activeStageId = stageForTab(activeTab)?.id || guide.activeStageId;
        const switchStage = (stageId) => {
            const stage = WORKFLOW_STAGES.find((item) => item.id === stageId);
            if (stage?.tabs[0]) switchTab(stage.tabs[0].id);
        };

        const body = el('div', { className: 'pipeline-layout' });
        // The inner panelShell already owns the named section landmark. Keep
        // this scroll container neutral so assistive tech does not announce a
        // duplicate region with the same panel title.
        const panelHost = el('div', { className: 'pipeline-panel-host' });
        const panelContent = el('div', { className: 'pipeline-panel-content' }, [
            activeTab === 'overview'
                ? WorkflowOverview({ state, onNavigate: switchTab })
                : renderPanel(activeTab, state, config, {
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
                        return result;
                    } catch {
                        window.alert(p('Save blocked: {reason}', {
                            reason: p('Planning write safety policy rejected the request.'),
                        }));
                        return { ok: false, written: false, executed: false };
                    }
                },
                mediaRetryPlan,
                mediaReviewSaveStatus,
                onMediaReviewSaveStatusChange: (status) => {
                    mediaReviewSaveStatus = status;
                },
                onRefreshMediaRetryPlan: async () => {
                    mediaRetryPlan = emptyMediaRetryPlan('loading');
                    render();
                    try {
                        mediaRetryPlan = await pipelineClient.getMediaRetryPlan();
                    } catch {
                        mediaRetryPlan = emptyMediaRetryPlan('blocked', 'MEDIA_RETRY_PLAN_READ_FAILED');
                    }
                    render();
                    return mediaRetryPlan;
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
                            ? 'production의 canonical selected-takes commit graph가 이미 현재 선택과 같습니다.'
                            : result?.promoted && result?.executed
                                ? '확인한 사람 선택을 production의 canonical commit graph에 반영했습니다.'
                                : 'G3 production 반영이 차단되었습니다.');
                    } catch {
                        g3PromotionPlan = staleG3PromotionPlan('G3_PROMOTION_FAILED');
                        window.alert('G3 production 반영이 안전 정책에 따라 차단되었습니다. 계획을 다시 확인하세요.');
                    }
                    render();
                },
                finishingWorkspace,
                finishingExecution,
                onFinishingRefresh: async () => {
                    finishingWorkspace = emptyFinishingWorkspace('loading');
                    finishingExecution = finishingExecutionState();
                    render();
                    try {
                        finishingWorkspace = normalizeFinishingWorkspace(await pipelineClient.getFinishingWorkspace());
                    } catch {
                        finishingWorkspace = normalizeFinishingWorkspace({
                            status: 'error',
                            blockers: ['FINISHING_WORKSPACE_LOAD_FAILED'],
                        }, 'error');
                    }
                    render();
                },
                onFinishingPlan: async () => {
                    finishingWorkspace = { ...finishingWorkspace, status: 'loading', ready_to_plan: false };
                    finishingExecution = finishingExecutionState();
                    render();
                    try {
                        finishingWorkspace = normalizeFinishingWorkspace(await pipelineClient.planFinishingRun());
                    } catch {
                        finishingWorkspace = normalizeFinishingWorkspace({
                            status: 'error',
                            blockers: ['FINISHING_PLAN_FAILED'],
                        }, 'error');
                    }
                    render();
                },
                onFinishingExecute: async (payload) => {
                    finishingExecution = finishingExecutionState('executing');
                    render();
                    try {
                        const result = await pipelineClient.executeFinishingRun(payload);
                        finishingExecution = finishingExecutionState('success', result);
                        const [loadedState, loadedWorkspace] = await Promise.all([
                            pipelineClient.readProductionState(),
                            pipelineClient.getFinishingWorkspace(),
                        ]);
                        state = normalizeState(loadedState?.state);
                        finishingWorkspace = normalizeFinishingWorkspace(loadedWorkspace);
                    } catch (error) {
                        finishingExecution = finishingExecutionState(
                            'error',
                            null,
                            /^FINISHING_[A-Z0-9_]+/.exec(error?.message || '')?.[0] || 'FINISHING_EXECUTION_FAILED',
                        );
                        finishingWorkspace = {
                            ...finishingWorkspace,
                            status: 'error',
                            ready: false,
                            plan_token: '',
                        };
                    }
                    render();
                },
                }),
        ]);

        panelHost.appendChild(panelContent);
        body.appendChild(PipelineSidebar({
            stages: guide.stages,
            activeStageId,
            activeTab,
            productions,
            productionsState,
            onSelect: switchTab,
            onSelectStage: switchStage,
            onSelectProduction: selectProduction,
            onNewProject: () => switchTab('intake'),
            onOpenProduction: openProductionFolder,
            onRefreshProductions: refreshProductions,
        }));
        body.appendChild(panelHost);

        container.appendChild(body);
    };

    const onPipelineNavigate = (event) => {
        if (event?.detail?.tab && PANEL_IDS.has(event.detail.tab)) {
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
            const [loadedState, loadedRetryPlan, loadedG3, loadedPromotion, loadedFinishing] = await Promise.all([
                pipelineClient.readProductionState().catch(() => ({ state: samplePipelineState })),
                pipelineClient.getMediaRetryPlan().catch(() => emptyMediaRetryPlan('blocked', 'MEDIA_RETRY_PLAN_READ_FAILED')),
                pipelineClient.getG3ReviewWorkspace().catch(() => emptyG3ReviewState('error')),
                pipelineClient.planG3ProductionPromotion().catch(() => staleG3PromotionPlan('G3_PROMOTION_PLAN_FAILED')),
                pipelineClient.getFinishingWorkspace().catch(() => ({ status: 'error', blockers: ['FINISHING_WORKSPACE_LOAD_FAILED'] })),
            ]);
            state = normalizeState(loadedState?.state);
            mediaRetryPlan = loadedRetryPlan;
            g3Workspace = normalizeG3ReviewState(loadedG3);
            g3PromotionPlan = normalizeG3PromotionPlan(loadedPromotion);
            finishingWorkspace = normalizeFinishingWorkspace(loadedFinishing);
            g3ActiveShotId = g3Workspace.shots[0]?.shot_id || '';
        } else {
            state = samplePipelineState;
            mediaRetryPlan = emptyMediaRetryPlan('empty', 'MEDIA_RETRY_PRODUCTION_ROOT_NOT_CONFIGURED');
            g3Workspace = normalizeG3ReviewState({
                ...emptyG3ReviewState('empty'),
                blockers: ['G3_PRODUCTION_ROOT_NOT_CONFIGURED'],
                validation_blockers: ['G3_PRODUCTION_ROOT_NOT_CONFIGURED'],
            });
            g3PromotionPlan = staleG3PromotionPlan('G3_PRODUCTION_ROOT_NOT_CONFIGURED');
            finishingWorkspace = normalizeFinishingWorkspace({
                status: 'empty',
                blockers: ['FINISHING_PRODUCTION_ROOT_NOT_CONFIGURED'],
            }, 'empty');
        }
        render();
    })();

    return container;
}
