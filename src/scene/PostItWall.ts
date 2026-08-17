// ============================================
// POST-IT WALL — the bottom of the board, which belongs to the visitor
// ============================================
//
// A CSS3DPanel over the board's lower region, but unlike the two paper sheets
// above it this one is NOT a sheet: it punches only the post-its and the add
// button, so the bare planks show between them and the notes read as stuck onto
// the wood rather than printed on a page. (transparent + inkBounds:false — one
// punched box per note instead of one around the lot.)
//
// THREE STATES, and the pointer moves between two owners as they change:
//
//   idle     — notes on the wall. Modal while the board is zoomed, so the add
//              button takes clicks.
//   editing  — a screen-space overlay. Deliberately NOT in the 3D layer: this is
//              a text field, and a text field wants a real focused element,
//              a real caret and the platform's own keyboard. Reading it as
//              "the note is held up to the camera" is a styling job, not a
//              geometry one.
//   placing  — a ghost note on the wall following the pointer. The panel goes
//              NON-modal here on purpose: modal sets the canvas to
//              pointer-events:none, and this state is built entirely on
//              raycasting the canvas.
//
// Placement works the same on both inputs because it is all pointer events on
// one invisible quad: press anywhere in the region to send the note there, drag
// to adjust, and a floating bar confirms. No hover-only affordance, so nothing
// about it is desktop-only, and no long-press, so nothing about it fights the
// scroll gesture on touch.
//
// STORED IN localStorage, per browser. There is no backend in this project, so
// notes are the visitor's own and are not shared with anyone else who opens the
// site — the wall is a personal scrapbook, not a guestbook. Wiring it to a real
// guestbook is a server away, and nothing in here would have to change except
// where load/save read from.

import { Raycaster, Vector2, type Object3D } from 'three';
import { CSS3DPanel } from '../effects/CSS3DPanel';
import { t, onLanguageChange } from '../core/i18n';
import { camera, renderer } from '../core/Scene';
import { playPostItStick, playUIButton } from '../core/Audio';

const DESIGN_W = 520;
const DESIGN_H = 350;

/** Five colours, the only palette a note can be. */
export const POSTIT_COLORS = ['#f7e06a', '#f6a95f', '#f28f8f', '#9fd6a0', '#8fc9e8'] as const;
export type PostItColor = typeof POSTIT_COLORS[number];

const MAX_CHARS = 90;
const STORAGE_KEY = 'portfolio-postits';
/** Plenty for a personal wall, and a hard stop on someone pasting a novel into
 *  localStorage until it throws. */
const MAX_NOTES = 24;

interface PostIt {
    id: string;
    text: string;
    color: string;
    /** Position within the region, 0..1 from the top-left. */
    u: number; v: number;
    /** Degrees of tilt — nobody sticks paper on straight. */
    rot: number;
}

let _notes: PostIt[] = [];

function _load(): void {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return;
        _notes = parsed
            .filter((n: any) => n && typeof n.text === 'string')
            .slice(0, MAX_NOTES)
            .map((n: any): PostIt => ({
                id: String(n.id ?? Math.random().toString(36).slice(2)),
                text: String(n.text).slice(0, MAX_CHARS),
                color: POSTIT_COLORS.includes(n.color) ? n.color : POSTIT_COLORS[0],
                u: Math.min(1, Math.max(0, Number(n.u) || 0.5)),
                v: Math.min(1, Math.max(0, Number(n.v) || 0.5)),
                rot: Math.min(14, Math.max(-14, Number(n.rot) || 0)),
            }));
    } catch { /* corrupt or unavailable — start with an empty wall */ }
}

function _save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_notes)); } catch { /* private mode */ }
}

_load();

// ── State ────────────────────────────────────────────────────────────────────

type Mode = 'idle' | 'editing' | 'placing';
let _mode: Mode = 'idle';

let _panel: CSS3DPanel | null = null;
let _wall: HTMLDivElement | null = null;
let _modal = false;
let _zoomed = false;
let _onExit: (() => void) | null = null;

/** The invisible quad over the region, handed over by Island once the board is
 *  built. Everything about placement is a raycast against this one object. */
let _pickPlane: Object3D | null = null;
export function registerPostItPickPlane(obj: Object3D): void { _pickPlane = obj; }

export function setPostItExit(cb: () => void): void { _onExit = cb; }

