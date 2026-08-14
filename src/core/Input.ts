import { Vector2 } from "three";
import { renderer } from "./Scene";
import { time } from "./Time";
import { handleScroll, isSceneScrollEnabled } from "./Control.ts";

class Pointer
{
    id = 0;
    phase = 0;
    position = new Vector2();
    deltaPosition = new Vector2();
    type = "";

    constructor(id: number, phase: number, position: Vector2, deltaPosition: Vector2, type: string)
    {
        this.id = id;
        this.phase = phase;
        this.position.copy(position);
        this.deltaPosition.copy(deltaPosition);
        this.type = type;
    }

    clone(): Pointer
    {
        return new Pointer(this.id, this.phase, this.position, this.deltaPosition, this.type);
    }
}

export class PointerPhase
{
    static began = 0;
    static stationary = 1;
    static moved = 2;
    static ended = 3;
    static cancelled = 4;
}

export class PointerType
{
    static mouse = "mouse";
    static pen = "pen";
    static touch = "touch";
}

export class KeyCodes
{
    static escape = "Escape";
    static f1 = "F1";
    static f2 = "F2";
    static f3 = "F3";
    static f4 = "F4";
    static f5 = "F5";
    static f6 = "F6";
    static f7 = "F7";
    static f8 = "F8";
    static f9 = "F9";
    static f10 = "F10";
    static f11 = "F11";
    static f12 = "F12";

    static digit0 = "Digit0";
    static digit1 = "Digit1";
    static digit2 = "Digit2";
    static digit3 = "Digit3";
    static digit4 = "Digit4";
    static digit5 = "Digit5";
    static digit6 = "Digit6";
    static digit7 = "Digit7";
    static digit8 = "Digit8";
    static digit9 = "Digit9";

    static keyQ = "KeyQ";
    static keyW = "KeyW";
    static keyE = "KeyE";
    static keyR = "KeyR";
    static keyT = "KeyT";
    static keyY = "KeyY";
    static keyU = "KeyU";
    static keyI = "KeyI";
    static keyO = "KeyO";
    static keyP = "KeyP";
    static keyA = "KeyA";
    static keyS = "KeyS";
    static keyD = "KeyD";
    static keyF = "KeyF";
    static keyG = "KeyG";
    static keyH = "KeyH";
    static keyJ = "KeyJ";
    static keyK = "KeyK";
    static keyL = "KeyL";
    static keyZ = "KeyZ";
    static keyX = "KeyX";
    static keyC = "KeyC";
    static keyV = "KeyV";
    static keyB = "KeyB";
    static keyN = "KeyN";
    static keyM = "KeyM";

    static shiftLeft = "ShiftLeft";
    static controlLeft = "ControlLeft";
    static space = "Space";

    static arrowUp = "ArrowUp";
    static arrowRight = "ArrowRight";
    static arrowDown = "ArrowDown";
    static arrowLeft = "ArrowLeft";
}

export let keysPressed = new Array<string>();
export let keysJustPressed = new Array<string>();
export let pointers = new Array<Pointer>();
export let mouseMovement = new Vector2();
export let lastPointerLockChange = -2;
export let lastFullscreenChange = 0;

let keysPressedCopy = new Array<string>();
let pointersCopy = new Array<Pointer>();
const mouseMovementCopy = new Vector2();
const TOUCH_SCROLL_MULTIPLIER = 2;
const TOUCH_FALLBACK_POINTER_FRESH_MS = 80;
const STALE_TOUCH_RESET_MS = 4000;
let lastTrackedTouchPointerMoveAt = -Infinity;
let lastTouchLifecycleAt = -Infinity;
let fallbackTouchId: number | null = null;
let fallbackTouchY = 0;

function IndexOfId(array: Pointer[], id: number): number
{
    for (let i = 0; i < array.length; i++)
    {
        if (array[i].id == id)
        {
            return i;
        }
    }

    return -1;
}

function isInteractiveSceneScrollTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    return !!el.closest(
        '.settings-panel, .settings-button, .media-player, .player-container, .playlist-items, ' +
        '.confirm-modal-overlay, .dialog-panel, .dialog-reply-panel, .coin-tooltip, button, input, select, textarea, a, iframe'
    );
}

function resetFallbackTouch(): void {
    fallbackTouchId = null;
    fallbackTouchY = 0;
}

