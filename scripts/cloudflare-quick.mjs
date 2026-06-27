import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { cleanupWikiSpeedRunProcesses } from "../server/process-cleanup.mjs";
import { setExternalShareLink, startServer } from "../server/index.mjs";

const port = Number(process.env.WSR_PORT ?? process.env.WSR_API_PORT ?? 3002);
const host = process.env.WSR_HOST ?? "127.0.0.1";
const serviceUrl = `http://${host}:${port}`;
const cloudflaredBin = process.env.CLOUDFLARED_BIN ?? (process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
const distIndex = path.resolve("dist", "index.html");
const smokeMs = Number(process.env.WSR_TUNNEL_SMOKE_MS ?? 0);

if (!existsSync(distIndex)) {
  console.warn("[cloudflare] dist/index.html not found. Run npm run build before sharing.");
}

await cleanupWikiSpeedRunProcesses({ includeTunnel: true, log: true });

console.log(`[app] starting WikiSpeedRun at ${serviceUrl}`);
const server = await startServer({ port, host });

console.log("[cloudflare] starting quick tunnel...");
console.log("[cloudflare] quick tunnels are temporary. Use a named tunnel for a fixed domain.");

const tunnel = spawn(cloudflaredBin, ["tunnel", "--url", serviceUrl], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});

let publicUrl = "";
let shuttingDown = false;

const maybePrintPublicUrl = (text) => {
  const match = text.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
  if (!match || publicUrl) {
    return;
  }

  publicUrl = match[0];
  setExternalShareLink(publicUrl, "cloudflare");
  console.log(`[cloudflare] public URL: ${publicUrl}`);
  console.log("[app] external share link updated inside WikiSpeedRun.");
  console.log("[cloudflare] press Ctrl+C to stop sharing.");
};

const pipeCloudflaredOutput = (chunk, target) => {
  const text = chunk.toString();
  maybePrintPublicUrl(text);
  target.write(text);
};

tunnel.stdout.on("data", (chunk) => pipeCloudflaredOutput(chunk, process.stdout));
tunnel.stderr.on("data", (chunk) => pipeCloudflaredOutput(chunk, process.stderr));

tunnel.on("error", async (error) => {
  console.error(`[cloudflare] failed to start ${cloudflaredBin}: ${error.message}`);
  console.error("[cloudflare] Install cloudflared or set CLOUDFLARED_BIN to the executable path.");
  await shutdown(1);
});

tunnel.on("exit", async (code) => {
  if (!shuttingDown) {
    console.log(`[cloudflare] tunnel stopped with code ${code ?? 0}`);
    await shutdown(code ?? 0);
  }
});

if (smokeMs > 0) {
  windowlessTimeout(() => {
    console.log(`[cloudflare] smoke timeout reached (${smokeMs}ms).`);
    void shutdown(publicUrl ? 0 : 1);
  }, smokeMs);
}

process.on("SIGINT", () => {
  void shutdown(0);
});

process.on("SIGTERM", () => {
  void shutdown(0);
});

async function shutdown(code) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  tunnel.kill();

  await new Promise((resolve) => server.close(resolve));
  process.exit(code);
}

function windowlessTimeout(callback, delay) {
  const timer = setTimeout(callback, delay);
  timer.unref?.();
  return timer;
}
