import * as TIME from "./core/Time";
import * as SCENE from "./core/Scene";
import * as INPUT from "./core/Input";
import * as CONTROL from "./core/Control";
import * as UI from "./core/UI";
import * as CABANA_EXIT from "./core/CabanaExit";
import * as DEBUG from "./core/Debug";
import * as SETTINGS from "./shaders/Settings"
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
// otherwise drive the scene update/render cycle at the monitor's native
// rate, wasting GPU/CPU for no visual benefit on this content.
const MAX_FPS = 60;
const MIN_FRAME_MS = 1000 / MAX_FPS;
let lastFrameTime = 0;

requestAnimationFrame(UpdateFrame);

function UpdateFrame(now: number): void
{
    requestAnimationFrame(UpdateFrame);

    const elapsed = now - lastFrameTime;
    if (elapsed < MIN_FRAME_MS) return;
    lastFrameTime = now - (elapsed % MIN_FRAME_MS);

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
