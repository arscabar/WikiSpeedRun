# Wiki Speed Run Architecture

## Product Goal

Wiki Speed Run gives players a locked, fair browsing environment for Namuwiki speedruns. Players race from a start document to a target document using only article body links, while the platform records route, time, click count, and multiplayer room state.

## MVP Scope

- React/Vite client with a locked browser shell.
- Local Node backend that fetches and sanitizes real Namuwiki pages.
- Daily, infinite, and private-room UI states.
- Automatic challenge creation: a playable start document is selected, then the server follows real body links by random walk and uses only the reached document as the target.
- Timer, click count, route history, result graph, room code copy, and result image download.

## Platform Decision

This project is local-first. It does not need a public deployment target.

For the first build, keep the current React/Vite UI and add a local Node service on `127.0.0.1`. For the polished local experience, wrap that local app with Electron or Tauri so the player sees a locked program window instead of a normal browser.

Namuwiki pages currently send `X-Frame-Options: SAMEORIGIN`, so embedding the original site in a normal iframe is not reliable. A desktop WebView can load Namuwiki as a top-level page, but direct CSS/script injection into a remote page is more fragile than rendering a sanitized local copy. The recommended path is still:

1. Local service fetches a Namuwiki document.
2. Local service extracts only article body content and outgoing body links.
3. The React app renders that sanitized document in its own locked browser shell.
4. Every click is validated against the previous document's extracted links.

Use a WebView/Electron wrapper for window control, fullscreen/kiosk mode, shortcut blocking, local file storage, and a clean streamer-friendly launch flow.

## Local Runtime Shape

### Desktop Shell

- Electron is the fastest route on Windows because Node integration, local server startup, global shortcut handling, and packaging are straightforward.
- Tauri is lighter, but Rust setup and WebView differences make early iteration slower.
- The shell should open only the local game URL, hide browser chrome, disable navigation shortcuts, and optionally run fullscreen.

### Frontend

- React SPA for the game console, result pages, and spectator views.
- A route guard should own navigation state instead of browser history.
- Article rendering should accept a sanitized AST from the backend, not raw HTML.

### Local Backend

- Node API for records, challenges, rooms, and replay metadata.
- WebSocket gateway for local/LAN room state: current document, click count, finish event, spectators, and room lifecycle.
- Namuwiki fetch/proxy service that strips search, sidebars, backlinks, scripts, editable controls, and non-body links before returning structured content.
- Challenge generator that calls Namuwiki random/document endpoints, keeps only existing normal `/w/` document pages, then verifies reachability by following sanitized body links.
- Challenge generation does not calculate difficulty or shortest path. It only guarantees that at least one server-verified click path exists and exposes the verified click count, not the hidden route.

Implemented MVP endpoints:

- `GET /api/challenge?mode=casual`
- `GET /api/challenge?mode=practice`
- `GET /api/challenge?mode=wild`
- `GET /api/share-link`
- `GET /api/article?title=사과`
- `POST /api/run/event` with `{ "from": "사과", "to": "사과나무" }`

The local parser currently keeps `.wiki-heading` and non-table `.wiki-paragraph` blocks, converts `.wiki-link-internal` anchors into controlled in-game buttons, and caches parsed articles for 12 hours under `data/cache/articles`.

### Storage

- SQLite: completed runs, route edges, leaderboard snapshots, room metadata.
- In-memory process state: active room state, player presence, timers, and daily challenge cache.
- JSON export/import can be added for sharing result packs without operating a server.

## Fairness Controls

- No editable URL or search input in the client.
- No client-side back navigation in the game shell.
- Server validates that each next document was linked from the previous sanitized document.
- Completed runs store the full route with timestamps for replay and moderation.
- Ranking sorts by click count first, then elapsed time for ties.

## Score And Ranking

The UI displays a live score estimate during play and locks the score when the target document is reached.

```text
score = max(0, 100000 - clicks * 4000 - elapsedSeconds * 35)
```

Rank titles:

- `90000+`: 레전드 러너
- `75000+`: 스피드러너
- `55000+`: 루트 파인더
- `30000+`: 완주자
- otherwise: 기록 보존

Local ranking supports three sort settings:

- click count first
- elapsed time first
- score first

Completed records are stored in the running server process memory. The session ranking starts empty when the server starts and is shared by local and Cloudflare Tunnel clients.

## Suggested API Contract

```ts
type SanitizedArticle = {
  title: string;
  sourceRevision?: string;
  body: Array<ParagraphNode | HeadingNode | LinkNode>;
  outgoingLinks: string[];
};

type RunEvent = {
  roomId?: string;
  runId: string;
  playerId: string;
  from: string;
  to: string;
  elapsedMs: number;
  clickIndex: number;
};
```
