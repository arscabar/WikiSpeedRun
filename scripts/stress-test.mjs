const baseUrl = process.env.WSR_BASE_URL ?? "http://127.0.0.1:3002";
const runs = Number(process.argv[2] ?? process.env.WSR_STRESS_N ?? 10);

const results = [];
const startedAt = Date.now();

await readJson("/api/health");

for (let index = 1; index <= runs; index += 1) {
  const runStartedAt = Date.now();
  const result = {
    run: index,
    ok: false,
    start: "",
    target: "",
    startLinks: 0,
    targetLinks: 0,
    targetExists: false,
    validClickAllowed: false,
    invalidClickBlocked: false,
    elapsedMs: 0,
    error: "",
  };

  try {
    const challenge = await readJson("/api/challenge?mode=daily");
    const startArticle = await readJson(`/api/article?title=${encodeURIComponent(challenge.start)}`);
    const targetArticle = await readJson(`/api/article?title=${encodeURIComponent(challenge.target)}`);
    const firstLink = startArticle.outgoingLinks[0];
    const validEvent = firstLink
      ? await readJson("/api/run/event", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ from: challenge.start, to: firstLink }),
        })
      : { allowed: false };
    const invalidEvent = await readJson("/api/run/event", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ from: challenge.start, to: "__WSR_INVALID_LINK__" }),
    });

    result.start = challenge.start;
    result.target = challenge.target;
    result.startLinks = startArticle.outgoingLinks.length;
    result.targetLinks = targetArticle.outgoingLinks.length;
    result.targetExists = Boolean(targetArticle.title);
    result.validClickAllowed = Boolean(validEvent.allowed);
    result.invalidClickBlocked = invalidEvent.allowed === false;
    result.ok =
      result.start !== result.target &&
      result.startLinks > 0 &&
      result.targetExists &&
      result.validClickAllowed &&
      result.invalidClickBlocked;
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    result.elapsedMs = Date.now() - runStartedAt;
    results.push(result);
  }
}

const passed = results.filter((result) => result.ok).length;
const failed = results.length - passed;
const summary = {
  baseUrl,
  runs,
  passed,
  failed,
  elapsedMs: Date.now() - startedAt,
  failures: results.filter((result) => !result.ok),
};

console.log(JSON.stringify({ summary, results }, null, 2));

if (failed > 0) {
  process.exitCode = 1;
}

async function readJson(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);

  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${response.statusText}`);
  }

  return response.json();
}