function markTouchLifecycle(): void {
    lastTouchLifecycleAt = performance.now();
}

export function resetPointerState(): void {
    for (const pointer of pointers) {
        try { renderer.domElement.releasePointerCapture?.(pointer.id); } catch {}
    }
    pointers = new Array<Pointer>();
    pointersCopy = new Array<Pointer>();
    mouseMovement.set(0, 0);
    mouseMovementCopy.set(0, 0);
    resetFallbackTouch();
}

function getFallbackTouch(touches: TouchList): Touch | null {
    if (touches.length === 0) return null;
    if (fallbackTouchId !== null) {
        for (let i = 0; i < touches.length; i++) {
            if (touches[i].identifier === fallbackTouchId) return touches[i];
        }
    }
    return touches[0];
}

function hasFallbackTouch(touches: TouchList): boolean {
    if (fallbackTouchId === null) return false;
    for (let i = 0; i < touches.length; i++) {
        if (touches[i].identifier === fallbackTouchId) return true;
    }
    return false;
}

export function Start(): void
{
    document.addEventListener("keydown", function(e)
    {
        if (!keysPressed.includes(e.code))
        {
            keysPressed.push(e.code);
        }
    });

    document.addEventListener("keyup", function(e)
    {
        keysPressed.splice(keysPressed.indexOf(e.code), 1);
    });

    document.addEventListener("pointerlockchange", function()
    {
        // Menu removed - no action needed on pointer lock change
        lastPointerLockChange = time;
        keysPressed = new Array<string>();
        resetPointerState();
    });

    document.addEventListener("fullscreenchange", function()
    {
        // Fullscreen update removed - no action needed
        lastFullscreenChange = time;
        keysPressed = new Array<string>();
        resetPointerState();
    });

    document.addEventListener("mousemove", function(e)
    {
        if (document.pointerLockElement)
        {
            mouseMovement.add(new Vector2(e.movementX, -e.movementY));
        }
    });

    // Wheel event for web page mode scrolling
    document.addEventListener("wheel", function(e)
    {
        if (!isSceneScrollEnabled()) {
            e.preventDefault();
            return;
        }
        handleScroll(e.deltaY);
    }, { passive: false });

    document.addEventListener("touchstart", function(e)
    {
        markTouchLifecycle();
        if (isInteractiveSceneScrollTarget(e.target)) {
            resetFallbackTouch();
            return;
        }
        const touch = getFallbackTouch(e.touches);
        if (!touch) return;
        fallbackTouchId = touch.identifier;
        fallbackTouchY = touch.clientY;
    }, { passive: true });

    document.addEventListener("touchmove", function(e)
    {
        markTouchLifecycle();
        if (!isSceneScrollEnabled()) {
            e.preventDefault();
            resetFallbackTouch();
            return;
        }

        if (isInteractiveSceneScrollTarget(e.target) || e.touches.length === 0) {
            resetFallbackTouch();
            return;
        }

        const touch = getFallbackTouch(e.touches);
        if (!touch) return;

        if (fallbackTouchId === null) {
            fallbackTouchId = touch.identifier;
            fallbackTouchY = touch.clientY;
            return;
        }

        const deltaY = touch.clientY - fallbackTouchY;
        fallbackTouchY = touch.clientY;

        // Pointer events are the primary path. This fallback only kicks in when
        // Safari/iOS stops delivering them after overlays, page visibility
        // changes, or pointer capture state gets stale.
        if (performance.now() - lastTrackedTouchPointerMoveAt > TOUCH_FALLBACK_POINTER_FRESH_MS && deltaY !== 0) {
            e.preventDefault();
            handleScroll(-deltaY * TOUCH_SCROLL_MULTIPLIER);
        }
    }, { passive: false });

    renderer.domElement.addEventListener("pointerdown", function(e)
    {   
        if (e.pointerType === PointerType.touch) markTouchLifecycle();
        const i = IndexOfId(pointers, e.pointerId);
        if (i < 0)
        {
            pointers.push(new Pointer(e.pointerId, PointerPhase.began, new Vector2(e.clientX, e.clientY), new Vector2(), e.pointerType));
        }
        else
        {
            const pointer = pointers[i].clone();
            pointer.phase = PointerPhase.began;
            pointers[i] = pointer;
        }
    });

    document.addEventListener("pointermove", function(e)
    {
        if (e.pointerType === PointerType.touch) markTouchLifecycle();
        const i = IndexOfId(pointers, e.pointerId);
        if (i >= 0)
        {
            const phase = pointers[i].phase;
            if (phase == PointerPhase.began || phase == PointerPhase.ended || phase == PointerPhase.cancelled)
            {
                return;
            }

            const pointer = pointers[i].clone();
            pointer.phase = PointerPhase.moved;
            pointer.position.setX(e.clientX);
            pointer.position.setY(e.clientY);
            pointers[i] = pointer;
            if (e.pointerType === PointerType.touch) {
                lastTrackedTouchPointerMoveAt = performance.now();
            }
        }
    });

    document.addEventListener("pointerup", function(e)
    {
        if (e.pointerType === PointerType.touch) markTouchLifecycle();
        const i = IndexOfId(pointers, e.pointerId);
        if (i >= 0)
        {
            const pointer = pointers[i].clone();
            pointer.phase = PointerPhase.ended;
            pointers[i] = pointer;
        }
    });

    document.addEventListener("pointercancel", function(e)
    {
        if (e.pointerType === PointerType.touch) markTouchLifecycle();
        const i = IndexOfId(pointers, e.pointerId);
        if (i >= 0)
        {
            const pointer = pointers[i].clone();
            pointer.phase = PointerPhase.cancelled;
            pointers[i] = pointer;
        }
    });

    document.addEventListener("touchend", function(e)
    {
        markTouchLifecycle();
        if (e.touches.length === 0) resetPointerState();
        else if (fallbackTouchId !== null && !hasFallbackTouch(e.touches)) resetFallbackTouch();
    }, { passive: true });

    document.addEventListener("touchcancel", function(e)
    {
        markTouchLifecycle();
        if (e.touches.length === 0) resetPointerState();
        else resetFallbackTouch();
    }, { passive: true });

    window.addEventListener("blur", resetPointerState);
    window.addEventListener("pagehide", resetPointerState);
    window.addEventListener("focus", resetPointerState);
    window.addEventListener("pageshow", resetPointerState);
    document.addEventListener("visibilitychange", function()
    {
        resetPointerState();
    });

    window.setInterval(() => {
        if (pointers.some(pointer => pointer.type === PointerType.touch) && performance.now() - lastTouchLifecycleAt > STALE_TOUCH_RESET_MS) {
            resetPointerState();
        }
    }, 1000);

    document.addEventListener("pointerdown", function(e)
    {
        try { (e.target as Element)?.releasePointerCapture?.(e.pointerId); } catch {}
    })
}

