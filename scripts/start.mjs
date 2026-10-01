// One command: starts the mock backend (:4000 API, :4001 pages) and the Vite dev server (:5173).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vite = path.join(root, "node_modules", "vite", "bin", "vite.js");
const procs = [
  spawn(process.execPath, [path.join(root, "backend", "server.js")], { cwd: root, stdio: "inherit" }),
  spawn(process.execPath, [vite, "frontend", "--port", "5173", "--strictPort"], { cwd: root, stdio: "inherit" }),
];
const stop = () => procs.forEach((p) => p.kill());
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
procs.forEach((p) => p.on("exit", (code) => { stop(); process.exit(code ?? 0); }));
console.log("\nApp: http://localhost:5173\n");
