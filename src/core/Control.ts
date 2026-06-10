import { MathUtils, Quaternion, Vector2, Vector3 } from "three";
import { deltaTime, time } from "./Time";
import { camera, cameraRight, cameraForward, UpdateCameraRotation, renderer, staticCamera } from "./Scene.ts"; //body,
import { KeyCodes, PointerPhase, PointerType, keysJustPressed, keysPressed, lastPointerLockChange, mouseMovement, pointers } from "./Input";
import { spotLightDistance, spotLightDistanceUniform } from "../materials/OceanMaterial";
import { islandPosition as cfgIslandPos, radioOffset as cfgRadioOffset, radioRotY as cfgRadioRotY, pugOffset as cfgPugOffset, pugRotY as cfgPugRotY, phoneOffset as cfgPhoneOffset } from '../scene/config/IslandConfig';
import { defaultCameraX, defaultCameraZ, defaultFov, mobileFov, mobileBreakpointWidth, aboveWaterBottomY as cfgAboveWaterBottomY, aboveWaterBottomYMobile as cfgAboveWaterBottomYMobile, underwaterTopY as cfgUnderwaterTopY, underwaterTopYMobile as cfgUnderwaterTopYMobile } from '../scene/config/CameraConfig';
import { phoneZoomHeight, phoneZoomTilt, phoneZoomPitch, phoneZoomFov } from '../scene/config/PhoneConfig';
import { cabanaCamX, cabanaCamY, cabanaCamZ, cabanaPhi, cabanaPitch, cabanaFov, cabanaCamXMobile, cabanaCamYMobile, cabanaCamZMobile, cabanaPhiMobile, cabanaPitchMobile, cabanaFovMobile, cabanaArriveDist } from '../scene/config/CabanaConfig';
import { mountIframe as mountPhoneIframe, unmountIframe as unmountPhoneIframe } from './PhoneScreen';
import { config as sfDecorConfig } from '../scene/SeaFloorDecor';
import { isDialogActive } from './Dialog';

const baseMoveSpeed = 10;
const shiftMoveSpeed = baseMoveSpeed * 5;
const smoothSpeed = 15;
const mindelta = 0.0001;
const moveSpeedExpMultiplier = 0;

// ============================================
// MODULE-LEVEL SCRATCH OBJECTS  (pre-allocated once, reused every frame)
// Eliminates ~7 short-lived heap allocations per Update() call that would
// otherwise trigger GC micro-pauses and stutter on low-end devices.
// ============================================
const _scratchV3a  = new Vector3();  // general purpose
const _scratchV3b  = new Vector3();  // second scratch
const _scratchV3c  = new Vector3();  // third scratch (world-up)
const _scratchV3d  = new Vector3();  // targetVector
const _scratchQx   = new Quaternion();
const _scratchQy   = new Quaternion();
const _scratchQ    = new Quaternion();
const _scratchV2   = new Vector2();  // for pointerPosNormalized

// Web page mode settings
let webPageMode = true;  // Start in web page mode

// ABOVE WATER zone (ocean surface is at Y=0)
const aboveWaterTopY = 1.4;       // Top camera position above water
const aboveWaterBottomY = window.innerWidth <= mobileBreakpointWidth ? cfgAboveWaterBottomYMobile : cfgAboveWaterBottomY; // Bottom limit above water (avoid looking at surface)

// UNDERWATER zone
const underwaterTopY = window.innerWidth <= mobileBreakpointWidth ? cfgUnderwaterTopYMobile : cfgUnderwaterTopY;   // Top limit underwater (avoid looking at surface from below)
const underwaterBottomY = -12;  // Bottom camera position (near sea floor)

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
const introStartY = 8.5;      // Camera starts just above the cloud deck
const introEndY = aboveWaterTopY;  // Camera ends at normal top position
let introActive = false;       // Kept false during loading — camera parked. True only during post-click descent.
let scrollEnabled = false;     // Prevent scrolling until descent completes
let _descentCompleteCallback: (() => void) | null = null;

