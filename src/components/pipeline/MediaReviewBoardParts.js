import { localMediaSource } from '../../lib/pipeline/mediaSources.js';
import { actionButton, card, el, emptyState, statusBadge } from './ui.js';

const REVIEW_LABELS = Object.freeze({
    unreviewed: '미검토',
    accepted: '채택',
    needs_changes: '수정 필요',
    retry_requested: '다시 만들기',
});
const REVIEW_BADGE_STATUS = Object.freeze({
    accepted: 'PASS',
    needs_changes: 'WARN',
    retry_requested: 'RETRY',
    unreviewed: 'UNREVIEWED',
});

function mediaPreview(attempt) {
    const kind = attempt.kind === 'video' ? 'video' : 'image';
    const source = localMediaSource(attempt.path, kind);
    if (kind === 'image' && source) {
        return el('img', {
            className: 'media-review-preview',
            attrs: { src: source, alt: `${attempt.target_id || attempt.media_id} 시도 ${attempt.attempt}` },
        });
    }
    if (kind === 'video' && source) {
        const video = el('video', {
            className: 'media-review-preview',
            attrs: { src: source, controls: 'true', playsinline: 'true', preload: 'metadata' },
        });
        video.muted = true;
        return video;
    }
    return el('div', { className: 'media-review-empty', attrs: { role: 'status' } }, [
        el('span', { text: kind === 'video' ? 'VIDEO' : 'IMAGE', className: 'media-review-empty-kind' }),
        el('strong', { text: '미리보기 파일 없음' }),
        el('span', { text: '결과 파일이 연결되면 이 자리에 표시됩니다.' }),
    ]);
}

export function MediaAttemptCard(attempt, actions) {
    const note = el('textarea', {
        value: attempt.review_note || '',
        className: 'media-review-note',
        attrs: {
            'aria-label': `${attempt.media_id} 검토 메모`,
            placeholder: '수정할 점을 짧게 적으세요',
            rows: '2',
        },
    });
    note.addEventListener('input', (event) => actions.onNote(attempt.media_id, event.target.value));

    return card([
        el('div', { className: 'media-review-card-head' }, [
            el('div', { className: 'min-w-0' }, [
                el('strong', { text: attempt.target_id || '대상 미지정', className: 'media-review-target' }),
                el('span', { text: `${attempt.provider || '제공자 미상'} · 시도 ${attempt.attempt}`, className: 'media-review-meta' }),
            ]),
            statusBadge(
                REVIEW_LABELS[attempt.review_status] || '미검토',
                REVIEW_BADGE_STATUS[attempt.review_status] || 'UNREVIEWED',
            ),
        ]),
        mediaPreview(attempt),
        el('div', { className: 'media-review-evidence' }, [
            el('span', { text: attempt.kind }),
            el('span', { text: attempt.generation_status || '상태 미상' }),
            el('span', { text: attempt.operation_id || '작업 번호 없음' }),
        ]),
        note,
        el('div', { className: 'media-review-actions' }, [
            actionButton('채택', {
                variant: attempt.review_status === 'accepted' ? 'primary' : 'muted',
                onClick: () => actions.onReview(attempt.media_id, 'accepted'),
            }),
            actionButton('수정 필요', {
                variant: attempt.review_status === 'needs_changes' ? 'primary' : 'muted',
                onClick: () => actions.onReview(attempt.media_id, 'needs_changes'),
            }),
            actionButton(attempt.selected_for_retry ? '다시 만들기 해제' : '다시 만들기 선택', {
                variant: attempt.selected_for_retry ? 'primary' : 'muted',
                onClick: () => actions.onRetry(attempt.media_id),
            }),
        ]),
    ], `media-review-card ${attempt.selected_for_retry ? 'is-retry-selected' : ''}`);
}

export function ReferenceRail(title, subtitle, attempts, actions) {
    return el('section', { className: 'media-review-band' }, [
        el('header', { className: 'media-review-band-head' }, [
            el('h3', { text: title }),
            el('p', { text: subtitle }),
        ]),
        attempts.length
            ? el('div', { className: 'media-review-rail' }, attempts.map((attempt) => MediaAttemptCard(attempt, actions)))
            : emptyState(`${title} 결과가 아직 없습니다.`),
    ]);
}

export function SceneReviewRow(group, clip, actions) {
    const attempts = [...group.images, ...group.videos];
    return el('section', { className: 'media-review-scene' }, [
        el('header', { className: 'media-review-scene-head' }, [
            el('div', {}, [
                el('span', { text: clip?.scene_id || '장면', className: 'media-review-kicker' }),
                el('h3', { text: group.target_id }),
            ]),
            el('p', { text: clip?.dramatic_beat || '장면 설명이 아직 연결되지 않았습니다.' }),
        ]),
        attempts.length
            ? el('div', { className: 'media-review-scene-grid' }, attempts.map((attempt) => MediaAttemptCard(attempt, actions)))
            : emptyState('현재 조건에 맞는 이미지·영상 시도가 없습니다.'),
    ]);
}
