import { normalizeImageTasks, safePreviewSource } from './imagePreparationUi.js';
import { normalizeVideoTasks } from './videoPreparationUi.js';
import { actionButton, el, emptyState } from './ui.js';

const FILTERS = Object.freeze({
    all: '전체',
    review: '검토할 결과',
    retry: '다시 만들기',
});

function hasResult(task) {
    return Boolean(task?.result_token);
}

function matchesFilter(task, filter) {
    if (filter === 'review') return hasResult(task) && task.status !== '재제작';
    if (filter === 'retry') return task.status === '재제작';
    return true;
}

function safeVideoSource(preview) {
    const source = String(preview?.source || '');
    return source.startsWith('blob:') ? source : '';
}

function imagePreview(task, previews) {
    const source = safePreviewSource(previews[task.result_token]);
    if (source) {
        return el('img', {
            className: 'aspect-[16/10] w-full rounded-md bg-black/30 object-contain',
            attrs: { src: source, alt: `${task.label} 결과` },
        });
    }
    return el('div', {
        text: hasResult(task) ? '연결된 결과를 불러오는 중입니다.' : '아직 연결된 이미지가 없습니다.',
        className: 'flex aspect-[16/10] items-center justify-center rounded-md border border-dashed border-white/10 bg-black/20 p-3 text-center text-xs leading-5 text-secondary',
        attrs: { role: 'status' },
    });
}

function videoPreview(task, previews) {
    const source = safeVideoSource(previews[task.result_token]);
    if (source) {
        const video = el('video', {
            className: 'aspect-[16/10] w-full rounded-md bg-black/40 object-contain',
            attrs: { src: source, controls: '', preload: 'metadata', playsinline: '', 'aria-label': `${task.label} 결과` },
        });
        video.muted = true;
        return video;
    }
    return el('div', {
        text: hasResult(task) ? '연결된 영상을 불러오는 중입니다.' : '아직 연결된 영상이 없습니다.',
        className: 'flex aspect-[16/10] items-center justify-center rounded-md border border-dashed border-white/10 bg-black/20 p-3 text-center text-xs leading-5 text-secondary',
        attrs: { role: 'status' },
    });
}

function reviewCard(task, lane, previews, onToggleRetry, onOpenWorkItem, rerender) {
    const retrySelected = task.status === '재제작';
    const status = retrySelected ? '다시 만들기로 선택됨' : hasResult(task) ? '결과 확인 필요' : '결과 기다리는 중';
    const retryButton = hasResult(task) ? actionButton(retrySelected ? '선택 해제' : '다시 만들기', {
        variant: retrySelected ? 'primary' : 'muted',
        onClick: async () => {
            task.status = retrySelected ? '결과연결' : '재제작';
            rerender();
            await onToggleRetry?.(task.task_token, !retrySelected);
        },
    }) : null;
    retryButton?.setAttribute('aria-pressed', String(retrySelected));
    return el('article', {
        className: 'min-w-0 rounded-lg border border-white/10 bg-white/[0.035] p-3',
        attrs: { 'data-review-kind': lane, 'data-review-sequence': task.sequence },
    }, [
        el('header', { className: 'mb-3 min-w-0' }, [
            el('h4', { text: task.label, className: 'truncate text-sm font-bold text-white' }),
            el('p', { text: status, className: 'mt-1 text-xs leading-5 text-secondary' }),
        ]),
        lane === 'video' ? videoPreview(task, previews) : imagePreview(task, previews),
        el('div', { className: 'mt-3 flex flex-wrap gap-2' }, [
            retryButton,
            actionButton('작업 열기', {
                variant: 'muted',
                onClick: () => onOpenWorkItem?.({ kind: lane, sequence: task.sequence }),
            }),
        ].filter(Boolean)),
    ]);
}

function referenceSection(title, subtitle, tasks, previews, onToggleRetry, onOpenWorkItem, rerender) {
    return el('section', { className: 'flex min-w-0 flex-col gap-3', attrs: { 'aria-label': title } }, [
        el('header', {}, [
            el('h3', { text: title, className: 'text-base font-bold text-white' }),
            el('p', { text: subtitle, className: 'mt-1 text-xs leading-5 text-secondary' }),
        ]),
        tasks.length
            ? el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3' }, tasks.map((task) => (
                reviewCard(task, 'image', previews, onToggleRetry, onOpenWorkItem, rerender)
            )))
            : emptyState(`${title}에 표시할 결과가 없습니다.`),
    ]);
}

