import { MathUtils, Quaternion, Vector2, Vector3 } from "three";
import { deltaTime, time } from "./Time";
import { camera, cameraRight, cameraForward, UpdateCameraRotation, renderer, staticCamera } from "./Scene.ts"; //body,
import { KeyCodes, PointerPhase, PointerType, keysJustPressed, keysPressed, lastPointerLockChange, mouseMovement, pointers } from "./Input";
import { spotLightDistance, spotLightDistanceUniform } from "../materials/OceanMaterial";
import { islandPosition as cfgIslandPos, radioOffset as cfgRadioOffset, radioRotY as cfgRadioRotY, pugOffset as cfgPugOffset, pugRotY as cfgPugRotY } from '../scene/IslandConfig';

const baseMoveSpeed = 10;
const shiftMoveSpeed = baseMoveSpeed * 5;
const smoothSpeed = 15;
const mindelta = 0.0001;
const moveSpeedExpMultiplier = 0;

// Web page mode settings
let webPageMode = true;  // Start in web page mode

// ABOVE WATER zone (ocean surface is at Y=0)
const aboveWaterTopY = 1.8;       // Top camera position above water
const aboveWaterBottomY = 1; // Bottom limit above water (avoid looking at surface)

// UNDERWATER zone
const underwaterTopY = -1;   // Top limit underwater (avoid looking at surface from below)
const underwaterBottomY = -8;   // Bottom camera position (near sea floor)

// Dead zone: camera must not rest between aboveWaterBottomY and underwaterTopY
const deadZoneTop = aboveWaterBottomY;   // 1
const deadZoneBottom = underwaterTopY;   // -1
const deadZoneMidpoint = (deadZoneTop + deadZoneBottom) / 2; // 0.0

const scrollSpeed = 0.005;    // How fast scroll moves camera
const scrollSmooth = 10;      // Smoothing factor
const snapSmooth = 6;         // Smoothing for dead-zone snap
let targetY = aboveWaterTopY;   // Target Y position
let currentY = aboveWaterTopY;  // Current Y position (for smoothing)
let isScrolling = false;        // Whether user is actively scrolling
let scrollTimeout: ReturnType<typeof setTimeout> | null = null;

// ============================================
// INTRO CAMERA DESCENT SETTINGS
// ============================================
const introStartY = 5;         // Camera starts high above scene (can't see island)
const introEndY = aboveWaterTopY;  // Camera ends at normal top position
const introSmooth = 0.8;       // How fast intro camera descends (lower = slower, higher = faster)
let introProgress = 0;         // Loading progress (0 to 1)
let introActive = true;        // Whether intro descent is active
let scrollEnabled = false;     // Prevent scrolling until button clicked

// Set intro loading progress (called from UI.ts)
export function setIntroProgress(progress: number): void {
    introProgress = Math.min(1, Math.max(0, progress));
    if (introActive) {
        targetY = introStartY - (introProgress * (introStartY - introEndY));
    }
}

// Enable normal scroll (called when start button clicked)
export function enableScroll(): void {
    scrollEnabled = true;
    introActive = false;
    // Ensure we end at the correct position
    targetY = introEndY;
}

// ============================================
// ZOOM MODE (radio and pug)
// ============================================
let radioZoomActive = false;
let pugZoomActive = false;

// Saved camera state before zoom
let savedCameraX = 0;
let savedCameraY = 0;
let savedCameraZ = 0;
let savedTargetY = 0;

// Current interpolated camera position for zoom
let currentZoomX = 0;
let currentZoomY = 0;
let currentZoomZ = 0;

const ZOOM_SMOOTH = 5;