export function onDescentComplete(cb: () => void): void {
    _descentCompleteCallback = cb;
}
// Camera tilts up during loading so the viewport shows only sky (horizon below frame).
// Must exceed the half-vertical-FOV (~25°) to guarantee no ocean is visible.
// Damped back to 0 once the user clicks Start, giving a cinematic sky→scene swoop.
const INTRO_TETHA_START = 0.35;   // radians; keeps the cloud deck in the lower frame
let introTetha = INTRO_TETHA_START;
const INTRO_DESCENT_SPEED  = 2.5;   // units/second at full speed
const INTRO_EASE_OUT_ZONE  = 1.8;   // last N units before landing where speed tapers — raise to ease earlier
const INTRO_MIN_SPEED      = 0.3;   // speed multiplier at the very end (0.3 = 30% of full speed)
const INTRO_TETHA_SPEED = INTRO_TETHA_START / (introStartY - introEndY) * INTRO_DESCENT_SPEED;

// Set intro loading progress (called from UI.ts for the loading bar animation).
// Camera no longer follows loading progress — it stays parked at introStartY
// until the user clicks Start, then descends cinematically in Update().
// The progress value is forwarded to the loading bar only (not used for camera movement).
export function setIntroProgress(_progress: number): void {
    // no-op for camera — progress is only used by UI.ts for the loading bar display
}

// Enable normal scroll (called when start button clicked).
// Triggers the cinematic camera descent from introStartY → introEndY.
export function enableScroll(): void {
    introActive = true;   // triggers smooth descent in Update()
    scrollEnabled = false;
    isScrolling = false;
    if (scrollTimeout) {
        clearTimeout(scrollTimeout);
        scrollTimeout = null;
    }
    targetY = introEndY;  // destination
    // scrollEnabled will be set true once the descent reaches the destination
}

// ============================================
// ZOOM MODE (radio, pug and phone)
// ============================================
let radioZoomActive = false;
let pugZoomActive = false;
let phoneZoomActive = false;
let chestZoomActive = false;
// Cabana (tent interior) zoom — the OUTER level. The phone zoom is nested inside
// it: phoneZoomActive can only be true while the cabana is 'inside'.
// Phased so the entrance is cinematic: the camera first dives into the dark
// interior (entering), then the props are revealed + the outside is sealed off
// (inside), and on the way out the outside snaps back fast (exiting).
type CabanaPhase = 'outside' | 'entering' | 'inside' | 'exiting';
let cabanaPhase: CabanaPhase = 'outside';

// Lazy-load bridge — Island registers how to load + query the interior so Control
// doesn't have to statically import the Island module (avoids an init cycle).
let _cabanaInteriorLoad: (() => void) | null = null;
let _cabanaInteriorReady: (() => boolean) | null = null;
export function registerCabanaInterior(load: () => void, isReady: () => boolean): void {
    _cabanaInteriorLoad = load;
    _cabanaInteriorReady = isReady;
}

// Reveal trigger distance — mutable so the debug GUI can dial it in live.
export const cabanaRevealConfig = { arriveDist: cabanaArriveDist };

// Counter for scroll attempts during zoom (stuck-zoom safety valve)
let _zoomScrollAttempts = 0;

// Saved camera state before zoom
let savedCameraX = 0;
let savedCameraY = 0;
let savedCameraZ = 0;
let savedTargetY = 0;

// Current interpolated camera position for zoom
let currentZoomX = defaultCameraX;
let currentZoomY = 0;
let currentZoomZ = 0;

const ZOOM_SMOOTH      = 5;

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
let zoomTetha = 0;           // Smoothly interpolated camera pitch, for phone top-down view
/** Effective startup FOV — larger on narrow (mobile) viewports. */
/** Returns the desktop or mobile FOV value based on the current viewport width. */
function _getResponsiveFov(desktop: number, mobile: number): number {
    return window.innerWidth <= mobileBreakpointWidth ? mobile : desktop;
}
const _startupFov = _getResponsiveFov(defaultFov, mobileFov);
/** Mutable config for the main (non-zoom) camera — tweak live from the debug GUI. */
export const mainCameraConfig = {
    x:          defaultCameraX,  // World-space X offset at rest
    z:          defaultCameraZ,  // World-space Z at rest
    desktopFov: defaultFov,      // FOV on viewport wider than mobileBreakpointWidth
    mobileFov:  mobileFov,       // FOV on viewport at or below mobileBreakpointWidth
    fov:        _startupFov,     // Current target FOV (set by resize, smoothed each frame)
};
let currentFov = _startupFov;  // Smoothly interpolated FOV — narrows during phone zoom

// On resize: pick the correct FOV from the live mutable values (not frozen import constants).
// The chest-zoom FOV is already evaluated per-frame in the update loop via _getResponsiveFov.
window.addEventListener('resize', () => {
    mainCameraConfig.fov = _getResponsiveFov(mainCameraConfig.desktopFov, mainCameraConfig.mobileFov);
});

