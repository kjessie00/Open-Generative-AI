import { actionButton, el, statusBadge } from './ui.js';
import { p } from './copy.js';

function shortHash(value) {
    return /^[a-f0-9]{64}$/.test(value || '') ? `${value.slice(0, 12)}…` : '없음';
}

function planBadge(plan) {
    if (plan.status === 'loading') return statusBadge('확인 중', 'UNREVIEWED');
    if (plan.already_current) return statusBadge('이미 production과 동일', 'PASS');
    if (plan.ready) return statusBadge('명시적 확인 대기', 'WARN');
    return statusBadge('승격 차단', 'BLOCK');
}

export function G3PromotionPanel({ plan = {}, onRefresh, onPromote }) {
    const section = el('section', {
        className: 'space-y-4 rounded-lg border border-amber-300/20 bg-amber-300/[0.035] p-4',
        attrs: { 'aria-labelledby': 'g3-promotion-title' },
    });
    section.appendChild(el('header', { className: 'space-y-2' }, [
        el('div', { className: 'flex flex-wrap items-center gap-2' }, [
            el('h4', { text: 'Production 반영 · 명시적 확인', className: 'mr-auto text-sm font-bold text-white', attrs: { id: 'g3-promotion-title' } }),
            planBadge(plan),
        ]),
        el('p', {
            text: '사람이 내보낸 선택을 현재 production의 canonical selected_takes.json 한 파일에만 반영합니다. 기계 QC는 근거이며 사람의 선택이나 최종 영상 품질을 대신하지 않습니다.',
            className: 'text-xs leading-5 text-secondary',
        }),
    ]));

    section.appendChild(el('dl', { className: 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4' }, [
        ['현재 target', plan.target_state || '확인 불가'],
        ['프로젝트 확인 문자열', plan.project_id || '—'],
        ['선택 샷', Number.isFinite(plan.shot_count) ? `${plan.shot_count}개` : '—'],
        ['내보내기 / 현재 hash', `${shortHash(plan.selected_takes_sha256)} / ${shortHash(plan.current_target_sha256)}`],
    ].map(([label, value]) => el('div', { className: 'border-l border-white/10 pl-3' }, [
        el('dt', { text: label, className: 'text-xs text-secondary' }),
        el('dd', { text: value, className: 'mt-1 break-words text-sm font-semibold text-white' }),
    ]))));

    if (plan.safety_summary?.length) {
        section.appendChild(el('ul', { className: 'space-y-1 text-xs leading-5 text-secondary' }, plan.safety_summary.map((item) => (
            el('li', { text: `• ${item}` })
        ))));
    }
    if (plan.blockers?.length) {
        section.appendChild(el('div', { attrs: { role: 'alert' } }, [
            el('p', { text: '현재 승격 차단 항목', className: 'text-xs font-semibold text-red-100' }),
            el('ul', { className: 'mt-2 space-y-1' }, plan.blockers.map((blocker) => (
                el('li', { text: p(blocker), className: 'text-xs text-red-200' })
            ))),
        ]));
    }

    const refresh = actionButton('승격 계획 다시 확인', { variant: 'muted', onClick: onRefresh });
    section.appendChild(refresh);
    if (!plan.ready || plan.already_current) return section;

    const confirmationInput = el('input', {
        className: 'mt-2 min-h-11 w-full rounded-md border border-white/10 bg-black/40 px-3 text-sm text-white',
        attrs: {
            id: 'g3-promotion-project-confirmation',
            type: 'text',
            autocomplete: 'off',
            spellcheck: 'false',
            maxlength: '160',
            'aria-describedby': 'g3-promotion-confirmation-help',
        },
    });
    const confirmationCheckbox = el('input', {
        className: 'h-5 w-5 shrink-0 accent-cyan-400',
        attrs: { id: 'g3-promotion-explicit-confirmation', type: 'checkbox' },
    });
    const promoteButton = actionButton('확인한 선택을 production에 반영', {
        disabled: true,
        variant: 'danger',
        onClick: () => onPromote({
            planToken: plan.plan_token,
            projectIdConfirmation: confirmationInput.value,
            confirmed: confirmationCheckbox.checked === true,
        }),
    });
    const updateReady = () => {
        promoteButton.disabled = !(confirmationCheckbox.checked && confirmationInput.value === plan.project_id);
        promoteButton.classList?.toggle('cursor-not-allowed', promoteButton.disabled);
        promoteButton.classList?.toggle('opacity-45', promoteButton.disabled);
    };
    confirmationInput.addEventListener('input', updateReady);
    confirmationCheckbox.addEventListener('change', updateReady);
    section.appendChild(el('div', { className: 'space-y-3 border-t border-amber-300/20 pt-4' }, [
        el('label', { className: 'block text-xs font-semibold text-secondary', attrs: { for: 'g3-promotion-project-confirmation' } }, [
            el('span', { text: `프로젝트 ID “${plan.project_id}”를 정확히 입력` }),
            confirmationInput,
        ]),
        el('p', {
            text: '대상과 source/export가 계획 이후 조금이라도 바뀌면 반영은 자동 차단됩니다.',
            className: 'text-xs leading-5 text-secondary',
            attrs: { id: 'g3-promotion-confirmation-help' },
        }),
        el('label', { className: 'flex min-h-11 items-center gap-3 rounded-md border border-white/10 bg-black/20 px-3 py-2 text-xs leading-5 text-white', attrs: { for: 'g3-promotion-explicit-confirmation' } }, [
            confirmationCheckbox,
            el('span', { text: '이 선택이 사람 검토 결과이며 production 반영을 명시적으로 승인합니다.' }),
        ]),
        promoteButton,
    ]));
    return section;
}