// Radio zoom target — computed from IslandConfig so camera sits on the radio's front face normal
const RADIO_ZOOM_SMOOTH  = ZOOM_SMOOTH;
const RADIO_ZOOM_DIST    = 1.5;   // World-units in front of the radio face
const _radioWorldX = cfgIslandPos.x + cfgRadioOffset.x;
const _radioWorldY = cfgIslandPos.y + cfgRadioOffset.y;
const _radioWorldZ = cfgIslandPos.z + cfgRadioOffset.z;
// Camera position: radio_world + frontNormal * dist  (frontNormal = [sin(rotY), 0, cos(rotY)])
const RADIO_ZOOM_TARGET_X = _radioWorldX + RADIO_ZOOM_DIST * Math.sin(cfgRadioRotY);
const RADIO_ZOOM_TARGET_Y = _radioWorldY + 0.55;   // Well above island surface
const RADIO_ZOOM_TARGET_Z = _radioWorldZ + RADIO_ZOOM_DIST * Math.cos(cfgRadioRotY);
// Camera yaw: phi = 2π − rotY makes the camera look along −frontNormal (directly at radio front)
const RADIO_ZOOM_PHI = Math.PI * 2 - cfgRadioRotY;
let zoomPhi = Math.PI * 2;  // Smoothly interpolated camera yaw, only active in webPageMode

// Pug zoom target — computed from IslandConfig respecting pug rotation
const PUG_ZOOM_DIST    = 1.2;   // World-units in front of pug face
const _pugWorldX = cfgIslandPos.x + cfgPugOffset.x;
const _pugWorldY = cfgIslandPos.y + cfgPugOffset.y;
const _pugWorldZ = cfgIslandPos.z + cfgPugOffset.z;
const PUG_ZOOM_TARGET_X = _pugWorldX + PUG_ZOOM_DIST * Math.sin(cfgPugRotY);
const PUG_ZOOM_TARGET_Y = _pugWorldY + 0.55;
const PUG_ZOOM_TARGET_Z = _pugWorldZ + PUG_ZOOM_DIST * Math.cos(cfgPugRotY);
// phi = 2π − rotY makes camera look along −frontNormal (same derivation as radio)
const PUG_ZOOM_PHI = Math.PI * 2 - cfgPugRotY;

// Shift camera rightward (in camera-local space) during pug zoom so the character
// appears left-of-centre, leaving visual room for the dialog bubble on the right.
// Camera-right at PUG_ZOOM_PHI = (cos(cfgPugRotY), 0, −sin(cfgPugRotY)).
const PUG_LATERAL = 0.15;   // world-unit rightward offset
const PUG_FINAL_X = PUG_ZOOM_TARGET_X + PUG_LATERAL * Math.cos(cfgPugRotY);
const PUG_FINAL_Z = PUG_ZOOM_TARGET_Z - PUG_LATERAL * Math.sin(cfgPugRotY);

export function isRadioZoomActive(): boolean {
    return radioZoomActive;
}

export function isPugZoomActive(): boolean {
    return pugZoomActive;
}

function saveAndStartZoom(): void {
    savedCameraX = camera.position.x;
    savedCameraY = currentY;
    savedCameraZ = camera.position.z;
    savedTargetY = targetY;
    currentZoomX = savedCameraX;
    currentZoomY = savedCameraY;
    currentZoomZ = savedCameraZ;
}

// Zoom camera to focus on radio (called when expanding media player above water)
export function zoomToRadio(): void {
    if (radioZoomActive || pugZoomActive || isUnderwater) return;
    saveAndStartZoom();
    radioZoomActive = true;
}

// Return camera to previous position (called when collapsing media player)
export function zoomOutFromRadio(): void {
    if (!radioZoomActive) return;
    radioZoomActive = false;
    targetY = savedTargetY;
}

// Zoom camera to focus on pug
export function zoomToPug(): void {
    if (pugZoomActive || radioZoomActive || isUnderwater) return;
    saveAndStartZoom();
    pugZoomActive = true;
}

// Zoom out from pug
export function zoomOutFromPug(): void {
    if (!pugZoomActive) return;
    pugZoomActive = false;
    targetY = savedTargetY;
}

// Get saved camera position (for calculating where radio will be after zoomout)
export function getSavedCameraPosition(): { x: number, y: number, z: number } {
    return {
        x: savedCameraX,
        y: savedCameraY,
        z: savedCameraZ
    };
}

