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
import { createG3PreviewObjectUrl } from '../../lib/pipeline/g3PreviewObjectUrl.js';
import { createFinalRenderStreamPreview } from '../../lib/pipeline/finalRenderStreamPreview.js';
import { PipelineSidebar } from './PipelineSidebar.js';
import { WorkflowOverview } from './WorkflowOverview.js';
import { IntakePanel } from './IntakePanel.js';
import { StoryboardPanel } from './StoryboardPanel.js';
import { ShotDesignerPanel } from './ShotDesignerPanel.js';
import { MotionBoardPanel } from './MotionBoardPanel.js';
import { GenerationPreparationPanel } from './GenerationPreparationPanel.js';
import { VideoPreparationPanel } from './VideoPreparationPanel.js';
import { NewProjectExecutionPanel } from './NewProjectExecutionPanel.js';
import { PromptPackPanel } from './PromptPackPanel.js';
import { ReviewGatesPanel } from './ReviewGatesPanel.js';
import { QueuePanel } from './QueuePanel.js';
import { QAPanel } from './QAPanel.js';
import { FinalReportPanel } from './FinalReportPanel.js';
import { PipelineSettingsPanel } from './PipelineSettingsPanel.js';
import { el } from './ui.js';
import { p } from './copy.js';

const EMPTY_PIPELINE_STATE = Object.freeze({
    project: Object.freeze({
        production_id: '', title: '', root_path: '', route: 'both', target_platform: '',
        aspect_ratio: '9:16', status: 'empty', created_at: '', updated_at: '',
    }),
    brief: Object.freeze({}),
    storyboard: Object.freeze([]),
    motionBoard: Object.freeze([]),
    imageDashboard: Object.freeze({ path: '', updated_at: '', stale: false, assets: Object.freeze([]) }),
    assets: Object.freeze([]),
    mediaAttempts: Object.freeze([]),
    promptPacks: Object.freeze([]),
    reviewGates: Object.freeze([]),
    submitRecords: Object.freeze([]),
    heartbeatRecords: Object.freeze([]),
    qaRecords: Object.freeze([]),
    acceptedSeconds: Object.freeze([]),
    finalReport: Object.freeze({ blockers: Object.freeze([]), clip_table: Object.freeze([]) }),
    referenceMediaPaths: Object.freeze([]),
    queueLedgers: Object.freeze({}),
    qaArtifacts: Object.freeze({ contactSheetPaths: Object.freeze([]), frameSamplePaths: Object.freeze([]) }),
    settings: Object.freeze({
        harnessDocs: Object.freeze({
            shorts: 'docs/harness/shorts-SKILL.md',
            seedance: 'docs/harness/Seedance2-SKILL.md',
        }),
    }),
    fileEvidence: Object.freeze({}),
    fileStatus: Object.freeze({ files_found: 0, content_parsed: 0, review_passed: 0, quality_accepted: 0 }),
});

const PANEL_IDS = new Set([
    'overview', 'settings',
    ...WORKFLOW_STAGES.flatMap((stage) => stage.tabs.map((tab) => tab.id)),
]);

const NEW_PROJECT_PANEL_STATE_PROPS = Object.freeze([
    'newProjectDraftState', 'newProjectDraftValue', 'newProjectNotice', 'newProjectDraftDirty',
    'newProjectDesignState', 'newProjectDesignBoard', 'newProjectDesignDirty', 'newProjectDesignNotice',
    'imagePlanState', 'imagePlanTasks', 'imageReviewDecisions', 'imagePlanDirty', 'imagePlanNotice',
    'imageResultWorkspace', 'imageResultPreviews',
    'videoPlanState', 'videoPlanTasks', 'videoReviewDecisions', 'videoPlanDirty', 'videoPlanNotice',
    'videoResultWorkspace', 'videoResultPreviews',
    'newProjectClipSelectionState', 'newProjectClipSelections', 'newProjectClipSelectionDirty',
    'newProjectClipSelectionNotice', 'newProjectFinalStitchState', 'newProjectFinalStitchNotice',
    'newProjectFinalRenderState', 'newProjectFinalRenderNotice', 'newProjectFinalRenderPreviewSource',
    'newProjectMediaReviewFilter', 'mediaReviewRetryNotice',
    'executionState', 'executionNotice', 'executionRefreshing',
]);

