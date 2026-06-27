import express from "express";
import * as cheerio from "cheerio";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupWikiSpeedRunProcesses } from "./process-cleanup.mjs";

const NAMU_ORIGIN = "https://namu.wiki";
const DEFAULT_PORT = Number(process.env.WSR_API_PORT ?? process.env.WSR_PORT ?? 3002);
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const RANDOM_ATTEMPTS = 36;
const LINKED_CHALLENGE_ATTEMPTS = 24;
const LINK_CANDIDATE_SAMPLE_SIZE = 32;
const MIN_START_LINKS = 8;
const MIN_START_BLOCKS = 2;
const MIN_TARGET_LINKS = 1;
const MIN_TARGET_BLOCKS = 2;
const MIN_INTERMEDIATE_LINKS = 4;
const MIN_INTERMEDIATE_BLOCKS = 1;
const MAX_RANKING_RECORDS = 200;
const MAX_ROUTE_STEPS = 80;
const VALID_MODES = new Set(["casual", "practice"]);
const VALID_STEP_ACTIONS = new Set(["start", "link", "back"]);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.WSR_DATA_DIR ? path.resolve(process.env.WSR_DATA_DIR) : path.join(rootDir, "data");
const cacheDir = path.join(dataDir, "cache");
const articleCacheDir = path.join(cacheDir, "articles");
const challengeLogPath = path.join(cacheDir, "challenges.json");
const distDir = process.env.WSR_DIST_DIR ? path.resolve(process.env.WSR_DIST_DIR) : path.join(rootDir, "dist");

const app = express();
const sessionStartedAt = new Date().toISOString();
const players = new Map();
const activeRuns = new Map();
const shareLinkState = {
  localUrl: "",
  externalUrl: normalizeShareUrl(process.env.WSR_PUBLIC_URL ?? process.env.WIKI_SPEED_RUN_PUBLIC_URL ?? ""),
  provider: process.env.WSR_PUBLIC_URL || process.env.WIKI_SPEED_RUN_PUBLIC_URL ? "env" : "",
  updatedAt: process.env.WSR_PUBLIC_URL || process.env.WIKI_SPEED_RUN_PUBLIC_URL ? new Date().toISOString() : "",
};
let sessionRankings = [];

