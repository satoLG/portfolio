import * as TIME from "./core/Time";
import * as SCENE from "./core/Scene";
import * as INPUT from "./core/Input";
import * as CONTROL from "./core/Control";
import * as UI from "./core/UI";
import * as CABANA_EXIT from "./core/CabanaExit";
import * as DEBUG from "./core/Debug";
import * as SETTINGS from "./shaders/Settings"
import * as FRAME_STATS from "./core/FrameStats";   // TEMP — see FrameStats.ts
// TEMP — on-screen ink tuner (see InkTuner.ts). Remove this import and the
// mountInkTuner() call below once the underwater ink values are settled.
import { mountInkTuner } from "./core/InkTuner";
import "./style.css";

// Register Service Worker for PWA
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js')
            .then((registration) => {
                console.log('SW registered:', registration.scope);
            })
            .catch((error) => {
                console.log('SW registration failed:', error);
            });
    });
}

TIME.Start();
SETTINGS.Start();
SCENE.Start();
INPUT.Start();
CONTROL.Start();
UI.Start();
CABANA_EXIT.Start();
DEBUG.Start();
mountInkTuner();   // TEMP — see InkTuner.ts

// Cap the render loop at 60 FPS. High refresh-rate displays (120Hz+) would
// otherwise drive the scene update/render cycle at the monitor's native rate,
// wasting GPU/CPU for no visual benefit on this content.
//
// The gate is a running deadline rather than a "has enough time passed since
// the last frame" delta check. A delta check has to compare against the full
// 16.67ms budget, and a 60Hz display never delivers frames on exactly that
// spacing — rAF timestamps jitter, and Safari quantises them to ~1ms. Every
// frame arriving a fraction early gets dropped whole, so the budget check
// halves a 60Hz display to ~40fps. Testing the deadline with a tolerance lets
// those early arrivals through, while the deadline itself still advances by a
// fixed budget, so the tolerance shifts a frame's phase without ever raising
// the average rate above the cap.
const MAX_FPS = 60;
const FRAME_BUDGET_MS = 1000 / MAX_FPS;
const FRAME_TOLERANCE_MS = 2;
let nextFrameDue = 0;

requestAnimationFrame(UpdateFrame);

function UpdateFrame(now: number): void
{
    requestAnimationFrame(UpdateFrame);

    FRAME_STATS.frameStats.raw++;   // TEMP — see FrameStats.ts

    if (now < nextFrameDue - FRAME_TOLERANCE_MS) return;
    // Falling more than a whole budget behind means the loop was suspended (a
    // hidden tab, a long stall), not that it is running late. Re-anchor to now
    // so it resumes at the cap instead of firing a burst of catch-up frames.
    nextFrameDue = now - nextFrameDue > FRAME_BUDGET_MS
        ? now + FRAME_BUDGET_MS
        : nextFrameDue + FRAME_BUDGET_MS;

    FRAME_STATS.frameStats.gated++;   // TEMP — see FrameStats.ts

    DEBUG.Begin();

    TIME.Update();
    SCENE.Update();
    INPUT.Update();
    CONTROL.Update();
    UI.Update();
    CABANA_EXIT.Update();
    DEBUG.Update();

    DEBUG.End();
}