// Get default camera position (when not zooming)
export const DEFAULT_CAMERA_X = 0;
export const DEFAULT_CAMERA_Z = 0.9;

// Track if camera is underwater (derived from position)
let isUnderwater = false;

export function getIsUnderwater(): boolean {
    return isUnderwater;
}

export function getCameraY(): number {
    return currentY;
}

export function isWebPageMode(): boolean {
    return webPageMode;
}

export function toggleCameraMode(): boolean {
    webPageMode = !webPageMode;
    if (webPageMode) {
        // Reset to top position when entering web page mode
        targetY = aboveWaterTopY;
        isUnderwater = false;
    }
    return webPageMode;
}

export function handleScroll(deltaY: number): void {
    if (!scrollEnabled) return;  // Block scroll during intro
    if (radioZoomActive || pugZoomActive) return;  // Block scroll during zoom
    if (webPageMode) {
        // Free scroll across the full range
        targetY = MathUtils.clamp(targetY - deltaY * scrollSpeed, underwaterBottomY, aboveWaterTopY);
        
        // Mark as actively scrolling and reset snap timer
        isScrolling = true;
        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            isScrolling = false;
        }, 150);
    }
}

declare global {
    interface Window {
        mobileAndTabletCheck: () => boolean;
    }
}

window.mobileAndTabletCheck = function(): boolean
{
    let check = false;
    (function(a){if(/(android|bb\d+|meego).+mobile|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series(4|6)0|symbian|treo|up\.(browser|link)|vodafone|wap|windows ce|xda|xiino|android|ipad|playbook|silk/i.test(a)||/1207|6310|6590|3gso|4thp|50[1-6]i|770s|802s|a wa|abac|ac(er|oo|s\-)|ai(ko|rn)|al(av|ca|co)|amoi|an(ex|ny|yw)|aptu|ar(ch|go)|as(te|us)|attw|au(di|\-m|r |s )|avan|be(ck|ll|nq)|bi(lb|rd)|bl(ac|az)|br(e|v)w|bumb|bw\-(n|u)|c55\/|capi|ccwa|cdm\-|cell|chtm|cldc|cmd\-|co(mp|nd)|craw|da(it|ll|ng)|dbte|dc\-s|devi|dica|dmob|do(c|p)o|ds(12|\-d)|el(49|ai)|em(l2|ul)|er(ic|k0)|esl8|ez([4-7]0|os|wa|ze)|fetc|fly(\-|_)|g1 u|g560|gene|gf\-5|g\-mo|go(\.w|od)|gr(ad|un)|haie|hcit|hd\-(m|p|t)|hei\-|hi(pt|ta)|hp( i|ip)|hs\-c|ht(c(\-| |_|a|g|p|s|t)|tp)|hu(aw|tc)|i\-(20|go|ma)|i230|iac( |\-|\/)|ibro|idea|ig01|ikom|im1k|inno|ipaq|iris|ja(t|v)a|jbro|jemu|jigs|kddi|keji|kgt( |\/)|klon|kpt |kwc\-|kyo(c|k)|le(no|xi)|lg( g|\/(k|l|u)|50|54|\-[a-w])|libw|lynx|m1\-w|m3ga|m50\/|ma(te|ui|xo)|mc(01|21|ca)|m\-cr|me(rc|ri)|mi(o8|oa|ts)|mmef|mo(01|02|bi|de|do|t(\-| |o|v)|zz)|mt(50|p1|v )|mwbp|mywa|n10[0-2]|n20[2-3]|n30(0|2)|n50(0|2|5)|n7(0(0|1)|10)|ne((c|m)\-|on|tf|wf|wg|wt)|nok(6|i)|nzph|o2im|op(ti|wv)|oran|owg1|p800|pan(a|d|t)|pdxg|pg(13|\-([1-8]|c))|phil|pire|pl(ay|uc)|pn\-2|po(ck|rt|se)|prox|psio|pt\-g|qa\-a|qc(07|12|21|32|60|\-[2-7]|i\-)|qtek|r380|r600|raks|rim9|ro(ve|zo)|s55\/|sa(ge|ma|mm|ms|ny|va)|sc(01|h\-|oo|p\-)|sdk\/|se(c(\-|0|1)|47|mc|nd|ri)|sgh\-|shar|sie(\-|m)|sk\-0|sl(45|id)|sm(al|ar|b3|it|t5)|so(ft|ny)|sp(01|h\-|v\-|v )|sy(01|mb)|t2(18|50)|t6(00|10|18)|ta(gt|lk)|tcl\-|tdg\-|tel(i|m)|tim\-|t\-mo|to(pl|sh)|ts(70|m\-|m3|m5)|tx\-9|up(\.b|g1|si)|utst|v400|v750|veri|vi(rg|te)|vk(40|5[0-3]|\-v)|vm40|voda|vulc|vx(52|53|60|61|70|80|81|83|85|98)|w3c(\-| )|webc|whit|wi(g |nc|nw)|wmlb|wonu|x700|yas\-|your|zeto|zte\-/i.test(a.substring(0,4))) check = true;})(navigator.userAgent);
    return check;
};

