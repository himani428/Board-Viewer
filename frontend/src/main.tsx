import { createRoot } from "react-dom/client";
import { App } from "./App";
import { startApp } from "./actions";
import { getState } from "./store";

document.body.style.margin = "0";
document.body.style.background = "#0b0d12";
document.body.style.overscrollBehavior = "none";
if (import.meta.env.DEV) (window as unknown as { __store: unknown }).__store = { getState }; // for debugging and automated tests
startApp();
createRoot(document.getElementById("root")!).render(<App />);