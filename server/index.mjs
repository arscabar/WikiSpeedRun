import express from "express";
import * as cheerio from "cheerio";
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAMU_ORIGIN = "https://namu.wiki";
const DEFAULT_PORT = Number(process.env.WSR_API_PORT ?? process.env.WSR_PORT ?? 3002);
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const RANDOM_ATTEMPTS = 18;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");
const dataDir = process.env.WSR_DATA_DIR ? path.resolve(process.env.WSR_DATA_DIR) : path.join(rootDir, "data");
const cacheDir = path.join(dataDir, "cache");
const articleCacheDir = path.join(cacheDir, "articles");
const challengeLogPath = path.join(cacheDir, "challenges.json");
const distDir = process.env.WSR_DIST_DIR ? path.resolve(process.env.WSR_DIST_DIR) : path.join(rootDir, "dist");

const app = express();

app.use(express.json({ limit: "64kb" }));
app.use((_, res, next) => {
  res.setHeader("access-control-allow-origin", "http://127.0.0.1:3001");
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type");
  next();
});

app.options(/.*/, (_, res) => res.sendStatus(204));

app.get("/api/health", (_, res) => {
  res.json({ ok: true, service: "wiki-speed-run-local", port: DEFAULT_PORT });
});

app.get("/api/challenge", async (req, res) => {
  try {
    const mode = typeof req.query.mode === "string" ? req.query.mode : "daily";
    const requestedStart = typeof req.query.start === "string" ? normalizeTitle(req.query.start) : "";
    const requestedTarget = typeof req.query.target === "string" ? normalizeTitle(req.query.target) : "";

    if (requestedStart && requestedTarget) {
      const startArticle = await getArticle(requestedStart);
      await getArticle(requestedTarget);

      if (requestedStart === requestedTarget || startArticle.outgoingLinks.length === 0) {
        res.status(400).json({ error: "invalid_challenge_override" });
        return;
      }

      const challenge = {
        start: requestedStart,
        target: requestedTarget,
        label: "테스트 제시어",
        generatedAt: new Date().toISOString(),
        source: "query-override",
      };

      await appendChallengeLog(challenge);
      res.json(challenge);
      return;
    }

    const target = await pickRandomDocument();
    let start = await pickRandomDocument(target.title);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const startArticle = await getArticle(start.title);
      if (startArticle.outgoingLinks.length > 0) {
        break;
      }
      start = await pickRandomDocument(target.title);
    }

    const challenge = {
      start: start.title,
      target: target.title,
      label: mode === "room" ? "방 자동 제시어" : mode === "infinite" ? "랜덤 제시어" : "자동 제시어",
      generatedAt: new Date().toISOString(),
      source: "namu.wiki/random",
    };

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
      console.log(`Wiki Speed Run local API listening on http://${host}:${boundPort}`);
      resolve(server);
    });
  });
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
  startServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

export { app, startServer };

async function pickRandomDocument(exceptTitle) {
  let lastTitle = "";

  for (let attempt = 0; attempt < RANDOM_ATTEMPTS; attempt += 1) {
    const title = await fetchRandomTitle();
    lastTitle = title;

    if (title === exceptTitle || !isNormalDocumentTitle(title)) {
      continue;
    }

    return { title };
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

function getErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
