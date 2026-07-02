import * as TIME from "./core/Time";
import * as SCENE from "./core/Scene";
import * as INPUT from "./core/Input";
import * as CONTROL from "./core/Control";
import * as UI from "./core/UI";
import * as CABANA_EXIT from "./core/CabanaExit";
import * as DEBUG from "./core/Debug";
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
CABANA_EXIT.Start();
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
    CABANA_EXIT.Update();
    DEBUG.Update();

    DEBUG.End();

    requestAnimationFrame(UpdateFrame);
}
