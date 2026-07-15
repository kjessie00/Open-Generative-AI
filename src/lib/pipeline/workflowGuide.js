import { isCanonicalSelectedTakesProvenance } from './canonicalProvenance.js';

export const WORKFLOW_STAGES = Object.freeze([
    Object.freeze({ id: 'start', number: 1, label: '기획·대본', tabs: Object.freeze([
        Object.freeze({ id: 'intake', label: '기획·대본' }),
    ]) }),
    Object.freeze({ id: 'design', number: 2, label: '설계', tabs: Object.freeze([
        Object.freeze({ id: 'storyboard', label: '스토리보드' }),
        Object.freeze({ id: 'shot-designer', label: '샷 설계' }),
        Object.freeze({ id: 'motion', label: '모션 보드' }),
    ]) }),
    Object.freeze({ id: 'prepare', number: 3, label: '생성 준비', tabs: Object.freeze([
        Object.freeze({ id: 'assets', label: '이미지 작업' }),
        Object.freeze({ id: 'videos', label: '영상 작업' }),
        Object.freeze({ id: 'prompts', label: '프롬프트 팩' }),
        Object.freeze({ id: 'gates', label: '검토 게이트' }),
        Object.freeze({ id: 'queue', label: '생성 대기열' }),
    ]) }),
    Object.freeze({ id: 'select', number: 4, label: '클립 선택', tabs: Object.freeze([
        Object.freeze({ id: 'qa', label: '클립 QA' }),
    ]) }),
    Object.freeze({ id: 'finish', number: 5, label: '마무리', tabs: Object.freeze([
        Object.freeze({ id: 'final', label: '최종 편집' }),
    ]) }),
]);

export const WORKFLOW_CAPABILITIES = Object.freeze([
    Object.freeze({ label: '바로 할 수 있음', detail: '프로젝트 초안 → 로컬 자료 읽기 → G3 선택 → 로컬 최종 편집' }),
    Object.freeze({ label: '준비 후 가능', detail: '생성 결과 불러오기 → 사람 품질 승인' }),
    Object.freeze({ label: '앱에서 실행 안 함', detail: '유료 생성 → Dreamina·Flow 제출 → Gemini 검토 → 외부 업로드' }),
]);

export function deriveWorkflowMetrics(state = {}) {
    const accepted = (state.acceptedSeconds || []).filter((record) => (
        isCanonicalSelectedTakesProvenance(record.canonical_provenance)
            ? record.accepted === true && record.source_exists === true && Boolean(record.clip_id)
            : record.accepted === true || (record.source_file && record.out_time > record.in_time)
    )).length;

    return Object.freeze({
        files: state.fileStatus?.files_found ?? state.assets?.length ?? 0,
        parsed: state.fileStatus?.content_parsed ?? [
            state.storyboard?.length,
            state.motionBoard?.length,
            state.promptPacks?.length,
            state.submitRecords?.length,
            state.heartbeatRecords?.length,
        ].filter(Boolean).length,
        reviewed: state.fileStatus?.review_passed
            ?? (state.reviewGates || []).filter((gate) => gate.status === 'PASS').length,
        accepted: state.fileStatus?.quality_accepted ?? accepted,
    });
}

function stageStatus(activeStageId, stageId) {
    const activeIndex = WORKFLOW_STAGES.findIndex((stage) => stage.id === activeStageId);
    const stageIndex = WORKFLOW_STAGES.findIndex((stage) => stage.id === stageId);
    if (stageIndex < activeIndex) return 'complete';
    if (stageIndex === activeIndex) return 'current';
    return 'pending';
}

function guideForMetrics(metrics) {
    if (metrics.files === 0) return {
        activeStageId: 'start', message: '기획과 대본을 작성하세요', actionLabel: '기획·대본 열기', actionTab: 'intake',
    };
    if (metrics.parsed === 0) return {
        activeStageId: 'design', message: '스토리보드와 모션 설계를 확인하세요', actionLabel: '설계 열기', actionTab: 'storyboard',
    };
    if (metrics.reviewed === 0) return {
        activeStageId: 'prepare', message: '생성 전 자료와 검토 상태를 확인하세요', actionLabel: '검토 게이트 열기', actionTab: 'gates',
    };
    if (metrics.accepted === 0) return {
        activeStageId: 'select',
        message: '클립을 검토하고 사용할 구간을 선택하세요',
        actionLabel: '클립 QA 열기',
        actionTab: 'qa',
        explanation: '채택한 구간이 0개라 최종 편집을 시작할 수 없습니다.',
    };
    return {
        activeStageId: 'finish', message: '선택한 구간으로 최종 편집을 준비하세요', actionLabel: '최종 편집 열기', actionTab: 'final',
    };
}

const DETAIL_ROWS = Object.freeze({
    start: Object.freeze(['기획 직접 작성', '대본 직접 작성', '에이전트 요청 저장']),
    design: Object.freeze(['스토리보드 확인', '샷과 움직임 설계']),
    prepare: Object.freeze(['참조 이미지 확인', '프롬프트와 검토 게이트 확인', '생성 결과 대기']),
    select: Object.freeze(['클립 검토', '채택 구간 지정', '채택 결과 저장']),
    finish: Object.freeze(['선택 구간 확인', '로컬 최종 편집', 'fresh probe와 receipt 확인']),
});

export function deriveWorkflowGuide(state = {}) {
    const metrics = deriveWorkflowMetrics(state);
    const guide = guideForMetrics(metrics);
    return Object.freeze({
        ...guide,
        explanation: guide.explanation || '',
        metrics,
        capabilities: WORKFLOW_CAPABILITIES,
        stages: WORKFLOW_STAGES.map((stage) => Object.freeze({
            ...stage,
            status: stageStatus(guide.activeStageId, stage.id),
        })),
        detailRows: DETAIL_ROWS[guide.activeStageId],
    });
}

export function stageForTab(tabId) {
    return WORKFLOW_STAGES.find((stage) => stage.tabs.some((tab) => tab.id === tabId)) || null;
}
