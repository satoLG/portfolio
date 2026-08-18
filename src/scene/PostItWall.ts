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
import { setZoomExitLock, isNoticeBoardFocused, setNoticeBoardFocus, isNoticeBoardZoomActive } from '../core/Control';

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
let _onExit: ((e?: PointerEvent) => void) | null = null;

/** The invisible quad over the region, handed over by Island once the board is
 *  built. Everything about placement is a raycast against this one object. */
let _pickPlane: Object3D | null = null;
export function registerPostItPickPlane(obj: Object3D): void { _pickPlane = obj; }

export function setPostItExit(cb: (e?: PointerEvent) => void): void { _onExit = cb; }

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

/**
 * One note.
 *
 * `data-ink-rot` is not decoration — CSS3DPanel punches each note's hole from
 * its LAYOUT box, which is transform-independent by design, so the mask has to
 * be told about the tilt separately or a rotated note's corners come out as
 * bare page background beside it.
 *
 * For the same reason the note is centred on its (u,v) with MARGINS rather than
 * translate(-50%,-50%): margins move the layout box, transforms do not. With a
 * translate the punched hole sat half a note away from the note — which is
 * exactly the "only part of it shows" the wall was doing.
 */
function _noteHTML(n: PostIt, extraClass = ''): string {
    return `
        <div class="pw-postit ${extraClass}" data-id="${n.id}" data-ink-rot="${n.rot}"
             style="left:${n.u * 100}%; top:${n.v * 100}%; --pw-rot:${n.rot}deg; --pw-color:${n.color};">
            <span class="pw-text"></span>
        </div>`;
}

/** Note size as a fraction of the region — must match .pw-postit in the CSS. */
const NOTE_U = 96 / DESIGN_W;
const NOTE_V = 92 / DESIGN_H;
/** Add button size as a fraction of the region — must match .pw-add. */
const ADD_U = 52 / DESIGN_W;
const ADD_V = 52 / DESIGN_H;

/** Where the fixed example note lives, and where the add button tucks into its
 *  BOTTOM-RIGHT corner. The example's text sits in its upper half, so the lower
 *  corner is free — and a button overlapping the note that explains what it
 *  makes reads as one object, which a button floating in a corner never did. */
const SAMPLE_U = 0.17, SAMPLE_V = 0.30;
const ADD_CU = SAMPLE_U + NOTE_U / 2 - ADD_U * 0.34;
const ADD_CV = SAMPLE_V + NOTE_V / 2 - ADD_V * 0.34;

/** The example note. Always present, never stored and never editable — without
 *  something already on the wall the add button is a button on bare wood, and
 *  what it makes is not obvious until after you press it. */
function _sampleNote(): PostIt {
    return {
        id: '__sample__',
        text: t('postit.sample'),
        color: POSTIT_COLORS[3],
        u: SAMPLE_U, v: SAMPLE_V, rot: -6,
    };
}

/** Boxes a visitor's note may not cover: the example and the add button. Both
 *  are part of the scene rather than the visitor's, and burying either one
 *  leaves the wall with no way to explain itself and no way to add to it. */
const RESERVED: Array<{ cu: number; cv: number; w: number; h: number }> = [
    { cu: SAMPLE_U, cv: SAMPLE_V, w: NOTE_U, h: NOTE_V },
    { cu: ADD_CU,   cv: ADD_CV,   w: ADD_U,  h: ADD_V  },
];

/**
 * How far past the region a note may hang.
 *
 * A note pinned near the edge should hang OFF it a little, the way a real one
 * does — not stop dead at an invisible boundary. What was clipping it was the
 * punch mask: its canvas is the design box plus maskPad, so anything beyond
 * that simply has no hole and the paper vanishes at a hard line. The pad below
 * is sized to cover this overhang, and the clamp keeps the overhang to about a
 * fifth of the note so it still reads as stuck on rather than falling off.
 */
const OVERHANG_U = NOTE_U * 0.20;
/** Downward only. Upward there is a sheet a few centimetres above this region,
 *  and a note that reaches it both collides with its panel and lands coplanar
 *  with it — two flat quads at the same depth, which is the z-fighting seen on
 *  the badge sheet. A margin keeps the two apart in the first place. */
const OVERHANG_V_BOTTOM = NOTE_V * 0.20;
const TOP_MARGIN_V = NOTE_V * 0.18;

/** True when a note dropped at (u,v) would overlap something reserved. */
function _hitsReserved(u: number, v: number): boolean {
    for (const r of RESERVED) {
        if (Math.abs(u - r.cu) < (NOTE_U + r.w) / 2 &&
            Math.abs(v - r.cv) < (NOTE_V + r.h) / 2) return true;
    }
    return false;
}

