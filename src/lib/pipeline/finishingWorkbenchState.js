const CONTRACT = 'film_pipeline.finishing_workbench.v1';

export function emptyFinishingWorkspace(status = 'loading') {
    return {
        ok: false,
        schema_version: CONTRACT,
        status,
        ready_to_plan: false,
        already_current: false,
        project_id: '',
        episode_id: '',
        selected_range_count: 0,
        selected_duration_seconds: 0,
        input_ready: false,
        qc_ready: false,
        harness_ready: false,
        runtime_ready: false,
        output_contract: {
            version: CONTRACT,
            location: 'production/final/workbench_runs/<content-derived-run-id>',
            canonical_delivery_untouched: true,
        },
        tool_status: { python: '확인 중', ffmpeg: '확인 중', ffprobe: '확인 중' },
        current_run: null,
        current_blockers: [],
        blockers: [],
        output_quality_approved: false,
        quality_notice: '렌더 실행 성공 ≠ 영상 품질 승인',
    };
}

function safeText(value, maximum = 200) {
    return typeof value === 'string' ? value.slice(0, maximum) : '';
}

function safeBlockers(value) {
    return Array.isArray(value)
        ? Array.from(new Set(value.filter((item) => /^FINISHING_[A-Z0-9_]+$/.test(item)))).slice(0, 100)
        : [];
}

export function normalizeFinishingWorkspace(value, fallbackStatus = 'blocked') {
    const base = emptyFinishingWorkspace(fallbackStatus);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
    const current = value.current_run && typeof value.current_run === 'object' && !Array.isArray(value.current_run)
        ? {
            run_id: safeText(value.current_run.run_id, 24),
            selected_range_count: Number.isInteger(value.current_run.selected_range_count) ? value.current_run.selected_range_count : 0,
            selected_duration_seconds: Number.isFinite(value.current_run.selected_duration_seconds) ? value.current_run.selected_duration_seconds : 0,
            output_duration_seconds: Number.isFinite(value.current_run.output_duration_seconds) ? value.current_run.output_duration_seconds : 0,
            output_size_bytes: Number.isInteger(value.current_run.output_size_bytes) ? value.current_run.output_size_bytes : 0,
            output_sha256_short: safeText(value.current_run.output_sha256_short, 20),
            fresh_probe_verified: value.current_run.fresh_probe_verified === true,
            output_quality_approved: false,
            render_completed_at: safeText(value.current_run.render_completed_at, 64),
        }
        : null;
    return {
        ...base,
        ok: value.ok === true,
        status: ['loading', 'ready_to_plan', 'ready', 'executing', 'success', 'already_current', 'stale', 'blocked', 'error', 'empty'].includes(value.status)
            ? value.status
            : fallbackStatus,
        ready_to_plan: value.ready_to_plan === true,
        ready: value.ready === true,
        already_current: value.already_current === true,
        project_id: safeText(value.project_id, 128),
        episode_id: safeText(value.episode_id, 128),
        selected_range_count: Number.isInteger(value.selected_range_count) ? value.selected_range_count : 0,
        selected_duration_seconds: Number.isFinite(value.selected_duration_seconds) ? value.selected_duration_seconds : 0,
        input_ready: value.input_ready === true,
        qc_ready: value.qc_ready === true,
        harness_ready: value.harness_ready === true,
        runtime_ready: value.runtime_ready === true,
        output_contract: {
            version: CONTRACT,
            location: safeText(value.output_contract?.location, 160) || base.output_contract.location,
            canonical_delivery_untouched: value.output_contract?.canonical_delivery_untouched === true,
        },
        tool_status: {
            python: safeText(value.tool_status?.python, 160) || '사용 불가',
            ffmpeg: safeText(value.tool_status?.ffmpeg, 160) || '사용 불가',
            ffprobe: safeText(value.tool_status?.ffprobe, 160) || '사용 불가',
        },
        current_run: current,
        current_blockers: safeBlockers(value.current_blockers),
        blockers: safeBlockers(value.blockers),
        plan_token: /^[a-f0-9]{64}$/.test(value.plan_token || '') ? value.plan_token : '',
        expires_at: safeText(value.expires_at, 64),
        output_quality_approved: false,
        quality_notice: '렌더 실행 성공 ≠ 영상 품질 승인',
        cooperative_lock_limit: safeText(value.cooperative_lock_limit, 300),
    };
}

export function finishingExecutionState(status = 'idle', result = null, error = '') {
    return { status, result, error };
}
