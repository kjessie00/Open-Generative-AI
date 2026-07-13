import { p } from './copy.js';

export function el(tag, options = {}, children = []) {
    const node = document.createElement(tag);
    const childList = Array.isArray(children) ? children : [children];

    if (options.className) node.className = options.className;
    if (options.text !== undefined) node.textContent = String(options.text);
    if (options.title) node.title = options.title;
    if (options.type) node.type = options.type;
    if (options.disabled !== undefined) node.disabled = Boolean(options.disabled);
    if (options.value !== undefined) node.value = options.value;
    if (options.readOnly !== undefined) node.readOnly = Boolean(options.readOnly);
    if (options.onClick) node.addEventListener('click', options.onClick);
    if (options.attrs) {
        Object.entries(options.attrs).forEach(([key, value]) => {
            if (value !== undefined && value !== null) node.setAttribute(key, String(value));
        });
    }

    childList.filter(Boolean).forEach((child) => {
        node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
}

export function textOrDash(value) {
    if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
    if (typeof value === 'boolean') return value ? p('yes') : p('no');
    if (value === 0) return '0';
    return value ? String(value) : '—';
}

export function statusBadge(label, status = 'muted') {
    const normalized = String(status || '').toUpperCase();
    const palette = {
        PASS: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/20',
        OK: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/20',
        ALLOWED: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/20',
        FAIL: 'bg-red-400/15 text-red-200 border-red-400/20',
        BLOCK: 'bg-red-400/15 text-red-200 border-red-400/20',
        BLOCKED: 'bg-red-400/15 text-red-200 border-red-400/20',
        RETRY: 'bg-orange-400/15 text-orange-200 border-orange-400/20',
        UNREVIEWED: 'bg-zinc-400/15 text-zinc-200 border-zinc-400/20',
        EXCEPTION: 'bg-purple-400/15 text-purple-200 border-purple-400/20',
        WARN: 'bg-yellow-400/15 text-yellow-100 border-yellow-400/20',
        PREVIEW: 'bg-cyan-400/15 text-cyan-100 border-cyan-400/20',
    };
    return el('span', {
        text: label,
        className: `inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-semibold ${palette[normalized] || 'bg-white/[0.06] text-secondary border-white/10'}`,
    });
}

export function panelShell(title, description, children = []) {
    return el('section', { className: 'flex flex-col gap-4', attrs: { 'aria-labelledby': `panel-${String(title).replace(/\s+/g, '-').toLowerCase()}` } }, [
        el('header', { className: 'flex flex-col gap-2' }, [
            el('h2', { text: title, className: 'text-xl font-bold tracking-tight text-white', attrs: { id: `panel-${String(title).replace(/\s+/g, '-').toLowerCase()}` } }),
            description ? el('p', { text: description, className: 'max-w-3xl text-sm leading-6 text-secondary' }) : null,
        ]),
        ...children,
    ]);
}

export function card(children = [], className = '') {
    return el('div', {
        className: `rounded-lg border border-white/10 bg-white/[0.035] p-4 ${className}`.trim(),
    }, children);
}

export function fieldCard(label, value, extra = null) {
    return card([
        el('div', { text: label, className: 'text-xs font-semibold text-secondary' }),
        el('div', { text: textOrDash(value), className: 'mt-2 break-words text-sm font-semibold text-white' }),
        extra,
    ].filter(Boolean), 'min-h-[72px]');
}

export function infoGrid(items, columns = 'lg:grid-cols-3') {
    return el('div', { className: `grid grid-cols-1 gap-3 md:grid-cols-2 ${columns}` }, items.map((item) => fieldCard(item.label, item.value, item.extra)));
}

export function blockerList(blockers = []) {
    const unique = Array.from(new Set(blockers.filter(Boolean)));
    if (!unique.length) {
        return card([statusBadge(p('No blockers'), 'PASS')], 'border-emerald-400/20');
    }

    return card([
        el('div', { text: p('Blockers'), className: 'mb-3 text-xs font-semibold text-secondary' }),
        el('div', { className: 'flex flex-wrap gap-2' }, unique.map((blocker) => statusBadge(blocker, 'BLOCK'))),
    ], 'border-red-400/20');
}

export function flagGrid(flags) {
    return el('div', { className: 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4' }, flags.map((flag) => (
        card([
            statusBadge(flag.value ? p('enabled') : p('off'), flag.value ? 'PASS' : 'UNREVIEWED'),
            el('div', { text: flag.label, className: 'mt-3 text-sm font-semibold text-white' }),
        ], 'p-4')
    )));
}

export function pathList(paths = []) {
    const values = Array.from(new Set(paths.filter(Boolean)));
    if (!values.length) return el('p', { text: p('No paths recorded.'), className: 'text-sm text-secondary', attrs: { role: 'status' } });
    return el('ul', { className: 'flex flex-col gap-2' }, values.map((path) => (
        el('li', { text: path, className: 'break-all rounded-lg border border-white/10 bg-black/20 px-3 py-2 font-mono text-xs text-secondary' })
    )));
}

export function dataTable(columns, rows) {
    const table = el('table', { className: 'min-w-full border-separate border-spacing-0 text-left text-sm' });
    const thead = el('thead');
    thead.appendChild(el('tr', {}, columns.map((column) => (
        el('th', { text: column.label, className: 'sticky top-0 z-10 border-b border-white/10 bg-[#0a0a0a] px-3 py-3 text-xs font-semibold text-secondary', attrs: { scope: 'col' } })
    ))));

    const tbody = el('tbody');
    rows.forEach((row) => {
        tbody.appendChild(el('tr', { className: 'align-top hover:bg-white/[0.03]' }, columns.map((column) => {
            const value = typeof column.render === 'function' ? column.render(row) : textOrDash(row[column.key]);
            const isNode = value && typeof value === 'object' && typeof value.nodeType === 'number';
            return el('td', { className: 'border-b border-white/5 px-3 py-3 text-secondary' }, isNode ? value : String(value));
        })));
    });

    table.appendChild(thead);
    table.appendChild(tbody);

    return el('div', { className: 'overflow-auto rounded-lg border border-white/10 bg-white/[0.03]' }, rows.length ? table : emptyState(p('No rows recorded.')));
}

export function emptyState(text) {
    return el('div', { text, className: 'rounded-lg border border-dashed border-white/10 bg-white/[0.02] p-6 text-center text-sm text-secondary', attrs: { role: 'status', 'aria-live': 'polite' } });
}

export function actionButton(label, { disabled = false, variant = 'primary', onClick } = {}) {
    const classes = variant === 'danger'
        ? 'border-red-400/20 bg-red-400/10 text-red-100'
        : variant === 'muted'
            ? 'border-white/10 bg-white/[0.04] text-secondary'
            : 'border-cyan-400/20 bg-cyan-400/10 text-cyan-100';

    return el('button', {
        text: label,
        disabled,
        onClick,
        className: `ui-action-button rounded-md border px-3 py-2 text-xs font-semibold transition-colors ${classes} ${disabled ? 'cursor-not-allowed opacity-45' : 'hover:bg-white/10'}`,
        attrs: { type: 'button' },
    });
}

export function codeBlock(text) {
    return el('pre', { className: 'overflow-auto rounded-lg border border-white/10 bg-black/30 p-4 text-xs leading-6 text-secondary' }, [
        el('code', { text: textOrDash(text) }),
    ]);
}
