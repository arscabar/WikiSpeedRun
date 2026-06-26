const baseUrl = process.env.WSR_BASE_URL ?? "http://127.0.0.1:3002";
const runs = Number(process.argv[2] ?? process.env.WSR_STRESS_N ?? 10);

const results = [];
const startedAt = Date.now();

await readJson("/api/health");
const rankingBefore = await readJson("/api/rankings");

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
    playerCreated: false,
    runCreated: false,
    validClickAllowed: false,
    invalidClickBlocked: false,
    backAllowed: false,
    completionAccepted: false,
    rankingStored: false,
    completedTarget: "",
    completedClicks: 0,
    completedScore: 0,
    elapsedMs: 0,
    error: "",
  };

  try {
    const challenge = await readJson("/api/challenge?mode=casual");
    const startArticle = await readJson(`/api/article?title=${encodeURIComponent(challenge.start)}`);
    const targetArticle = await readJson(`/api/article?title=${encodeURIComponent(challenge.target)}`);

    const transitLink =
      startArticle.outgoingLinks.find((link) => link !== challenge.target && link !== challenge.start) ??
      startArticle.outgoingLinks.find((link) => link !== challenge.start) ??
      startArticle.outgoingLinks[0];

    const playerResponse = await readJson("/api/players", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: `Stress${String(index).padStart(2, "0")}` }),
    });

    const playerId = playerResponse.player?.id;
    result.playerCreated = Boolean(playerId);

    const validationRunResponse = await readJson("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        start: challenge.start,
        target: challenge.target,
        mode: "casual",
        allRandom: false,
      }),
    });

    result.runCreated = Boolean(validationRunResponse.run?.id);

    const invalidEvent = await readJson(`/api/runs/${validationRunResponse.run.id}/link`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ to: "__WSR_INVALID_LINK__" }),
    });

    const validEvent = transitLink
      ? await readJson(`/api/runs/${validationRunResponse.run.id}/link`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: transitLink }),
        })
      : { allowed: false };

    const backEvent =
      validEvent.allowed && !validEvent.completed
        ? await readJson(`/api/runs/${validationRunResponse.run.id}/back`, {
            method: "POST",
            headers: { "content-type": "application/json" },
          })
        : { allowed: validEvent.completed ? true : false };

    const rankingTarget =
      startArticle.outgoingLinks.find((link) => link !== challenge.start) ?? startArticle.outgoingLinks[0];
    const rankingRunResponse = await readJson("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        playerId,
        start: challenge.start,
        target: rankingTarget,
        mode: "casual",
        allRandom: false,
      }),
    });
    const completionEvent = rankingTarget
      ? await readJson(`/api/runs/${rankingRunResponse.run.id}/link`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ to: rankingTarget }),
        })
      : { completed: false, ranking: { accepted: false } };
    const rankings = await readJson("/api/rankings");
    const storedRecord = rankings.records.find((record) => record.runId === rankingRunResponse.run.id);

    result.start = challenge.start;
    result.target = challenge.target;
    result.startLinks = startArticle.outgoingLinks.length;
    result.targetLinks = targetArticle.outgoingLinks.length;
    result.targetExists = Boolean(targetArticle.title);
    result.validClickAllowed = Boolean(validEvent.allowed);
    result.invalidClickBlocked = invalidEvent.allowed === false;
    result.backAllowed = Boolean(backEvent.allowed);
    result.completionAccepted = Boolean(completionEvent.completed && completionEvent.ranking?.accepted);
    result.rankingStored = Boolean(storedRecord);
    result.completedTarget = storedRecord?.target ?? "";
    result.completedClicks = storedRecord?.clicks ?? 0;
    result.completedScore = storedRecord?.score ?? 0;
    result.ok =
      result.start !== result.target &&
      result.startLinks > 0 &&
      result.targetExists &&
      result.playerCreated &&
      result.runCreated &&
      result.validClickAllowed &&
      result.invalidClickBlocked &&
      result.backAllowed &&
      result.completionAccepted &&
      result.rankingStored;
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
  rankingBefore: rankingBefore.total,
  rankingAfter: await readJson("/api/rankings").then((rankings) => rankings.total),
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
