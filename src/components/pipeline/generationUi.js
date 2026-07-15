import { el, statusBadge } from './ui.js';

const STATUS_LABELS = Object.freeze({
    PASS: '통과',
    OK: '통과',
    ALLOWED: '사용 가능',
    BLOCK: '준비 필요',
    BLOCKED: '준비 필요',
    FAIL: '실패',
    RETRY: '다시 만들기',
    UNREVIEWED: '검토 전',
    EXCEPTION: '예외 승인',
    WARN: '확인 필요',
    PREVIEW: '미리보기',
});

const GATE_LABELS = Object.freeze({
    image_prompt: '이미지 프롬프트',
    image_qa: '이미지 검토',
    dashboard: '이미지 현황',
    prompt_media: '프롬프트·참조',
    preflight: '제출 전 확인',
    submit_confirmation: '생성 승인',
    frame_qa: '영상 프레임',
    accepted_seconds: '채택 구간',
});

const QUEUE_PHASE_LABELS = Object.freeze({
    pre_queue_failure: '제출 전',
    submitted_missing_id: 'ID 확인',
    heartbeat_not_due: '대기 중',
    heartbeat_due: '확인할 때',
    downloaded: '받기 완료',
    completed_not_downloaded: '받기 필요',
    failed_after_real_queue: '실패',
    queued: '생성 중',
    not_queued: '제출 전',
});

const BLOCKER_LABELS = Object.freeze({
    MISSING_PIPELINE_DOC: '파이프라인 문서 필요',
    MISSING_WORK_DECOMPOSITION: '작업 순서 필요',
    MISSING_PRODUCTION_BRIEF: '제작 설명 필요',
    MISSING_STORYBOARD_CONTINUITY_PACKET: '스토리보드 필요',
    CREDIT_CONFIRMATION_REQUIRED: '생성 승인 필요',
    DREAMINA_PREFLIGHT_BLOCKED: '제출 준비 필요',
    MISSING_YOUMIND_TEMPLATE_EVIDENCE: '프롬프트 기준 필요',
    MISSING_GPT_IMAGE_GUIDE_EVIDENCE: '이미지 기준 필요',
    IMAGE_PROMPT_TEMPLATE_NOT_REVIEWED: '이미지 프롬프트 검토 필요',
    IMAGE_GEMINI_REVIEW_REQUIRED: '이미지 검토 필요',
    IMAGE_GEMINI_REVIEW_NOT_PASS: '이미지 검토 필요',
    MISSING_IMAGE_DASHBOARD: '이미지 현황 필요',
    IMAGE_DASHBOARD_STALE: '이미지 현황 새로고침 필요',
    MISSING_REFERENCE_ANNOTATION: '참조 설명 필요',
    MISSING_VIDEO_REFERENCE_METADATA: '영상 참조 정보 필요',
    DURATION_LOCK_MISSING: '영상 길이 확인 필요',
    MISSING_MOTION_BOARD: '모션 보드 필요',
    GEMINI_REVIEW_BLOCKED: '외부 검토 준비 필요',
    FRAME_EXTRACTION_BLOCKED: '생성된 영상 필요',
    GEMINI_VIDEO_REVIEW_BLOCKED: '영상 검토 필요',
    MISSING_ACCEPTED_SECONDS: '채택 구간 필요',
    MODEL_MISMATCH: '생성 모델 확인 필요',
    OUTPUT_QUALITY_NOT_PROVEN: '결과 품질 확인 필요',
    SIDE_EFFECT_BLOCKED: '실행 승인 필요',
    MAIN_OWNED_PRODUCTION_ROOT_REQUIRED: '제작 폴더 확인 필요',
    NEW_PACK_OUTPUT_SAFETY_UNPROVEN: '새 제작 폴더 확인 필요',
    FFPROBE_EVIDENCE_COMMAND_UNVERIFIED: '영상 확인 필요',
    SELECTED_RANGE_RENDER_PLAN_NOT_IMPLEMENTED: '렌더 준비 필요',
});

export function simpleStatusLabel(status) {
    const normalized = String(status || 'UNREVIEWED').toUpperCase();
    return STATUS_LABELS[normalized] || '확인 필요';
}

export function simpleStatusBadge(status, label = '') {
    return statusBadge(label || simpleStatusLabel(status), status);
}

export function gateLabel(type) {
    return GATE_LABELS[type] || '추가 확인';
}

export function queuePhaseLabel(phase) {
    return QUEUE_PHASE_LABELS[phase] || '확인 필요';
}

export function blockerLabel(blocker) {
    return BLOCKER_LABELS[blocker] || '추가 확인 필요';
}

export function issueList(blockers = []) {
    const unique = Array.from(new Set(blockers.filter(Boolean)));
    if (!unique.length) return null;
    return el('div', { className: 'rounded-lg border border-amber-400/20 bg-amber-400/[0.05] p-4' }, [
        el('strong', { text: '먼저 확인할 것', className: 'text-sm text-amber-100' }),
        el('ul', { className: 'mt-2 list-disc space-y-1 pl-5 text-sm leading-6 text-secondary' }, unique.map((blocker) => (
            el('li', { text: blockerLabel(blocker), title: blocker })
        ))),
    ]);
}

export function plainStatus(status) {
    return el('span', { text: simpleStatusLabel(status), className: 'text-sm text-secondary' });
}
