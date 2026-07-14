import { createG3PreviewObjectUrl } from '../../lib/pipeline/g3PreviewObjectUrl.js';
import { actionButton, el, emptyState, statusBadge } from './ui.js';

function formatBytes(value) {
    if (!Number.isFinite(value)) return '—';
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function G3CandidatePanel({ candidates, selection, onChange, onPreview }) {
    if (!candidates.length) return emptyState('승인된 후보 폴더에서 검토할 동영상을 찾지 못했습니다.');
    const wrapper = el('section', { className: 'space-y-3', attrs: { 'aria-labelledby': 'g3-candidate-title' } });
    wrapper.appendChild(el('h4', { text: '후보 영상', className: 'text-sm font-bold text-white', attrs: { id: 'g3-candidate-title' } }));
    const label = el('label', { className: 'block text-xs font-semibold text-secondary', attrs: { for: 'g3-candidate-select' }, text: '후보 클립' });
    const select = el('select', {
        className: 'mt-2 min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
        attrs: { id: 'g3-candidate-select' },
    }, [
        el('option', { value: '', text: '후보를 선택하세요' }),
        ...candidates.map((candidate) => el('option', {
            value: candidate.candidate_token,
            text: `${candidate.display_path} · ${formatBytes(candidate.size_bytes)}`,
        })),
    ]);
    select.value = selection.candidate_token || '';
    wrapper.appendChild(label);
    wrapper.appendChild(select);

    const selected = () => candidates.find((candidate) => candidate.candidate_token === select.value);
    const meta = el('div', { className: 'flex flex-wrap gap-2', attrs: { 'aria-live': 'polite' } });
    const renderMeta = () => {
        meta.innerHTML = '';
        const candidate = selected();
        if (!candidate) return;
        meta.appendChild(statusBadge(candidate.duration_authoritative
            ? `검증된 길이 ${candidate.duration_sec}초`
            : '길이 상한 미검증', candidate.duration_authoritative ? 'PASS' : 'WARN'));
        meta.appendChild(statusBadge(candidate.preview_allowed ? '로컬 미리보기 가능' : '미리보기 용량 초과', candidate.preview_allowed ? 'PREVIEW' : 'BLOCK'));
    };
    renderMeta();
    wrapper.appendChild(meta);

    const previewHost = el('div', { className: 'min-h-24 rounded-md border border-dashed border-white/10 bg-black/20 p-3' }, [
        el('p', { text: '후보를 선택한 뒤 로컬 미리보기를 불러오세요.', className: 'text-sm text-secondary', attrs: { role: 'status' } }),
    ]);
    let activePreview = null;
    let requestVersion = 0;
    const disposePreview = () => {
        requestVersion += 1;
        activePreview?.dispose();
        activePreview = null;
    };
    const showMessage = (text, role = 'status', error = false) => {
        previewHost.replaceChildren(el('p', {
            text,
            className: `text-sm ${error ? 'text-red-200' : 'text-secondary'}`,
            attrs: { role },
        }));
    };
    select.addEventListener('change', () => {
        disposePreview();
        showMessage('후보를 선택한 뒤 로컬 미리보기를 불러오세요.');
        renderMeta();
        onChange('candidate_token', select.value);
    });
    wrapper.appendChild(actionButton('선택 후보 미리보기', {
        disabled: false,
        variant: 'muted',
        onClick: async () => {
            disposePreview();
            const candidate = selected();
            if (!candidate?.candidate_token) {
                showMessage('먼저 후보를 선택하세요.', 'alert');
                return;
            }
            const currentRequest = requestVersion;
            showMessage('로컬 후보를 불러오는 중…');
            const preview = await onPreview(candidate.candidate_token).catch(() => null);
            const prepared = createG3PreviewObjectUrl(preview);
            if (currentRequest !== requestVersion || ('isConnected' in wrapper && !wrapper.isConnected)) {
                prepared.dispose();
                return;
            }
            if (!prepared.ok) {
                showMessage('미리보기를 안전하게 불러오지 못했습니다.', 'alert', true);
                return;
            }
            activePreview = prepared;
            const video = el('video', {
                className: 'max-h-80 w-full rounded-md bg-black object-contain',
                attrs: { controls: '', preload: 'metadata', src: prepared.url, 'aria-label': '선택한 후보 영상 미리보기' },
            });
            video.addEventListener('error', () => {
                disposePreview();
                showMessage('미리보기를 재생할 수 없습니다.', 'alert', true);
            });
            previewHost.replaceChildren(video);
        },
    }));
    wrapper.appendChild(previewHost);
    if (typeof globalThis.MutationObserver === 'function') {
        const observer = new globalThis.MutationObserver(() => {
            if (wrapper.isConnected) return;
            disposePreview();
            observer.disconnect();
        });
        observer.observe(document.documentElement || document.body, { childList: true, subtree: true });
    }
    wrapper.appendChild(el('p', {
        text: '파일 길이가 canonical 근거로 제공되지 않으면 구간 상한은 검증하지 않습니다. 인·아웃 값은 사람이 직접 확인해야 합니다.',
        className: 'text-xs leading-5 text-secondary',
    }));
    return wrapper;
}
