export const SIDE_EFFECT_TYPES = Object.freeze({
    LOCAL_PLANNING_WRITE: 'local_planning_write',
    LOCAL_READ: 'local_read',
    LOCAL_WRITE: 'local_write',
    NON_CONSUMING_STATUS: 'non_consuming_status',
    CREDIT_CONSUMING_GENERATION: 'credit_consuming_generation',
    EXTERNAL_REVIEW: 'external_review',
    EXTERNAL_UPLOAD: 'external_upload',
    ACCOUNT_MUTATION: 'account_mutation',
    VIP_FALLBACK_MODEL: 'vip_fallback_model',
});

const BLOCKED_TYPES = new Set([
    SIDE_EFFECT_TYPES.CREDIT_CONSUMING_GENERATION,
    SIDE_EFFECT_TYPES.EXTERNAL_REVIEW,
    SIDE_EFFECT_TYPES.EXTERNAL_UPLOAD,
    SIDE_EFFECT_TYPES.ACCOUNT_MUTATION,
    SIDE_EFFECT_TYPES.VIP_FALLBACK_MODEL,
]);

const ALLOWED_TYPES = new Set([
    SIDE_EFFECT_TYPES.LOCAL_PLANNING_WRITE,
    SIDE_EFFECT_TYPES.LOCAL_READ,
    SIDE_EFFECT_TYPES.LOCAL_WRITE,
]);

const PREVIEW_ONLY_TYPES = new Set([
    SIDE_EFFECT_TYPES.NON_CONSUMING_STATUS,
]);

const CREDIT_KEYWORDS = [
    'dreamina submit',
    'jimeng submit',
    'seedance submit',
    'generate',
    'txt2video',
    'img2video',
    'i2v',
    't2v',
];

const EXTERNAL_REVIEW_KEYWORDS = ['gemini', 'deepsearch', 'imagegen', 'browser', 'playwright', 'chrome'];
const EXTERNAL_UPLOAD_KEYWORDS = ['upload', 'youtube', 'tiktok', 'instagram', 'telegram', 's3', 'aws', 'gcloud', 'gsutil', 'scp', 'rsync', 'curl', 'wget'];
const ACCOUNT_MUTATION_KEYWORDS = ['login', 'logout', 'auth', 'token', 'cookie', 'vercel', 'firebase', 'supabase'];
const VIP_FALLBACK_KEYWORDS = ['vip', 'fallback', 'benefit_type', 'backend_benefit_type'];

export function shellQuote(value) {
    const stringValue = String(value ?? '');
    if (/^[A-Za-z0-9_/:=.,@%+-]+$/.test(stringValue)) return stringValue;
    return `'${stringValue.replace(/'/g, `'\\''`)}'`;
}

export function renderShellCommand(commandSpec = {}) {
    const command = commandSpec.command || '';
    const args = Array.isArray(commandSpec.args) ? commandSpec.args : [];
    const rendered = [command, ...args].filter(Boolean).map(shellQuote).join(' ');
    return commandSpec.cwd ? `cd ${shellQuote(commandSpec.cwd)} && ${rendered}` : rendered;
}

function commandText(commandSpec = {}) {
    return [commandSpec.command, ...(Array.isArray(commandSpec.args) ? commandSpec.args : [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
}

function includesAny(text, keywords) {
    return keywords.some((keyword) => text.includes(keyword));
}

export function classifySideEffect(commandSpec = {}) {
    const text = commandText(commandSpec);
    let type = commandSpec.side_effect_type || SIDE_EFFECT_TYPES.ACCOUNT_MUTATION;
    const blockers = [];
    const disabledBySpec = Boolean(commandSpec.disabled_reason);

    if (includesAny(text, VIP_FALLBACK_KEYWORDS)) {
        type = SIDE_EFFECT_TYPES.VIP_FALLBACK_MODEL;
        blockers.push('VIP_FALLBACK_MODEL_BLOCKED');
    } else if (includesAny(text, CREDIT_KEYWORDS)) {
        type = SIDE_EFFECT_TYPES.CREDIT_CONSUMING_GENERATION;
    } else if (includesAny(text, EXTERNAL_REVIEW_KEYWORDS)) {
        type = SIDE_EFFECT_TYPES.EXTERNAL_REVIEW;
    } else if (includesAny(text, EXTERNAL_UPLOAD_KEYWORDS)) {
        type = SIDE_EFFECT_TYPES.EXTERNAL_UPLOAD;
    } else if (includesAny(text, ACCOUNT_MUTATION_KEYWORDS)) {
        type = SIDE_EFFECT_TYPES.ACCOUNT_MUTATION;
    }

    if (commandSpec.preview_only !== true && commandSpec.side_effect_type !== SIDE_EFFECT_TYPES.LOCAL_PLANNING_WRITE) {
        blockers.push('PREVIEW_ONLY_REQUIRED');
    }

    if (BLOCKED_TYPES.has(type)) {
        blockers.push(blockers.includes('VIP_FALLBACK_MODEL_BLOCKED') ? '' : 'SIDE_EFFECT_BLOCKED');
    }

    if (commandSpec.disabled_reason) blockers.push(commandSpec.disabled_reason);

    const mode = disabledBySpec || BLOCKED_TYPES.has(type)
        ? 'blocked'
        : PREVIEW_ONLY_TYPES.has(type)
            ? 'preview_only'
            : ALLOWED_TYPES.has(type)
                ? 'allowed'
                : 'blocked';

    return {
        type,
        mode,
        allowed: mode === 'allowed' || mode === 'preview_only',
        executable: false,
        copyAllowed: commandSpec.copy_allowed !== false,
        blocker: blockers.filter(Boolean)[0] || '',
        blockers: Array.from(new Set(blockers.filter(Boolean))),
        requiredEvidenceOutput: commandSpec.evidence_output_path || '',
    };
}

export function allowedStatusLabel(classification) {
    if (classification.mode === 'allowed') return 'allowed';
    if (classification.mode === 'preview_only') return 'preview only';
    return 'blocked';
}