app.use(express.json({ limit: "64kb" }));
app.use((_, res, next) => {
  res.setHeader("access-control-allow-origin", "http://127.0.0.1:3001");
  res.setHeader("access-control-allow-methods", "GET,POST,DELETE,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  next();
});

app.options(/.*/, (_, res) => res.sendStatus(204));

app.get("/api/health", (_, res) => {
  res.json({ ok: true, service: "wiki-speed-run-local", port: DEFAULT_PORT });
});

app.get("/api/share-link", (_, res) => {
  res.json(publicShareLinkState());
});

app.post("/api/share-link", (req, res) => {
  if (!isLocalShareUpdateRequest(req)) {
    res.status(403).json({ error: "local_update_only", message: "외부 링크 갱신은 로컬 터널 프로세스에서만 허용됩니다." });
    return;
  }

  const externalUrl = normalizeShareUrl(req.body?.externalUrl ?? req.body?.url ?? "");

  if (!externalUrl) {
    res.status(400).json({ error: "invalid_external_url", message: "http 또는 https 외부 URL이 필요합니다." });
    return;
  }

  setExternalShareLink(externalUrl, cleanProvider(req.body?.provider ?? "manual"));
  res.json(publicShareLinkState());
});

app.delete("/api/share-link", (req, res) => {
  if (!isLocalShareUpdateRequest(req)) {
    res.status(403).json({ error: "local_update_only", message: "외부 링크 초기화는 로컬에서만 허용됩니다." });
    return;
  }

  clearExternalShareLink();
  res.json(publicShareLinkState());
});

app.get("/api/rankings", (_, res) => {
  res.json({
    sessionStartedAt,
    total: sessionRankings.length,
    records: sessionRankings,
  });
});

app.post("/api/rankings", (_, res) => {
  res.status(405).json({
    accepted: false,
    error: "rankings_are_server_authoritative",
    message: "랭킹은 서버 run 로그로만 생성됩니다.",
  });
});

app.delete("/api/rankings", (_, res) => {
  sessionRankings = [];
  res.json({
    sessionStartedAt,
    total: 0,
    records: sessionRankings,
  });
});

app.post("/api/players", (req, res) => {
  try {
    const player = upsertPlayer(req.body);
    res.json({
      player,
      sessionStartedAt,
    });
  } catch (error) {
    res.status(400).json({ error: "invalid_player", message: getErrorMessage(error) });
  }
});

app.post("/api/runs", (req, res) => {
  try {
    const run = createRun(req.body);
    res.status(201).json({ run: publicRun(run), sessionStartedAt });
  } catch (error) {
    res.status(400).json({ error: "invalid_run", message: getErrorMessage(error) });
  }
});

app.get("/api/runs/:runId", (req, res) => {
  const run = activeRuns.get(req.params.runId);

  if (!run) {
    res.status(404).json({ error: "run_not_found" });
    return;
  }

  res.json({ run: publicRun(run), sessionStartedAt });
});

app.post("/api/runs/:runId/link", async (req, res) => {
  const run = activeRuns.get(req.params.runId);
  const to = normalizeTitle(typeof req.body?.to === "string" ? req.body.to : "");

  if (!run || !to) {
    res.status(run ? 400 : 404).json({ allowed: false, error: run ? "missing_to" : "run_not_found" });
    return;
  }

  if (run.status === "finished") {
    res.status(409).json({ allowed: false, error: "run_already_finished", run: publicRun(run) });
    return;
  }

  try {
    const article = await getArticle(run.currentTitle);
    const allowed = article.outgoingLinks.includes(to);

    if (!allowed) {
      res.json({ allowed: false, from: run.currentTitle, to, run: publicRun(run) });
      return;
    }

    run.documentStack.push(to);
    run.routeSteps.push({ title: to, action: "link" });
    run.currentTitle = to;
    run.updatedAt = new Date().toISOString();

    const completed = to === run.target;
    const ranking = completed ? finishRun(run) : null;

    res.json({
      allowed: true,
      completed,
      from: article.title,
      to,
      run: publicRun(run),
      ranking,
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ allowed: false, error: "validation_failed", message: getErrorMessage(error), run: publicRun(run) });
  }
});

app.post("/api/runs/:runId/back", (req, res) => {
  const run = activeRuns.get(req.params.runId);

  if (!run) {
    res.status(404).json({ allowed: false, error: "run_not_found" });
    return;
  }

  if (run.status === "finished") {
    res.status(409).json({ allowed: false, error: "run_already_finished", run: publicRun(run) });
    return;
  }

  if (run.documentStack.length <= 1) {
    res.json({ allowed: false, error: "no_previous_document", run: publicRun(run) });
    return;
  }

  run.documentStack.pop();
  const previousTitle = run.documentStack[run.documentStack.length - 1];
  run.routeSteps.push({ title: previousTitle, action: "back" });
  run.currentTitle = previousTitle;
  run.updatedAt = new Date().toISOString();

  res.json({ allowed: true, run: publicRun(run) });
});

app.post("/api/runs/:runId/finish", (req, res) => {
  const run = activeRuns.get(req.params.runId);

  if (!run) {
    res.status(404).json({ completed: false, error: "run_not_found" });
    return;
  }

  if (run.currentTitle !== run.target) {
    res.status(409).json({ completed: false, error: "target_not_reached", run: publicRun(run) });
    return;
  }

  const ranking = finishRun(run);
  res.json({ completed: true, run: publicRun(run), ranking });
});

app.get("/api/challenge", async (req, res) => {
  try {
    const mode = typeof req.query.mode === "string" ? req.query.mode : "casual";
    const requestedStart = typeof req.query.start === "string" ? normalizeTitle(req.query.start) : "";
    const requestedTarget = typeof req.query.target === "string" ? normalizeTitle(req.query.target) : "";

    if (requestedStart && requestedTarget) {
      const startArticle = await getArticle(requestedStart);
      const targetArticle = await getArticle(requestedTarget);

      if (requestedStart === requestedTarget || !isPlayableStartArticle(startArticle) || !isPlayableTargetArticle(targetArticle)) {
        res.status(400).json({ error: "invalid_challenge_override" });
        return;
      }

      const challenge = {
        start: requestedStart,
        target: requestedTarget,
        label: "테스트 제시어",
        generatedAt: new Date().toISOString(),
        source: "query-override",
        verifiedClicks: startArticle.outgoingLinks.includes(requestedTarget) ? 1 : 0,
      };

      await appendChallengeLog(challenge);
      res.json(challenge);
      return;
    }

    const challenge = await createReachableChallenge(mode);

    await appendChallengeLog(challenge);
    res.json(challenge);
  } catch (error) {
    console.error(error);
    res.status(502).json({ error: "challenge_generation_failed", message: getErrorMessage(error) });
  }
});

app.get("/api/article", async (req, res) => {
  const title = typeof req.query.title === "string" ? req.query.title.trim() : "";

  if (!title) {
    res.status(400).json({ error: "missing_title" });
    return;
  }

  try {
    const article = await getArticle(title, req.query.refresh === "1");
    res.json(article);
  } catch (error) {
    console.error(error);
    const status = error?.status === 404 ? 404 : 502;
    res.status(status).json({ error: "article_fetch_failed", message: getErrorMessage(error) });
  }
});

app.post("/api/run/event", async (req, res) => {
  const from = typeof req.body?.from === "string" ? req.body.from.trim() : "";
  const to = typeof req.body?.to === "string" ? req.body.to.trim() : "";

  if (!from || !to) {
    res.status(400).json({ allowed: false, error: "missing_from_or_to" });
    return;
  }

  try {
    const article = await getArticle(from);
    const allowed = article.outgoingLinks.includes(to);

    res.json({
      allowed,
      from,
      to,
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error(error);
    res.status(502).json({ allowed: false, error: "validation_failed", message: getErrorMessage(error) });
  }
});

mountStaticFiles(app);

function startServer({ port = DEFAULT_PORT, host = "127.0.0.1" } = {}) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);

    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      const address = server.address();
      const boundPort = typeof address === "object" && address ? address.port : port;
      setLocalShareLink(host, boundPort);
      console.log(`Wiki Speed Run local API listening on http://${host}:${boundPort}`);
      resolve(server);
    });
  });
}