// Camera follow offset applied on top of the pug zoom target during cutscenes.
// Set each frame by Island.ts while the pug is moving, reset to 0 when done.
let _pugCamOffsetX = 0;
let _pugCamOffsetZ = 0;
/** Shift the pug-zoom camera target by (dx, dz) in world space. Call every frame while pug moves. */
export function setPugCamOffset(dx: number, dz: number): void {
    _pugCamOffsetX = dx;
    _pugCamOffsetZ = dz;
}

// Pug zoom target — computed from IslandConfig respecting pug rotation
const PUG_ZOOM_DIST    = 1.2;   // World-units in front of pug face
const _pugWorldX = cfgIslandPos.x + cfgPugOffset.x;
const _pugWorldY = cfgIslandPos.y + cfgPugOffset.y;
const _pugWorldZ = cfgIslandPos.z + cfgPugOffset.z;
const PUG_ZOOM_TARGET_X = _pugWorldX + PUG_ZOOM_DIST * Math.sin(cfgPugRotY);
const PUG_ZOOM_TARGET_Y = _pugWorldY + 0.25;
const PUG_ZOOM_TARGET_Z = _pugWorldZ + PUG_ZOOM_DIST * Math.cos(cfgPugRotY);
// phi = 2π − rotY makes camera look along −frontNormal (same derivation as radio)
const PUG_ZOOM_PHI = Math.PI * 2 - cfgPugRotY;

// Shift camera rightward (in camera-local space) during pug zoom so the character
// appears left-of-centre, leaving visual room for the dialog bubble on the right.
// Camera-right at PUG_ZOOM_PHI = (cos(cfgPugRotY), 0, −sin(cfgPugRotY)).
const PUG_LATERAL = 0.15;   // world-unit rightward offset
const PUG_FINAL_X = PUG_ZOOM_TARGET_X + PUG_LATERAL * Math.cos(cfgPugRotY);
const PUG_FINAL_Z = PUG_ZOOM_TARGET_Z - PUG_LATERAL * Math.sin(cfgPugRotY);

// Phone zoom target — camera looks nearly straight down at the phone lying flat
// Tweak these live from the debug GUI (H key) while zoomed into the phone.
export const phoneZoomConfig = {
    height: phoneZoomHeight,   // World-units above the phone surface
    tilt:   phoneZoomTilt,     // Z forward offset for slight viewing angle
    pitch:  phoneZoomPitch,    // Camera pitch in radians (~-83° = nearly straight down)
    fov:    phoneZoomFov,      // Camera FOV during phone zoom (telephoto — lower = more zoom)
};
const _phoneWorldX = cfgIslandPos.x + cfgPhoneOffset.x;
const _phoneWorldY = cfgIslandPos.y + cfgPhoneOffset.y;
const _phoneWorldZ = cfgIslandPos.z + cfgPhoneOffset.z;

// Cabana zoom target — absolute world-space camera pose just inside the tent
// entrance. Holds BOTH desktop and mobile poses; the active one is picked live by
// viewport width each frame (see getCabanaZoom). Mutable so the debug GUI can dial
// in whichever device is current and copy both back to CabanaConfig.
export const cabanaZoomConfig = {
    camX:  cabanaCamX,
    camY:  cabanaCamY,
    camZ:  cabanaCamZ,
    phi:   cabanaPhi,    // yaw looking into the tent
    pitch: cabanaPitch,  // slight downward pitch
    fov:   cabanaFov,    // narrow telephoto (> 0)
    camXMobile:  cabanaCamXMobile,
    camYMobile:  cabanaCamYMobile,
    camZMobile:  cabanaCamZMobile,
    phiMobile:   cabanaPhiMobile,
    pitchMobile: cabanaPitchMobile,
    fovMobile:   cabanaFovMobile,
};
/** The cabana pose for the current viewport (desktop vs mobile), read live each
 *  frame so a resize / device-rotation switches framing without re-init. */
