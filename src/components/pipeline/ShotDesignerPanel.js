import { actionButton, card, codeBlock, el, panelShell, statusBadge } from './ui.js';
import {
    buildDeepSearchSceneImageCommandSpec,
    buildDeepSearchSceneImageDraftMarkdown,
    buildDeepSearchSceneImagePrompt,
    DEEPSEARCH_PROFILE,
} from '../../lib/pipeline/deepsearchSceneImages.js';
import { CameraControlStrip } from './CameraControlStrip.js';
import { CommandPreviewCard } from './CommandPreviewCard.js';
import { MediaReferencePicker } from './MediaReferencePicker.js';
import { GenerationHistoryGrid } from './GenerationHistoryGrid.js';

const MODEL_OPTIONS = Object.freeze([
    'seedance_2_i2v_payload_only',
    'flow_omni_payload_only',
    'dual_route_payload_only',
]);

const ASPECT_RATIO_OPTIONS = Object.freeze(['9:16', '16:9', '1:1', '4:5', '21:9']);
const DURATION_OPTIONS = Object.freeze([3, 4, 5, 6, 8, 10]);

function seedancePromptPack(state, clipId) {
    return (state.promptPacks || []).find((pack) => (
        pack.clip_id === clipId && String(pack.generator || '').includes('seedance')
    )) || (state.promptPacks || []).find((pack) => pack.clip_id === clipId) || {};
}

function motionForClip(state, clipId) {
    return (state.motionBoard || []).find((shot) => shot.clip_id === clipId) || {};
}

function firstAssetForClip(state, clipId) {
    return (state.assets || state.imageDashboard?.assets || []).find((asset) => asset.target_clip_id === clipId) || {};
}

function promptFromClip(clip = {}) {
    return [
        clip.dramatic_beat,
        clip.action,
        clip.camera,
        clip.lighting,
    ].filter(Boolean).join('\n');
}

function riskNotes(clip = {}, motion = {}) {
    return [
        clip.risk,
        motion.movement_risk ? `movement: ${motion.movement_risk}` : '',
        motion.identity_risk ? `identity: ${motion.identity_risk}` : '',
        motion.continuity_notes,
    ].filter(Boolean).join('\n');
}

function createPayload(state, clipId) {
    const clip = (state.storyboard || [])[0]?.clip_id === clipId
        ? (state.storyboard || [])[0]
        : (state.storyboard || []).find((item) => item.clip_id === clipId) || (state.storyboard || [])[0] || {};
    const motion = motionForClip(state, clip.clip_id);
    const promptPack = seedancePromptPack(state, clip.clip_id);
    const firstAsset = firstAssetForClip(state, clip.clip_id);

    return {
        scene_id: clip.scene_id || '',
        clip_id: clip.clip_id || '',
        prompt: promptFromClip(clip),
        first_frame_asset_id: firstAsset.asset_id || '',
        end_frame_asset_id: '',
        references: (clip.reference_dependencies || []).map((asset_id) => ({ asset_id, role: 'storyboard_reference' })),
        duration: promptPack.duration || clip.duration || 5,
        aspect_ratio: promptPack.aspect_ratio || state.project?.aspect_ratio || '9:16',
        camera: motion.shot_size || clip.camera || 'slow dolly push-in',
        lens: 'anamorphic cinema',
        focal_length: 35,
        aperture: 'f/2.8',
        camera_movement: motion.camera_movement || clip.dominant_camera_strategy || 'one slow push-in',
        lighting: clip.lighting || '',
        audio_sfx_dialogue: clip.audio_sfx_dialogue || '',
        negative_constraints: promptPack.negative_constraints || [],
        risk_notes: riskNotes(clip, motion),
    };
}