function setLocalShareLink(host, port) {
  const safeHost = host === "0.0.0.0" || host === "::" ? "127.0.0.1" : host;
  shareLinkState.localUrl = `http://${safeHost}:${port}`;
}

function setExternalShareLink(externalUrl, provider = "manual") {
  const normalizedUrl = normalizeShareUrl(externalUrl);

  if (!normalizedUrl) {
    return false;
  }

  shareLinkState.externalUrl = normalizedUrl;
  shareLinkState.provider = cleanProvider(provider);
  shareLinkState.updatedAt = new Date().toISOString();
  return true;
}

function clearExternalShareLink() {
  shareLinkState.externalUrl = "";
  shareLinkState.provider = "";
  shareLinkState.updatedAt = "";
}

function publicShareLinkState() {
  return {
    sessionStartedAt,
    localUrl: shareLinkState.localUrl,
    externalUrl: shareLinkState.externalUrl,
    provider: shareLinkState.provider,
    updatedAt: shareLinkState.updatedAt,
    status: shareLinkState.externalUrl ? "external-online" : "local-only",
  };
}

function normalizeShareUrl(value) {
  if (typeof value !== "string") {
    return "";
  }

  const cleanValue = value.trim();

  if (!cleanValue) {
    return "";
  }

  try {
    const url = new URL(cleanValue);

    if (!["http:", "https:"].includes(url.protocol)) {
      return "";
    }

    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "";
  }
}

function cleanProvider(value) {
  return String(value || "manual")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32);
}

function isLocalShareUpdateRequest(req) {
  const forwardedFor = req.headers["x-forwarded-for"];
  const cloudflareIp = req.headers["cf-connecting-ip"];
  const remoteAddress = req.socket.remoteAddress ?? "";

  if (forwardedFor || cloudflareIp) {
    return false;
  }

  return ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(remoteAddress);
}