export function Update(): void
{   
    mouseMovement.sub(mouseMovementCopy);
    mouseMovementCopy.copy(mouseMovement);

    for (let i = 0; i < pointersCopy.length; i++)
    {
        const pointerCopy = pointersCopy[i].clone();
        const j = IndexOfId(pointers, pointerCopy.id);

        if (pointerCopy.phase == PointerPhase.ended || pointerCopy.phase == PointerPhase.cancelled)
        {
            pointers.splice(j, 1);
        }
    }

    for (let i = 0; i < pointers.length; i++)
    {
        const pointer = pointers[i].clone();
        const j = IndexOfId(pointersCopy, pointer.id);

        if (j >= 0)
        {
            pointer.deltaPosition = pointer.position.clone().sub(pointersCopy[j].position);

            if (pointer.phase != PointerPhase.ended && pointer.phase != PointerPhase.cancelled && pointer.deltaPosition.lengthSq() == 0)
            {
                pointer.phase = PointerPhase.stationary;
            }
        }
        else
        {
            pointer.phase = PointerPhase.began;
        }

        pointers[i] = pointer;
    }

    pointersCopy = new Array<Pointer>();
    for (let i = 0; i < pointers.length; i++)
    {
        pointersCopy[i] = pointers[i].clone();
    }

    for (let i = 0; i < keysPressed.length; i++)
    {
        const key = keysPressed[i];

        if (!keysPressedCopy.includes(key))
        {
            keysJustPressed.push(key);
        }
        else if (keysJustPressed.includes(key))
        {
            keysJustPressed.splice(keysJustPressed.indexOf(key), 1);
        }
    }

    keysPressedCopy = new Array<string>(...keysPressed);
}