function normalizeState(state) {
    if (state?.project && state?.brief) return state;
    const normalized = normalizeProductionReaderState(state);
    if (normalized) return normalized;
    return { ...EMPTY_PIPELINE_STATE, bridgeState: state || null };
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

function emptyDstBundleImportWorkspace(status = 'empty', blocker = '') {
    return {
        status,
        blockers: blocker ? [blocker] : [],
        candidates: [],
    };
}

function emptyDstBundleImportPreview(status = 'empty', blocker = '') {
    return {
        status,
        ready: false,
        candidate_token: '',
        preview: null,
        blockers: blocker ? [blocker] : [],
    };
}

async function readDstBundleImportState(preferredBundleId = '') {
    const workspace = await pipelineClient.getDstBundleImportWorkspace();
    const preferred = workspace?.candidates?.find((candidate) => candidate.bundle_id === preferredBundleId);
    const candidateToken = preferred?.candidate_token || workspace?.candidates?.[0]?.candidate_token || '';
    let preview = emptyDstBundleImportPreview();
    if (candidateToken) {
        preview = await pipelineClient.loadDstBundleImportPreview({ candidateToken })
            .catch(() => emptyDstBundleImportPreview('blocked', 'DST_BUNDLE_IMPORT_PREVIEW_READ_FAILED'));
    }
    return { workspace, preview };
}

function emptyDstBundleImportPlan(status = 'empty', blocker = '') {
    return {
        status,
        ready: false,
        already_current: false,
        plan_token: '',
        retry_media_id: '',
        target_id: '',
        source_bundle_id: '',
        blockers: blocker ? [blocker] : [],
        executed: false,
    };
}

function emptyVideoResultImportWorkspace(status = 'empty', blocker = '') {
    return {
        status,
        ready: false,
        blockers: blocker ? [blocker] : [],
        candidates: [],
        initial_targets: [],
    };
}

function emptyVideoResultImportPlan(status = 'empty', blocker = '') {
    return {
        status,
        ready: false,
        already_current: false,
        plan_token: '',
        retry_media_id: '',
        target_id: '',
        source_result_id: '',
        blockers: blocker ? [blocker] : [],
        executed: false,
    };
}

function emptyNewProjectDesignState(status = 'empty', blocker = '') {
    return {
        status,
        board: { characters: [], locations: [], scenes: [] },
        revision_sha256: '',
        planning_revision_sha256: '',
        collaboration: {
            status: 'empty', recent_requests: [], blockers: blocker ? [blocker] : [],
        },
        blockers: blocker ? [blocker] : [],
    };
}

function emptyNewProjectImagePlanState(status = 'empty', blocker = '') {
    return {
        ok: false,
        status,
        design_revision_sha256: '',
        revision_sha256: '', review_decisions: [], review_blockers: blocker ? [blocker] : [],
        tasks: [],
        preparation: { status: 'empty', items: [], executed: false, model_called: false },
        blockers: blocker ? [blocker] : [],
    };
}

function emptyNewProjectImageResultWorkspace(status = 'empty', blocker = '') {
    return { status, candidates: [], blockers: blocker ? [blocker] : [] };
}

function emptyNewProjectVideoPlanState(status = 'empty', blocker = '') {
    return {
        ok: false, status, design_revision_sha256: '', image_plan_revision_sha256: '', revision_sha256: '', tasks: [],
        review_decisions: [], review_blockers: blocker ? [blocker] : [],
        preparation: { status: 'empty', items: [], executed: false, model_called: false },
        blockers: blocker ? [blocker] : [],
    };
}

function emptyNewProjectVideoResultWorkspace(status = 'empty', blocker = '') {
    return { status, candidates: [], blockers: blocker ? [blocker] : [] };
}

function emptyNewProjectClipSelectionState(status = 'empty', blocker = '') {
    return {
        ok: false, status, design_revision_sha256: '', image_plan_revision_sha256: '',
        video_plan_revision_sha256: '', revision_sha256: '', clips: [], accepted_count: 0,
        total_count: 0, blockers: blocker ? [blocker] : [], executed: false, generation_executed: false,
    };
}

function emptyNewProjectFinalStitchState(status = 'empty', blocker = '') {
    return {
        ok: false, status, revision: '', staged: false, selected_count: 0,
        total_duration_seconds: 0, clips: [], blockers: blocker ? [blocker] : [],
        executed: false, rendered: false, generation_executed: false,
    };
}

function emptyNewProjectFinalRenderState(status = 'loading') {
    return {
        ok: false, status, can_render: false, rendered: false, selected_count: 0,
        selected_duration_seconds: 0, output_duration_seconds: 0,
        fresh_probe_verified: false, has_video: false, has_audio: false, preview_ready: false,
        executed: false, output_quality_approved: false, generation_executed: false,
        review_version: '', review_decision: 'pending', review_ready: false, human_review_recorded: false,
        legacy_production_modified: false, canonical_delivery_modified: false,
        notice: '',
    };
}

function emptyNewProjectExecutionState(status = 'empty', blocker = '') {
    return {
        ok: false,
        status,
        status_label: status === 'loading' ? '확인 중' : '준비 전',
        tasks: [],
        summary: { queued: 0, running: 0, succeeded: 0, failed: 0 },
        blockers: blocker ? [blocker] : [],
        executed: false,
        model_called: false,
        generation_executed: false,
    };
}

function renderPanel(tabId, state, config, actions, workspaceMode) {
    if (workspaceMode === 'production' && tabId === 'intake') {
        return IntakePanel({ state, config, onSavePlanningFile: actions.onSavePlanningFile, productionOnly: true });
    }
    const props = { state, config, ...actions };
    if (workspaceMode === 'production') {
        NEW_PROJECT_PANEL_STATE_PROPS.forEach((key) => delete props[key]);
    }
    if (tabId === 'intake') return IntakePanel(props);
    if (tabId === 'storyboard') return StoryboardPanel(props);
    if (tabId === 'shot-designer') return ShotDesignerPanel(props);
    if (tabId === 'motion') return MotionBoardPanel(props);
    if (tabId === 'assets') return GenerationPreparationPanel(props);
    if (tabId === 'videos') return VideoPreparationPanel(props);
    if (tabId === 'progress') return NewProjectExecutionPanel(props);
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
    let workspaceMode = 'new-project';
    let workspaceModeExplicit = false;
    let state = EMPTY_PIPELINE_STATE;
    let config = {
        productionRoot: '',
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
    let newProjectDraftDirty = { brief: false, script: false, settings: false };
    let newProjectNotice = '';
    let newProjectDesignState = emptyNewProjectDesignState('loading');
    let newProjectDesignBoard = { characters: [], locations: [], scenes: [] };
    let newProjectDesignDirty = false;
    let newProjectDesignNotice = '';
    let newProjectImagePlanState = emptyNewProjectImagePlanState('loading');
    let newProjectImagePlanTasks = [];
    let newProjectImagePlanDirty = false;
    let newProjectImagePlanNotice = '';
    let newProjectImageResultWorkspace = emptyNewProjectImageResultWorkspace('loading');
    let newProjectImageResultPreviews = {};
    let newProjectVideoPlanState = emptyNewProjectVideoPlanState('loading');
    let newProjectVideoPlanTasks = [];
    let newProjectVideoPlanDirty = false;
    let newProjectVideoPlanNotice = '';
    let newProjectVideoResultWorkspace = emptyNewProjectVideoResultWorkspace('loading');
    let newProjectVideoResultPreviews = {};
    let newProjectClipSelectionState = emptyNewProjectClipSelectionState('loading');
    let newProjectClipSelections = [];
    let newProjectClipSelectionDirty = false;
    let newProjectClipSelectionNotice = '';
    let newProjectFinalStitchState = emptyNewProjectFinalStitchState('loading');
    let newProjectFinalStitchNotice = '';
    let newProjectFinalRenderState = emptyNewProjectFinalRenderState();
    let newProjectFinalRenderNotice = '';
    let newProjectFinalRenderPreview = { source: '', dispose() {} };
    let newProjectFinalRenderRequestEpoch = 0;
    let newProjectMediaReviewFilter = 'all';
    let newProjectMediaReviewRetryNotice = '';
    let newProjectExecutionState = emptyNewProjectExecutionState('loading');
    let newProjectExecutionNotice = '';
    let newProjectExecutionRefreshing = false;
    const newProjectStateEpochs = {
        draft: 0,
        design: 0,
        image: 0,
        video: 0,
        clip: 0,
        finalStitch: 0,
        execution: 0,
    };
    let newProjectImagePreviewEpoch = 0;
    let newProjectVideoPreviewEpoch = 0;
    let g3Workspace = emptyG3ReviewState();
    let g3ActiveShotId = '';
    let g3PromotionPlan = emptyG3PromotionPlan();
    let finishingWorkspace = emptyFinishingWorkspace();
    let finishingExecution = finishingExecutionState();
    let mediaRetryPlan = emptyMediaRetryPlan();
    let dstBundleImportWorkspace = emptyDstBundleImportWorkspace();
    let dstBundleImportPreview = emptyDstBundleImportPreview();
    let dstBundleImportPlan = emptyDstBundleImportPlan();
    let videoResultImportWorkspace = emptyVideoResultImportWorkspace();
    let videoResultImportPlan = emptyVideoResultImportPlan();
    let mediaReviewSaveStatus = '';

    const bumpNewProjectStateEpoch = (key) => {
        newProjectStateEpochs[key] += 1;
        if (key === 'image') newProjectImagePreviewEpoch += 1;
        if (key === 'video') newProjectVideoPreviewEpoch += 1;
        return newProjectStateEpochs[key];
    };
    const isLatestNewProjectStateEpoch = (key, epoch) => newProjectStateEpochs[key] === epoch;

    const beginNewProjectFinalRenderRequest = () => {
        newProjectFinalRenderRequestEpoch += 1;
        return newProjectFinalRenderRequestEpoch;
    };

    const isLatestNewProjectFinalRenderRequest = (requestEpoch) => (
        requestEpoch === newProjectFinalRenderRequestEpoch
    );

    const loadNewProjectFinalRenderPreview = async (requestEpoch) => {
        const sourceState = newProjectFinalRenderState;
        let prepared = { ok: false, url: '', dispose() {} };
        let consumedInline = false;
        if (sourceState.rendered && sourceState.preview_ready) {
            try {
                const inline = sourceState.preview;
                consumedInline = Boolean(inline && typeof inline.ready === 'boolean');
                const raw = consumedInline ? inline : await pipelineClient.getNewProjectFinalRenderPreview();
                if (!isLatestNewProjectFinalRenderRequest(requestEpoch)
                    || newProjectFinalRenderState !== sourceState) return false;
                prepared = typeof raw?.stream_url === 'string'
                    ? createFinalRenderStreamPreview(raw)
                    : createG3PreviewObjectUrl({ ...raw, loaded: raw?.ready === true });
            } catch { /* pathless preview remains unavailable */ }
            if (!isLatestNewProjectFinalRenderRequest(requestEpoch)
                || newProjectFinalRenderState !== sourceState) {
                prepared.dispose?.();
                return false;
            }
            if (consumedInline) {
                const nextState = { ...sourceState };
                delete nextState.preview;
                newProjectFinalRenderState = nextState;
            }
        }
        if (!isLatestNewProjectFinalRenderRequest(requestEpoch)) {
            prepared.dispose?.();
            return false;
        }
        newProjectFinalRenderPreview.dispose?.();
        newProjectFinalRenderPreview = prepared.ok
            ? { source: prepared.url, dispose: prepared.dispose }
            : { source: '', dispose() {} };
        return true;
    };

    const refreshNewProjectImagePreviews = async (tasks = newProjectImagePlanTasks) => {
        const requestEpoch = ++newProjectImagePreviewEpoch;
        const tokens = Array.from(new Set((tasks || []).map((task) => task.result_token).filter(Boolean)));
        const loaded = await Promise.all(tokens.map(async (resultToken) => {
            try {
                return [resultToken, await pipelineClient.getNewProjectImageResultPreview({ result_token: resultToken })];
            } catch {
                return [resultToken, null];
            }
        }));
        if (requestEpoch !== newProjectImagePreviewEpoch) return false;
        newProjectImageResultPreviews = Object.fromEntries(loaded.filter(([, value]) => value?.ready));
        return true;
    };

    const refreshNewProjectVideoPreviews = async (tasks = newProjectVideoPlanTasks) => {
        const requestEpoch = ++newProjectVideoPreviewEpoch;
        const tokens = Array.from(new Set((tasks || []).map((task) => task.result_token).filter(Boolean)));
        const loaded = await Promise.all(tokens.map(async (resultToken) => {
            try {
                const raw = await pipelineClient.getNewProjectVideoResultPreview({ result_token: resultToken });
                const prepared = createG3PreviewObjectUrl(raw);
                return prepared.ok ? [resultToken, { source: prepared.url, dispose: prepared.dispose }] : [resultToken, null];
            } catch {
                return [resultToken, null];
            }
        }));
        const nextPreviews = Object.fromEntries(loaded.filter(([, value]) => value?.source));
        if (requestEpoch !== newProjectVideoPreviewEpoch) {
            Object.values(nextPreviews).forEach((preview) => preview?.dispose?.());
            return false;
        }
        const previousPreviews = newProjectVideoResultPreviews;
        newProjectVideoResultPreviews = nextPreviews;
        Object.values(previousPreviews).forEach((preview) => preview?.dispose?.());
        return true;
    };

    const render = () => {
        container.innerHTML = '';
        if (typeof CustomEvent === 'function') {
            const draftTitle = String(newProjectDraftValue.production_id || '').trim();
            window.dispatchEvent(new CustomEvent('pipeline:project-title', {
                detail: { title: workspaceMode === 'production' ? state.project?.title || '' : draftTitle },
            }));
        }

        const showPathSelectionBlocked = () => window.alert(p('Folder selection blocked by the local path safety policy.'));

        const refreshNewProjectDraft = async ({ preserveLocalEdits = false } = {}) => {
            const requestEpoch = bumpNewProjectStateEpoch('draft');
            try {
                const result = await pipelineClient.getNewProjectDraftState();
                if (!isLatestNewProjectStateEpoch('draft', requestEpoch)) return newProjectDraftState;
                const localValue = { ...newProjectDraftValue };
                newProjectDraftState = result;
                if (result?.draft) {
                    newProjectDraftValue = { ...result.draft };
                    if (preserveLocalEdits) {
                        if (newProjectDraftDirty.brief) newProjectDraftValue.brief = localValue.brief;
                        if (newProjectDraftDirty.script) newProjectDraftValue.script = localValue.script;
                        if (newProjectDraftDirty.settings) {
                            for (const field of ['production_id', 'route', 'aspect_ratio', 'scene_duration', 'max_scenes']) {
                                newProjectDraftValue[field] = localValue[field];
                            }
                        }
                    } else {
                        newProjectDraftDirty = { brief: false, script: false, settings: false };
                    }
                }
                newProjectNotice = preserveLocalEdits ? '최신 수정안 상태를 확인했습니다.' : '';
            } catch {
                if (!isLatestNewProjectStateEpoch('draft', requestEpoch)) return newProjectDraftState;
                newProjectDraftState = {
                    ...newProjectDraftState,
                    status: 'error',
                    readiness: 'blocked',
                    blockers: ['NEW_PROJECT_DRAFT_READ_FAILED'],
                    preview: { ready: false, copyAllowed: false, previewOnly: true, executed: false, shellSafeCommand: '' },
                };
            }
        };

        const refreshNewProjectDesign = async ({ preserveLocalEdits = false } = {}) => {
            const requestEpoch = bumpNewProjectStateEpoch('design');
            const localBoard = newProjectDesignBoard;
            try {
                const result = await pipelineClient.getNewProjectDesignState();
                if (!isLatestNewProjectStateEpoch('design', requestEpoch)) return newProjectDesignState;
                newProjectDesignState = result;
                if (result?.board && !(preserveLocalEdits && newProjectDesignDirty)) {
                    newProjectDesignBoard = structuredClone(result.board);
                    newProjectDesignDirty = false;
                } else if (preserveLocalEdits && newProjectDesignDirty) {
                    newProjectDesignBoard = localBoard;
                }
                newProjectDesignNotice = preserveLocalEdits ? '최신 수정안 상태를 확인했습니다.' : '';
            } catch {
                if (!isLatestNewProjectStateEpoch('design', requestEpoch)) return newProjectDesignState;
                newProjectDesignState = emptyNewProjectDesignState('error', 'DESIGN_STATE_READ_FAILED');
                newProjectDesignNotice = '설계를 불러오지 못했습니다.';
            }
        };

        const refreshNewProjectImagePlan = async ({ preserveLocalEdits = false } = {}) => {
            const requestEpoch = bumpNewProjectStateEpoch('image');
            const localTasks = newProjectImagePlanTasks;
            try {
                const result = await pipelineClient.getNewProjectImagePlan();
                if (!isLatestNewProjectStateEpoch('image', requestEpoch)) return newProjectImagePlanState;
                newProjectImagePlanState = result;
                if (!(preserveLocalEdits && newProjectImagePlanDirty)) {
                    newProjectImagePlanTasks = structuredClone(result?.tasks || []);
                    newProjectImagePlanDirty = false;
                    await refreshNewProjectImagePreviews(newProjectImagePlanTasks);
                } else {
                    newProjectImagePlanTasks = localTasks;
                }
            } catch {
                if (!isLatestNewProjectStateEpoch('image', requestEpoch)) return newProjectImagePlanState;
                newProjectImagePlanState = emptyNewProjectImagePlanState('error', 'IMAGE_PLAN_READ_FAILED');
                newProjectImagePlanNotice = '이미지 작업을 불러오지 못했습니다.';
            }
        };

        const refreshNewProjectImageResults = async () => {
            const requestEpoch = bumpNewProjectStateEpoch('image');
            try {
                const result = await pipelineClient.getNewProjectImageResultWorkspace();
                if (!isLatestNewProjectStateEpoch('image', requestEpoch)) return newProjectImageResultWorkspace;
                newProjectImageResultWorkspace = result;
            } catch {
                if (!isLatestNewProjectStateEpoch('image', requestEpoch)) return newProjectImageResultWorkspace;
                newProjectImageResultWorkspace = emptyNewProjectImageResultWorkspace('error', 'IMAGE_RESULT_WORKSPACE_READ_FAILED');
            }
            render();
            return newProjectImageResultWorkspace;
        };

        const refreshNewProjectVideoPlan = async ({ preserveLocalEdits = false } = {}) => {
            const requestEpoch = bumpNewProjectStateEpoch('video');
            const localTasks = newProjectVideoPlanTasks;
            try {
                const result = await pipelineClient.getNewProjectVideoPlan();
                if (!isLatestNewProjectStateEpoch('video', requestEpoch)) return newProjectVideoPlanState;
                newProjectVideoPlanState = result;
                if (!(preserveLocalEdits && newProjectVideoPlanDirty)) {
                    newProjectVideoPlanTasks = structuredClone(result?.tasks || []);
                    newProjectVideoPlanDirty = false;
                    await refreshNewProjectVideoPreviews(newProjectVideoPlanTasks);
                } else {
                    newProjectVideoPlanTasks = localTasks;
                }
            } catch {
                if (!isLatestNewProjectStateEpoch('video', requestEpoch)) return newProjectVideoPlanState;
                newProjectVideoPlanState = emptyNewProjectVideoPlanState('error', 'VIDEO_PLAN_READ_FAILED');
                newProjectVideoPlanNotice = '영상 작업을 불러오지 못했습니다.';
            }
        };

        const refreshNewProjectVideoResults = async () => {
            const requestEpoch = bumpNewProjectStateEpoch('video');
            try {
                const result = await pipelineClient.getNewProjectVideoResultWorkspace();
                if (!isLatestNewProjectStateEpoch('video', requestEpoch)) return newProjectVideoResultWorkspace;
                newProjectVideoResultWorkspace = result;
            } catch {
                if (!isLatestNewProjectStateEpoch('video', requestEpoch)) return newProjectVideoResultWorkspace;
                newProjectVideoResultWorkspace = emptyNewProjectVideoResultWorkspace('error', 'VIDEO_RESULT_WORKSPACE_READ_FAILED');
            }
            render();
            return newProjectVideoResultWorkspace;
        };

        const refreshNewProjectClipSelection = async ({ preserveLocalEdits = false } = {}) => {
            const requestEpoch = bumpNewProjectStateEpoch('clip');
            const local = newProjectClipSelections;
            try {
                const result = await pipelineClient.getNewProjectClipSelection();
                if (!isLatestNewProjectStateEpoch('clip', requestEpoch)) return newProjectClipSelectionState;
                newProjectClipSelectionState = result;
                if (!(preserveLocalEdits && newProjectClipSelectionDirty)) {
                    newProjectClipSelections = structuredClone(result?.clips || []);
                    newProjectClipSelectionDirty = false;
                } else newProjectClipSelections = local;
                newProjectClipSelectionNotice = '';
            } catch {
                if (!isLatestNewProjectStateEpoch('clip', requestEpoch)) return newProjectClipSelectionState;
                newProjectClipSelectionState = emptyNewProjectClipSelectionState('error', 'CLIP_SELECTION_READ_FAILED');
                newProjectClipSelectionNotice = '클립 선택을 불러오지 못했습니다.';
            }
            return newProjectClipSelectionState;
        };

        const refreshNewProjectFinalStitch = async () => {
            const requestEpoch = bumpNewProjectStateEpoch('finalStitch');
            try {
                const result = await pipelineClient.getNewProjectFinalStitch();
                if (!isLatestNewProjectStateEpoch('finalStitch', requestEpoch)) return newProjectFinalStitchState;
                newProjectFinalStitchState = result;
                newProjectFinalStitchNotice = '';
            } catch {
                if (!isLatestNewProjectStateEpoch('finalStitch', requestEpoch)) return newProjectFinalStitchState;
                newProjectFinalStitchState = emptyNewProjectFinalStitchState('error', 'FINAL_STITCH_READ_FAILED');
                newProjectFinalStitchNotice = '최종 편집 준비를 불러오지 못했습니다.';
            }
            return newProjectFinalStitchState;
        };

        const refreshNewProjectFinalRender = async ({ loadPreview = true } = {}) => {
            const requestEpoch = beginNewProjectFinalRenderRequest();
            try {
                const result = await pipelineClient.getNewProjectFinalRender();
                if (!isLatestNewProjectFinalRenderRequest(requestEpoch)) return newProjectFinalRenderState;
                newProjectFinalRenderState = result;
                newProjectFinalRenderNotice = '';
                if (loadPreview) await loadNewProjectFinalRenderPreview(requestEpoch);
            } catch {
                if (!isLatestNewProjectFinalRenderRequest(requestEpoch)) return newProjectFinalRenderState;
                newProjectFinalRenderState = emptyNewProjectFinalRenderState('blocked');
                newProjectFinalRenderNotice = '검토용 영상 상태를 불러오지 못했습니다.';
            }
            return newProjectFinalRenderState;
        };

        const refreshNewProjectExecution = async () => {
            const requestEpoch = bumpNewProjectStateEpoch('execution');
            newProjectExecutionRefreshing = true;
            newProjectExecutionNotice = '최신 상태를 확인하는 중…';
            render();
            try {
                const result = await pipelineClient.getNewProjectExecutionState();
                if (!isLatestNewProjectStateEpoch('execution', requestEpoch)) return newProjectExecutionState;
                newProjectExecutionState = result;
                newProjectExecutionNotice = '최신 상태를 확인했습니다.';
            } catch {
                if (!isLatestNewProjectStateEpoch('execution', requestEpoch)) return newProjectExecutionState;
                newProjectExecutionState = emptyNewProjectExecutionState('error', 'NEW_PROJECT_EXECUTION_READ_FAILED');
                newProjectExecutionNotice = '상태를 불러오지 못했습니다. 잠시 후 다시 확인하세요.';
            }
            newProjectExecutionRefreshing = false;
            render();
            return newProjectExecutionState;
        };

        const stageNewProjectExecution = async () => {
            bumpNewProjectStateEpoch('execution');
            if (!newProjectExecutionState?.revision_sha256) {
                newProjectExecutionNotice = '먼저 이미지 또는 영상 작업을 준비하세요.';
                render();
                return newProjectExecutionState;
            }
            newProjectExecutionRefreshing = true;
            newProjectExecutionNotice = '실행 목록을 준비하는 중…';
            render();
            try {
                newProjectExecutionState = await pipelineClient.stageNewProjectExecutionHandoff({
                    expected_revision_sha256: newProjectExecutionState.revision_sha256,
                });
                newProjectExecutionNotice = '실행 목록을 준비했습니다. 생성은 시작하지 않았습니다.';
            } catch {
                newProjectExecutionNotice = '실행 목록을 준비하지 못했습니다. 작업 상태를 새로고침하세요.';
            }
            newProjectExecutionRefreshing = false;
            render();
            return newProjectExecutionState;
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
                workspaceMode = 'production';
                workspaceModeExplicit = true;
                const [loaded, retryPlanLoaded, dstImportLoaded, g3Loaded, promotionLoaded, finishingLoaded] = await Promise.all([
                    pipelineClient.readProductionState(),
                    pipelineClient.getMediaRetryPlan().catch(() => emptyMediaRetryPlan('blocked', 'MEDIA_RETRY_PLAN_READ_FAILED')),
                    readDstBundleImportState().catch(() => ({
                        workspace: emptyDstBundleImportWorkspace('blocked', 'DST_BUNDLE_IMPORT_WORKSPACE_READ_FAILED'),
                        preview: emptyDstBundleImportPreview('blocked', 'DST_BUNDLE_IMPORT_PREVIEW_READ_FAILED'),
                    })),
                    pipelineClient.getG3ReviewWorkspace(),
                    pipelineClient.planG3ProductionPromotion(),
                    pipelineClient.getFinishingWorkspace(),
                ]);
                state = normalizeState(loaded?.state);
                mediaRetryPlan = retryPlanLoaded;
                dstBundleImportWorkspace = dstImportLoaded.workspace;
                dstBundleImportPreview = dstImportLoaded.preview;
                dstBundleImportPlan = emptyDstBundleImportPlan();
                videoResultImportPlan = emptyVideoResultImportPlan();
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

        const pickExternalMediaRoot = async (provider) => {
            try {
                const selected = await pipelineClient.selectExternalMediaRoot({ provider });
                if (!selected?.ok || selected.canceled) return;
                config = {
                    ...config,
                    ...(selected.config || {}),
                    dryRunMode: true,
                    allowSafeCommandExecution: false,
                };
                if (provider === 'dst') {
                    const [dstState] = await Promise.all([
                        readDstBundleImportState().catch(() => null),
                        refreshNewProjectImageResults(),
                    ]);
                    if (dstState) {
                        dstBundleImportWorkspace = dstState.workspace;
                        dstBundleImportPreview = dstState.preview;
                    }
                    dstBundleImportPlan = emptyDstBundleImportPlan();
                } else {
                    const [workspace] = await Promise.all([
                        pipelineClient.getVideoResultImportWorkspace().catch(() => null),
                        refreshNewProjectVideoResults(),
                    ]);
                    if (workspace) videoResultImportWorkspace = workspace;
                    videoResultImportPlan = emptyVideoResultImportPlan();
                }
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
                workspaceMode = 'production';
                workspaceModeExplicit = true;
                const [loaded, retryPlanLoaded, dstImportLoaded, g3Loaded, promotionLoaded, finishingLoaded] = await Promise.all([
                    pipelineClient.readProductionState(),
                    pipelineClient.getMediaRetryPlan().catch(() => emptyMediaRetryPlan('blocked', 'MEDIA_RETRY_PLAN_READ_FAILED')),
                    readDstBundleImportState().catch(() => ({
                        workspace: emptyDstBundleImportWorkspace('blocked', 'DST_BUNDLE_IMPORT_WORKSPACE_READ_FAILED'),
                        preview: emptyDstBundleImportPreview('blocked', 'DST_BUNDLE_IMPORT_PREVIEW_READ_FAILED'),
                    })),
                    pipelineClient.getG3ReviewWorkspace(),
                    pipelineClient.planG3ProductionPromotion(),
                    pipelineClient.getFinishingWorkspace(),
                ]);
                state = normalizeState(loaded?.state);
                mediaRetryPlan = retryPlanLoaded;
                dstBundleImportWorkspace = dstImportLoaded.workspace;
                dstBundleImportPreview = dstImportLoaded.preview;
                dstBundleImportPlan = emptyDstBundleImportPlan();
                videoResultImportPlan = emptyVideoResultImportPlan();
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

        const workflowState = workspaceMode === 'new-project' ? {
            ...state,
            newProjectDraftState,
            newProjectDesignState,
            newProjectImagePlanState,
            newProjectVideoPlanState,
            newProjectClipSelectionState,
            newProjectFinalStitchState,
            newProjectFinalRenderState,
        } : state;
        const guide = deriveWorkflowGuide(workflowState);
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
                ? WorkflowOverview({ state: workflowState, onNavigate: switchTab })
                : renderPanel(activeTab, state, workspaceMode === 'new-project'
                    ? { ...config, productionRoot: '' }
                    : config, {
                harnessStatus,
                newProjectDraftState,
                newProjectDraftValue,
                newProjectNotice,
                newProjectDraftDirty,
                newProjectDesignState,
                newProjectDesignBoard,
                newProjectDesignDirty,
                newProjectDesignNotice,
                imagePlanState: newProjectImagePlanState,
                imagePlanTasks: newProjectImagePlanTasks,
                imageReviewDecisions: newProjectImagePlanState.review_decisions || [],
                imagePlanDirty: newProjectImagePlanDirty,
                imagePlanNotice: newProjectImagePlanNotice,
                imageResultWorkspace: newProjectImageResultWorkspace,
                imageResultPreviews: newProjectImageResultPreviews,
                onOpenImageResultReview: () => switchTab('storyboard'),
                onOpenImageNext: () => switchTab('videos'),
                videoPlanState: newProjectVideoPlanState,
                videoPlanTasks: newProjectVideoPlanTasks,
                videoReviewDecisions: newProjectVideoPlanState.review_decisions || [],
                videoPlanDirty: newProjectVideoPlanDirty,
                videoPlanNotice: newProjectVideoPlanNotice,
                videoResultWorkspace: newProjectVideoResultWorkspace,
                videoResultPreviews: newProjectVideoResultPreviews,
                newProjectClipSelectionState,
                newProjectClipSelections,
                newProjectClipSelectionDirty,
                newProjectClipSelectionNotice,
                newProjectFinalStitchState,
                newProjectFinalStitchNotice,
                newProjectFinalRenderState,
                newProjectFinalRenderNotice,
                newProjectFinalRenderPreviewSource: newProjectFinalRenderPreview.source,
                newProjectMediaReviewFilter,
                mediaReviewRetryNotice: newProjectMediaReviewRetryNotice,
                onNewProjectMediaReviewFilterChange: (value) => { newProjectMediaReviewFilter = value; },
                executionState: newProjectExecutionState,
                executionNotice: newProjectExecutionNotice,
                executionRefreshing: newProjectExecutionRefreshing,
                hasProductionRoot: Boolean(config.productionRoot),
                onRefreshExecution: refreshNewProjectExecution,
                onStageExecution: stageNewProjectExecution,
                onOpenNextAction: ({ tab }) => switchTab(tab),
                onOpenWorkItem: async ({ kind, sequence, candidateToken = '', imageIndex = 0, openConnector = false }) => {
                    if (candidateToken || openConnector) {
                        if (kind === 'video') await refreshNewProjectVideoResults();
                        else await refreshNewProjectImageResults();
                    }
                    switchTab(kind === 'video' ? 'videos' : 'assets');
                    queueMicrotask(() => {
                        const target = document.querySelector?.(`[data-work-target="${kind}"][data-sequence="${sequence}"]`);
                        target?.focus?.();
                        target?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
                        if (candidateToken || openConnector) target?.dispatchEvent?.(new CustomEvent('workbench:show-result', {
                            detail: { candidateToken, imageIndex },
                        }));
                    });
                },
                onOpenLegacyQueue: () => switchTab('queue'),
                onOpenVideoResultReview: () => switchTab('storyboard'),
                onOpenVideoNext: () => switchTab('qa'),
                onOpenNewProjectResultReview: () => switchTab('storyboard'),
                onNewProjectClipSelectionChange: (taskToken, patch) => {
                    bumpNewProjectStateEpoch('clip');
                    bumpNewProjectStateEpoch('finalStitch');
                    newProjectClipSelections = newProjectClipSelections.map((clip) => (
                        clip.task_token === taskToken ? { ...clip, ...patch } : clip
                    ));
                    newProjectClipSelectionDirty = true;
                    newProjectClipSelectionNotice = '저장하지 않은 선택이 있습니다.';
                    render();
                },
                onSaveNewProjectClipSelection: async () => {
                    const requestEpoch = bumpNewProjectStateEpoch('clip');
                    bumpNewProjectStateEpoch('finalStitch');
                    const isCurrentSave = () => isLatestNewProjectStateEpoch('clip', requestEpoch);
                    newProjectClipSelectionNotice = '선택을 저장하는 중…';
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectClipSelection({
                            selections: newProjectClipSelections.map((clip) => ({
                                task_token: clip.task_token,
                                in_seconds: clip.in_seconds,
                                out_seconds: clip.out_seconds,
                                reason: clip.reason,
                                reviewer_confidence: clip.reviewer_confidence,
                            })),
                            expected_design_revision_sha256: newProjectClipSelectionState.design_revision_sha256,
                            expected_image_plan_revision_sha256: newProjectClipSelectionState.image_plan_revision_sha256,
                            expected_video_plan_revision_sha256: newProjectClipSelectionState.video_plan_revision_sha256,
                            expected_clip_selection_revision_sha256: newProjectClipSelectionState.revision_sha256,
                        });
                        if (!result?.ok) throw new Error('CLIP_SELECTION_SAVE_FAILED');
                        if (!isCurrentSave()) return;
                        newProjectClipSelectionState = result;
                        newProjectClipSelections = structuredClone(result.clips || []);
                        newProjectClipSelectionDirty = false;
                        newProjectClipSelectionNotice = result.accepted_count === result.total_count
                            ? '구간 선택을 완료했습니다. 다음은 5단계 마무리 준비입니다.'
                            : `구간 ${result.accepted_count}/${result.total_count}개를 저장했습니다.`;
                        await refreshNewProjectFinalStitch();
                    } catch {
                        if (!isCurrentSave()) return;
                        newProjectClipSelectionNotice = '선택을 저장하지 못했습니다. 범위와 이유를 확인하세요.';
                    }
                    render();
                },
                onRefreshNewProjectClipSelection: async () => {
                    newProjectClipSelectionNotice = '최신 선택을 확인하는 중…';
                    render();
                    await refreshNewProjectClipSelection({ preserveLocalEdits: true });
                    render();
                },
                onOpenNewProjectClipSelection: () => switchTab('qa'),
                onOpenNewProjectFinal: () => switchTab('final'),
                onRefreshNewProjectFinalStitch: async () => {
                    newProjectFinalStitchNotice = '최신 준비 상태를 확인하는 중…';
                    render();
                    await refreshNewProjectFinalStitch();
                    await refreshNewProjectFinalRender();
                    render();
                },
                onStageNewProjectFinalStitch: async () => {
                    const requestEpoch = bumpNewProjectStateEpoch('finalStitch');
                    newProjectFinalStitchNotice = '최종 편집 준비를 저장하는 중…';
                    render();
                    try {
                        const result = await pipelineClient.stageNewProjectFinalStitch({
                            expected_revision: newProjectFinalStitchState.revision,
                        });
                        if (!result?.ok || !result?.staged) throw new Error('FINAL_STITCH_STAGE_FAILED');
                        if (!isLatestNewProjectStateEpoch('finalStitch', requestEpoch)) return;
                        newProjectFinalStitchState = result;
                        newProjectFinalStitchNotice = '준비 파일을 저장했습니다. 아직 영상을 합치지 않았습니다.';
                        await refreshNewProjectFinalRender();
                    } catch {
                        if (!isLatestNewProjectStateEpoch('finalStitch', requestEpoch)) return;
                        newProjectFinalStitchNotice = '준비를 저장하지 못했습니다. 클립 선택을 다시 확인하세요.';
                    }
                    render();
                },
                onRenderNewProjectFinal: async () => {
                    const requestEpoch = beginNewProjectFinalRenderRequest();
                    newProjectFinalRenderState = { ...newProjectFinalRenderState, status: 'rendering' };
                    newProjectFinalRenderNotice = '검토용 영상을 만드는 중입니다.';
                    render();
                    try {
                        const plan = await pipelineClient.planNewProjectFinalRender();
                        if (!plan?.ready || !plan?.plan_token) throw new Error('FINAL_RENDER_NOT_READY');
                        const rendered = await pipelineClient.executeNewProjectFinalRender({
                            planToken: plan.plan_token,
                            confirmed: true,
                            projectId: newProjectDraftValue.production_id,
                        });
                        if (!rendered?.rendered || !rendered?.fresh_probe_verified) throw new Error('FINAL_RENDER_FAILED');
                        if (!isLatestNewProjectFinalRenderRequest(requestEpoch)) return;
                        newProjectFinalRenderState = rendered;
                        await loadNewProjectFinalRenderPreview(requestEpoch);
                        if (!isLatestNewProjectFinalRenderRequest(requestEpoch)) return;
                        newProjectFinalRenderNotice = '검토용 영상이 준비되었습니다. 장면 품질은 직접 확인해 주세요.';
                    } catch {
                        if (!isLatestNewProjectFinalRenderRequest(requestEpoch)) return;
                        newProjectFinalRenderState = emptyNewProjectFinalRenderState('blocked');
                        newProjectFinalRenderNotice = '검토용 영상을 만들지 못했습니다. 준비 상태를 새로고침해 주세요.';
                    }
                    render();
                },
                onSaveNewProjectFinalReviewDecision: async (decision) => {
                    const requestEpoch = beginNewProjectFinalRenderRequest();
                    newProjectFinalRenderNotice = '결정을 저장하는 중…';
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectFinalReviewDecision({
                            decision,
                            expected_review_version: newProjectFinalRenderState.review_version,
                        });
                        if (!result?.rendered || !result?.human_review_recorded) throw new Error('FINAL_REVIEW_SAVE_FAILED');
                        if (!isLatestNewProjectFinalRenderRequest(requestEpoch)) return;
                        newProjectFinalRenderState = result;
                        newProjectFinalRenderNotice = decision === 'use'
                            ? '이 영상을 사용하기로 저장했습니다.'
                            : '다시 만들기로 저장했습니다. 결과 검토에서 수정할 장면을 확인하세요.';
                    } catch {
                        if (!isLatestNewProjectFinalRenderRequest(requestEpoch)) return;
                        newProjectFinalRenderNotice = '결정을 저장하지 못했습니다. 최신 상태를 확인하고 다시 선택하세요.';
                    }
                    render();
                },
                onNewProjectDraftChange: (field, value) => {
                    bumpNewProjectStateEpoch('draft');
                    newProjectDraftValue[field] = value;
                    if (field === 'brief' || field === 'script') newProjectDraftDirty[field] = true;
                    else newProjectDraftDirty.settings = true;
                },
                onSaveNewProjectDraft: async (draft) => {
                    bumpNewProjectStateEpoch('draft');
                    newProjectNotice = '저장 중…';
                    newProjectDraftState = { ...newProjectDraftState, status: 'saving' };
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectDraft(draft);
                        newProjectDraftState = result;
                        if (result?.draft) newProjectDraftValue = { ...result.draft };
                        newProjectNotice = result?.ok ? '직접 저장됨' : '저장하지 못했습니다.';
                        if (result?.ok) newProjectDraftDirty = { brief: false, script: false, settings: false };
                        if (result?.ok) await refreshNewProjectDesign();
                        render();
                        return result;
                    } catch {
                        newProjectDraftState = {
                            ...newProjectDraftState,
                            status: 'error',
                            readiness: 'blocked',
                            blockers: ['NEW_PROJECT_DRAFT_SAVE_FAILED'],
                            preview: { ready: false, copyAllowed: false, previewOnly: true, executed: false, shellSafeCommand: '' },
                        };
                        newProjectNotice = '저장하지 못했습니다.';
                        render();
                        return { ok: false, status: 'error' };
                    }
                },
                onEnqueuePlanningAgentRequest: async ({ stage, instruction }) => {
                    bumpNewProjectStateEpoch('draft');
                    newProjectNotice = '요청 저장 중…';
                    newProjectDraftState = { ...newProjectDraftState, status: 'requesting' };
                    render();
                    try {
                        const saved = await pipelineClient.saveNewProjectDraft({ ...newProjectDraftValue });
                        if (!saved?.ok || !saved.revision_sha256) throw new Error('DRAFT_SAVE_FAILED');
                        newProjectDraftState = saved;
                        if (saved.draft) newProjectDraftValue = { ...saved.draft };
                        newProjectDraftDirty = { brief: false, script: false, settings: false };
                        const result = await pipelineClient.enqueuePlanningAgentRequest({
                            stage,
                            instruction,
                            expected_revision_sha256: saved.revision_sha256,
                        });
                        if (!result?.queued || !result?.state) throw new Error('REQUEST_QUEUE_FAILED');
                        newProjectDraftState = { ...result.state, status: 'requesting' };
                        if (result.state.draft) newProjectDraftValue = { ...result.state.draft };
                        newProjectNotice = stage === 'brief'
                            ? '에이전트가 기획을 수정하고 있습니다…'
                            : '에이전트가 스크립트를 수정하고 있습니다…';
                        render();
                        const agent = await pipelineClient.runPlanningAgentRequest({ stage });
                        if (agent?.state) {
                            newProjectDraftState = agent.state;
                            if (agent.state.draft) newProjectDraftValue = { ...agent.state.draft };
                        }
                        newProjectNotice = agent?.ok
                            ? '수정안이 도착했습니다. 현재 내용과 비교해 보세요.'
                            : '수정안을 만들지 못했습니다. 다시 시도하세요.';
                        render();
                        return { ...result, agent };
                    } catch {
                        newProjectDraftState = { ...newProjectDraftState, status: 'error' };
                        newProjectNotice = '작업을 시작하지 못했습니다. 다시 시도하세요.';
                        render();
                        return { ok: false, queued: false, executed: false, model_called: false };
                    }
                },
                onRunPlanningAgentRequest: async ({ stage }) => {
                    bumpNewProjectStateEpoch('draft');
                    newProjectDraftState = { ...newProjectDraftState, status: 'requesting' };
                    newProjectNotice = stage === 'brief'
                        ? '에이전트가 기획을 수정하고 있습니다…'
                        : '에이전트가 스크립트를 수정하고 있습니다…';
                    render();
                    try {
                        const result = await pipelineClient.runPlanningAgentRequest({ stage });
                        if (result?.state) {
                            newProjectDraftState = result.state;
                            if (result.state.draft) newProjectDraftValue = { ...result.state.draft };
                        }
                        newProjectNotice = result?.ok
                            ? '수정안이 도착했습니다. 현재 내용과 비교해 보세요.'
                            : '수정안을 만들지 못했습니다. 다시 시도하세요.';
                        render();
                        return result;
                    } catch {
                        newProjectDraftState = { ...newProjectDraftState, status: 'error' };
                        newProjectNotice = '수정안을 만들지 못했습니다. 다시 시도하세요.';
                        render();
                        return { ok: false, status: 'failed' };
                    }
                },
                onRefreshNewProjectDraft: async () => {
                    newProjectNotice = '수정안 확인 중…';
                    newProjectDraftState = { ...newProjectDraftState, status: 'loading' };
                    render();
                    await refreshNewProjectDraft({ preserveLocalEdits: true });
                    render();
                },
                onDecidePlanningAgentSuggestion: async ({ stage, suggestion_token, action }) => {
                    bumpNewProjectStateEpoch('draft');
                    const stageDirty = newProjectDraftDirty.settings || newProjectDraftDirty[stage];
                    if (action === 'apply' && stageDirty) {
                        newProjectNotice = '원문이 바뀌어 바로 적용할 수 없습니다.';
                        render();
                        return { ok: false, status: 'stale' };
                    }
                    const localValue = { ...newProjectDraftValue };
                    const localDirty = { ...newProjectDraftDirty };
                    newProjectNotice = action === 'apply' ? '수정안 적용 중…' : '보류 중…';
                    newProjectDraftState = { ...newProjectDraftState, status: 'saving' };
                    render();
                    try {
                        const result = await pipelineClient.decidePlanningAgentSuggestion({
                            suggestion_token,
                            action,
                            expected_revision_sha256: newProjectDraftState.revision_sha256,
                        });
                        if (!result?.ok || !result?.state) throw new Error('SUGGESTION_DECISION_FAILED');
                        newProjectDraftState = result.state;
                        if (result.state.draft) {
                            newProjectDraftValue = { ...result.state.draft };
                            if (localDirty.brief && !(action === 'apply' && stage === 'brief')) {
                                newProjectDraftValue.brief = localValue.brief;
                            }
                            if (localDirty.script && !(action === 'apply' && stage === 'script')) {
                                newProjectDraftValue.script = localValue.script;
                            }
                            if (localDirty.settings) {
                                for (const field of ['production_id', 'route', 'aspect_ratio', 'scene_duration', 'max_scenes']) {
                                    newProjectDraftValue[field] = localValue[field];
                                }
                            }
                        }
                        newProjectDraftDirty = {
                            brief: localDirty.brief && !(action === 'apply' && stage === 'brief'),
                            script: localDirty.script && !(action === 'apply' && stage === 'script'),
                            settings: localDirty.settings,
                        };
                        if (action === 'apply') await refreshNewProjectDesign();
                        newProjectNotice = action === 'apply' ? '수정안을 적용했습니다.' : '보류함 · 원문은 그대로';
                        render();
                        return result;
                    } catch {
                        newProjectDraftState = { ...newProjectDraftState, status: 'error' };
                        newProjectNotice = '수정안을 처리하지 못했습니다.';
                        render();
                        return { ok: false, status: 'error' };
                    }
                },
                onCopyNewProjectBuildCommand: async () => {
                    bumpNewProjectStateEpoch('draft');
                    newProjectNotice = '명령 복사 중…';
                    newProjectDraftState = { ...newProjectDraftState, status: 'copying' };
                    render();
                    try {
                        const result = await pipelineClient.copyNewProjectBuildCommand();
                        if (result?.state) {
                            newProjectDraftState = result.state;
                            if (result.state.draft) newProjectDraftValue = { ...result.state.draft };
                        }
                        newProjectNotice = result?.copied && result?.verified
                            ? '빌드 명령을 복사했습니다.'
                            : '빌드 명령을 복사하지 못했습니다.';
                    } catch {
                        newProjectDraftState = {
                            ...newProjectDraftState,
                            status: 'error',
                            readiness: 'blocked',
                            blockers: ['NEW_PROJECT_COMMAND_COPY_FAILED'],
                            preview: { ready: false, copyAllowed: false, previewOnly: true, executed: false, shellSafeCommand: '' },
                        };
                        newProjectNotice = '빌드 명령을 복사하지 못했습니다.';
                    }
                    render();
                },
                onNewProjectDesignChange: (board) => {
                    bumpNewProjectStateEpoch('design');
                    newProjectDesignBoard = structuredClone(board);
                    newProjectDesignDirty = true;
                    newProjectDesignNotice = '저장하지 않은 변경이 있습니다';
                },
                onSaveNewProjectDesign: async (board) => {
                    bumpNewProjectStateEpoch('design');
                    newProjectDesignState = { ...newProjectDesignState, status: 'saving' };
                    newProjectDesignNotice = '저장 중…';
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectDesignBoard({
                            board,
                            expected_planning_revision_sha256: newProjectDesignState.planning_revision_sha256,
                            expected_design_revision_sha256: newProjectDesignState.revision_sha256,
                        });
                        const nextState = result?.state || result;
                        if (!result?.ok || !nextState?.revision_sha256) throw new Error('DESIGN_SAVE_FAILED');
                        newProjectDesignState = nextState;
                        newProjectDesignBoard = structuredClone(nextState.board);
                        newProjectDesignDirty = false;
                        newProjectDesignNotice = '직접 저장됨';
                        await refreshNewProjectImagePlan();
                        render();
                        return result;
                    } catch {
                        newProjectDesignState = { ...newProjectDesignState, status: 'error' };
                        newProjectDesignNotice = '필수 내용을 채운 뒤 다시 저장하세요.';
                        render();
                        return { ok: false, status: 'error' };
                    }
                },
                onEnqueueDesignAgentRequest: async ({ instruction, board }) => {
                    bumpNewProjectStateEpoch('design');
                    newProjectDesignState = { ...newProjectDesignState, status: 'requesting' };
                    newProjectDesignNotice = '요청 저장 중…';
                    render();
                    try {
                        const persistedBoard = newProjectDesignState.board || {};
                        const cleanEmptyBoard = !newProjectDesignDirty
                            && ['characters', 'locations', 'scenes'].every((key) => Array.isArray(persistedBoard[key]) && persistedBoard[key].length === 0);
                        let savedState = newProjectDesignState;
                        if (!cleanEmptyBoard) {
                            const saved = await pipelineClient.saveNewProjectDesignBoard({
                                board,
                                expected_planning_revision_sha256: newProjectDesignState.planning_revision_sha256,
                                expected_design_revision_sha256: newProjectDesignState.revision_sha256,
                            });
                            savedState = saved?.state || saved;
                            if (!saved?.ok || !savedState?.revision_sha256) throw new Error('DESIGN_SAVE_FAILED');
                        }
                        newProjectDesignState = savedState;
                        newProjectDesignBoard = structuredClone(savedState.board);
                        newProjectDesignDirty = false;
                        const result = await pipelineClient.enqueueDesignAgentRequest({
                            instruction,
                            expected_planning_revision_sha256: savedState.planning_revision_sha256,
                            expected_design_revision_sha256: savedState.revision_sha256,
                        });
                        if (!result?.queued || !result?.state) throw new Error('DESIGN_REQUEST_FAILED');
                        newProjectDesignState = { ...result.state, status: 'requesting' };
                        newProjectDesignBoard = structuredClone(result.state.board);
                        newProjectDesignNotice = '에이전트가 설계를 정리하고 있습니다…';
                        render();
                        const agent = await pipelineClient.runDesignAgentRequest();
                        if (agent?.state) {
                            newProjectDesignState = agent.state;
                            newProjectDesignBoard = structuredClone(agent.state.board);
                        }
                        newProjectDesignNotice = agent?.ok
                            ? '수정안이 도착했습니다. 현재 설계와 비교해 보세요.'
                            : '수정안을 만들지 못했습니다. 다시 시도하세요.';
                        render();
                        return { ...result, agent };
                    } catch {
                        newProjectDesignState = { ...newProjectDesignState, status: 'error' };
                        newProjectDesignNotice = '작업을 시작하지 못했습니다. 다시 시도하세요.';
                        render();
                        return { ok: false, queued: false, executed: false, model_called: false };
                    }
                },
                onRunDesignAgentRequest: async () => {
                    bumpNewProjectStateEpoch('design');
                    newProjectDesignState = { ...newProjectDesignState, status: 'requesting' };
                    newProjectDesignNotice = '에이전트가 설계를 정리하고 있습니다…';
                    render();
                    try {
                        const result = await pipelineClient.runDesignAgentRequest();
                        if (result?.state) {
                            newProjectDesignState = result.state;
                            newProjectDesignBoard = structuredClone(result.state.board);
                        }
                        newProjectDesignNotice = result?.ok
                            ? '수정안이 도착했습니다. 현재 설계와 비교해 보세요.'
                            : '수정안을 만들지 못했습니다. 다시 시도하세요.';
                        render();
                        return result;
                    } catch {
                        newProjectDesignState = { ...newProjectDesignState, status: 'error' };
                        newProjectDesignNotice = '수정안을 만들지 못했습니다. 다시 시도하세요.';
                        render();
                        return { ok: false, status: 'failed' };
                    }
                },
                onRefreshNewProjectDesign: async () => {
                    newProjectDesignState = { ...newProjectDesignState, status: 'loading' };
                    newProjectDesignNotice = '수정안 확인 중…';
                    render();
                    await refreshNewProjectDesign({ preserveLocalEdits: true });
                    render();
                },
                onDecideDesignAgentSuggestion: async ({ suggestion_token, action }) => {
                    bumpNewProjectStateEpoch('design');
                    if (action === 'apply' && newProjectDesignDirty) {
                        newProjectDesignNotice = '원문이 바뀌어 적용할 수 없습니다';
                        render();
                        return { ok: false, status: 'stale' };
                    }
                    newProjectDesignState = { ...newProjectDesignState, status: 'saving' };
                    newProjectDesignNotice = action === 'apply' ? '수정안 적용 중…' : '보류 중…';
                    render();
                    try {
                        const result = await pipelineClient.decideDesignAgentSuggestion({
                            suggestion_token,
                            action,
                            expected_design_revision_sha256: newProjectDesignState.revision_sha256,
                        });
                        if (!result?.ok || !result?.state) throw new Error('DESIGN_DECISION_FAILED');
                        newProjectDesignState = result.state;
                        if (action === 'apply') {
                            newProjectDesignBoard = structuredClone(result.state.board);
                            newProjectDesignDirty = false;
                            await refreshNewProjectImagePlan();
                        }
                        newProjectDesignNotice = action === 'apply' ? '수정안을 적용했습니다' : '보류함 · 현재 설계는 그대로';
                        render();
                        return result;
                    } catch {
                        newProjectDesignState = { ...newProjectDesignState, status: 'error' };
                        newProjectDesignNotice = '수정안을 처리하지 못했습니다.';
                        render();
                        return { ok: false, status: 'error' };
                    }
                },
                onImagePromptChange: (taskToken, prompt) => {
                    bumpNewProjectStateEpoch('image');
                    newProjectImagePlanTasks = newProjectImagePlanTasks.map((task) => (
                        task.task_token === taskToken ? { ...task, prompt } : task
                    ));
                    newProjectImagePlanDirty = true;
                    newProjectImagePlanNotice = '저장하지 않은 프롬프트가 있습니다.';
                },
                onRequestImageAgentEdit: async (taskToken, instruction) => {
                    bumpNewProjectStateEpoch('image');
                    newProjectImagePlanNotice = '현재 프롬프트를 저장하는 중…';
                    render();
                    try {
                        let current = newProjectImagePlanState;
                        if (newProjectImagePlanDirty || ['derived', 'design_changed'].includes(current.status)) {
                            current = await pipelineClient.saveNewProjectImagePlan({
                                tasks: newProjectImagePlanTasks,
                                expected_design_revision_sha256: current.design_revision_sha256,
                                expected_image_plan_revision_sha256: current.revision_sha256,
                            });
                            if (!current?.ok) throw new Error('IMAGE_PLAN_SAVE_FAILED');
                            newProjectImagePlanTasks = structuredClone(current.tasks);
                            newProjectImagePlanDirty = false;
                        }
                        const queued = await pipelineClient.enqueueImagePromptAgentRequest({
                            task_token: taskToken, instruction,
                            expected_design_revision_sha256: current.design_revision_sha256,
                            expected_image_plan_revision_sha256: current.revision_sha256,
                        });
                        if (!queued?.ok || !queued?.state) throw new Error('IMAGE_AGENT_QUEUE_FAILED');
                        newProjectImagePlanState = queued.state;
                        newProjectImagePlanNotice = '에이전트가 수정안을 만들고 있습니다…';
                        render();
                        const result = await pipelineClient.runImagePromptAgentRequest({ task_token: taskToken });
                        newProjectImagePlanState = result?.state || newProjectImagePlanState;
                        newProjectImagePlanNotice = result?.ok
                            ? '수정안이 도착했습니다. 현재 내용과 비교해 보세요.'
                            : '수정안을 만들지 못했습니다. 다시 시도하세요.';
                        render();
                        return result;
                    } catch {
                        newProjectImagePlanNotice = '수정안을 만들지 못했습니다. 다시 시도하세요.';
                        render();
                        return { ok: false, executed: false, model_called: false, generation_executed: false };
                    }
                },
                onDecideImageAgentEdit: async (suggestionToken, action) => {
                    bumpNewProjectStateEpoch('image');
                    if (action === 'apply' && newProjectImagePlanDirty) {
                        newProjectImagePlanNotice = '현재 프롬프트가 바뀌었습니다. 저장한 뒤 새로 요청하세요.';
                        render();
                        return { ok: false, status: 'stale' };
                    }
                    try {
                        const result = await pipelineClient.decideImagePromptAgentSuggestion({
                            suggestion_token: suggestionToken, action,
                            expected_design_revision_sha256: newProjectImagePlanState.design_revision_sha256,
                            expected_image_plan_revision_sha256: newProjectImagePlanState.revision_sha256,
                        });
                        if (!result?.ok || !result?.state) throw new Error('IMAGE_AGENT_DECISION_FAILED');
                        newProjectImagePlanState = result.state;
                        if (action === 'apply') {
                            newProjectImagePlanTasks = structuredClone(result.state.tasks);
                            newProjectImagePlanDirty = false;
                            await refreshNewProjectVideoPlan();
                        }
                        newProjectImagePlanNotice = action === 'apply'
                            ? '수정안을 적용하고 저장했습니다. 생성은 시작하지 않았습니다.'
                            : '현재 내용을 유지했습니다.';
                        render();
                        return result;
                    } catch {
                        newProjectImagePlanNotice = '수정안을 처리하지 못했습니다. 새로 요청하세요.';
                        render();
                        return { ok: false, status: 'error' };
                    }
                },
                onSaveImagePlan: async (tasks) => {
                    bumpNewProjectStateEpoch('image');
                    newProjectImagePlanState = { ...newProjectImagePlanState, status: 'saving' };
                    newProjectImagePlanNotice = '저장 중…';
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectImagePlan({
                            tasks,
                            expected_design_revision_sha256: newProjectImagePlanState.design_revision_sha256,
                            expected_image_plan_revision_sha256: newProjectImagePlanState.revision_sha256,
                        });
                        const nextState = result?.state || result;
                        if (!nextState?.ok || !Array.isArray(nextState.tasks)) throw new Error('IMAGE_PLAN_SAVE_FAILED');
                        newProjectImagePlanState = nextState;
                        newProjectImagePlanTasks = structuredClone(nextState.tasks);
                        newProjectImagePlanDirty = false;
                        newProjectImagePlanNotice = '프롬프트를 저장했습니다.';
                        render();
                        return nextState;
                    } catch {
                        newProjectImagePlanState = { ...newProjectImagePlanState, status: 'error' };
                        newProjectImagePlanNotice = '프롬프트를 저장하지 못했습니다.';
                        render();
                        return { ok: false, executed: false, model_called: false };
                    }
                },
                onPrepareImagePlan: async (tasks) => {
                    bumpNewProjectStateEpoch('image');
                    const needsSave = newProjectImagePlanDirty
                        || ['derived', 'design_changed'].includes(newProjectImagePlanState.status);
                    newProjectImagePlanState = { ...newProjectImagePlanState, status: 'preparing' };
                    newProjectImagePlanNotice = 'DST 작업 순서를 준비하는 중…';
                    render();
                    try {
                        let current = newProjectImagePlanState;
                        if (needsSave) {
                            const saved = await pipelineClient.saveNewProjectImagePlan({
                                tasks,
                                expected_design_revision_sha256: current.design_revision_sha256,
                                expected_image_plan_revision_sha256: current.revision_sha256,
                            });
                            current = saved?.state || saved;
                            if (!current?.ok) throw new Error('IMAGE_PLAN_SAVE_FAILED');
                        }
                        const prepared = await pipelineClient.prepareNewProjectImagePlan({
                            expected_design_revision_sha256: current.design_revision_sha256,
                            expected_image_plan_revision_sha256: current.revision_sha256,
                        });
                        const nextState = prepared?.state || prepared;
                        if (!nextState?.ok) throw new Error('IMAGE_PLAN_PREPARE_FAILED');
                        newProjectImagePlanState = nextState;
                        newProjectImagePlanTasks = structuredClone(nextState.tasks || current.tasks || tasks);
                        newProjectImagePlanDirty = false;
                        newProjectImagePlanNotice = 'DST 작업 순서를 준비했습니다. 생성은 시작하지 않았습니다.';
                        render();
                        return prepared;
                    } catch {
                        newProjectImagePlanState = { ...newProjectImagePlanState, status: 'error' };
                        newProjectImagePlanNotice = 'DST 작업 준비를 저장하지 못했습니다.';
                        render();
                        return { ok: false, executed: false, model_called: false };
                    }
                },
                onToggleImageRetry: async (taskToken, selected) => {
                    bumpNewProjectStateEpoch('image');
                    const previous = newProjectImagePlanTasks;
                    const nextTasks = previous.map((task) => task.task_token === taskToken
                        ? { ...task, status: selected ? '재제작' : task.result_token ? '결과연결' : '준비' }
                        : task);
                    newProjectImagePlanTasks = nextTasks;
                    newProjectImagePlanNotice = '다시 만들 항목을 저장하는 중…';
                    newProjectMediaReviewRetryNotice = '다시 만들기 선택을 저장하는 중…';
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectImageRetrySelection({
                            task_tokens: nextTasks.filter((task) => task.status === '재제작').map((task) => task.task_token),
                            expected_design_revision_sha256: newProjectImagePlanState.design_revision_sha256,
                            expected_image_plan_revision_sha256: newProjectImagePlanState.revision_sha256,
                        });
                        const nextState = result?.state || result;
                        if (!nextState?.ok) throw new Error('IMAGE_RETRY_SAVE_FAILED');
                        newProjectImagePlanState = nextState;
                        newProjectImagePlanTasks = structuredClone(nextState.tasks);
                        await refreshNewProjectVideoPlan();
                        newProjectImagePlanNotice = selected ? '다시 만들기로 선택했습니다.' : '다시 만들기 선택을 해제했습니다.';
                        newProjectMediaReviewRetryNotice = selected
                            ? '다시 만들기 선택을 저장했습니다.'
                            : '다시 만들기 선택 해제를 저장했습니다.';
                    } catch {
                        newProjectImagePlanTasks = previous;
                        newProjectImagePlanNotice = '다시 만들 선택을 저장하지 못했습니다.';
                        newProjectMediaReviewRetryNotice = '선택을 저장하지 못했습니다. 다시 선택하세요.';
                    }
                    render();
                },
                onSaveImageReviewDecision: async (taskToken, decision) => {
                    bumpNewProjectStateEpoch('image');
                    const previousState = newProjectImagePlanState;
                    const previousTasks = newProjectImagePlanTasks;
                    newProjectImagePlanNotice = '결과 선택을 저장하는 중…';
                    newProjectMediaReviewRetryNotice = '결과 선택을 저장하는 중…';
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectImageReviewDecision({
                            task_token: taskToken,
                            decision,
                            expected_design_revision_sha256: previousState.design_revision_sha256,
                            expected_image_plan_revision_sha256: previousState.revision_sha256,
                        });
                        const nextState = result?.state || result;
                        if (!nextState?.ok) throw new Error('IMAGE_REVIEW_SAVE_FAILED');
                        newProjectImagePlanState = nextState;
                        newProjectImagePlanTasks = structuredClone(nextState.tasks);
                        await refreshNewProjectVideoPlan();
                        newProjectImagePlanNotice = decision === 'use' ? '이 결과를 사용하기로 저장했습니다.' : '다시 만들기로 저장했습니다.';
                        newProjectMediaReviewRetryNotice = newProjectImagePlanNotice;
                    } catch {
                        newProjectImagePlanState = previousState;
                        newProjectImagePlanTasks = previousTasks;
                        newProjectImagePlanNotice = '결과 선택을 저장하지 못했습니다.';
                        newProjectMediaReviewRetryNotice = '결과 선택을 저장하지 못했습니다. 다시 선택하세요.';
                    }
                    render();
                },
                onRefreshImageResults: refreshNewProjectImageResults,
                onLoadImageCandidatePreview: (payload) => pipelineClient.loadDstBundleImportPreview(payload),
                onConnectImageResult: async ({ taskToken, candidateToken, imageIndex }) => {
                    bumpNewProjectStateEpoch('image');
                    newProjectImagePlanNotice = 'DST 결과를 연결하는 중…';
                    render();
                    try {
                        let current = newProjectImagePlanState;
                        if (newProjectImagePlanDirty || ['derived', 'design_changed'].includes(current.status)) {
                            const saved = await pipelineClient.saveNewProjectImagePlan({
                                tasks: newProjectImagePlanTasks,
                                expected_design_revision_sha256: current.design_revision_sha256,
                                expected_image_plan_revision_sha256: current.revision_sha256,
                            });
                            current = saved?.state || saved;
                            if (!current?.ok) throw new Error('IMAGE_PLAN_SAVE_FAILED');
                        }
                        const result = await pipelineClient.connectNewProjectImageResult({
                            task_token: taskToken,
                            candidate_token: candidateToken,
                            image_index: imageIndex,
                            expected_design_revision_sha256: current.design_revision_sha256,
                            expected_image_plan_revision_sha256: current.revision_sha256,
                        });
                        if (!result?.connected || !result?.state) throw new Error('IMAGE_RESULT_CONNECT_FAILED');
                        newProjectImagePlanState = result.state;
                        newProjectImagePlanTasks = structuredClone(result.state.tasks);
                        newProjectImagePlanDirty = false;
                        await refreshNewProjectImagePreviews(newProjectImagePlanTasks);
                        newProjectImagePlanNotice = 'DST 결과를 연결했습니다.';
                        render();
                        return result;
                    } catch {
                        newProjectImagePlanNotice = 'DST 결과를 연결하지 못했습니다.';
                        render();
                        return { ok: false, connected: false, executed: false };
                    }
                },
                onVideoPromptChange: (taskToken, prompt) => {
                    bumpNewProjectStateEpoch('video');
                    newProjectVideoPlanTasks = newProjectVideoPlanTasks.map((task) => (
                        task.task_token === taskToken ? { ...task, prompt } : task
                    ));
                    newProjectVideoPlanDirty = true;
                    newProjectVideoPlanNotice = '저장하지 않은 프롬프트가 있습니다.';
                },
                onRequestVideoAgentEdit: async (taskToken, instruction) => {
                    bumpNewProjectStateEpoch('video');
                    newProjectVideoPlanNotice = '현재 프롬프트를 저장하는 중…';
                    render();
                    try {
                        let current = newProjectVideoPlanState;
                        if (newProjectVideoPlanDirty || ['derived', 'design_changed', 'image_changed'].includes(current.status)) {
                            current = await pipelineClient.saveNewProjectVideoPlan({
                                tasks: newProjectVideoPlanTasks,
                                expected_design_revision_sha256: current.design_revision_sha256,
                                expected_image_plan_revision_sha256: current.image_plan_revision_sha256,
                                expected_video_plan_revision_sha256: current.revision_sha256,
                            });
                            if (!current?.ok) throw new Error('VIDEO_PLAN_SAVE_FAILED');
                            newProjectVideoPlanTasks = structuredClone(current.tasks);
                            newProjectVideoPlanDirty = false;
                        }
                        const queued = await pipelineClient.enqueueVideoPromptAgentRequest({
                            task_token: taskToken, instruction,
                            expected_design_revision_sha256: current.design_revision_sha256,
                            expected_image_plan_revision_sha256: current.image_plan_revision_sha256,
                            expected_video_plan_revision_sha256: current.revision_sha256,
                        });
                        if (!queued?.ok || !queued?.state) throw new Error('VIDEO_AGENT_QUEUE_FAILED');
                        newProjectVideoPlanState = queued.state;
                        newProjectVideoPlanNotice = '에이전트가 수정안을 만들고 있습니다…';
                        render();
                        const result = await pipelineClient.runVideoPromptAgentRequest({ task_token: taskToken });
                        newProjectVideoPlanState = result?.state || newProjectVideoPlanState;
                        newProjectVideoPlanNotice = result?.ok
                            ? '수정안이 도착했습니다. 현재 내용과 비교해 보세요.'
                            : '수정안을 만들지 못했습니다. 다시 시도하세요.';
                        render();
                        return result;
                    } catch {
                        newProjectVideoPlanNotice = '수정안을 만들지 못했습니다. 다시 시도하세요.';
                        render();
                        return { ok: false, executed: false, model_called: false, generation_executed: false };
                    }
                },
                onDecideVideoAgentEdit: async (suggestionToken, action) => {
                    bumpNewProjectStateEpoch('video');
                    if (action === 'apply' && newProjectVideoPlanDirty) {
                        newProjectVideoPlanNotice = '현재 프롬프트가 바뀌었습니다. 저장한 뒤 새로 요청하세요.';
                        render();
                        return { ok: false, status: 'stale' };
                    }
                    try {
                        const result = await pipelineClient.decideVideoPromptAgentSuggestion({
                            suggestion_token: suggestionToken, action,
                            expected_design_revision_sha256: newProjectVideoPlanState.design_revision_sha256,
                            expected_image_plan_revision_sha256: newProjectVideoPlanState.image_plan_revision_sha256,
                            expected_video_plan_revision_sha256: newProjectVideoPlanState.revision_sha256,
                        });
                        if (!result?.ok || !result?.state) throw new Error('VIDEO_AGENT_DECISION_FAILED');
                        newProjectVideoPlanState = result.state;
                        if (action === 'apply') {
                            newProjectVideoPlanTasks = structuredClone(result.state.tasks);
                            newProjectVideoPlanDirty = false;
                        }
                        newProjectVideoPlanNotice = action === 'apply'
                            ? '수정안을 적용하고 저장했습니다. 생성은 시작하지 않았습니다.'
                            : '현재 내용을 유지했습니다.';
                        render();
                        return result;
                    } catch {
                        newProjectVideoPlanNotice = '수정안을 처리하지 못했습니다. 새로 요청하세요.';
                        render();
                        return { ok: false, status: 'error' };
                    }
                },
                onVideoProviderChange: (taskToken, provider) => {
                    bumpNewProjectStateEpoch('video');
                    newProjectVideoPlanTasks = newProjectVideoPlanTasks.map((task) => (
                        task.task_token === taskToken ? { ...task, provider } : task
                    ));
                    newProjectVideoPlanDirty = true;
                    newProjectVideoPlanNotice = '저장하지 않은 생성 도구 변경이 있습니다.';
                },
                onSaveVideoPlan: async (tasks) => {
                    bumpNewProjectStateEpoch('video');
                    newProjectVideoPlanState = { ...newProjectVideoPlanState, status: 'saving' };
                    newProjectVideoPlanNotice = '저장 중…';
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectVideoPlan({
                            tasks,
                            expected_design_revision_sha256: newProjectVideoPlanState.design_revision_sha256,
                            expected_image_plan_revision_sha256: newProjectVideoPlanState.image_plan_revision_sha256,
                            expected_video_plan_revision_sha256: newProjectVideoPlanState.revision_sha256,
                        });
                        const nextState = result?.state || result;
                        if (!nextState?.ok || !Array.isArray(nextState.tasks)) throw new Error('VIDEO_PLAN_SAVE_FAILED');
                        newProjectVideoPlanState = nextState;
                        newProjectVideoPlanTasks = structuredClone(nextState.tasks);
                        newProjectVideoPlanDirty = false;
                        newProjectVideoPlanNotice = '프롬프트와 생성 도구를 저장했습니다.';
                        render();
                        return nextState;
                    } catch {
                        newProjectVideoPlanState = { ...newProjectVideoPlanState, status: 'error' };
                        newProjectVideoPlanNotice = '영상 작업을 저장하지 못했습니다.';
                        render();
                        return { ok: false, executed: false, model_called: false };
                    }
                },
                onPrepareVideoPlan: async (tasks) => {
                    bumpNewProjectStateEpoch('video');
                    const needsSave = newProjectVideoPlanDirty
                        || ['derived', 'design_changed', 'image_changed'].includes(newProjectVideoPlanState.status);
                    newProjectVideoPlanState = { ...newProjectVideoPlanState, status: 'preparing' };
                    newProjectVideoPlanNotice = '영상 작업 순서를 준비하는 중…';
                    render();
                    try {
                        let current = newProjectVideoPlanState;
                        if (needsSave) {
                            const saved = await pipelineClient.saveNewProjectVideoPlan({
                                tasks,
                                expected_design_revision_sha256: current.design_revision_sha256,
                                expected_image_plan_revision_sha256: current.image_plan_revision_sha256,
                                expected_video_plan_revision_sha256: current.revision_sha256,
                            });
                            current = saved?.state || saved;
                            if (!current?.ok) throw new Error('VIDEO_PLAN_SAVE_FAILED');
                        }
                        const prepared = await pipelineClient.prepareNewProjectVideoPlan({
                            expected_design_revision_sha256: current.design_revision_sha256,
                            expected_image_plan_revision_sha256: current.image_plan_revision_sha256,
                            expected_video_plan_revision_sha256: current.revision_sha256,
                        });
                        const nextState = prepared?.state || prepared;
                        if (!nextState?.ok) throw new Error('VIDEO_PLAN_PREPARE_FAILED');
                        newProjectVideoPlanState = nextState;
                        newProjectVideoPlanTasks = structuredClone(nextState.tasks || current.tasks || tasks);
                        newProjectVideoPlanDirty = false;
                        newProjectVideoPlanNotice = '영상 작업 순서를 준비했습니다. 생성은 시작하지 않았습니다.';
                        render();
                        return prepared;
                    } catch {
                        newProjectVideoPlanState = { ...newProjectVideoPlanState, status: 'error' };
                        newProjectVideoPlanNotice = '영상 작업 준비를 저장하지 못했습니다.';
                        render();
                        return { ok: false, executed: false, model_called: false };
                    }
                },
                onToggleVideoRetry: async (taskToken, selected) => {
                    bumpNewProjectStateEpoch('video');
                    const previous = newProjectVideoPlanTasks;
                    const nextTasks = previous.map((task) => task.task_token === taskToken
                        ? { ...task, status: selected ? '재제작' : task.result_token ? '결과연결' : '준비' }
                        : task);
                    newProjectVideoPlanTasks = nextTasks;
                    newProjectVideoPlanNotice = '다시 만들 항목을 저장하는 중…';
                    newProjectMediaReviewRetryNotice = '다시 만들기 선택을 저장하는 중…';
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectVideoRetrySelection({
                            task_tokens: nextTasks.filter((task) => task.status === '재제작').map((task) => task.task_token),
                            expected_design_revision_sha256: newProjectVideoPlanState.design_revision_sha256,
                            expected_image_plan_revision_sha256: newProjectVideoPlanState.image_plan_revision_sha256,
                            expected_video_plan_revision_sha256: newProjectVideoPlanState.revision_sha256,
                        });
                        const nextState = result?.state || result;
                        if (!nextState?.ok) throw new Error('VIDEO_RETRY_SAVE_FAILED');
                        newProjectVideoPlanState = nextState;
                        newProjectVideoPlanTasks = structuredClone(nextState.tasks);
                        newProjectVideoPlanNotice = selected ? '다시 만들기로 선택했습니다.' : '다시 만들기 선택을 해제했습니다.';
                        newProjectMediaReviewRetryNotice = selected
                            ? '다시 만들기 선택을 저장했습니다.'
                            : '다시 만들기 선택 해제를 저장했습니다.';
                    } catch {
                        newProjectVideoPlanTasks = previous;
                        newProjectVideoPlanNotice = '다시 만들 선택을 저장하지 못했습니다.';
                        newProjectMediaReviewRetryNotice = '선택을 저장하지 못했습니다. 다시 선택하세요.';
                    }
                    render();
                },
                onSaveVideoReviewDecision: async (taskToken, decision) => {
                    bumpNewProjectStateEpoch('video');
                    const previousState = newProjectVideoPlanState;
                    const previousTasks = newProjectVideoPlanTasks;
                    newProjectVideoPlanNotice = '결과 선택을 저장하는 중…';
                    newProjectMediaReviewRetryNotice = '결과 선택을 저장하는 중…';
                    render();
                    try {
                        const result = await pipelineClient.saveNewProjectVideoReviewDecision({
                            task_token: taskToken,
                            decision,
                            expected_design_revision_sha256: previousState.design_revision_sha256,
                            expected_image_plan_revision_sha256: previousState.image_plan_revision_sha256,
                            expected_video_plan_revision_sha256: previousState.revision_sha256,
                        });
                        const nextState = result?.state || result;
                        if (!nextState?.ok) throw new Error('VIDEO_REVIEW_SAVE_FAILED');
                        newProjectVideoPlanState = nextState;
                        newProjectVideoPlanTasks = structuredClone(nextState.tasks);
                        newProjectVideoPlanNotice = decision === 'use' ? '이 결과를 사용하기로 저장했습니다.' : '다시 만들기로 저장했습니다.';
                        newProjectMediaReviewRetryNotice = newProjectVideoPlanNotice;
                        await refreshNewProjectClipSelection();
                    } catch {
                        newProjectVideoPlanState = previousState;
                        newProjectVideoPlanTasks = previousTasks;
                        newProjectVideoPlanNotice = '결과 선택을 저장하지 못했습니다.';
                        newProjectMediaReviewRetryNotice = '결과 선택을 저장하지 못했습니다. 다시 선택하세요.';
                    }
                    render();
                },
                onRefreshVideoResults: refreshNewProjectVideoResults,
                onLoadVideoCandidatePreview: (payload) => pipelineClient.loadVideoResultImportPreview(payload),
                onConnectVideoResult: async ({ taskToken, candidateToken }) => {
                    bumpNewProjectStateEpoch('video');
                    newProjectVideoPlanNotice = '완료 영상을 연결하는 중…';
                    render();
                    try {
                        let current = newProjectVideoPlanState;
                        if (newProjectVideoPlanDirty || ['derived', 'design_changed', 'image_changed'].includes(current.status)) {
                            const saved = await pipelineClient.saveNewProjectVideoPlan({
                                tasks: newProjectVideoPlanTasks,
                                expected_design_revision_sha256: current.design_revision_sha256,
                                expected_image_plan_revision_sha256: current.image_plan_revision_sha256,
                                expected_video_plan_revision_sha256: current.revision_sha256,
                            });
                            current = saved?.state || saved;
                            if (!current?.ok) throw new Error('VIDEO_PLAN_SAVE_FAILED');
                        }
                        const result = await pipelineClient.connectNewProjectVideoResult({
                            task_token: taskToken,
                            candidate_token: candidateToken,
                            expected_design_revision_sha256: current.design_revision_sha256,
                            expected_image_plan_revision_sha256: current.image_plan_revision_sha256,
                            expected_video_plan_revision_sha256: current.revision_sha256,
                        });
                        if (!result?.connected || !result?.state) throw new Error('VIDEO_RESULT_CONNECT_FAILED');
                        newProjectVideoPlanState = result.state;
                        newProjectVideoPlanTasks = structuredClone(result.state.tasks);
                        newProjectVideoPlanDirty = false;
                        await refreshNewProjectVideoPreviews(newProjectVideoPlanTasks);
                        newProjectVideoPlanNotice = '완료 영상을 연결했습니다.';
                        render();
                        return result;
                    } catch {
                        newProjectVideoPlanNotice = '완료 영상을 연결하지 못했습니다.';
                        render();
                        return { ok: false, connected: false, executed: false };
                    }
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
                dstBundleImportWorkspace,
                dstBundleImportPreview,
                dstBundleImportPlan,
                videoResultImportWorkspace,
                videoResultImportPlan,
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
                onRefreshDstBundleImportWorkspace: async () => {
                    dstBundleImportWorkspace = emptyDstBundleImportWorkspace('loading');
                    dstBundleImportPreview = emptyDstBundleImportPreview('loading');
                    render();
                    try {
                        const loaded = await readDstBundleImportState();
                        dstBundleImportWorkspace = loaded.workspace;
                        dstBundleImportPreview = loaded.preview;
                    } catch {
                        dstBundleImportWorkspace = emptyDstBundleImportWorkspace('blocked', 'DST_BUNDLE_IMPORT_WORKSPACE_READ_FAILED');
                        dstBundleImportPreview = emptyDstBundleImportPreview('blocked', 'DST_BUNDLE_IMPORT_PREVIEW_READ_FAILED');
                    }
                    dstBundleImportPlan = emptyDstBundleImportPlan();
                    render();
                    return dstBundleImportWorkspace;
                },
                onLoadDstBundleImportPreview: async (payload) => {
                    dstBundleImportPreview = await pipelineClient.loadDstBundleImportPreview(payload);
                    return dstBundleImportPreview;
                },
                onPlanDstBundleImport: async (payload) => {
                    try {
                        dstBundleImportPlan = await pipelineClient.planDstBundleImport(payload);
                    } catch {
                        dstBundleImportPlan = emptyDstBundleImportPlan('blocked', 'DST_BUNDLE_IMPORT_PLAN_FAILED');
                    }
                    return dstBundleImportPlan;
                },
                onConfirmDstBundleImport: async (payload) => {
                    const result = await pipelineClient.confirmDstBundleImport(payload);
                    dstBundleImportPlan = {
                        ...dstBundleImportPlan,
                        ...result,
                        ready: false,
                        status: result?.imported || result?.already_current ? 'imported' : 'blocked',
                    };
                    if (result?.imported || result?.already_current) {
                        const [loadedState, loadedRetryPlan, loadedImport] = await Promise.all([
                            pipelineClient.readProductionState().catch(() => null),
                            pipelineClient.getMediaRetryPlan().catch(() => null),
                            readDstBundleImportState(dstBundleImportPlan.source_bundle_id).catch(() => null),
                        ]);
                        if (loadedState?.state) state = normalizeState(loadedState.state);
                        if (loadedRetryPlan) mediaRetryPlan = loadedRetryPlan;
                        if (loadedImport) {
                            dstBundleImportWorkspace = loadedImport.workspace;
                            dstBundleImportPreview = loadedImport.preview;
                        }
                        mediaReviewSaveStatus = '';
                        render();
                    }
                    return result;
                },
                onRefreshVideoResultImportWorkspace: async () => {
                    videoResultImportWorkspace = emptyVideoResultImportWorkspace('loading');
                    videoResultImportPlan = emptyVideoResultImportPlan();
                    render();
                    try {
                        videoResultImportWorkspace = await pipelineClient.getVideoResultImportWorkspace();
                    } catch {
                        videoResultImportWorkspace = emptyVideoResultImportWorkspace('blocked', 'VIDEO_IMPORT_WORKSPACE_READ_FAILED');
                    }
                    render();
                    return videoResultImportWorkspace;
                },
                onLoadVideoResultImportPreview: (payload) => pipelineClient.loadVideoResultImportPreview(payload),
                onPlanVideoResultImport: async (payload) => {
                    try {
                        videoResultImportPlan = await pipelineClient.planVideoResultImport(payload);
                    } catch {
                        videoResultImportPlan = emptyVideoResultImportPlan('blocked', 'VIDEO_IMPORT_PLAN_FAILED');
                    }
                    return videoResultImportPlan;
                },
                onConfirmVideoResultImport: async (payload) => {
                    const result = await pipelineClient.confirmVideoResultImport(payload);
                    videoResultImportPlan = {
                        ...videoResultImportPlan,
                        ...result,
                        ready: false,
                        status: result?.imported || result?.already_current ? 'imported' : 'blocked',
                    };
                    if (result?.imported || result?.already_current) {
                        const [loadedState, loadedRetryPlan, loadedVideoWorkspace] = await Promise.all([
                            pipelineClient.readProductionState().catch(() => null),
                            pipelineClient.getMediaRetryPlan().catch(() => null),
                            pipelineClient.getVideoResultImportWorkspace().catch(() => null),
                        ]);
                        if (loadedState?.state) state = normalizeState(loadedState.state);
                        if (loadedRetryPlan) mediaRetryPlan = loadedRetryPlan;
                        if (loadedVideoWorkspace) videoResultImportWorkspace = loadedVideoWorkspace;
                        mediaReviewSaveStatus = '';
                        render();
                    }
                    return result;
                },
                onPreviewCommand: (commandSpec) => pipelineClient.previewCommand(commandSpec),
                onPickParent: pickParentFolder,
                onPickMediaRoot: pickExternalMediaRoot,
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
                }, workspaceMode),
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
            onNewProject: () => {
                workspaceMode = 'new-project';
                workspaceModeExplicit = true;
                switchTab('intake');
            },
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
        const initialStateEpochs = { ...newProjectStateEpochs };
        const initialFinalRenderRequestEpoch = beginNewProjectFinalRenderRequest();
        const finalRenderResultPromise = pipelineClient.getNewProjectFinalRender()
            .then((value) => ({ status: 'fulfilled', value }), (reason) => ({ status: 'rejected', reason }));
        const [configResult, harnessResult, newProjectResult, designResult, imagePlanResult, imageWorkspaceResult, videoPlanResult, videoWorkspaceResult, clipSelectionResult, finalStitchResult, videoImportResult, executionResult] = await Promise.allSettled([
            pipelineClient.getConfig(),
            pipelineClient.getHarnessContractStatus(),
            pipelineClient.getNewProjectDraftState(),
            pipelineClient.getNewProjectDesignState(),
            pipelineClient.getNewProjectImagePlan(),
            pipelineClient.getNewProjectImageResultWorkspace(),
            pipelineClient.getNewProjectVideoPlan(),
            pipelineClient.getNewProjectVideoResultWorkspace(),
            pipelineClient.getNewProjectClipSelection(),
            pipelineClient.getNewProjectFinalStitch(),
            pipelineClient.getVideoResultImportWorkspace(),
            pipelineClient.getNewProjectExecutionState(),
        ]);
        if (configResult.status === 'fulfilled') {
            const result = configResult.value;
            loadedConfig = result?.config || result || loadedConfig;
        }
        if (harnessResult.status === 'fulfilled' && harnessResult.value) {
            harnessStatus = harnessResult.value;
        }
        if (isLatestNewProjectStateEpoch('draft', initialStateEpochs.draft)) {
            if (newProjectResult.status === 'fulfilled' && newProjectResult.value) {
                newProjectDraftState = newProjectResult.value;
                if (newProjectResult.value.draft) newProjectDraftValue = { ...newProjectResult.value.draft };
                newProjectDraftDirty = { brief: false, script: false, settings: false };
            } else {
                newProjectDraftState = {
                    ...newProjectDraftState,
                    status: 'error',
                    blockers: ['NEW_PROJECT_DRAFT_READ_FAILED'],
                };
            }
        }
        if (isLatestNewProjectStateEpoch('design', initialStateEpochs.design)) {
            if (designResult.status === 'fulfilled' && designResult.value) {
                newProjectDesignState = designResult.value;
                newProjectDesignBoard = structuredClone(designResult.value.board || { characters: [], locations: [], scenes: [] });
                newProjectDesignDirty = false;
            } else {
                newProjectDesignState = emptyNewProjectDesignState('error', 'DESIGN_STATE_READ_FAILED');
            }
        }
        if (isLatestNewProjectStateEpoch('image', initialStateEpochs.image)) {
            if (imagePlanResult.status === 'fulfilled' && imagePlanResult.value) {
                newProjectImagePlanState = imagePlanResult.value;
                newProjectImagePlanTasks = structuredClone(imagePlanResult.value.tasks || []);
                newProjectImagePlanDirty = false;
                await refreshNewProjectImagePreviews(newProjectImagePlanTasks);
            } else {
                newProjectImagePlanState = emptyNewProjectImagePlanState('error', 'IMAGE_PLAN_READ_FAILED');
            }
            if (isLatestNewProjectStateEpoch('image', initialStateEpochs.image)) {
                if (imageWorkspaceResult.status === 'fulfilled' && imageWorkspaceResult.value) {
                    newProjectImageResultWorkspace = imageWorkspaceResult.value;
                } else {
                    newProjectImageResultWorkspace = emptyNewProjectImageResultWorkspace('error', 'IMAGE_RESULT_WORKSPACE_READ_FAILED');
                }
            }
        }
        if (isLatestNewProjectStateEpoch('video', initialStateEpochs.video)) {
            if (videoPlanResult.status === 'fulfilled' && videoPlanResult.value) {
                newProjectVideoPlanState = videoPlanResult.value;
                newProjectVideoPlanTasks = structuredClone(videoPlanResult.value.tasks || []);
                newProjectVideoPlanDirty = false;
                await refreshNewProjectVideoPreviews(newProjectVideoPlanTasks);
            } else {
                newProjectVideoPlanState = emptyNewProjectVideoPlanState('error', 'VIDEO_PLAN_READ_FAILED');
            }
            if (isLatestNewProjectStateEpoch('video', initialStateEpochs.video)) {
                if (videoWorkspaceResult.status === 'fulfilled' && videoWorkspaceResult.value) {
                    newProjectVideoResultWorkspace = videoWorkspaceResult.value;
                } else {
                    newProjectVideoResultWorkspace = emptyNewProjectVideoResultWorkspace('error', 'VIDEO_RESULT_WORKSPACE_READ_FAILED');
                }
            }
        }
        if (isLatestNewProjectStateEpoch('clip', initialStateEpochs.clip)) {
            if (clipSelectionResult.status === 'fulfilled' && clipSelectionResult.value) {
                newProjectClipSelectionState = clipSelectionResult.value;
                newProjectClipSelections = structuredClone(clipSelectionResult.value.clips || []);
                newProjectClipSelectionDirty = false;
            } else {
                newProjectClipSelectionState = emptyNewProjectClipSelectionState('error', 'CLIP_SELECTION_READ_FAILED');
            }
        }
        if (isLatestNewProjectStateEpoch('finalStitch', initialStateEpochs.finalStitch)) {
            if (finalStitchResult.status === 'fulfilled' && finalStitchResult.value) {
                newProjectFinalStitchState = finalStitchResult.value;
            } else {
                newProjectFinalStitchState = emptyNewProjectFinalStitchState('error', 'FINAL_STITCH_READ_FAILED');
            }
        }
        if (videoImportResult.status === 'fulfilled' && videoImportResult.value) {
            videoResultImportWorkspace = videoImportResult.value;
        } else {
            videoResultImportWorkspace = emptyVideoResultImportWorkspace('blocked', 'VIDEO_IMPORT_WORKSPACE_READ_FAILED');
        }
        if (isLatestNewProjectStateEpoch('execution', initialStateEpochs.execution)) {
            if (executionResult.status === 'fulfilled' && executionResult.value) {
                newProjectExecutionState = executionResult.value;
            } else {
                newProjectExecutionState = emptyNewProjectExecutionState('error', 'NEW_PROJECT_EXECUTION_READ_FAILED');
            }
        }
        config = {
            ...config,
            ...loadedConfig,
            productionRoot: typeof loadedConfig.productionRoot === 'string' ? loadedConfig.productionRoot : '',
            productionParentRoot: typeof loadedConfig.productionParentRoot === 'string' ? loadedConfig.productionParentRoot : '',
            dryRunMode: true,
            allowSafeCommandExecution: false,
        };
        if (!workspaceModeExplicit) workspaceMode = config.productionRoot ? 'production' : 'new-project';

        if (config.productionRoot) {
            const [loadedState, loadedRetryPlan, loadedDstImport, loadedG3, loadedPromotion, loadedFinishing] = await Promise.all([
                pipelineClient.readProductionState().catch(() => ({ state: EMPTY_PIPELINE_STATE })),
                pipelineClient.getMediaRetryPlan().catch(() => emptyMediaRetryPlan('blocked', 'MEDIA_RETRY_PLAN_READ_FAILED')),
                readDstBundleImportState().catch(() => ({
                    workspace: emptyDstBundleImportWorkspace('blocked', 'DST_BUNDLE_IMPORT_WORKSPACE_READ_FAILED'),
                    preview: emptyDstBundleImportPreview('blocked', 'DST_BUNDLE_IMPORT_PREVIEW_READ_FAILED'),
                })),
                pipelineClient.getG3ReviewWorkspace().catch(() => emptyG3ReviewState('error')),
                pipelineClient.planG3ProductionPromotion().catch(() => staleG3PromotionPlan('G3_PROMOTION_PLAN_FAILED')),
                pipelineClient.getFinishingWorkspace().catch(() => ({ status: 'error', blockers: ['FINISHING_WORKSPACE_LOAD_FAILED'] })),
            ]);
            state = normalizeState(loadedState?.state);
            mediaRetryPlan = loadedRetryPlan;
            dstBundleImportWorkspace = loadedDstImport.workspace;
            dstBundleImportPreview = loadedDstImport.preview;
            dstBundleImportPlan = emptyDstBundleImportPlan();
            g3Workspace = normalizeG3ReviewState(loadedG3);
            g3PromotionPlan = normalizeG3PromotionPlan(loadedPromotion);
            finishingWorkspace = normalizeFinishingWorkspace(loadedFinishing);
            g3ActiveShotId = g3Workspace.shots[0]?.shot_id || '';
        } else {
            state = EMPTY_PIPELINE_STATE;
            mediaRetryPlan = emptyMediaRetryPlan('empty', 'MEDIA_RETRY_PRODUCTION_ROOT_NOT_CONFIGURED');
            dstBundleImportWorkspace = emptyDstBundleImportWorkspace('empty', 'DST_BUNDLE_IMPORT_PRODUCTION_ROOT_NOT_CONFIGURED');
            dstBundleImportPreview = emptyDstBundleImportPreview('empty', 'DST_BUNDLE_IMPORT_PRODUCTION_ROOT_NOT_CONFIGURED');
            dstBundleImportPlan = emptyDstBundleImportPlan();
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

        const finalRenderResult = await finalRenderResultPromise;
        if (!isLatestNewProjectFinalRenderRequest(initialFinalRenderRequestEpoch)) return;
        if (finalRenderResult.status === 'fulfilled' && finalRenderResult.value) {
            newProjectFinalRenderState = finalRenderResult.value;
            await loadNewProjectFinalRenderPreview(initialFinalRenderRequestEpoch);
        } else {
            newProjectFinalRenderState = emptyNewProjectFinalRenderState('blocked');
        }
        if (!isLatestNewProjectFinalRenderRequest(initialFinalRenderRequestEpoch)) return;
        render();
    })();

    return container;
}
