import { g3PreviewDataUrl } from '../../lib/pipeline/g3ReviewWorkspace.js';
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
    select.addEventListener('change', () => onChange('candidate_token', select.value));
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
    select.addEventListener('change', renderMeta);
    renderMeta();
    wrapper.appendChild(meta);

    const previewHost = el('div', { className: 'min-h-24 rounded-md border border-dashed border-white/10 bg-black/20 p-3' }, [
        el('p', { text: '후보를 선택한 뒤 로컬 미리보기를 불러오세요.', className: 'text-sm text-secondary', attrs: { role: 'status' } }),
    ]);
    wrapper.appendChild(actionButton('선택 후보 미리보기', {
        disabled: false,
        variant: 'muted',
        onClick: async () => {
            const candidate = selected();
            previewHost.innerHTML = '';
            if (!candidate?.candidate_token) {
                previewHost.appendChild(el('p', { text: '먼저 후보를 선택하세요.', className: 'text-sm text-secondary', attrs: { role: 'alert' } }));
                return;
            }
            previewHost.appendChild(el('p', { text: '로컬 후보를 불러오는 중…', className: 'text-sm text-secondary', attrs: { role: 'status' } }));
            const preview = await onPreview(candidate.candidate_token).catch(() => null);
            const source = g3PreviewDataUrl(preview);
            previewHost.innerHTML = '';
            if (!source) {
                previewHost.appendChild(el('p', { text: '미리보기를 안전하게 불러오지 못했습니다.', className: 'text-sm text-red-200', attrs: { role: 'alert' } }));
                return;
            }
            previewHost.appendChild(el('video', {
                className: 'max-h-80 w-full rounded-md bg-black object-contain',
                attrs: { controls: '', preload: 'metadata', src: source, 'aria-label': '선택한 후보 영상 미리보기' },
            }));
        },
    }));
    wrapper.appendChild(previewHost);
    wrapper.appendChild(el('p', {
        text: '파일 길이가 canonical 근거로 제공되지 않으면 구간 상한은 검증하지 않습니다. 인·아웃 값은 사람이 직접 확인해야 합니다.',
        className: 'text-xs leading-5 text-secondary',
    }));
    return wrapper;
}
