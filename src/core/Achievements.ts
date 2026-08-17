// ============================================
// ACHIEVEMENTS — what the island keeps track of
// ============================================
//
// Six things the visitor can complete. Three are a single event (drop an apple,
// see a golden one, play a track); three need progress kept across a session
// (strike all three corals, walk every branch of the pug's conversation, and
// night, which is a single event but arrives from a render loop that ticks it
// constantly rather than from a click).
//
// TWO-STAGE BY DESIGN. Earning is not the same as seeing it land:
//
//   unlock()  — the moment it is earned. Persists, pops a toast, plays a
//               stinger. The board is not touched; the visitor is usually
//               nowhere near it.
//   reveal    — the next time the board is zoomed. takePendingReveals() hands
//               over everything earned-but-not-yet-seen, the panel animates each
//               badge from locked to lit, and markRevealed() closes them out.
//
// That gap is the whole point. Walking up to the board and finding the badges
// already painted is a status screen; walking up and watching them light up one
// after another is a reward.
//
// STATE LIVES IN localStorage, per browser. There is no backend in this project
// — it is a static site — so progress is per-device and does not follow the
// visitor anywhere. That is the honest ceiling of what can be promised here.

import { playAchievementUnlock } from './Audio';
import { t } from './i18n';
import { ACHIEVEMENT_ART } from './AchievementArt';

export type AchievementId =
    | 'apple' | 'goldenApple' | 'coral' | 'bonfire' | 'music' | 'dialog';

export interface AchievementDef {
    id: AchievementId;
    /** i18n key for the badge's name. */
    titleKey: string;
    /** i18n key for the one-line "how you got this". */
    descKey: string;
    /** Where the badge sits on the paper, in % of the panel box, plus a few
     *  degrees of tilt. Hand-placed rather than generated: the point is that the
     *  sheet looks pinned-up by a person, and a formula reads as a grid however
     *  much jitter is added to it. The two apples are deliberately at opposite
     *  corners — they share a silhouette, and side by side they would read as
     *  one badge in two states rather than two achievements. */
    x: number; y: number; rot: number;
}

export const ACHIEVEMENTS: AchievementDef[] = [
    { id: 'apple',       titleKey: 'ach.apple.title',       descKey: 'ach.apple.desc',       x: 13, y: 30, rot: -8 },
    { id: 'coral',       titleKey: 'ach.coral.title',       descKey: 'ach.coral.desc',       x: 43, y: 20, rot:  6 },
    { id: 'music',       titleKey: 'ach.music.title',       descKey: 'ach.music.desc',       x: 74, y: 32, rot: -5 },
    { id: 'dialog',      titleKey: 'ach.dialog.title',      descKey: 'ach.dialog.desc',      x: 18, y: 68, rot:  7 },
    { id: 'bonfire',     titleKey: 'ach.bonfire.title',     descKey: 'ach.bonfire.desc',     x: 47, y: 74, rot: -6 },
    { id: 'goldenApple', titleKey: 'ach.goldenApple.title', descKey: 'ach.goldenApple.desc', x: 78, y: 66, rot:  9 },
];

/** Every pug reply the visitor has to have chosen for the dialog badge. Taken
 *  from the reply trees in Island.ts — if a branch is added there it belongs
 *  here too, or the badge becomes unreachable. */
const DIALOG_OPTIONS = [
    'pug.reply.hi',
    'pug.reply.bye',
    'pug.reply.thisplace',
    'pug.reply.youtalk',
    'pug.reply.likeit',
    'pug.reply.wholeo',
];

const CORAL_COUNT = 3;
const STORAGE_KEY = 'portfolio-achievements';

interface SavedState {
    unlocked: AchievementId[];
    /** Earned AND already animated on the board. */
    revealed: AchievementId[];
    /** Progress toward the multi-step ones. */
    corals: number[];
    dialog: string[];
}

const _state: SavedState = { unlocked: [], revealed: [], corals: [], dialog: [] };

function _load(): void {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw) as Partial<SavedState>;
        // Filtered rather than trusted: this is user-editable storage that also
        // has to survive an achievement being renamed or dropped in a later
        // build, and an unknown id would otherwise sit in the list forever and
        // never match a badge.
        const known = new Set(ACHIEVEMENTS.map(a => a.id));
        _state.unlocked = (parsed.unlocked ?? []).filter(id => known.has(id as AchievementId)) as AchievementId[];
        _state.revealed = (parsed.revealed ?? []).filter(id => known.has(id as AchievementId)) as AchievementId[];
        _state.corals = (parsed.corals ?? []).filter(i => Number.isInteger(i) && i >= 0 && i < CORAL_COUNT);
        _state.dialog = (parsed.dialog ?? []).filter(k => DIALOG_OPTIONS.includes(k));
    } catch {
        /* corrupt or unavailable storage — start fresh rather than break the scene */
    }
}

