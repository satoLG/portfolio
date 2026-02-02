import * as TIME from "./scripts/Time";
import * as SCENE from "./scripts/Scene";
import * as INPUT from "./scripts/Input";
import * as CONTROL from "./scripts/Control";
import * as UI from "./scripts/UI";
import * as DEBUG from "./scripts/Debug";
import * as SETTINGS from "./shaders/Settings"
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
DEBUG.Start();

requestAnimationFrame(UpdateFrame);

function UpdateFrame(): void
{
    DEBUG.Begin();

    TIME.Update();
    SCENE.Update();
    INPUT.Update();
    CONTROL.Update();
    UI.Update();
    DEBUG.Update();

    DEBUG.End();

    requestAnimationFrame(UpdateFrame);
}