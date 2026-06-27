$ErrorActionPreference = "Continue"

$serviceUrl = "http://127.0.0.1:3002"
$shareApiUrl = "$serviceUrl/api/share-link"
$cloudflaredPath = Join-Path $PSScriptRoot "cloudflared.exe"
$publishedUrl = ""

if (-not (Test-Path -LiteralPath $cloudflaredPath)) {
  $commandPath = Get-Command "cloudflared.exe" -ErrorAction SilentlyContinue

  if ($commandPath) {
    $cloudflaredPath = $commandPath.Source
  } else {
    Write-Host "[Cloudflare] cloudflared.exe not found in this folder or PATH."
    exit 1
  }
}

Get-CimInstance Win32_Process -Filter "name = 'cloudflared.exe'" | ForEach-Object {
  $cmd = $_.CommandLine

  if ($cmd -and $cmd -match "tunnel" -and $cmd -match "127\.0\.0\.1:3002") {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop
      Write-Host "[Cloudflare] Stopped previous WikiSpeedRun tunnel process $($_.ProcessId)."
    } catch {}
  }
}

Write-Host "[Cloudflare] Starting temporary public tunnel."
Write-Host "[Cloudflare] The public URL will appear in WikiSpeedRun after Cloudflare prints it."
Write-Host "[Cloudflare] Close this window or press Ctrl+C to stop sharing."
Write-Host ""

& $cloudflaredPath tunnel --url $serviceUrl 2>&1 | ForEach-Object {
  $line = $_.ToString()
  Write-Host $line

  if (-not $publishedUrl -and $line -match "https://[a-zA-Z0-9-]+\.trycloudflare\.com") {
    $publishedUrl = $Matches[0]

    try {
      $body = @{
        externalUrl = $publishedUrl
        provider = "cloudflare"
      } | ConvertTo-Json -Compress

      Invoke-RestMethod -Method Post -Uri $shareApiUrl -ContentType "application/json" -Body $body | Out-Null
      Write-Host "[WikiSpeedRun] External share link updated in the app: $publishedUrl"
    } catch {
      Write-Host "[WikiSpeedRun] Could not update app share link: $($_.Exception.Message)"
    }
  }
}

try {
  Invoke-RestMethod -Method Delete -Uri $shareApiUrl | Out-Null
  Write-Host "[WikiSpeedRun] External share link cleared."
} catch {}

exit $LASTEXITCODE
