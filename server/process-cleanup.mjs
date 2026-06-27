import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function cleanupWikiSpeedRunProcesses({
  rootDir = path.resolve(__dirname, ".."),
  port = Number(process.env.WSR_PORT ?? process.env.WSR_API_PORT ?? 3002),
  devPort = 3001,
  currentPid = process.pid,
  includeDevServer = false,
  includeApp = false,
  includeTunnel = true,
  log = false,
} = {}) {
  if (process.platform !== "win32") {
    return cleanupUnixLikeProcesses({ port, devPort, currentPid, includeDevServer, includeTunnel, log });
  }

  const script = `
$ErrorActionPreference = "SilentlyContinue"
$currentPid = ${Number(currentPid)}
$rootDir = ${JSON.stringify(path.resolve(rootDir))}
$port = ${Number(port)}
$devPort = ${Number(devPort)}
$includeDevServer = ${includeDevServer ? "$true" : "$false"}
$includeApp = ${includeApp ? "$true" : "$false"}
$includeTunnel = ${includeTunnel ? "$true" : "$false"}
$targets = @{}

function Add-Target([int]$targetProcessId) {
  if ($targetProcessId -gt 0 -and $targetProcessId -ne $currentPid) {
    $targets[[string]$targetProcessId] = $true
  }
}

Get-NetTCPConnection -LocalPort $port -State Listen | ForEach-Object {
  Add-Target ([int]$_.OwningProcess)
}

if ($includeDevServer) {
  Get-NetTCPConnection -LocalPort $devPort -State Listen | ForEach-Object {
    Add-Target ([int]$_.OwningProcess)
  }
}

Get-CimInstance Win32_Process | ForEach-Object {
  $processId = [int]$_.ProcessId
  if ($processId -eq $currentPid) { return }

  $name = [string]$_.Name
  $cmd = [string]$_.CommandLine
  $rootMatch = $cmd.Contains($rootDir)
  $isWikiServer = $cmd -match "server[\\\\/]index\\.mjs" -and ($rootMatch -or $cmd -match "WikiSpeedRun")
  $isDevServer = $includeDevServer -and $cmd -match "vite" -and $cmd -match "--port\\s+${Number(devPort)}"
  $isTunnel = $includeTunnel -and $name -ieq "cloudflared.exe" -and $cmd -match "tunnel" -and $cmd -match "127\\.0\\.0\\.1:${Number(port)}"
  $isTunnelShell = $includeTunnel -and $name -ieq "powershell.exe" -and $cmd -match "Publish-WikiSpeedRun-Tunnel\\.ps1"
  $isApp = $includeApp -and $name -ieq "WikiSpeedRun.exe"

  if ($isWikiServer -or $isDevServer -or $isTunnel -or $isTunnelShell -or $isApp) {
    Add-Target $processId
  }
}

$stopped = @()
foreach ($processIdKey in $targets.Keys) {
  try {
    Stop-Process -Id ([int]$processIdKey) -Force -ErrorAction Stop
    $stopped += $processIdKey
  } catch {}
}

$stopped -join ","
`;

  try {
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
      windowsHide: true,
      timeout: 15000,
    });
    const stopped = stdout.trim();
    if (log && stopped) {
      console.log(`[cleanup] stopped WikiSpeedRun processes: ${stopped}`);
    }
  } catch (error) {
    if (log) {
      console.warn(`[cleanup] process cleanup skipped: ${error.message}`);
    }
  }
}

async function cleanupUnixLikeProcesses({ port, devPort, currentPid, includeDevServer, includeTunnel, log }) {
  const patterns = [`server/index.mjs`];

  if (includeDevServer) {
    patterns.push(`vite.*--port ${devPort}`);
  }

  if (includeTunnel) {
    patterns.push(`cloudflared.*tunnel.*127\\.0\\.0\\.1:${port}`);
  }

  for (const pattern of patterns) {
    try {
      await execFileAsync("pkill", ["-f", pattern], { timeout: 5000 });
    } catch {
      // No matching process is fine.
    }
  }

  if (log) {
    console.log(`[cleanup] checked WikiSpeedRun processes, current pid ${currentPid}`);
  }
}

export { cleanupWikiSpeedRunProcesses };
