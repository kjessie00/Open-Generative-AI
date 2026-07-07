import { BLOCKERS } from './blockers.js';
import { joinPath } from './filePathUtils.js';
import { SIDE_EFFECT_TYPES } from './sideEffects.js';

export const DEEPSEARCH_TEAM_ROOT = '/Users/jessiek/StudioProjects/deepSearchTeam';
export const DEEPSEARCH_PROFILE = 'goldpure369';

export const DEFAULT_SCENE_IMAGE_NEGATIVE_CONSTRAINTS = Object.freeze([
    'no collage',
    'no storyboard grid',
    'no contact sheet',
    'no subtitles',
    'no captions',
    'no logo',
    'no watermark',
    'no UI text',
    'no extra characters',
    'no face morphing',
    'no warped hands',
    'no heavy retouching',
]);

function asArray(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value === undefined || value === null || value === '') return [];
    return [value];
}

function uniqueStrings(values) {
    return Array.from(new Set(asArray(values).map((value) => String(value).trim()).filter(Boolean)));
}

function safeId(value, fallback = 'scene') {
    return String(value || fallback).replace(/[^A-Za-z0-9_-]+/g, '_');
}

function projectRoot(state = {}) {
    return state.project?.root_path || '';
}

function outputPath(state = {}, clipId = 'scene') {
    return joinPath(
        projectRoot(state),
        'image_generation',
        'deepsearch_scene_images',
        `${safeId(clipId)}_scene_image_prompt.md`,
    );
}

function promptPackForClip(state = {}, clipId = '') {
    return (state.promptPacks || []).find((pack) => pack.clip_id === clipId && String(pack.generator || '').includes('seedance'))
        || (state.promptPacks || []).find((pack) => pack.clip_id === clipId)
        || {};
}

function motionForClip(state = {}, clipId = '') {
    return (state.motionBoard || []).find((shot) => shot.clip_id === clipId) || {};
}

function assetRecords(state = {}) {
    return [
        ...(state.assets || []),
        ...(state.imageDashboard?.assets || []),
    ];
}

function assetById(state = {}, assetId = '') {
    return assetRecords(state).find((asset) => asset.asset_id === assetId) || {};
}

function referenceRecord(state = {}, reference, role = 'storyboard_reference') {
    if (typeof reference === 'object' && reference !== null) {
        const asset = reference.asset_id ? assetById(state, reference.asset_id) : {};
        return {
            asset_id: reference.asset_id || asset.asset_id || '',
            path: reference.path || asset.path || '',
            role: reference.role || role,
            notes: reference.notes || asset.continuity_notes || '',
        };
    }

    const asset = assetById(state, reference);
    return {
        asset_id: String(reference || asset.asset_id || ''),
        path: asset.path || '',
        role,
        notes: asset.continuity_notes || '',
    };
}

function referencesForClip(state = {}, clip = {}, promptPack = {}) {
    const referenceIds = [
        ...asArray(clip.reference_dependencies),
        ...asArray(promptPack.attached_assets),
    ];
    const seen = new Set();

    return referenceIds.map((reference) => referenceRecord(state, reference))
        .filter((reference) => {
            const key = reference.asset_id || reference.path;
            if (!key || seen.has(key)) return false;
            seen.add(key);
            return true;
        });
}

function referenceLines(references = []) {
    if (!references.length) return ['No reference images attached. Do not invent character identity details beyond the storyboard.'];
    return references.map((reference, index) => {
        const label = `Image ${index + 1}`;
        const id = reference.asset_id ? `asset ${reference.asset_id}` : 'unlabeled asset';
        const path = reference.path ? `path ${reference.path}` : 'path not recorded';
        const role = reference.role || 'reference';
        const notes = reference.notes ? `; notes: ${reference.notes}` : '';
        return `${label}: ${id}; role: ${role}; ${path}${notes}`;
    });
}

function negativeConstraintLines(payload = {}) {
    return uniqueStrings([
        ...asArray(payload.negative_constraints),
        ...DEFAULT_SCENE_IMAGE_NEGATIVE_CONSTRAINTS,
    ]).map((item) => `- ${item}`);
}

function lineBlock(title, value) {
    const values = Array.isArray(value) ? value : [value];
    const body = values.map((item) => String(item || '').trim()).filter(Boolean);
    if (!body.length) return '';
    return `${title}:\n${body.join('\n')}`;
}

export function buildStoryboardSceneImagePayloads(state = {}) {
    return (state.storyboard || []).map((clip) => {
        const motion = motionForClip(state, clip.clip_id);
        const promptPack = promptPackForClip(state, clip.clip_id);
        const references = referencesForClip(state, clip, promptPack);
        const negativeConstraints = uniqueStrings([
            ...asArray(promptPack.negative_constraints),
            ...DEFAULT_SCENE_IMAGE_NEGATIVE_CONSTRAINTS,
        ]);

        return {
            scene_id: clip.scene_id || '',
            clip_id: clip.clip_id || '',
            prompt: [
                clip.dramatic_beat,
                clip.first_frame ? `First frame: ${clip.first_frame}` : '',
                clip.action,
            ].filter(Boolean).join('\n'),
            first_frame_asset_id: references[0]?.asset_id || '',
            end_frame_asset_id: '',
            references,
            duration: promptPack.duration || clip.duration || 5,
            aspect_ratio: promptPack.aspect_ratio || state.project?.aspect_ratio || '9:16',
            camera: motion.shot_size || clip.camera || '',
            lens: 'cinematic natural lensing',
            focal_length: 35,
            aperture: 'f/2.8',
            camera_movement: motion.camera_movement || clip.dominant_camera_strategy || '',
            lighting: clip.lighting || '',
            audio_sfx_dialogue: clip.audio_sfx_dialogue || '',
            negative_constraints: negativeConstraints,
            risk_notes: [
                clip.risk,
                motion.movement_risk ? `movement risk: ${motion.movement_risk}` : '',
                motion.identity_risk ? `identity risk: ${motion.identity_risk}` : '',
                motion.continuity_notes,
            ].filter(Boolean).join('\n'),
        };
    });
}