export let touchControls = window.mobileAndTabletCheck();
export function setTouchControls(value: boolean): void
{
    touchControls = value;
    lookSensitivity = touchControls ? 0.01 : 0.003;
}

let lookSensitivity = touchControls ? 0.01 : 0.003;

export let sensitivityMult = 1;
export function SetLookSensitivityMultiplier(value: number): void
{
    sensitivityMult = value;
}

let moving = false;
const moveVector = new Vector3(0, 0, 0);
// Fixed camera looking 90 degrees left (along -X axis)
let phi = Math.PI * 2;  // 90 degrees left
let tetha = 0;          // Level with horizon
let moveSpeedMultiplier = 1;

let lookPointerId = -1;

let buttonUp = false;
export function changeUpState(up: boolean): void
{
    buttonUp = up;
}

let buttonDown = false;
export function changeDownState(down: boolean): void
{
    buttonDown = down;
}

export function Start(): void
{
    // Initialize camera at intro start position (high above scene)
    targetY = introStartY;
    currentY = introStartY;
}

export function Update(): void
{
    
    for (let i = 0; i < pointers.length; i++)
    {
        const pointer = pointers[i];

        if (touchControls && !webPageMode)
        {
            const pointerPosNormalized = pointer.position.clone().divide(new Vector2(window.innerWidth, window.innerHeight));

            if (pointer.phase == PointerPhase.began)
            {
                if (pointerPosNormalized.x < 0.35)
                {

                }
                else if(lookPointerId == -1)
                {
                    lookPointerId = pointer.id;
                }
            }

            if (pointer.phase == PointerPhase.moved)
            {

                if (pointer.id == lookPointerId)
                {
                    phi += pointer.deltaPosition.x * lookSensitivity * sensitivityMult;
                    tetha = MathUtils.clamp(tetha - pointer.deltaPosition.y * lookSensitivity * sensitivityMult, -Math.PI / 2, Math.PI / 2);
                }
            }

            if (pointer.phase == PointerPhase.ended || pointer.phase == PointerPhase.cancelled)
            {

                if (pointer.id == lookPointerId)
                {
                    lookPointerId = -1;
                }
            }

            if (pointer.type != PointerType.mouse && !document.fullscreenElement && pointer.phase == PointerPhase.ended)
            {
                document.body.requestFullscreen();
                (screen.orientation as any).lock("landscape");
            }
        }
        else if (touchControls && webPageMode)
        {
            // Two-finger scroll: gate on 2+ simultaneous touches.
            // Only process for the first pointer (i === 0) to avoid double-counting.
            if (pointer.phase == PointerPhase.moved && pointers.length >= 2 && i === 0)
            {
                // Average Y delta across all active touch pointers for stable scrolling
                let avgDeltaY = 0;
                for (const p of pointers) avgDeltaY += p.deltaPosition.y;
                avgDeltaY /= pointers.length;
                handleScroll(-avgDeltaY * 2);
            }
        }
        else if (pointer.type == PointerType.mouse && !document.pointerLockElement && pointer.phase == PointerPhase.ended && time - lastPointerLockChange > 1.5 && !webPageMode)
        {
            renderer.domElement.requestPointerLock();
        }
    }

    const targetVector = new Vector3();

    if (!touchControls && !webPageMode)
    {
        if (keysPressed.includes(KeyCodes.keyA))
        {
            targetVector.x -= 1;
        }

        if (keysPressed.includes(KeyCodes.keyD))
        {
            targetVector.x += 1;
        }

        if (keysPressed.includes(KeyCodes.keyQ))
        {
            targetVector.y -= 1;
        }

        if (keysPressed.includes(KeyCodes.keyE))
        {
            targetVector.y += 1;
        }

        if (keysPressed.includes(KeyCodes.keyS))
        {
            targetVector.z -= 1;
        }
        
        if (keysPressed.includes(KeyCodes.keyW))
        {
            targetVector.z += 1;
        }

        if (keysJustPressed.includes(KeyCodes.keyL))
        {
            if (spotLightDistanceUniform.value > 0)
            {
                spotLightDistanceUniform.value = 0;
            }
            else
            {
                spotLightDistanceUniform.value = spotLightDistance;
            }
        }
    }
    else if (!webPageMode)
    {

        if (buttonUp)
        {
            targetVector.y += 1;
        }

        if (buttonDown)
        {
            targetVector.y -= 1;
        }
    }

    if (Math.abs(targetVector.x - moveVector.x) > mindelta)
    {
        moveVector.x = MathUtils.damp(moveVector.x, targetVector.x, smoothSpeed, deltaTime);
    }
    else
    {
        moveVector.x = targetVector.x;
    }

    if (Math.abs(targetVector.y - moveVector.y) > mindelta)
    {
        moveVector.y = MathUtils.damp(moveVector.y, targetVector.y, smoothSpeed, deltaTime);
    }
    else
    {
        moveVector.y = targetVector.y;
    }

    if (Math.abs(targetVector.z - moveVector.z) > mindelta)
    {
        moveVector.z = MathUtils.damp(moveVector.z, targetVector.z, smoothSpeed, deltaTime);
    }
    else
    {
        moveVector.z = targetVector.z;
    }

    const moveLength = moveVector.length();
    if (moveLength > 1)
    {
        moveVector.divideScalar(moveLength);
    }

    moving = moveVector.lengthSq() > 0;
    let moveSpeed = touchControls ? shiftMoveSpeed : keysPressed.includes(KeyCodes.shiftLeft) ? shiftMoveSpeed : baseMoveSpeed;
    if (moving)
    {
        moveSpeedMultiplier += moveSpeedMultiplier * moveSpeedExpMultiplier * deltaTime;
    }
    else
    {
        moveSpeedMultiplier = 1;
    }
    moveSpeed *= moveSpeedMultiplier;

    camera.position.add(new Vector3().copy(cameraRight).multiplyScalar(moveVector.x * moveSpeed * deltaTime));
    camera.position.add(new Vector3().copy(new Vector3(0, 1, 0)).multiplyScalar(moveVector.y * moveSpeed * deltaTime));
    camera.position.add(new Vector3().copy(cameraForward).multiplyScalar(moveVector.z * moveSpeed * deltaTime));

    // Web page mode: override camera position with smooth scroll/zoom
    if (webPageMode) {
        if (radioZoomActive || pugZoomActive) {
            // ZOOM MODE: Smoothly move camera to target position
            const zoomTargetX = pugZoomActive ? PUG_FINAL_X : RADIO_ZOOM_TARGET_X;
            const zoomTargetY = pugZoomActive ? PUG_ZOOM_TARGET_Y : RADIO_ZOOM_TARGET_Y;
            const zoomTargetZ = pugZoomActive ? PUG_FINAL_Z : RADIO_ZOOM_TARGET_Z;
            currentZoomX = MathUtils.damp(currentZoomX, zoomTargetX, ZOOM_SMOOTH, deltaTime);
            currentZoomY = MathUtils.damp(currentZoomY, zoomTargetY, ZOOM_SMOOTH, deltaTime);
            currentZoomZ = MathUtils.damp(currentZoomZ, zoomTargetZ, ZOOM_SMOOTH, deltaTime);
            
            camera.position.x = currentZoomX;
            camera.position.y = currentZoomY;
            camera.position.z = currentZoomZ;
            
            // Keep currentY in sync for when we exit zoom
            currentY = currentZoomY;

            // Smoothly rotate camera to face the target during zoom
            if (radioZoomActive) {
                zoomPhi = MathUtils.damp(zoomPhi, RADIO_ZOOM_PHI, ZOOM_SMOOTH, deltaTime);
            } else if (pugZoomActive) {
                zoomPhi = MathUtils.damp(zoomPhi, PUG_ZOOM_PHI, ZOOM_SMOOTH, deltaTime);
            }
        } else {
            // NORMAL MODE: Smooth Y scrolling, fixed X and Z
            let smoothFactor = introActive ? introSmooth : scrollSmooth;
            
            // Dead zone snap: when user stops scrolling in the dead zone, snap to nearest edge
            if (!isScrolling && !introActive && targetY < deadZoneTop && targetY > deadZoneBottom) {
                // Snap to whichever boundary is closer
                const snapTarget = targetY >= deadZoneMidpoint ? deadZoneTop : deadZoneBottom;
                targetY = MathUtils.damp(targetY, snapTarget, snapSmooth, deltaTime);
                // Snap precisely when very close
                if (Math.abs(targetY - snapTarget) < 0.01) {
                    targetY = snapTarget;
                }
            }
            
            // Derive underwater state from current position
            isUnderwater = currentY < deadZoneMidpoint;
            
            // When exiting zoom, also smoothly return X and Z to default
            if (currentZoomX !== 0 || currentZoomZ !== 0.9) {
                currentZoomX = MathUtils.damp(currentZoomX, 0, RADIO_ZOOM_SMOOTH, deltaTime);
                currentZoomZ = MathUtils.damp(currentZoomZ, 0.9, RADIO_ZOOM_SMOOTH, deltaTime);
                camera.position.x = currentZoomX;
                camera.position.z = currentZoomZ;
                
                // Snap when close enough
                if (Math.abs(currentZoomX) < 0.01 && Math.abs(currentZoomZ - 0.9) < 0.01) {
                    currentZoomX = 0;
                    currentZoomZ = 0.9;
                }
            } else {
                camera.position.x = 0;
                camera.position.z = 0.9;
            }

            // Smoothly return camera yaw to default after radio zoom
            if (Math.abs(zoomPhi - Math.PI * 2) > 0.001) {
                zoomPhi = MathUtils.damp(zoomPhi, Math.PI * 2, ZOOM_SMOOTH, deltaTime);
                if (Math.abs(zoomPhi - Math.PI * 2) < 0.001) zoomPhi = Math.PI * 2;
            }

            currentY = MathUtils.damp(currentY, targetY, smoothFactor, deltaTime);
            camera.position.y = currentY;
        }
    }

    if (!touchControls && !webPageMode)
    {
        phi += mouseMovement.x * lookSensitivity * sensitivityMult;
        tetha = MathUtils.clamp(tetha + mouseMovement.y * lookSensitivity * sensitivityMult, -Math.PI / 2, Math.PI / 2);
    }

    const qx = new Quaternion();
    // In web-page mode, zoomPhi drives camera yaw (smoothly rotates to face radio front on zoom)
    qx.setFromAxisAngle(new Vector3(0, -1, 0), webPageMode ? zoomPhi : phi);
    const qy = new Quaternion();
    qy.setFromAxisAngle(new Vector3(1, 0, 0), tetha);

    const q = new Quaternion();
    q.multiply(qx);
    q.multiply(qy);

    camera.quaternion.copy(q);
    UpdateCameraRotation();
    staticCamera.quaternion.copy(q);
}