/** Placement must not let the board's click-away fire underneath it. */
export function isPostItBusy(): boolean { return _mode !== 'idle'; }

// Draft being written / placed
let _draftText = '';
let _draftColor: string = POSTIT_COLORS[0];
let _draftU = 0.5;
let _draftV = 0.5;
let _draftRot = 0;

const _raycaster = new Raycaster();
const _ndc = new Vector2();

// ── Rendering the wall ───────────────────────────────────────────────────────

function _noteHTML(n: PostIt, extraClass = ''): string {
    return `
        <div class="pw-postit ${extraClass}" data-id="${n.id}"
             style="left:${n.u * 100}%; top:${n.v * 100}%; --pw-rot:${n.rot}deg; --pw-color:${n.color};">
            <span class="pw-text"></span>
        </div>`;
}

/** The example note. Always present, never stored and never editable — without
 *  something already on the wall the add button is a button on bare wood, and
 *  what it makes is not obvious until after you press it. */
function _sampleNote(): PostIt {
    return {
        id: '__sample__',
        text: t('postit.sample'),
        color: POSTIT_COLORS[3],
        u: 0.16, v: 0.30, rot: -6,
    };
}

function _render(): void {
    if (!_wall || !_panel) return;
    const sample = _sampleNote();
    const ghost: string = _mode === 'placing'
        ? _noteHTML({ id: '__ghost__', text: _draftText, color: _draftColor, u: _draftU, v: _draftV, rot: _draftRot }, 'pw-ghost')
        : '';

    _wall.innerHTML = `
        ${_noteHTML(sample, 'pw-sample')}
        ${_notes.map(n => _noteHTML(n)).join('')}
        ${ghost}
        <button class="pw-add" type="button" title="${t('postit.add')}">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"
                fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round"/></svg>
        </button>`;

    // Text goes in via textContent, never innerHTML — this is visitor input and
    // it is being written into the page.
    const all = [sample, ..._notes, ...(_mode === 'placing'
        ? [{ id: '__ghost__', text: _draftText } as PostIt] : [])];
    for (const n of all) {
        const el = _wall.querySelector<HTMLElement>(`[data-id="${n.id}"] .pw-text`);
        if (el) el.textContent = n.text;
    }

    _wall.querySelector<HTMLButtonElement>('.pw-add')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openEditor();
    });

    _panel.requestRepaint();
}

// ── Editor overlay (screen space) ────────────────────────────────────────────

let _editorEl: HTMLDivElement | null = null;

function _buildEditor(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'postit-editor';
    el.innerHTML = `
        <div class="pe-backdrop"></div>
        <div class="pe-stage">
            <div class="pe-note">
                <textarea class="pe-input" maxlength="${MAX_CHARS}" rows="4"
                          spellcheck="false" autocomplete="off"></textarea>
                <span class="pe-count"></span>
            </div>
            <div class="pe-swatches">
                ${POSTIT_COLORS.map((c, i) => `
                    <button class="pe-swatch${i === 0 ? ' pe-swatch-on' : ''}" type="button"
                            data-color="${c}" style="--pw-color:${c}"></button>`).join('')}
            </div>
            <div class="pe-actions">
                <button class="pe-btn pe-cancel" type="button"></button>
                <button class="pe-btn pe-done" type="button"></button>
            </div>
        </div>`;
    document.body.appendChild(el);

    const input = el.querySelector<HTMLTextAreaElement>('.pe-input')!;
    const note = el.querySelector<HTMLElement>('.pe-note')!;
    const count = el.querySelector<HTMLElement>('.pe-count')!;

    const sync = () => {
        _draftText = input.value.slice(0, MAX_CHARS);
        count.textContent = `${_draftText.length}/${MAX_CHARS}`;
    };
    input.addEventListener('input', sync);

    for (const sw of el.querySelectorAll<HTMLButtonElement>('.pe-swatch')) {
        sw.addEventListener('click', () => {
            _draftColor = sw.dataset.color!;
            note.style.setProperty('--pw-color', _draftColor);
            el.querySelectorAll('.pe-swatch').forEach(s => s.classList.remove('pe-swatch-on'));
            sw.classList.add('pe-swatch-on');
            playUIButton();
        });
    }

    el.querySelector('.pe-cancel')!.addEventListener('click', () => closeEditor(false));
    el.querySelector('.pe-done')!.addEventListener('click', () => closeEditor(true));
    // Clicking the dimmed surround is the same as cancelling — the usual
    // expectation for something held up in front of you.
    el.querySelector('.pe-backdrop')!.addEventListener('click', () => closeEditor(false));

    return el;
}

