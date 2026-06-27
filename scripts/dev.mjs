import { spawn } from "node:child_process";
import { cleanupWikiSpeedRunProcesses } from "../server/process-cleanup.mjs";

await cleanupWikiSpeedRunProcesses({ includeDevServer: true, includeTunnel: true, log: true });

const commands = [
  {
    name: "api",
    command: process.execPath,
    args: ["server/index.mjs"],
  },
  {
    name: "web",
    command: process.platform === "win32" ? "npx.cmd" : "npx",
    args: ["vite", "--host", "127.0.0.1", "--port", "3001", "--strictPort"],
  },
];

const children = commands.map(({ name, command, args }) => {
  const child = spawn(command, args, {
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  child.stdout.on("data", (chunk) => process.stdout.write(`[${name}] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[${name}] ${chunk}`));
  child.on("exit", (code) => {
    if (code && code !== 0) {
      console.error(`[${name}] exited with code ${code}`);
      shutdown(code);
    }
  });

  return child;
});

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

function shutdown(code) {
  for (const child of children) {
    if (!child.killed) {
      child.kill();
    }
  }
  process.exit(code);
}
