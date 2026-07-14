export function emptyG3PromotionPlan(status = 'loading') {
    return {
        ok: status !== 'blocked',
        schema_version: 'film_pipeline.g3_promotion_plan.v1',
        status,
        ready: false,
        already_current: false,
        plan_token: '',
        expires_at: '',
        project_id: '',
        episode_id: '',
        shot_count: 0,
        target_state: status === 'loading' ? '확인 중' : '확인 불가',
        selected_takes_sha256: '',
        current_target_sha256: '',
        safety_summary: [],
        blockers: [],
        executed: false,
    };
}

export function normalizeG3PromotionPlan(value) {
    const fallback = emptyG3PromotionPlan('blocked');
    if (!value || typeof value !== 'object') return fallback;
    return {
        ...fallback,
        ...value,
        safety_summary: Array.isArray(value.safety_summary) ? value.safety_summary : [],
        blockers: Array.isArray(value.blockers) ? value.blockers : [],
        ready: value.ready === true,
        already_current: value.already_current === true,
        executed: false,
    };
}

export function staleG3PromotionPlan(blocker = 'G3_UNSAVED_CHANGES') {
    return normalizeG3PromotionPlan({
        status: 'blocked',
        ok: false,
        target_state: '다시 확인 필요',
        safety_summary: ['초안 또는 production 선택이 바뀌어 승격 계획을 다시 확인해야 합니다.'],
        blockers: [blocker],
    });
}