function mountStaticFiles(serverApp) {
  if (!existsSync(distDir)) {
    return;
  }

  serverApp.use(express.static(distDir));
  serverApp.get(/.*/, (_, res) => {
    res.sendFile(path.join(distDir, "index.html"));
  });
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  cleanupWikiSpeedRunProcesses({ includeTunnel: true, log: true })
    .then(() => startServer())
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

export { app, clearExternalShareLink, setExternalShareLink, startServer };

async function createReachableChallenge(mode) {
  let lastError = "";

  for (let attempt = 0; attempt < LINKED_CHALLENGE_ATTEMPTS; attempt += 1) {
    try {
      const start = await pickRandomDocument("", { minBlocks: MIN_START_BLOCKS, minLinks: MIN_START_LINKS });
      const route = await pickReachableRoute(start.title, mode);
      const target = route[route.length - 1];

      if (route.length < 2 || target === start.title) {
        continue;
      }

      return {
        start: start.title,
        target,
        label: getChallengeLabel(mode),
        generatedAt: new Date().toISOString(),
        source: "namu.wiki/random-walk",
        verifiedClicks: route.length - 1,
      };
    } catch (error) {
      lastError = getErrorMessage(error);
    }
  }

  throw new Error(`Could not create a reachable challenge. ${lastError}`);
}

async function pickReachableRoute(startTitle, mode) {
  const { min, max } = getChallengeDepthRange(mode);
  const targetDepth = randomInteger(min, max);
  const route = [startTitle];
  const visited = new Set(route);
  let currentTitle = startTitle;

  for (let depth = 0; depth < targetDepth; depth += 1) {
    const currentArticle = await getArticle(currentTitle);
    const isTargetStep = depth === targetDepth - 1;
    const nextArticle = await pickLinkedArticle(currentArticle, visited, {
      minBlocks: isTargetStep ? MIN_TARGET_BLOCKS : MIN_INTERMEDIATE_BLOCKS,
      minLinks: isTargetStep ? MIN_TARGET_LINKS : MIN_INTERMEDIATE_LINKS,
    });

    if (!nextArticle) {
      throw new Error(`No playable linked article from ${currentArticle.title}`);
    }

    route.push(nextArticle.title);
    visited.add(nextArticle.title);
    currentTitle = nextArticle.title;
  }

  return route;
}

async function pickLinkedArticle(article, visited, constraints) {
  const candidates = shuffleValues(
    article.outgoingLinks
      .map(normalizeTitle)
      .filter((title) => title && title !== article.title && !visited.has(title) && isNormalDocumentTitle(title)),
  ).slice(0, LINK_CANDIDATE_SAMPLE_SIZE);

  for (const candidate of candidates) {
    try {
      const linkedArticle = await getArticle(candidate);

      if (!visited.has(linkedArticle.title) && isPlayableArticle(linkedArticle, constraints)) {
        return linkedArticle;
      }
    } catch {
      // Skip broken, blocked, or unsupported links and try another body link.
    }
  }

  return null;
}

function getChallengeDepthRange(mode) {
  if (mode === "practice") {
    return { min: 1, max: 2 };
  }

  if (mode === "wild") {
    return { min: 2, max: 4 };
  }

  return { min: 2, max: 3 };
}

function getChallengeLabel(mode) {
  if (mode === "wild") {
    return "아예랜덤 경로보장 제시어";
  }

  if (mode === "practice") {
    return "연습 경로보장 제시어";
  }

  if (mode === "casual") {
    return "캐주얼 경로보장 제시어";
  }

  return "경로보장 제시어";
}

function randomInteger(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function shuffleValues(values) {
  const output = [...values];

  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }

  return output;
}

async function pickRandomDocument(exceptTitle, { minBlocks = 1, minLinks = 0 } = {}) {
  let lastTitle = "";

  for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt += 1) {
    const title = await fetchRandomTitle();
    lastTitle = title;

    if (title === exceptTitle || !isNormalDocumentTitle(title)) {
      continue;
    }

    try {
      const article = await getArticle(title);
      if (isPlayableArticle(article, { minBlocks, minLinks })) {
        return { title };
      }
    } catch {
      // Keep sampling random documents until a playable article is found.
    }
  }

  throw new Error(`Could not pick a valid random document. Last candidate: ${lastTitle || "none"}`);
}

