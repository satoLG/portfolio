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
    });

    document.addEventListener("fullscreenchange", function()
    {
        // Fullscreen update removed - no action needed
        lastFullscreenChange = time;
        keysPressed = new Array<string>();
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

    document.addEventListener("touchmove", function(e)
    {
        if (!isSceneScrollEnabled()) {
            e.preventDefault();
        }
    }, { passive: false });

    renderer.domElement.addEventListener("pointerdown", function(e)
    {   
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
        }
    });

    document.addEventListener("pointerup", function(e)
    {
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
        const i = IndexOfId(pointers, e.pointerId);
        if (i >= 0)
        {
            const pointer = pointers[i].clone();
            pointer.phase = PointerPhase.cancelled;
            pointers[i] = pointer;
        }
    });

    document.addEventListener("pointerdown", function(e)
    {
        (e.target as Element)?.releasePointerCapture?.(e.pointerId);
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
