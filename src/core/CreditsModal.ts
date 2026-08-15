// ============================================
// CREDITS MODAL — third-party attribution, opened from the settings menu
// ============================================
//
// The catalogue itself lives in CreditsData.ts; this file only renders it. The
// body is rebuilt from scratch on every language change rather than annotated
// with data-i18n, because entry notes are bilingual data rather than UI strings
// and applyTranslations() has no way to reach them.

import { t, getCurrentLanguage, onLanguageChange } from './i18n';
import { playUIButton, playUIBubbleExpand, playUIBubbleCollapse } from './Audio';
import { creditGroups, groupProgress, isPending, type CreditEntry, type CreditGroup } from './CreditsData';

const OPEN_GROUPS_KEY = 'portfolio-credits-groups';

let overlay: HTMLElement | null = null;
let body: HTMLElement | null = null;
let isOpen = false;

/** Which group accordions the user left open, persisted like the settings tabs. */
function loadOpenGroups(): Record<string, boolean> {
    try {
        return JSON.parse(localStorage.getItem(OPEN_GROUPS_KEY) || '{}');
    } catch {
        return {};
    }
}

function saveOpenGroup(id: string, open: boolean): void {
    const states = loadOpenGroups();
    states[id] = open;
    localStorage.setItem(OPEN_GROUPS_KEY, JSON.stringify(states));
}

