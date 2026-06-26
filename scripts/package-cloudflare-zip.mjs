import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const releaseDir = path.join(rootDir, "release");
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));
const portableExe = path.join(releaseDir, `WikiSpeedRun-${packageJson.version}-portable.exe`);
const bundleDir = path.join(releaseDir, `WikiSpeedRun-${packageJson.version}-cloudflare`);
const zipPath = path.join(releaseDir, `WikiSpeedRun-${packageJson.version}-cloudflare.zip`);

await fs.access(portableExe);

const cloudflaredSource = await findCloudflared();
await fs.rm(bundleDir, { recursive: true, force: true });
await fs.rm(zipPath, { force: true });
await fs.mkdir(bundleDir, { recursive: true });

await fs.copyFile(portableExe, path.join(bundleDir, path.basename(portableExe)));
await fs.copyFile(cloudflaredSource, path.join(bundleDir, "cloudflared.exe"));
await fs.copyFile(path.join(rootDir, "cloudflare", "Start-WikiSpeedRun-Cloudflare.cmd"), path.join(bundleDir, "Start-WikiSpeedRun-Cloudflare.cmd"));
await fs.copyFile(path.join(rootDir, "cloudflare", "README-cloudflare.txt"), path.join(bundleDir, "README-cloudflare.txt"));

execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    `Compress-Archive -Path "${bundleDir}\\*" -DestinationPath "${zipPath}" -Force`,
  ],
  { stdio: "inherit" },
);

await fs.rm(bundleDir, { recursive: true, force: true });

console.log(`Cloudflare bundle created: ${zipPath}`);

async function findCloudflared() {
  const fromEnv = process.env.CLOUDFLARED_BIN?.trim();
  if (fromEnv) {
    return fs.realpath(fromEnv);
  }

  const command = process.platform === "win32" ? "where.exe" : "which";
  const output = execFileSync(command, ["cloudflared.exe"], { encoding: "utf8" })
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (output.length === 0) {
    throw new Error("cloudflared.exe was not found. Install cloudflared or set CLOUDFLARED_BIN.");
  }

  return fs.realpath(output[0]);
}
