const KIND_ORDER = Object.freeze({ character_sheet: 0, location_sheet: 1, scene_image: 2 });

export const IMAGE_KIND_LABELS = Object.freeze({
    character_sheet: '인물',
    location_sheet: '장소',
    scene_image: '장면',
});

export function normalizeImageTasks(tasks = [], reviewDecisions = []) {
    const decisions = new Map((Array.isArray(reviewDecisions) ? reviewDecisions : [])
        .map((decision) => [decision?.task_token, decision?.decision]));
    return (Array.isArray(tasks) ? tasks : [])
        .filter((task) => task && IMAGE_KIND_LABELS[task.kind])
        .map((task) => ({
            ...task,
            sequence: Number(task.sequence) || 0,
            label: String(task.label || '이름 없음'),
            prompt: String(task.prompt || ''),
            status: ['준비', '결과연결', '재제작'].includes(task.status) ? task.status : '준비',
            review_decision: task.status === '재제작' ? 'retry'
                : ['pending', 'use'].includes(decisions.get(task.task_token)) ? decisions.get(task.task_token) : 'pending',
            reference_task_ids: Array.isArray(task.reference_task_ids) ? [...task.reference_task_ids] : [],
        }))
        .sort((left, right) => (
            (KIND_ORDER[left.kind] - KIND_ORDER[right.kind])
            || (left.sequence - right.sequence)
        ));
}

export function imageProgress(tasks = []) {
    const normalized = normalizeImageTasks(tasks);
    const complete = normalized.filter((task) => task.status === '결과연결').length;
    const retry = normalized.filter((task) => task.status === '재제작').length;
    const next = normalized.find((task) => task.status !== '결과연결') || null;
    return { total: normalized.length, complete, retry, next };
}

export function safePreviewSource(value) {
    const preview = value?.preview || value || {};
    const mime = preview.mime_type || '';
    const base64 = preview.base64 || '';
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) return '';
    if (!/^[A-Za-z0-9+/=]+$/.test(base64)) return '';
    return `data:${mime};base64,${base64}`;
}

export function candidateLabel(candidate) {
    const date = new Date(candidate?.created_at || '');
    const created = Number.isFinite(date.getTime())
        ? `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
        : '시간 미상';
    const count = Math.max(1, Number(candidate?.image_count) || 1);
    return `${created} · 이미지 ${count}장`;
}