function selectControl(label, value, options, onChange) {
    const select = el('select', {
        className: 'w-full rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm font-semibold text-white outline-none transition focus:border-cyan-400/50',
        attrs: { 'aria-label': label },
    });
    options.forEach((option) => {
        select.appendChild(el('option', { text: option, value: option }));
    });
    select.value = String(value ?? options[0] ?? '');
    select.addEventListener('change', () => onChange(select.value));
    return el('label', { className: 'flex min-w-0 flex-col gap-2' }, [
        el('span', { text: label, className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
        select,
    ]);
}

function textareaControl(label, value, onInput, rows = 3) {
    const textarea = el('textarea', {
        className: 'min-h-[96px] w-full resize-y rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-sm leading-6 text-white outline-none transition placeholder:text-secondary focus:border-cyan-400/50',
        attrs: { rows, 'aria-label': label },
    });
    textarea.value = value || '';
    textarea.addEventListener('input', () => onInput(textarea.value));
    return el('label', { className: 'flex flex-col gap-2' }, [
        el('span', { text: label, className: 'text-[11px] font-bold uppercase tracking-widest text-secondary' }),
        textarea,
    ]);
}

async function copyText(text, button, fallbackLabel) {
    try {
        await navigator.clipboard.writeText(text);
        button.textContent = 'Copied';
    } catch {
        button.textContent = 'Copy failed';
    }
    setTimeout(() => {
        button.textContent = fallbackLabel;
    }, 1200);
}

export function ShotDesignerPanel({ state, onSavePlanningFile }) {
    const container = el('div');
    const clips = state.storyboard || [];
    let selectedClipId = clips[0]?.clip_id || '';
    let selectedModel = MODEL_OPTIONS[0];
    let payload = createPayload(state, selectedClipId);

    const render = () => {
        container.innerHTML = '';
        let jsonCode = null;
        let deepSearchPromptCode = null;
        let deepSearchCommandMount = null;
        const jsonText = () => JSON.stringify(payload, null, 2);
        const deepSearchPromptText = () => buildDeepSearchSceneImagePrompt(payload, state);
        const deepSearchDraftText = () => buildDeepSearchSceneImageDraftMarkdown(state, payload);
        const deepSearchCommandSpec = () => buildDeepSearchSceneImageCommandSpec(state, payload);
        const refreshJson = () => {
            if (jsonCode) jsonCode.textContent = jsonText();
        };
        const refreshDeepSearchPreview = () => {
            if (deepSearchPromptCode) deepSearchPromptCode.textContent = deepSearchPromptText();
            if (deepSearchCommandMount) {
                deepSearchCommandMount.replaceChildren(CommandPreviewCard({ commandSpec: deepSearchCommandSpec() }));
            }
        };
        const setPayload = (patch, rerender = false) => {
            payload = { ...payload, ...patch };
            if (rerender) render();
            else {
                refreshJson();
                refreshDeepSearchPreview();
            }
        };

        const clipSelect = selectControl(
            'Clip',
            selectedClipId,
            clips.map((clip) => clip.clip_id),
            (clipId) => {
                selectedClipId = clipId;
                payload = createPayload(state, selectedClipId);
                render();
            },
        );

        const modelSelect = selectControl('Model target', selectedModel, MODEL_OPTIONS, (model) => {
            selectedModel = model;
        });

        const aspectSelect = selectControl('Aspect ratio', payload.aspect_ratio, ASPECT_RATIO_OPTIONS, (aspect_ratio) => setPayload({ aspect_ratio }));
        const durationSelect = selectControl('Duration', payload.duration, DURATION_OPTIONS.map(String), (duration) => setPayload({ duration: Number(duration) }));

        const copyButton = actionButton('Copy Shot Payload JSON');
        copyButton.addEventListener('click', () => copyText(jsonText(), copyButton, 'Copy Shot Payload JSON'));

        const saveButton = actionButton('Save to storyboard draft', {
            disabled: !state.project?.root_path || !payload.clip_id,
            onClick: () => onSavePlanningFile?.({
                rootPath: state.project.root_path,
                relativePath: `storyboard/drafts/${payload.clip_id || 'shot'}_shot_payload.json`,
                content: jsonText(),
            }),
        });

        const jsonBlock = codeBlock(jsonText());
        jsonCode = jsonBlock.querySelector('code');
        const deepSearchPromptBlock = codeBlock(deepSearchPromptText());
        deepSearchPromptCode = deepSearchPromptBlock.querySelector('code');

        const copyDeepSearchPromptButton = actionButton('Copy DeepSearchTeam prompt', {
            variant: 'muted',
        });
        copyDeepSearchPromptButton.addEventListener('click', () => copyText(
            deepSearchPromptText(),
            copyDeepSearchPromptButton,
            'Copy DeepSearchTeam prompt',
        ));

        const saveDeepSearchPromptButton = actionButton('Save DeepSearchTeam prompt draft', {
            disabled: !state.project?.root_path || !payload.clip_id,
            onClick: () => onSavePlanningFile?.({
                rootPath: state.project.root_path,
                relativePath: `image_generation/prompts/${payload.clip_id || 'shot'}_deepsearch_scene_image.md`,
                content: deepSearchDraftText(),
            }),
        });

        deepSearchCommandMount = el('div');
        deepSearchCommandMount.appendChild(CommandPreviewCard({ commandSpec: deepSearchCommandSpec() }));

        container.appendChild(panelShell('Shot Designer', 'Preview-only shot payload builder adapted from the old Video and Cinema Studio control patterns. No generation, upload, or external review is wired.', [
            el('div', { className: 'flex flex-wrap items-center gap-2' }, [
                statusBadge('ShotPayload draft', 'PREVIEW'),
                statusBadge('No hosted API calls', 'BLOCK'),
                statusBadge('No submit jobs', 'BLOCK'),
                statusBadge('Planning file only', 'PASS'),
                copyButton,
                saveButton,
            ]),
            card([
                el('div', { className: 'mb-4 flex flex-wrap items-center justify-between gap-2' }, [
                    el('div', {}, [
                        el('h3', { text: 'Prompt And Output Shape', className: 'text-sm font-black uppercase tracking-widest text-white' }),
                        el('p', { text: 'Model is UI metadata only. The emitted JSON uses the ShotPayload contract fields.', className: 'mt-1 text-xs text-secondary' }),
                    ]),
                    statusBadge(selectedModel, 'PREVIEW'),
                ]),
                el('div', { className: 'grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4' }, [
                    clipSelect,
                    modelSelect,
                    aspectSelect,
                    durationSelect,
                ]),
                el('div', { className: 'mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2' }, [
                    textareaControl('Prompt', payload.prompt, (prompt) => setPayload({ prompt }), 7),
                    el('div', { className: 'flex flex-col gap-4' }, [
                        textareaControl('Lighting', payload.lighting, (lighting) => setPayload({ lighting })),
                        textareaControl('Audio / SFX / Dialogue', payload.audio_sfx_dialogue, (audio_sfx_dialogue) => setPayload({ audio_sfx_dialogue })),
                    ]),
                ]),
                el('div', { className: 'mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2' }, [
                    textareaControl('Negative Constraints', (payload.negative_constraints || []).join('\n'), (value) => setPayload({
                        negative_constraints: value.split('\n').map((item) => item.trim()).filter(Boolean),
                    }), 5),
                    textareaControl('Risk Notes', payload.risk_notes, (risk_notes) => setPayload({ risk_notes }), 5),
                ]),
            ]),
            CameraControlStrip({
                value: payload,
                onChange: (nextCamera) => setPayload(nextCamera, true),
            }),
            MediaReferencePicker({
                state,
                value: payload,
                onChange: (nextPayload) => {
                    payload = nextPayload;
                    render();
                },
            }),
            GenerationHistoryGrid({ state, payload }),
            card([
                el('div', { className: 'mb-3 flex flex-wrap items-center justify-between gap-2' }, [
                    el('h3', { text: 'ShotPayload JSON', className: 'text-sm font-black uppercase tracking-widest text-white' }),
                    statusBadge('copy/save only', 'PREVIEW'),
                ]),
                jsonBlock,
            ]),
            card([
                el('div', { className: 'mb-4 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between' }, [
                    el('div', {}, [
                        el('h3', { text: 'DeepSearchTeam Scene Image Prompt', className: 'text-sm font-black uppercase tracking-widest text-white' }),
                        el('p', {
                            text: `Storyboard-to-scene image route. Profile ${DEEPSEARCH_PROFILE}, Thinking mode, one finished image only. Execution remains blocked in this UI.`,
                            className: 'mt-1 text-xs leading-5 text-secondary',
                        }),
                    ]),
                    el('div', { className: 'flex flex-wrap gap-2' }, [
                        statusBadge('goldpure369 required', 'BLOCK'),
                        statusBadge('Thinking mode required', 'BLOCK'),
                        statusBadge('one image only', 'PREVIEW'),
                        statusBadge('no generation run', 'BLOCK'),
                        copyDeepSearchPromptButton,
                        saveDeepSearchPromptButton,
                    ]),
                ]),
                deepSearchPromptBlock,
            ], 'border-cyan-400/20'),
            deepSearchCommandMount,
        ]));
    };

    render();
    return container;
}

export default ShotDesignerPanel;