async function fetchRandomTitle() {
  const response = await fetch(`${NAMU_ORIGIN}/random`, {
    redirect: "manual",
    headers: requestHeaders(),
  });

  const location = response.headers.get("location") ?? response.url;
  const title = titleFromNamuPath(location);

  if (!title) {
    throw new Error(`Random endpoint did not return a document location: ${response.status}`);
  }

  return title;
}

async function getArticle(title, refresh = false) {
  const normalizedTitle = normalizeTitle(title);
  const cachePath = path.join(articleCacheDir, `${cacheKey(normalizedTitle)}.json`);

  if (!refresh) {
    const cached = await readFreshJson(cachePath);
    if (cached) {
      return cached;
    }
  }

  const article = await fetchAndParseArticle(normalizedTitle);
  await writeJson(cachePath, article);
  return article;
}

async function fetchAndParseArticle(title) {
  if (!isNormalDocumentTitle(title)) {
    const error = new Error(`Unsupported document title: ${title}`);
    error.status = 404;
    throw error;
  }

  const sourceUrl = `${NAMU_ORIGIN}/w/${encodeURIComponent(title)}`;
  const response = await fetch(sourceUrl, {
    redirect: "follow",
    headers: requestHeaders(),
  });

  if (response.status === 404) {
    const error = new Error(`Document not found: ${title}`);
    error.status = 404;
    throw error;
  }

  if (!response.ok) {
    throw new Error(`Namuwiki responded with ${response.status} for ${title}`);
  }

  const html = await response.text();
  return parseArticleHtml(html, title, response.url || sourceUrl);
}

function parseArticleHtml(html, requestedTitle, sourceUrl) {
  const $ = cheerio.load(html);
  const title =
    normalizeWhitespace($('meta[property="og:title"]').attr("content") ?? "") ||
    normalizeWhitespace($("h1").first().text()) ||
    requestedTitle;
  const updated = $("time[datetime]").first().attr("datetime") ?? "";
  const root = $(".lXimsrdP").first().length ? $(".lXimsrdP").first() : $("body");
  const outgoing = new Set();
  const blocks = [];

  root.find(".wiki-heading, .wiki-paragraph").each((_, element) => {
    const node = $(element);

    if (node.parents("table").length > 0 || node.parents(".wiki-macro-toc").length > 0) {
      return;
    }

    if (node.hasClass("wiki-heading")) {
      const text = normalizeWhitespace(node.text().replace(/\[편집\]/g, ""));
      if (text) {
        blocks.push({ type: "heading", text });
      }
      return;
    }

    const segments = extractSegments($, element, outgoing);
    const text = normalizeWhitespace(segments.map((segment) => segment.value ?? segment.label).join(""));

    if (text.length >= 2) {
      blocks.push({ type: "paragraph", segments });
    }
  });

  const paragraphCount = blocks.filter((block) => block.type === "paragraph").length;

  if (paragraphCount === 0) {
    const description = normalizeWhitespace($('meta[property="og:description"]').attr("content") ?? "");
    if (description) {
      blocks.push({ type: "paragraph", segments: [{ kind: "text", value: description }] });
    }
  }

  return {
    title,
    sourceUrl,
    updated,
    fetchedAt: new Date().toISOString(),
    blocks,
    outgoingLinks: Array.from(outgoing).sort((a, b) => a.localeCompare(b, "ko")),
    facts: [
      { label: "출처", value: "namu.wiki" },
      { label: "본문 링크", value: String(outgoing.size) },
      { label: "블록", value: String(blocks.length) },
    ],
  };
}