export function getCabanaZoom(): { camX: number; camY: number; camZ: number; phi: number; pitch: number; fov: number } {
    const c = cabanaZoomConfig;
    return window.innerWidth <= mobileBreakpointWidth
        ? { camX: c.camXMobile, camY: c.camYMobile, camZ: c.camZMobile, phi: c.phiMobile, pitch: c.pitchMobile, fov: c.fovMobile }
        : { camX: c.camX, camY: c.camY, camZ: c.camZ, phi: c.phi, pitch: c.pitch, fov: c.fov };
}
// Phone zoom targets are computed live each frame in Update() from phoneZoomConfig
// Camera yaw: face negative Z to look toward the phone
const PHONE_ZOOM_PHI = Math.PI * 2;
// Camera pitch for top-down view (handled via tetha override in Update)

// Chest zoom — target is read live each frame from sfDecorConfig for debug-GUI responsiveness
const CHEST_ZOOM_PHI = Math.PI * 2; // look straight ahead (-Z)

export function isRadioZoomActive(): boolean {
    return radioZoomActive;
}

export function isPugZoomActive(): boolean {
    return pugZoomActive;
}

export function isPhoneZoomActive(): boolean {
    return phoneZoomActive;
}

export function isChestZoomActive(): boolean {
    return chestZoomActive;
}

export function isCabanaZoomActive(): boolean {
    return cabanaPhase !== 'outside';
}

export function getCabanaPhase(): CabanaPhase {
    return cabanaPhase;
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
    if (radioZoomActive || pugZoomActive || phoneZoomActive || chestZoomActive || cabanaPhase !== 'outside' || isUnderwater) return;
    saveAndStartZoom();
    radioZoomActive = true;
}

// Zoom camera INTO the cabana (tent interior). Outer level — the phone zoom nests
// inside it. Mounts the phone iframe so the interior phone screen is already live.
export function zoomToCabana(): void {
    if (cabanaPhase !== 'outside' || radioZoomActive || pugZoomActive || phoneZoomActive || chestZoomActive || isUnderwater) return;
    saveAndStartZoom();
    cabanaPhase = 'entering';
    // Kick off the (idempotent) interior lazy-load; the dark dive masks it. The
    // iframe is mounted later, at the reveal, once the phone model exists.
    _cabanaInteriorLoad?.();
}

// Zoom out of the cabana entirely (also drops any nested phone zoom). Tears down
// the phone iframe. Triggered by the on-screen exit button. Enters the 'exiting'
// phase so the outside snaps back fast while the camera eases out (see Update).
export function zoomOutFromCabana(): void {
    if (cabanaPhase === 'outside' || cabanaPhase === 'exiting') return;
    phoneZoomActive = false;   // drop the inner zoom if it was active
    cabanaPhase = 'exiting';
    targetY = savedTargetY;
    unmountPhoneIframe();
}

// Return camera to previous position (called when collapsing media player)
export function zoomOutFromRadio(): void {
    if (!radioZoomActive) return;
    radioZoomActive = false;
    targetY = savedTargetY;
}

// Zoom camera to focus on pug
export function zoomToPug(): void {
    if (pugZoomActive || radioZoomActive || phoneZoomActive || chestZoomActive || cabanaPhase !== 'outside' || isUnderwater) return;
    saveAndStartZoom();
    pugZoomActive = true;
}

// Zoom out from pug
export function zoomOutFromPug(): void {
    if (!pugZoomActive) return;
    pugZoomActive = false;
    targetY = savedTargetY;
}

// Zoom camera to focus on phone (top-down view). INNER level — only reachable
// while inside the cabana. The cabana already saved the outside camera state and
// mounted the iframe, so this just retargets the camera; it must NOT re-save or
// re-mount (that would clobber the single save slot / reload the iframe).
export function zoomToPhone(): void {
    if (cabanaPhase !== 'inside' || phoneZoomActive) return;
    phoneZoomActive = true;
}

// Zoom out from phone back to the cabana room view (cabana stays active). Does
// NOT restore targetY or unmount — the cabana owns those; the Update loop simply
// falls back to the cabana camera target once phoneZoomActive is cleared.
export function zoomOutFromPhone(): void {
    if (!phoneZoomActive) return;
    phoneZoomActive = false;
}

// Zoom camera to focus on chest (underwater)
export function zoomToChest(): void {
    if (chestZoomActive || radioZoomActive || pugZoomActive || phoneZoomActive || cabanaPhase !== 'outside' || !isUnderwater) return;
    saveAndStartZoom();
    chestZoomActive = true;
}

// Zoom out from chest
export function zoomOutFromChest(): void {
    if (!chestZoomActive) return;
    chestZoomActive = false;
    targetY = savedTargetY;
}