function _paintEditorText(): void {
    if (!_editorEl) return;
    _editorEl.querySelector('.pe-cancel')!.textContent = t('postit.cancel');
    _editorEl.querySelector('.pe-done')!.textContent = t('postit.done');
    _editorEl.querySelector<HTMLTextAreaElement>('.pe-input')!.placeholder = t('postit.placeholder');
}

export function openEditor(): void {
    if (_mode !== 'idle') return;
    _mode = 'editing';
    _draftText = '';
    _draftColor = POSTIT_COLORS[0];
    // A few degrees either way, decided once per note so it does not twitch
    // while being dragged around the wall.
    _draftRot = Math.round((Math.random() * 16 - 8) * 10) / 10;

    _editorEl ??= _buildEditor();
    _paintEditorText();
    const input = _editorEl.querySelector<HTMLTextAreaElement>('.pe-input')!;
    const note = _editorEl.querySelector<HTMLElement>('.pe-note')!;
    input.value = '';
    note.style.setProperty('--pw-color', _draftColor);
    _editorEl.querySelectorAll('.pe-swatch').forEach((s, i) => s.classList.toggle('pe-swatch-on', i === 0));
    _editorEl.querySelector('.pe-count')!.textContent = `0/${MAX_CHARS}`;

    document.body.classList.add('postit-editing');
    _editorEl.classList.add('pe-open');
    // Focus after the open transition starts, so mobile keyboards do not fight
    // the animation for the viewport.
    setTimeout(() => input.focus(), 180);
    playUIButton();
}

function closeEditor(accept: boolean): void {
    if (_mode !== 'editing' || !_editorEl) return;
    _editorEl.classList.remove('pe-open');
    document.body.classList.remove('postit-editing');
    _editorEl.querySelector<HTMLTextAreaElement>('.pe-input')!.blur();

    if (accept && _draftText.trim().length > 0) {
        _mode = 'placing';
        _draftU = 0.5; _draftV = 0.5;
        _openPlacementBar();
        _render();
    } else {
        _mode = 'idle';
        playUIButton();
    }
}

// ── Placement ────────────────────────────────────────────────────────────────

let _placeBar: HTMLDivElement | null = null;

function _buildPlacementBar(): HTMLDivElement {
    const el = document.createElement('div');
    el.id = 'postit-place-bar';
    el.innerHTML = `
        <span class="pp-hint"></span>
        <div class="pp-actions">
            <button class="pe-btn pp-cancel" type="button"></button>
            <button class="pe-btn pp-confirm" type="button"></button>
        </div>`;
    document.body.appendChild(el);
    el.querySelector('.pp-cancel')!.addEventListener('click', () => _endPlacement(false));
    el.querySelector('.pp-confirm')!.addEventListener('click', () => _endPlacement(true));
    return el;
}

function _openPlacementBar(): void {
    _placeBar ??= _buildPlacementBar();
    _placeBar.querySelector('.pp-hint')!.textContent = t('postit.placeHint');
    _placeBar.querySelector('.pp-cancel')!.textContent = t('postit.cancel');
    _placeBar.querySelector('.pp-confirm')!.textContent = t('postit.stick');
    _placeBar.classList.add('pp-open');
}

function _endPlacement(accept: boolean): void {
    if (_mode !== 'placing') return;
    _placeBar?.classList.remove('pp-open');
    _mode = 'idle';

    if (accept) {
        if (_notes.length >= MAX_NOTES) _notes.shift();
        _notes.push({
            id: Math.random().toString(36).slice(2),
            text: _draftText.slice(0, MAX_CHARS),
            color: _draftColor,
            u: _draftU, v: _draftV, rot: _draftRot,
        });
        _save();
        playPostItStick();
    } else {
        playUIButton();
    }
    _render();
}

/** Turn a screen point into a spot on the wall. Returns false when the pointer
 *  is off the region, which is what keeps a note from being stuck to the sky. */