function extractSegments($, element, outgoing) {
  const segments = [];

  const visit = (node) => {
    if (node.type === "text") {
      appendTextSegment(segments, node.data ?? "");
      return;
    }

    if (node.type !== "tag") {
      return;
    }

    const current = $(node);

    if (node.name === "br") {
      appendTextSegment(segments, "\n");
      return;
    }

    if (node.name === "a" && current.hasClass("wiki-link-internal")) {
      const href = current.attr("href") ?? "";
      const title = titleFromNamuPath(href);
      const label = normalizeWhitespace(current.text());

      if (title && label && isNormalDocumentTitle(title)) {
        outgoing.add(title);
        segments.push({ kind: "link", label, to: title });
        return;
      }
    }

    current.contents().each((_, child) => visit(child));
  };

  $(element)
    .contents()
    .each((_, child) => visit(child));

  return compactSegments(segments);
}

function appendTextSegment(segments, value) {
  const normalized = value.replace(/\s+/g, " ");
  if (!normalized) {
    return;
  }

  const last = segments[segments.length - 1];
  if (last?.kind === "text") {
    last.value += normalized;
    return;
  }

  segments.push({ kind: "text", value: normalized });
}

function compactSegments(segments) {
  return segments
    .map((segment) =>
      segment.kind === "text"
        ? { ...segment, value: segment.value.replace(/\s+/g, " ") }
        : { ...segment, label: segment.label.replace(/\s+/g, " ") },
    )
    .filter((segment) => (segment.kind === "text" ? segment.value.trim() : segment.label.trim()));
}

function titleFromNamuPath(value) {
  if (!value) {
    return "";
  }

  const url = new URL(value, NAMU_ORIGIN);
  if (!url.pathname.startsWith("/w/")) {
    return "";
  }

  return normalizeTitle(decodeURIComponent(url.pathname.slice(3)));
}

function normalizeTitle(title) {
  return title.replace(/_/g, " ").trim();
}

function isNormalDocumentTitle(title) {
  if (!title || title.length > 100 || title.includes("\u0000")) {
    return false;
  }

  const forbiddenPrefixes = [
    "분류:",
    "파일:",
    "틀:",
    "나무위키:",
    "사용자:",
    "휴지통:",
    "더미:",
    "초안:",
    "모듈:",
    "미디어위키:",
  ];

  return !forbiddenPrefixes.some((prefix) => title.startsWith(prefix));
}

function isPlayableStartArticle(article) {
  return isPlayableArticle(article, { minBlocks: MIN_START_BLOCKS, minLinks: MIN_START_LINKS });
}

function isPlayableTargetArticle(article) {
  return isPlayableArticle(article, { minBlocks: MIN_TARGET_BLOCKS, minLinks: MIN_TARGET_LINKS });
}