function _save(): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(_state)); } catch { /* private mode */ }
}

_load();

// ── Query ────────────────────────────────────────────────────────────────────

export function isUnlocked(id: AchievementId): boolean {
    return _state.unlocked.includes(id);
}

/** Earned but not yet animated on the board. Does NOT clear them — the panel
 *  calls markRevealed once the animation has actually run, so a zoom that gets
 *  interrupted does not silently burn the reveal. */
export function getPendingReveals(): AchievementId[] {
    return _state.unlocked.filter(id => !_state.revealed.includes(id));
}

export function markRevealed(ids: AchievementId[]): void {
    let changed = false;
    for (const id of ids) {
        if (!_state.revealed.includes(id)) { _state.revealed.push(id); changed = true; }
    }
    if (changed) _save();
}

// ── Earning ──────────────────────────────────────────────────────────────────

/** Idempotent. Safe to call from a render loop. */
export function unlock(id: AchievementId): void {
    if (_state.unlocked.includes(id)) return;
    const def = ACHIEVEMENTS.find(a => a.id === id);
    if (!def) return;
    _state.unlocked.push(id);
    _save();
    _showToast(def);
    playAchievementUnlock();
}

/** One of the three corals was struck. The badge needs all three, in any order
 *  and across any number of visits. */
export function reportCoralHit(index: number): void {
    if (index < 0 || index >= CORAL_COUNT) return;
    if (!_state.corals.includes(index)) {
        _state.corals.push(index);
        _save();
    }
    if (_state.corals.length >= CORAL_COUNT) unlock('coral');
}

/** A pug reply was chosen. The badge needs every branch of the tree. */
export function reportDialogOption(textKey: string): void {
    if (!DIALOG_OPTIONS.includes(textKey)) return;
    if (!_state.dialog.includes(textKey)) {
        _state.dialog.push(textKey);
        _save();
    }
    if (_state.dialog.length >= DIALOG_OPTIONS.length) unlock('dialog');
}

/** Wipe progress — for the debug GUI, and for anyone who wants to watch the
 *  reveal again. */
export function resetAchievements(): void {
    _state.unlocked = []; _state.revealed = []; _state.corals = []; _state.dialog = [];
    _save();
}

/** Debug helper: earn everything, leaving it all pending so the next zoom plays
 *  the full reveal sequence. */
export function unlockAllForDebug(): void {
    _state.unlocked = ACHIEVEMENTS.map(a => a.id);
    _state.revealed = [];
    _save();
}

// ── Toast ────────────────────────────────────────────────────────────────────
// Screen-space DOM, not a CSS3D panel. It has to be readable the instant it
// fires, and the visitor is usually looking at an apple or a coral rather than
// at the board — a panel anchored in the world would be off-screen exactly when
// it matters.

let _toastHost: HTMLDivElement | null = null;
const _toastQueue: AchievementDef[] = [];
let _toastBusy = false;

function _ensureToastHost(): HTMLDivElement {
    if (_toastHost) return _toastHost;
    _toastHost = document.createElement('div');
    _toastHost.id = 'achievement-toasts';
    document.body.appendChild(_toastHost);
    return _toastHost;
}

function _showToast(def: AchievementDef): void {
    _toastQueue.push(def);
    if (!_toastBusy) _drainToasts();
}

/** One at a time. Two badges can land in the same second (the third coral while
 *  a track is already playing), and stacked toasts fighting for the same corner
 *  read as a glitch. */
function _drainToasts(): void {
    const def = _toastQueue.shift();
    if (!def) { _toastBusy = false; return; }
    _toastBusy = true;

    const host = _ensureToastHost();
    const el = document.createElement('div');
    el.className = 'ach-toast';
    // Painted once, deliberately not subscribed to language changes: a toast
    // lives about three seconds, and onLanguageChange has no unsubscribe — one
    // listener per toast would accumulate for the whole session and keep every
    // removed element alive with it.
    el.innerHTML = `
        <div class="ach-toast-badge">${ACHIEVEMENT_ART[def.id] ?? ''}</div>
        <div class="ach-toast-text">
            <span class="ach-toast-kicker">${t('ach.unlocked')}</span>
            <strong class="ach-toast-title">${t(def.titleKey)}</strong>
        </div>`;
    host.appendChild(el);

    requestAnimationFrame(() => el.classList.add('ach-toast-in'));
    setTimeout(() => {
        el.classList.remove('ach-toast-in');
        el.classList.add('ach-toast-out');
        setTimeout(() => { el.remove(); _drainToasts(); }, 420);
    }, 2600);
}