function _render(): void {
    if (!_wall || !_panel) return;
    const sample = _sampleNote();
    const blocked = _mode === 'placing' && _hitsReserved(_draftU, _draftV);
    const ghost: string = _mode === 'placing'
        ? _noteHTML({ id: '__ghost__', text: _draftText, color: _draftColor, u: _draftU, v: _draftV, rot: _draftRot },
                    blocked ? 'pw-ghost pw-blocked' : 'pw-ghost')
        : '';
    _syncConfirmState(blocked);

    _wall.innerHTML = `
        ${_noteHTML(sample, 'pw-sample')}
        ${_notes.map(n => _noteHTML(n)).join('')}
        ${ghost}
        <button class="pw-add" type="button" title="${t('postit.add')}"
                data-ink-rot="-4" data-ink-radius="12"
                style="left:${ADD_CU * 100}%; top:${ADD_CV * 100}%;">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"
                fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round"/></svg>
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

/**
 * Move the ghost while it is being dragged — WITHOUT rebuilding the wall.
 *
 * Dragging used to call _render(), which throws away and re-creates every note
 * on the board: two dozen elements, each with a filtered paper texture, plus
 * the add button's SVG and a fresh listener, plus a forced double reflow from
 * requestRepaint — all so that one note could move a few pixels. On a phone
 * that is the difference between a drag that follows your finger and one that
 * arrives a moment later.
 *
 * Only the ghost moves during a drag, so only the ghost is touched. Everything
 * the visitor sees is identical: same position, same blocked styling, same
 * disabled confirm, same repaint.
 */
function _syncGhost(): void {
    if (_mode !== 'placing' || !_wall) return;
    const el = _wall.querySelector<HTMLElement>('[data-id="__ghost__"]');
    if (!el) { _render(); return; }   // shouldn't happen — placement always renders one
    const blocked = _hitsReserved(_draftU, _draftV);
    el.style.left = `${_draftU * 100}%`;
    el.style.top = `${_draftV * 100}%`;
    el.classList.toggle('pw-blocked', blocked);
    _syncConfirmState(blocked);
    _panel?.requestRepaint();
}

/** Coalesce drag updates to one per frame. A finger on a 120Hz screen produces
 *  several touchmoves per displayed frame and a mouse can produce more; every
 *  one of them past the first is work whose result is overwritten before it is
 *  ever shown. */
let _ghostRaf = 0;
function _requestGhostSync(): void {
    if (_ghostRaf) return;
    _ghostRaf = requestAnimationFrame(() => { _ghostRaf = 0; _syncGhost(); });
}
function _cancelGhostSync(): void {
    if (_ghostRaf) { cancelAnimationFrame(_ghostRaf); _ghostRaf = 0; }
}

/** Grey out "stick it here" while the note is over something reserved, and say
 *  why — a button that silently does nothing is worse than no button. */
function _syncConfirmState(blocked: boolean): void {
    if (!_placeBar) return;
    const btn = _placeBar.querySelector<HTMLButtonElement>('.pp-confirm');
    if (btn) btn.disabled = blocked;
    const hint = _placeBar.querySelector('.pp-hint');
    if (hint) hint.textContent = t(blocked ? 'postit.blocked' : 'postit.placeHint');
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
    // The wall only works from inside the board's zoom. The button is unclickable
    // from outside anyway (the panel is non-modal there, so the canvas owns the
    // pointer), but nothing about the wall should be reachable by any other
    // route either — the whole feature belongs to that camera.
    if (!isNoticeBoardZoomActive()) return;
    _mode = 'editing';
    // Held for the WHOLE flow — writing and placing — and released on every way
    // out. A placement drag is a stream of move events, and without this the
    // stuck-zoom safety valve reads it as the user trying to leave and pulls the
    // camera off the board mid-drag.
    setZoomExitLock(true);
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
        setZoomExitLock(false);
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
    // Hand the gesture to us for the duration. Without this the browser claims
    // the touch for panning and fires pointercancel the moment a finger moves,
    // which is why dragging a note did nothing on a phone.
    renderer.domElement.style.touchAction = 'none';
    _placeBar ??= _buildPlacementBar();
    _placeBar.querySelector('.pp-hint')!.textContent = t('postit.placeHint');
    _placeBar.querySelector('.pp-cancel')!.textContent = t('postit.cancel');
    _placeBar.querySelector('.pp-confirm')!.textContent = t('postit.stick');
    _placeBar.classList.add('pp-open');
}

function _endPlacement(accept: boolean): void {
    if (_mode !== 'placing') return;
    _cancelGhostSync();   // a queued frame would run against a wall that is gone
    renderer.domElement.style.touchAction = '';
    _placeBar?.classList.remove('pp-open');
    _mode = 'idle';
    setZoomExitLock(false);

    if (accept && _hitsReserved(_draftU, _draftV)) {
        // Should be unreachable — the confirm button is disabled over a
        // reserved box — but a note must never end up on top of the example.
        playUIButton();
        _render();
        return;
    }

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
    // Centres may sit far enough out that the note hangs over the edge — see
    // OVERHANG_U/V. Half the note minus the allowed overhang is the limit.
    const maxU = 1 - NOTE_U / 2 + OVERHANG_U;
    const maxV = 1 - NOTE_V / 2 + OVERHANG_V_BOTTOM;
    const minV = NOTE_V / 2 + TOP_MARGIN_V;   // asymmetric: no overhang upward
    _draftU = Math.min(maxU, Math.max(1 - maxU, hit.uv.x));
    _draftV = Math.min(maxV, Math.max(minV, 1 - hit.uv.y));
    return true;
}

function _setupPlacementInput(): void {
    const canvas = renderer.domElement;
    if (!canvas) return;

    // ── Touch ────────────────────────────────────────────────────────────────
    // Touch events, NOT pointer events, and this is the whole reason dragging a
    // note did nothing on a phone. While a zoom is active Input.ts calls
    // preventDefault() on every touchmove to stop the page scrolling — and a
    // prevented touchmove suppresses the pointermove that would have followed
    // it and fires pointercancel instead, so the pointer-based drag died on the
    // first frame of movement. The touch handler still runs regardless.
    //
    // stopPropagation keeps the gesture from reaching Input's document-level
    // listener at all, so placement and the camera never contend for it.
    const onTouch = (e: TouchEvent) => {
        if (_mode !== 'placing') return;
        const touch = e.touches[0] ?? e.changedTouches[0];
        if (!touch) return;
        e.preventDefault();
        e.stopPropagation();
        if (_pickAt(touch.clientX, touch.clientY)) _requestGhostSync();
    };
    canvas.addEventListener('touchstart', onTouch, { passive: false });
    canvas.addEventListener('touchmove', onTouch, { passive: false });

    // ── Mouse ────────────────────────────────────────────────────────────────
    // Desktop tracks the cursor continuously — there is a hover to track, so the
    // note follows without needing a button held down.
    // Desktop: PRESS to place, drag to adjust, release to leave it there.
    //
    // It used to follow the cursor free, with no button held — which made the
    // confirm button unreachable: the note travelled with the pointer all the
    // way to the bar, so there was no way to say "here" and then go press it.
    // A held drag is the same gesture as touch and leaves the note where the
    // button came up.
    let mouseDown = false;
    canvas.addEventListener('pointerdown', (e) => {
        if (_mode !== 'placing' || e.pointerType !== 'mouse') return;
        mouseDown = true;
        if (_pickAt(e.clientX, e.clientY)) _requestGhostSync();
    });
    canvas.addEventListener('pointermove', (e) => {
        if (_mode !== 'placing' || e.pointerType !== 'mouse' || !mouseDown) return;
        if (_pickAt(e.clientX, e.clientY)) _requestGhostSync();
    });
    const releaseMouse = (e: PointerEvent) => { if (e.pointerType === 'mouse') mouseDown = false; };
    canvas.addEventListener('pointerup', releaseMouse);
    canvas.addEventListener('pointercancel', releaseMouse);
}

// ── Panel ────────────────────────────────────────────────────────────────────

function _ensurePanel(): CSS3DPanel {
    if (_panel) return _panel;

    _panel = new CSS3DPanel({
        pxPerUnit: DESIGN_W,
        initialSize: { w: DESIGN_W, h: DESIGN_H },
        modal: false,
        // Big enough to hold a note that hangs past the region — the mask canvas
        // is the design box plus this, and a hole outside it is where the paper
        // was being sliced off.
        maskPad: 34,
        transparent: true,
        // NOT inkBounds: each note gets its own punched box so the planks show
        // between them. A single bounding region would paint a pale rectangle
        // over the whole lower board and the notes would stop reading as paper
        // stuck to wood.
        inkBounds: false,
        inkSelectors: ['.pw-postit', '.pw-add'],
        // NEGATIVE: the hole is punched two pixels INSIDE each note, so the
        // paper's own edge always covers the mask's antialiased boundary. A hole
        // exactly the size of the note leaves a hairline of page background all
        // round it — see the longer note in NoticeBoardPanel.
        inkPad: -2,
        inkRadius: 3,
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

    // The wall is never itself framed, so a click on it while a sheet is framed
    // is a click outside that sheet: step back to the board.
    _wall!.addEventListener('click', (e) => {
        e.stopPropagation();
        if (isNoticeBoardFocused()) setNoticeBoardFocus(null);
    });
    _panel.setOnOutsideClick((e) => { if (_mode === 'idle') _onExit?.(e); });
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
