const PROVIDERS = Object.freeze(['flow', 'grok', 'replicate', 'bytedance']);

export const VIDEO_PROVIDER_LABELS = Object.freeze({
    flow: 'Flow',
    grok: 'Grok',
    replicate: 'Replicate',
    bytedance: 'ByteDance',
});

export function normalizeVideoTasks(tasks = [], reviewDecisions = []) {
    const decisions = new Map((Array.isArray(reviewDecisions) ? reviewDecisions : [])
        .map((decision) => [decision?.task_token, decision?.decision]));
    return (Array.isArray(tasks) ? tasks : [])
        .filter((task) => task?.kind === 'scene_video')
        .map((task) => ({
            ...task,
            sequence: Number(task.sequence) || 0,
            label: String(task.label || '장면 이름 없음'),
            provider: PROVIDERS.includes(task.provider) ? task.provider : 'flow',
            prompt: String(task.prompt || ''),
            status: ['준비', '결과연결', '재제작'].includes(task.status) ? task.status : '준비',
            review_decision: task.status === '재제작' ? 'retry'
                : ['pending', 'use'].includes(decisions.get(task.task_token)) ? decisions.get(task.task_token) : 'pending',
        }))
        .sort((left, right) => left.sequence - right.sequence);
}

export function videoProgress(tasks = []) {
    const normalized = normalizeVideoTasks(tasks);
    const complete = normalized.filter((task) => task.status === '결과연결').length;
    const retry = normalized.filter((task) => task.status === '재제작').length;
    const next = normalized.find((task) => task.status !== '결과연결') || null;
    return { total: normalized.length, complete, retry, next };
}

export function videoCandidateLabel(candidate) {
    const provider = VIDEO_PROVIDER_LABELS[candidate?.provider] || '생성 도구';
    const duration = Number(candidate?.duration_seconds);
    const durationText = Number.isFinite(duration) && duration > 0 ? `${duration.toFixed(1)}초` : '길이 미상';
    const width = Number(candidate?.width);
    const height = Number(candidate?.height);
    const sizeText = width > 0 && height > 0 ? `${width}×${height}` : '크기 미상';
    return `${provider} · ${durationText} · ${sizeText}`;
}