// Force-clear all zoom flags (safety valve for stuck zooms on mobile)
function forceExitZoom(): void {
    _zoomScrollAttempts = 0;
    if (radioZoomActive) { radioZoomActive = false; targetY = savedTargetY; }
    if (pugZoomActive)   { pugZoomActive = false;   targetY = savedTargetY; }
    // Phone is the inner level — the cabana below owns the restore + iframe teardown.
    if (phoneZoomActive) { phoneZoomActive = false; }
    if (cabanaPhase !== 'outside'){ cabanaPhase = 'outside'; targetY = savedTargetY; unmountPhoneIframe(); }
    if (chestZoomActive) { chestZoomActive = false;  targetY = savedTargetY; }
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
export const DEFAULT_CAMERA_Z = defaultCameraZ;  // alias kept for back-compat

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
    // Block scroll entirely while a dialog is open. Returning before the zoom
    // safety below also prevents the "3 attempts → forceExitZoom" escape hatch
    // from firing mid-dialog (which orphaned the dialog and bugged everything).
    if (isDialogActive()) return;
    if (radioZoomActive || pugZoomActive || phoneZoomActive || chestZoomActive || cabanaPhase !== 'outside') {
        // Safety: user is trying to scroll while a zoom flag is active.
        // Increment a counter — if they keep scrolling, force-clear the stuck zoom.
        _zoomScrollAttempts++;
        if (_zoomScrollAttempts > 3) {
            forceExitZoom();
        }
        return;  // Block scroll during zoom
    }
    _zoomScrollAttempts = 0;
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

export function isSceneScrollEnabled(): boolean {
    // Also reports "disabled" during a dialog so Input.ts preventDefaults wheel /
    // touchmove events — no native page scroll or rubber-banding while talking.
    return scrollEnabled && !isDialogActive();
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
            const pointerPosNormalized = _scratchV2.copy(pointer.position).divide(_scratchV2.set(window.innerWidth, window.innerHeight));

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
            // Single-finger scroll: only process for the first pointer to avoid double-counting.
            if (pointer.phase == PointerPhase.moved && pointers.length >= 1 && i === 0)
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

    const targetVector = _scratchV3d.set(0, 0, 0);

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

    camera.position.add(_scratchV3a.copy(cameraRight).multiplyScalar(moveVector.x * moveSpeed * deltaTime));
    camera.position.add(_scratchV3b.set(0, moveVector.y * moveSpeed * deltaTime, 0));
    camera.position.add(_scratchV3c.copy(cameraForward).multiplyScalar(moveVector.z * moveSpeed * deltaTime));

    // Web page mode: override camera position with smooth scroll/zoom
    if (webPageMode) {
        // The cabana drives the camera only while diving in / settled inside. On
        // 'exiting' it falls through to NORMAL MODE so the camera eases back out.
        const cabanaDrivingCamera = cabanaPhase === 'entering' || cabanaPhase === 'inside';
        if (radioZoomActive || pugZoomActive || phoneZoomActive || chestZoomActive || cabanaDrivingCamera) {
            // ZOOM MODE: Smoothly move camera to target position
            let zoomTargetX: number, zoomTargetY: number, zoomTargetZ: number;
            if (phoneZoomActive) {
                // Inner level — wins over the cabana target below when both active.
                zoomTargetX = _phoneWorldX;
                zoomTargetY = _phoneWorldY + phoneZoomConfig.height;
                zoomTargetZ = _phoneWorldZ + phoneZoomConfig.tilt;
            } else if (cabanaDrivingCamera) {
                const cz = getCabanaZoom();
                zoomTargetX = cz.camX;
                zoomTargetY = cz.camY;
                zoomTargetZ = cz.camZ;
            } else if (pugZoomActive) {
                zoomTargetX = PUG_FINAL_X + _pugCamOffsetX;
                zoomTargetY = PUG_ZOOM_TARGET_Y;
                zoomTargetZ = PUG_FINAL_Z + _pugCamOffsetZ;
            } else if (chestZoomActive) {
                zoomTargetX = sfDecorConfig.chest.x;
                zoomTargetY = sfDecorConfig.chest.y + sfDecorConfig.chestZoomHeight;
                zoomTargetZ = sfDecorConfig.chest.z + sfDecorConfig.chestZoomDist;
            } else {
                zoomTargetX = RADIO_ZOOM_TARGET_X;
                zoomTargetY = RADIO_ZOOM_TARGET_Y;
                zoomTargetZ = RADIO_ZOOM_TARGET_Z;
            }
            currentZoomX = MathUtils.damp(currentZoomX, zoomTargetX, ZOOM_SMOOTH, deltaTime);
            currentZoomY = MathUtils.damp(currentZoomY, zoomTargetY, ZOOM_SMOOTH, deltaTime);
            currentZoomZ = MathUtils.damp(currentZoomZ, zoomTargetZ, ZOOM_SMOOTH, deltaTime);
            
            camera.position.x = currentZoomX;
            camera.position.y = currentZoomY;
            camera.position.z = currentZoomZ;
            
            // Keep currentY in sync for when we exit zoom
            currentY = currentZoomY;

            // Cabana reveal trigger: once the camera has dived into the dark
            // interior AND the lazy-loaded props are ready, flip to 'inside' (the
            // reveal animation + outside-sealing keys off this) and mount the phone.
            if (cabanaPhase === 'entering') {
                const cz = getCabanaZoom();
                const dx = currentZoomX - cz.camX;
                const dy = currentZoomY - cz.camY;
                const dz = currentZoomZ - cz.camZ;
                const arrived = (dx * dx + dy * dy + dz * dz) < (cabanaRevealConfig.arriveDist * cabanaRevealConfig.arriveDist);
                const ready = _cabanaInteriorReady ? _cabanaInteriorReady() : true;
                if (arrived && ready) {
                    cabanaPhase = 'inside';
                    mountPhoneIframe();
                }
            }

            // Smoothly rotate camera to face the target during zoom. Phone (inner)
            // and cabana are checked first so the nested phone framing wins.
            if (phoneZoomActive) {
                zoomPhi = MathUtils.damp(zoomPhi, PHONE_ZOOM_PHI, ZOOM_SMOOTH, deltaTime);
                // Tilt camera down for top-down phone view
                zoomTetha = MathUtils.damp(zoomTetha, phoneZoomConfig.pitch, ZOOM_SMOOTH, deltaTime);
                // Narrow FOV for telephoto phone zoom
                currentFov = MathUtils.damp(currentFov, phoneZoomConfig.fov, ZOOM_SMOOTH, deltaTime);
            } else if (cabanaDrivingCamera) {
                const cz = getCabanaZoom();
                zoomPhi = MathUtils.damp(zoomPhi, cz.phi, ZOOM_SMOOTH, deltaTime);
                zoomTetha = MathUtils.damp(zoomTetha, cz.pitch, ZOOM_SMOOTH, deltaTime);
                // Narrow FOV toward ~0 for the "stepping into the cabana" effect
                currentFov = MathUtils.damp(currentFov, cz.fov, ZOOM_SMOOTH, deltaTime);
            } else if (radioZoomActive) {
                zoomPhi = MathUtils.damp(zoomPhi, RADIO_ZOOM_PHI, ZOOM_SMOOTH, deltaTime);
            } else if (pugZoomActive) {
                zoomPhi = MathUtils.damp(zoomPhi, PUG_ZOOM_PHI, ZOOM_SMOOTH, deltaTime);
            } else if (chestZoomActive) {
                zoomPhi = MathUtils.damp(zoomPhi, CHEST_ZOOM_PHI, ZOOM_SMOOTH, deltaTime);
                // Tilt camera down to look at chest from above
                zoomTetha = MathUtils.damp(zoomTetha, sfDecorConfig.chestZoomPitch, ZOOM_SMOOTH, deltaTime);
                // Narrow FOV for underwater chest zoom (responsive)
                currentFov = MathUtils.damp(currentFov,
                    _getResponsiveFov(sfDecorConfig.chestZoomFov, sfDecorConfig.chestZoomMobileFov),
                    ZOOM_SMOOTH, deltaTime);
            }
        } else {
            // NORMAL MODE: Smooth Y scrolling, fixed X and Z
            let smoothFactor = scrollSmooth;
            
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

            // Finish the cabana exit once the camera has eased back out to the
            // default X/Z — only then do the interior props get re-hidden (Island
            // keys their visibility off 'outside'), unseen behind the camera.
            if (cabanaPhase === 'exiting' &&
                Math.abs(currentZoomX - mainCameraConfig.x) < 0.05 &&
                Math.abs(currentZoomZ - mainCameraConfig.z) < 0.05) {
                cabanaPhase = 'outside';
            }

            // When exiting zoom, also smoothly return X and Z to default
            if (currentZoomX !== mainCameraConfig.x || currentZoomZ !== mainCameraConfig.z) {
                currentZoomX = MathUtils.damp(currentZoomX, mainCameraConfig.x, RADIO_ZOOM_SMOOTH, deltaTime);
                currentZoomZ = MathUtils.damp(currentZoomZ, mainCameraConfig.z, RADIO_ZOOM_SMOOTH, deltaTime);
                camera.position.x = currentZoomX;
                camera.position.z = currentZoomZ;
                
                // Snap when close enough
                if (Math.abs(currentZoomX - mainCameraConfig.x) < 0.01 && Math.abs(currentZoomZ - mainCameraConfig.z) < 0.01) {
                    currentZoomX = mainCameraConfig.x;
                    currentZoomZ = mainCameraConfig.z;
                }
            } else {
                camera.position.x = mainCameraConfig.x;
                camera.position.z = mainCameraConfig.z;
            }

            // Smoothly return camera yaw to default after radio zoom
            if (Math.abs(zoomPhi - Math.PI * 2) > 0.001) {
                zoomPhi = MathUtils.damp(zoomPhi, Math.PI * 2, ZOOM_SMOOTH, deltaTime);
                if (Math.abs(zoomPhi - Math.PI * 2) < 0.001) zoomPhi = Math.PI * 2;
            }

            // Smoothly return camera pitch to default after phone zoom
            if (Math.abs(zoomTetha) > 0.001) {
                zoomTetha = MathUtils.damp(zoomTetha, 0, ZOOM_SMOOTH, deltaTime);
                if (Math.abs(zoomTetha) < 0.001) zoomTetha = 0;
            }

            // Smoothly restore FOV after phone zoom
            currentFov = MathUtils.damp(currentFov, mainCameraConfig.fov, ZOOM_SMOOTH, deltaTime);
            if (Math.abs(currentFov - mainCameraConfig.fov) < 0.05) currentFov = mainCameraConfig.fov;

            if (introActive) {
                const yDist    = targetY - currentY;
                const remaining = Math.abs(yDist);
                const speedScale = remaining < INTRO_EASE_OUT_ZONE
                    ? MathUtils.lerp(INTRO_MIN_SPEED, 1.0, remaining / INTRO_EASE_OUT_ZONE)
                    : 1.0;
                const yStep = INTRO_DESCENT_SPEED * speedScale * deltaTime;
                currentY = remaining <= yStep ? targetY : currentY + Math.sign(yDist) * yStep;
                camera.position.y = currentY;

                if (introTetha !== 0) {
                    const tStep = INTRO_TETHA_SPEED * speedScale * deltaTime;
                    introTetha  = introTetha <= tStep ? 0 : introTetha - tStep;
                }

                if (currentY === targetY && introTetha === 0) {
                    introActive   = false;
                    scrollEnabled = true;
                    if (_descentCompleteCallback) {
                        const cb = _descentCompleteCallback;
                        _descentCompleteCallback = null;
                        cb();
                    }
                }
            } else {
                currentY = MathUtils.damp(currentY, targetY, smoothFactor, deltaTime);
                camera.position.y = currentY;
            }
        }
    }

    if (!touchControls && !webPageMode)
    {
        phi += mouseMovement.x * lookSensitivity * sensitivityMult;
        tetha = MathUtils.clamp(tetha + mouseMovement.y * lookSensitivity * sensitivityMult, -Math.PI / 2, Math.PI / 2);
    }

    // In web-page mode, zoomPhi drives camera yaw (smoothly rotates to face radio front on zoom)
    _scratchQx.setFromAxisAngle(_scratchV3a.set(0, -1, 0), webPageMode ? zoomPhi : phi);
    _scratchQy.setFromAxisAngle(_scratchV3b.set(1, 0, 0), webPageMode ? (tetha + zoomTetha + introTetha) : tetha);

    _scratchQ.copy(_scratchQx);
    _scratchQ.multiply(_scratchQy);

    // Apply interpolated FOV (narrows during phone zoom, restores afterwards)
    if (camera.fov !== currentFov) {
        camera.fov = currentFov;
        camera.updateProjectionMatrix();
    }

    camera.quaternion.copy(_scratchQ);
    UpdateCameraRotation();
    staticCamera.quaternion.copy(_scratchQ);
}
