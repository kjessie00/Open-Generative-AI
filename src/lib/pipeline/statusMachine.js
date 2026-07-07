import { BLOCKERS } from './blockers.js';

export const PIPELINE_STAGES = Object.freeze([
    'intake',
    'storyboard',
    'motion_board',
    'assets',
    'prompt_packs',
    'review_gates',
    'queue',
    'qa',
    'final',
    'settings',
]);

export const SIDE_EFFECT_POLICIES = Object.freeze({
    planning_files: Object.freeze({ mode: 'allowed', requires_confirmation: false }),
    local_reads_writes: Object.freeze({ mode: 'allowed', requires_confirmation: false }),
    non_consuming_status_commands: Object.freeze({ mode: 'preview_only', requires_confirmation: false }),
    image_generation: Object.freeze({ mode: 'blocked', requires_confirmation: true }),
    dreamina_submit: Object.freeze({ mode: 'blocked', requires_confirmation: true }),
    gemini_review: Object.freeze({ mode: 'blocked', requires_confirmation: true }),
    external_upload: Object.freeze({ mode: 'blocked', requires_confirmation: true }),
});

export const ACTION_SIDE_EFFECTS = Object.freeze({
    write_planning_file: 'planning_files',
    read_local_project: 'local_reads_writes',
    write_local_project: 'local_reads_writes',
    preview_status_command: 'non_consuming_status_commands',
    run_status_command: 'non_consuming_status_commands',
    generate_image: 'image_generation',
    submit_dreamina: 'dreamina_submit',
    run_gemini_review: 'gemini_review',
    upload_external: 'external_upload',
});

export const PIPELINE_TRANSITIONS = Object.freeze({
    intake: Object.freeze(['storyboard', 'settings']),
    storyboard: Object.freeze(['motion_board', 'intake', 'settings']),
    motion_board: Object.freeze(['assets', 'storyboard', 'settings']),
    assets: Object.freeze(['prompt_packs', 'motion_board', 'settings']),
    prompt_packs: Object.freeze(['review_gates', 'assets', 'settings']),
    review_gates: Object.freeze(['queue', 'prompt_packs', 'settings']),
    queue: Object.freeze(['qa', 'review_gates', 'settings']),
    qa: Object.freeze(['final', 'queue', 'settings']),
    final: Object.freeze(['qa', 'settings']),
    settings: Object.freeze(['intake', 'storyboard', 'motion_board', 'assets', 'prompt_packs', 'review_gates', 'queue', 'qa', 'final']),
});

export function getSideEffectPolicy(actionOrType) {
    const type = ACTION_SIDE_EFFECTS[actionOrType] || actionOrType;
    return SIDE_EFFECT_POLICIES[type] || Object.freeze({ mode: 'blocked', requires_confirmation: true });
}

export function evaluateSideEffect(actionOrType, gates = {}) {
    const policy = getSideEffectPolicy(actionOrType);
    const confirmed = gates.explicit_confirmation === true || gates.confirmed === true;
    const isPreview = gates.dry_run === true || gates.preview_only === true;

    if (policy.mode === 'allowed') {
        return { ok: true, mode: 'allowed', blockers: [] };
    }

    if (policy.mode === 'preview_only') {
        return { ok: true, mode: 'preview_only', blockers: [] };
    }

    if (policy.requires_confirmation && !confirmed) {
        return {
            ok: false,
            mode: isPreview ? 'preview_only' : 'blocked',
            blockers: [BLOCKERS.CREDIT_CONFIRMATION_REQUIRED],
        };
    }

    return {
        ok: false,
        mode: 'blocked',
        blockers: [BLOCKERS.DREAMINA_PREFLIGHT_BLOCKED],
    };
}

export function canTransition(fromStage, toStage) {
    return Boolean(PIPELINE_TRANSITIONS[fromStage]?.includes(toStage));
}

export function getNextStages(stage) {
    return PIPELINE_TRANSITIONS[stage] || [];
}
