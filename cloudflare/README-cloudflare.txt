WikiSpeedRun Cloudflare ZIP
===========================

Included files:
- WikiSpeedRun-*-portable.exe
- cloudflared.exe
- Start-WikiSpeedRun-Cloudflare.cmd
- Publish-WikiSpeedRun-Tunnel.ps1

Quick external sharing:
1. Run Start-WikiSpeedRun-Cloudflare.cmd.
2. Wait until WikiSpeedRun opens.
3. Wait until the https://*.trycloudflare.com URL appears.
4. Copy the URL from the WikiSpeedRun "External Access" panel, or from the console.
5. Close the console window or press Ctrl+C to stop sharing.

Notes:
- The trycloudflare.com URL is temporary and changes every run.
- Keep the console window open while people are playing.
- The app updates its External Access panel automatically when the tunnel URL is detected.
- Session ranking is stored in the running WikiSpeedRun server memory.
- If the app is closed, the session ranking is reset.
- For a fixed public URL, create a named Cloudflare Tunnel in the Cloudflare dashboard.