function _pickAt(clientX: number, clientY: number): boolean {
    if (!_pickPlane) return false;
    _ndc.x = (clientX / window.innerWidth) * 2 - 1;
    _ndc.y = -(clientY / window.innerHeight) * 2 + 1;
    _raycaster.setFromCamera(_ndc, camera);
    const hit = _raycaster.intersectObject(_pickPlane, false)[0];
    if (!hit || !hit.uv) return false;
    // PlaneGeometry hands back uv directly, which IS the normalised position in
    // the region — no world-space maths and nothing to keep in step with the
    // board's transform. uv.y runs bottom-up; the DOM runs top-down.
    _draftU = Math.min(0.97, Math.max(0.03, hit.uv.x));
    _draftV = Math.min(0.94, Math.max(0.06, 1 - hit.uv.y));
    return true;
}

function _setupPlacementInput(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;

    let dragging = false;

    const move = (e: PointerEvent) => {
        if (_mode !== 'placing') return;
        // Desktop tracks the cursor continuously; touch only while a finger is
        // down, since there is no hover to track.
        if (e.pointerType !== 'mouse' && !dragging) return;
        if (_pickAt(e.clientX, e.clientY)) _render();
    };

    canvas.addEventListener('pointerdown', (e) => {
        if (_mode !== 'placing') return;
        dragging = true;
        if (_pickAt(e.clientX, e.clientY)) _render();
    });
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', () => { dragging = false; });
    canvas.addEventListener('pointercancel', () => { dragging = false; });
}

// ── Panel ────────────────────────────────────────────────────────────────────

function _ensurePanel(): CSS3DPanel {
    if (_panel) return _panel;

    _panel = new CSS3DPanel({
        pxPerUnit: DESIGN_W,
        initialSize: { w: DESIGN_W, h: DESIGN_H },
        modal: false,
        maskPad: 8,
        transparent: true,
        // NOT inkBounds: each note gets its own punched box so the planks show
        // between them. A single bounding region would paint a pale rectangle
        // over the whole lower board and the notes would stop reading as paper
        // stuck to wood.
        inkBounds: false,
        inkSelectors: ['.pw-postit', '.pw-add'],
        inkPad: 3,
        inkRadius: 6,
        inkBorderBand: 0,
        glass: true,
        glassMode: 'paper',
        glassRoughness: 0.96,
        paperShadeStrength: 0.6,
        paperLightGain: 1.15,
    });

    const host = document.createElement('div');
    host.className = 'pw-host';
    host.innerHTML = `<div class="pw-wall"></div>`;
    _panel.content.appendChild(host);
    _wall = host.querySelector('.pw-wall');

    _wall!.addEventListener('click', (e) => e.stopPropagation());
    _panel.setOnOutsideClick(() => { if (_mode === 'idle') _onExit?.(); });
    onLanguageChange(() => { _paintEditorText(); _render(); });
    _setupPlacementInput();
    _render();

    return _panel;
}

/** Per-frame sync from Island.Update — same contract as the other two panels. */
export function syncPostItWall(
    shown: boolean,
    zoomed: boolean,
    wx: number, wy: number, wz: number,
    worldW: number,
    rotY: number,
): void {
    if (!shown && !_panel) return;
    const panel = _ensurePanel();

    if (!shown) {
        if (panel.isOpen()) panel.close();
        if (_modal) { _modal = false; panel.setModal(false); }
        return;
    }

    panel.setFixedYaw(rotY);
    panel.setWorldPosition(wx, wy, wz);
    if (worldW > 0) panel.setPxPerUnit(DESIGN_W / worldW);
    if (!panel.isOpen()) panel.open();

    // Modal while zoomed so the add button takes clicks — but NOT while placing:
    // modal hands the canvas pointer-events:none, and placement is built on
    // raycasting the canvas. The confirm bar is screen-space, so it stays live
    // either way.
    const wantModal = zoomed && _mode !== 'placing';
    if (wantModal !== _modal) {
        _modal = wantModal;
        panel.setModal(wantModal);
        panel.content.classList.toggle('pw-interactive', wantModal);
        panel.requestRepaint();
    }

    // Leaving the board mid-flow would strand the overlay over a scene the
    // visitor has already scrolled away from.
    if (_zoomed && !zoomed && _mode !== 'idle') {
        if (_mode === 'editing') closeEditor(false);
        else _endPlacement(false);
    }
    _zoomed = zoomed;
}