function isPlayableArticle(article, { minBlocks, minLinks }) {
  const paragraphCount = article.blocks.filter((block) => block.type === "paragraph").length;
  const hasEnoughBody = article.blocks.length >= minBlocks && paragraphCount > 0;
  const hasEnoughLinks = article.outgoingLinks.length >= minLinks;

  return hasEnoughBody && hasEnoughLinks && isNormalDocumentTitle(article.title);
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function requestHeaders() {
  return {
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "ko-KR,ko;q=0.9,en-US;q=0.7,en;q=0.6",
    "user-agent": "WikiSpeedRunLocal/0.1 (+local speedrun tool)",
  };
}

function cacheKey(value) {
  return Buffer.from(value).toString("base64url");
}

async function readFreshJson(filePath) {
  try {
    const stat = await fs.stat(filePath);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      return null;
    }
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(filePath, data) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function appendChallengeLog(challenge) {
  let entries = [];

  try {
    entries = JSON.parse(await fs.readFile(challengeLogPath, "utf8"));
  } catch {
    entries = [];
  }

  entries.unshift(challenge);
  await writeJson(challengeLogPath, entries.slice(0, 100));
}

function upsertPlayer(payload) {
  const incomingId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
  const playerName = cleanRankingText(payload?.playerName, 18) || "Player";
  const now = new Date().toISOString();
  const existing = incomingId ? players.get(incomingId) : null;

  if (existing) {
    existing.name = playerName;
    existing.lastSeenAt = now;
    existing.connected = true;
    return existing;
  }

  const player = {
    id: createId("player"),
    name: playerName,
    role: players.size === 0 ? "host" : "player",
    joinedAt: now,
    lastSeenAt: now,
    connected: true,
  };

  players.set(player.id, player);
  return player;
}

function createRun(payload) {
  const playerId = typeof payload?.playerId === "string" ? payload.playerId.trim() : "";
  const player = playerId ? players.get(playerId) : null;

  if (!player) {
    throw new Error("player_not_found");
  }

  const start = normalizeTitle(typeof payload?.start === "string" ? payload.start : "");
  const target = normalizeTitle(typeof payload?.target === "string" ? payload.target : "");
  const mode = VALID_MODES.has(payload?.mode) ? payload.mode : "casual";

  if (!start || !target || start === target) {
    throw new Error("invalid_start_or_target");
  }

  const now = new Date().toISOString();
  const run = {
    id: createId("run"),
    playerId: player.id,
    playerName: player.name,
    start,
    target,
    mode,
    allRandom: Boolean(payload?.allRandom),
    status: "running",
    currentTitle: start,
    documentStack: [start],
    routeSteps: [{ title: start, action: "start" }],
    startedAt: now,
    finishedAt: null,
    createdAt: now,
    updatedAt: now,
    record: null,
  };

  activeRuns.set(run.id, run);
  return run;
}

function finishRun(run) {
  if (run.status === "finished") {
    return createRankingSnapshot(run.record);
  }

  run.status = "finished";
  run.finishedAt = new Date().toISOString();
  run.updatedAt = run.finishedAt;

  if (run.mode === "practice") {
    return createRankingSnapshot(null, "practice_mode");
  }

  const record = createRankingRecordFromRun(run);
  run.record = record;
  sessionRankings = [record, ...sessionRankings].slice(0, MAX_RANKING_RECORDS);

  return createRankingSnapshot(record);
}

function createRankingRecordFromRun(run) {
  const elapsedMs = getRunElapsedMs(run);
  const clicks = Math.max(0, run.routeSteps.length - 1);
  const score = calculateScore(elapsedMs, clicks);

  return {
    id: createId("record"),
    playerName: run.playerName,
    start: run.start,
    target: run.target,
    mode: run.mode,
    allRandom: run.allRandom,
    clicks,
    elapsedMs,
    score,
    completedAt: run.finishedAt,
    path: run.routeSteps.map(formatNumberedRouteStep),
    routeSteps: run.routeSteps,
    runId: run.id,
    playerId: run.playerId,
  };
}

function createRankingSnapshot(record = null, reason = "") {
  return {
    accepted: Boolean(record),
    reason,
    record,
    sessionStartedAt,
    total: sessionRankings.length,
    records: sessionRankings,
  };
}

function publicRun(run) {
  return {
    id: run.id,
    playerId: run.playerId,
    playerName: run.playerName,
    start: run.start,
    target: run.target,
    mode: run.mode,
    allRandom: run.allRandom,
    status: run.status,
    currentTitle: run.currentTitle,
    documentStack: run.documentStack,
    routeSteps: run.routeSteps,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    elapsedMs: getRunElapsedMs(run),
    clicks: Math.max(0, run.routeSteps.length - 1),
    score: calculateScore(getRunElapsedMs(run), Math.max(0, run.routeSteps.length - 1)),
    record: run.record,
  };
}

function getRunElapsedMs(run) {
  const start = new Date(run.startedAt).getTime();
  const end = run.finishedAt ? new Date(run.finishedAt).getTime() : Date.now();

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }

  return Math.max(0, end - start);
}

function createId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function formatNumberedRouteStep(step, index) {
  const labels = {
    start: "시작",
    link: "이동",
    back: "뒤로",
  };

  return `${String(index + 1).padStart(2, "0")} ${labels[step.action] ?? "이동"} ${step.title}`;
}

function calculateScore(elapsedMs, clicks) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return Math.max(0, 100000 - clicks * 4000 - seconds * 35);
}

function clampNumber(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(max, Math.max(min, Math.floor(number)));
}

function cleanRankingText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return normalizeWhitespace(value).slice(0, maxLength);
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