function esc(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

/** A chip is a link when the datum has a URL behind it, plain text otherwise. */
function chip(kind: string, label: string, url?: string, icon = ''): string {
    const inner = `${icon}<span>${esc(label)}</span>`;
    return url
        ? `<a class="credit-chip ${kind}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${inner}</a>`
        : `<span class="credit-chip ${kind}">${inner}</span>`;
}

const authorIcon = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;
const linkIcon = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
const licenseIcon = `<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></svg>`;
const arrowSvg = `<svg class="credits-group-arrow" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>`;

function renderEntry(entry: CreditEntry): string {
    const lang = getCurrentLanguage();
    const waiting = isPending(entry);

    const chips: string[] = [];
    if (entry.author) chips.push(chip('author', entry.author, entry.authorUrl, authorIcon));
    // The chain glyph is a link affordance, so a source with no page behind it
    // (Pixabay, whose sounds aren't addressable by id) goes without one.
    if (entry.source) chips.push(chip('source', entry.source, entry.sourceUrl, entry.sourceUrl ? linkIcon : ''));
    else if (entry.sourceUrl) chips.push(chip('source', entry.sourceUrl, entry.sourceUrl, linkIcon));
    if (entry.license) chips.push(chip('license', entry.license, entry.licenseUrl, licenseIcon));
    if (waiting) chips.push(`<span class="credit-chip todo">${esc(t('credits.pending'))}</span>`);
    else if (!entry.license) chips.push(`<span class="credit-chip todo soft">${esc(t('credits.licensePending'))}</span>`);

    const title = entry.title && entry.title !== entry.name
        ? `<span class="credit-original">“${esc(entry.title)}”</span>`
        : '';
    const file = entry.file ? `<div class="credit-file">${esc(entry.file)}</div>` : '';
    const atlas = entry.atlas
        ? `<div class="credit-note">${esc(t('credits.atlasHint'))} <code>${esc(entry.atlas)}</code></div>`
        : '';
    const note = entry.note
        ? `<div class="credit-note">${esc(lang === 'pt-br' ? entry.note.pt : entry.note.en)}</div>`
        : '';

    return `
        <div class="credit-entry${waiting ? ' pending' : ''}">
            <div class="credit-head">
                <span class="credit-name">${esc(entry.name)}</span>
                ${title}
            </div>
            ${file}
            <div class="credit-chips">${chips.join('')}</div>
            ${atlas}
            ${note}
        </div>`;
}

function renderGroup(group: CreditGroup, openStates: Record<string, boolean>): string {
    const [credited, total] = groupProgress(group);
    const open = openStates[group.id] ?? false;

    const sections = group.sections.map(section => {
        const label = section.labelKey
            ? `<div class="credits-section-label">${esc(t(section.labelKey))}</div>`
            : '';
        return `<div class="credits-section">${label}${section.entries.map(renderEntry).join('')}</div>`;
    }).join('');

    return `
        <section class="credits-group${open ? ' open' : ''}" data-group="${esc(group.id)}">
            <button class="credits-group-header" type="button">
                <span class="credits-group-title">${esc(t(group.titleKey))}</span>
                <span class="credits-group-count${credited === total ? ' complete' : ''}">${credited}/${total}</span>
                ${arrowSvg}
            </button>
            <div class="credits-group-content">${sections}</div>
        </section>`;
}

function renderBody(): void {
    if (!body) return;
    const openStates = loadOpenGroups();
    body.innerHTML = creditGroups.map(g => renderGroup(g, openStates)).join('');

    body.querySelectorAll('.credits-group-header').forEach(header => {
        header.addEventListener('click', () => {
            const group = (header as HTMLElement).parentElement!;
            const nowOpen = !group.classList.contains('open');
            group.classList.toggle('open', nowOpen);
            saveOpenGroup(group.dataset.group || '', nowOpen);
            playUIButton();
        });
    });
}

/** Rewrite the chrome (title, subtitle, footer) for the active language. */
function renderChrome(): void {
    if (!overlay) return;
    const set = (selector: string, key: string) => {
        const el = overlay!.querySelector(selector) as HTMLElement | null;
        if (el) el.textContent = t(key);
    };
    set('.credits-title', 'credits.title');
    set('.credits-subtitle', 'credits.subtitle');
    set('.credits-footer-text', 'credits.footer');
    const close = overlay.querySelector('.credits-close') as HTMLElement | null;
    if (close) close.title = t('credits.close');
}

/** Build the modal once. Safe to call repeatedly. */
export function initCreditsModal(): void {
    if (overlay) return;

    overlay = document.createElement('div');
    overlay.className = 'credits-overlay';
    overlay.innerHTML = `
        <div class="credits-modal" role="dialog" aria-modal="true">
            <div class="credits-modal-header">
                <div class="credits-heading">
                    <div class="credits-title"></div>
                    <div class="credits-subtitle"></div>
                </div>
                <button class="credits-close" type="button" aria-label="close">
                    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
            </div>
            <div class="credits-body"></div>
            <div class="credits-modal-footer"><span class="credits-footer-text"></span></div>
        </div>`;
    document.body.appendChild(overlay);

    body = overlay.querySelector('.credits-body') as HTMLElement;

    renderChrome();
    renderBody();

    (overlay.querySelector('.credits-close') as HTMLElement).addEventListener('click', closeCreditsModal);

    // Backdrop click closes; clicks on the sheet itself must not.
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) closeCreditsModal();
    });

    // The scene drives the camera off document-level wheel/touchmove (Input.ts),
    // so scrolling this list has to stop there — same guard the settings panel uses.
    const swallow = (e: Event) => e.stopPropagation();
    overlay.addEventListener('wheel', swallow, { passive: false });
    overlay.addEventListener('touchmove', swallow, { passive: false });
    overlay.addEventListener('pointerdown', swallow);

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && isOpen) closeCreditsModal();
    });

    onLanguageChange(() => {
        renderChrome();
        renderBody();
    });
}

export function openCreditsModal(): void {
    initCreditsModal();
    if (isOpen) return;
    isOpen = true;
    overlay!.classList.add('open');
    playUIBubbleExpand();
}

export function closeCreditsModal(): void {
    if (!isOpen || !overlay) return;
    isOpen = false;
    overlay.classList.remove('open');
    playUIBubbleCollapse();
}

export function isCreditsOpen(): boolean {
    return isOpen;
}
