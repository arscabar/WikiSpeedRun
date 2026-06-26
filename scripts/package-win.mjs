import packager from "electron-packager";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const outDir = path.join(rootDir, "release");
const appOutDir = path.join(outDir, "WikiSpeedRun-win32-x64");
const packageJson = JSON.parse(await fs.readFile(path.join(rootDir, "package.json"), "utf8"));

await fs.rm(appOutDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });

const appPaths = await packager({
  dir: rootDir,
  name: "WikiSpeedRun",
  executableName: "WikiSpeedRun",
  platform: "win32",
  arch: "x64",
  out: outDir,
  overwrite: true,
  prune: true,
  asar: false,
  appVersion: packageJson.version,
  buildVersion: packageJson.version,
  ignore: [
    /^\/(?:\.git|\.omx|\.tmp-test|cloudflare|data|docs|public|release|scripts|src)(?:\/|$)/,
    /^\/(?:\.gitignore|config\.ya?ml|index\.html|README\.md|tsconfig.*|vite\.config\..*|.*\.tsbuildinfo|package-lock\.json)$/,
  ],
});

for (const appPath of appPaths) {
  console.log(`Packaged Windows app: ${appPath}`);
}