export function buildDeepSearchSceneImagePrompt(payload = {}, state = {}) {
    const clipId = payload.clip_id || 'clip';
    const title = state.project?.title || state.project?.production_id || 'local cinematic production';
    const brief = state.brief?.logline || state.brief?.concept || '';
    const references = asArray(payload.references).map((reference) => referenceRecord(state, reference));
    const aspectRatio = payload.aspect_ratio || state.project?.aspect_ratio || '9:16';

    return [
        lineBlock('Outcome', `Generate exactly one finished cinematic scene image for ${title}, clip ${clipId}. This is a first-frame/reference still for the local video pipeline, not a video and not a storyboard grid.`),
        brief ? lineBlock('Production brief', brief) : '',
        lineBlock('Scene and subject', [
            payload.scene_id ? `Scene id: ${payload.scene_id}` : '',
            payload.prompt || '',
        ]),
        lineBlock('Camera and composition', [
            `Aspect ratio: ${aspectRatio}.`,
            payload.camera ? `Framing / shot size: ${payload.camera}.` : '',
            payload.lens ? `Lens language: ${payload.lens}.` : '',
            payload.focal_length ? `Approximate focal length feel: ${payload.focal_length}mm.` : '',
            payload.aperture ? `Depth of field: ${payload.aperture}.` : '',
            payload.camera_movement ? `Implied video camera strategy: ${payload.camera_movement}. Render a single still that can start that movement.` : '',
        ]),
        lineBlock('Lighting and realism', [
            payload.lighting || '',
            'Photorealistic, cinematic, grounded in real materials and natural imperfections.',
            'Use believable skin, fabric, object texture, atmosphere, and practical light behavior; avoid glamorized studio polish unless the storyboard explicitly requires it.',
        ]),
        lineBlock('Reference image roles', referenceLines(references)),
        payload.audio_sfx_dialogue ? lineBlock('Story context from audio/SFX/dialogue', payload.audio_sfx_dialogue) : '',
        payload.risk_notes ? lineBlock('Continuity and risk notes', payload.risk_notes) : '',
        lineBlock('Visual constraints', negativeConstraintLines(payload)),
        lineBlock('DeepSearchTeam operator gates', [
            '- Profile goldpure369 only.',
            '- Use Thinking mode for image generation.',
            '- Produce one finished image only.',
            '- Stop before submission if the account, mode, references, or explicit approval gate cannot be verified.',
        ]),
        lineBlock('QA checks', [
            '- The still must clearly serve as the first frame/reference for the named clip.',
            '- One dominant action and one dominant camera strategy should be visually readable.',
            '- Preserve reference roles and identity/continuity constraints when references are attached.',
            '- Do not create subtitles, watermarks, UI text, logos, extra people, face morphing, warped hands, or a multi-panel layout.',
        ]),
    ].filter(Boolean).join('\n\n');
}

export function buildDeepSearchSceneImageDraftMarkdown(state = {}, payload = {}) {
    return [
        `# DeepSearchTeam Scene Image Prompt - ${payload.clip_id || 'clip'}`,
        '',
        'Execution status: PREVIEW ONLY',
        `Profile required: ${DEEPSEARCH_PROFILE}`,
        'Mode required: Thinking image generation',
        'Side effect: credit-consuming generation, blocked until explicit approval',
        '',
        '```text',
        buildDeepSearchSceneImagePrompt(payload, state),
        '```',
    ].join('\n');
}

export function buildDeepSearchSceneImageCommandSpec(state = {}, payload = {}) {
    const clipId = payload.clip_id || 'clip';
    const prompt = buildDeepSearchSceneImagePrompt(payload, state);

    return {
        preview_only: true,
        id: `deepsearch_scene_image_${safeId(clipId)}`,
        label: `DeepSearchTeam scene image - ${clipId}`,
        command: 'python',
        args: ['-m', 'dst', 'image', prompt, '-p', DEEPSEARCH_PROFILE],
        cwd: DEEPSEARCH_TEAM_ROOT,
        side_effect_type: SIDE_EFFECT_TYPES.CREDIT_CONSUMING_GENERATION,
        requires_confirmation: true,
        confirmation_token: '',
        related_clip_id: clipId,
        evidence_output_path: outputPath(state, clipId),
        disabled_reason: BLOCKERS.CREDIT_CONFIRMATION_REQUIRED,
        disabled_detail: 'DeepSearchTeam dst image is a ChatGPT image-generation side effect. This UI may copy the prompt or command preview only; execution requires a later explicit approval gate.',
    };
}

export function buildDeepSearchSceneImageCommandSpecs(state = {}) {
    return buildStoryboardSceneImagePayloads(state).map((payload) => buildDeepSearchSceneImageCommandSpec(state, payload));
}