function sceneRows(designBoard, imageTasks, videoTasks) {
    const scenes = Array.isArray(designBoard?.scenes) ? designBoard.scenes : [];
    const images = new Map(imageTasks.filter((task) => task.kind === 'scene_image').map((task) => [task.source_id, task]));
    const videos = new Map(videoTasks.map((task) => [task.source_id, task]));
    const rows = scenes.map((scene, index) => ({
        number: index + 1,
        title: String(scene?.title || `장면 ${index + 1}`),
        image: images.get(scene?.id) || null,
        video: videos.get(scene?.id) || null,
    }));
    const known = new Set(scenes.map((scene) => scene?.id));
    const extras = new Map();
    [...images.entries(), ...videos.entries()].forEach(([sourceId, task]) => {
        if (known.has(sourceId)) return;
        const row = extras.get(sourceId) || { number: rows.length + extras.size + 1, title: task.label, image: null, video: null };
        if (task.kind === 'scene_video') row.video = task;
        else row.image = task;
        extras.set(sourceId, row);
    });
    return [...rows, ...extras.values()];
}

export function NewProjectMediaReviewBoard({
    designBoard,
    imagePlanTasks,
    imageResultPreviews = {},
    videoPlanTasks,
    videoResultPreviews = {},
    onToggleImageRetry,
    onToggleVideoRetry,
    onOpenWorkItem,
    activeFilter = 'all',
    onFilterChange,
}) {
    let imageTasks = normalizeImageTasks(imagePlanTasks);
    let videoTasks = normalizeVideoTasks(videoPlanTasks);
    let filter = FILTERS[activeFilter] ? activeFilter : 'all';
    const root = el('section', {
        className: 'flex min-w-0 flex-col gap-5 rounded-lg border border-white/10 bg-black/15 p-4',
        attrs: { 'aria-labelledby': 'new-project-media-review-title' },
    });

    const render = () => {
        const visibleImages = imageTasks.filter((task) => matchesFilter(task, filter));
        const visibleVideos = videoTasks.filter((task) => matchesFilter(task, filter));
        const characterTasks = visibleImages.filter((task) => task.kind === 'character_sheet');
        const locationTasks = visibleImages.filter((task) => task.kind === 'location_sheet');
        const rows = sceneRows(designBoard, visibleImages, visibleVideos)
            .filter((row) => filter === 'all' || row.image || row.video);
        const retryCount = [...imageTasks, ...videoTasks].filter((task) => task.status === '재제작').length;
        const filters = el('div', {
            className: 'flex flex-wrap gap-2',
            attrs: { role: 'group', 'aria-label': '새 프로젝트 결과 필터' },
        }, Object.entries(FILTERS).map(([value, label]) => {
            const button = actionButton(label, {
                variant: value === filter ? 'primary' : 'muted',
                onClick: () => {
                    filter = value;
                    onFilterChange?.(value);
                    render();
                },
            });
            button.setAttribute('aria-pressed', String(value === filter));
            return button;
        }));

        const sceneSections = rows.map((row) => el('section', {
            className: 'flex min-w-0 flex-col gap-3 rounded-lg border border-white/10 bg-black/10 p-3',
            attrs: { 'aria-label': `${row.number}. ${row.title}` },
        }, [
            el('header', {}, [
                el('p', { text: `장면 ${row.number}`, className: 'text-xs font-semibold text-secondary' }),
                el('h3', { text: row.title, className: 'mt-1 text-base font-bold text-white' }),
            ]),
            el('div', { className: 'grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2' }, [
                row.image
                    ? reviewCard(row.image, 'image', imageResultPreviews, onToggleImageRetry, onOpenWorkItem, render)
                    : emptyState('장면 이미지 결과가 아직 없습니다.'),
                row.video
                    ? reviewCard(row.video, 'video', videoResultPreviews, onToggleVideoRetry, onOpenWorkItem, render)
                    : emptyState('장면 영상 결과가 아직 없습니다.'),
            ]),
        ]));

        root.replaceChildren(...[
            el('header', {}, [
                el('h2', { text: '새 프로젝트 결과 검토', className: 'text-lg font-bold text-white', attrs: { id: 'new-project-media-review-title' } }),
                el('p', { text: '인물과 장소 기준을 먼저 보고, 장면 이미지와 영상을 순서대로 확인하세요.', className: 'mt-1 text-sm leading-6 text-secondary' }),
                el('p', { text: `다시 만들기 ${retryCount}개 선택`, className: 'mt-1 text-xs leading-5 text-secondary', attrs: { role: 'status', 'aria-live': 'polite' } }),
            ]),
            filters,
            referenceSection('인물 기준', '등장인물의 외형과 의상 기준입니다.', characterTasks, imageResultPreviews, onToggleImageRetry, onOpenWorkItem, render),
            referenceSection('장소 기준', '장면 전체에서 유지할 공간과 조명 기준입니다.', locationTasks, imageResultPreviews, onToggleImageRetry, onOpenWorkItem, render),
            ...sceneSections,
            !imageTasks.length && !videoTasks.length ? emptyState('설계를 저장하면 검토할 이미지와 영상 작업이 여기에 표시됩니다.') : null,
        ].filter(Boolean));
    };

    render();
    return root;
}

export default NewProjectMediaReviewBoard;
