import {
  AlertTriangle,
  ArrowLeft,
  Award,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Eye,
  GitBranch,
  Home,
  ImageDown,
  LoaderCircle,
  LockKeyhole,
  MousePointerClick,
  Radio,
  Search,
  RotateCcw,
  SearchX,
  Settings2,
  Share2,
  ShieldCheck,
  Shuffle,
  Swords,
  Target,
  Trophy,
  UserRound,
  Users,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Mode = "casual" | "practice";

type Segment =
  | {
      kind: "text";
      value: string;
    }
  | {
      kind: "link";
      label: string;
      to: string;
    };

type ArticleBlock =
  | {
      type: "heading";
      text: string;
    }
  | {
      type: "paragraph";
      segments: Segment[];
    };

type ApiArticle = {
  title: string;
  sourceUrl: string;
  updated: string;
  fetchedAt: string;
  blocks: ArticleBlock[];
  outgoingLinks: string[];
  facts: Array<{ label: string; value: string }>;
};

type Challenge = {
  start: string;
  target: string;
  label: string;
  generatedAt: string;
  source: string;
};

type RankingMode = "clicks" | "time" | "score";

type RunMeta = {
  mode: Mode;
  allRandom: boolean;
};

type RouteStep = {
  title: string;
  action: "start" | "link" | "back";
};

type CompletionRecord = {
  id: string;
  playerName: string;
  start: string;
  target: string;
  mode: Mode;
  allRandom: boolean;
  clicks: number;
  elapsedMs: number;
  score: number;
  completedAt: string;
  path: string[];
  routeSteps?: RouteStep[];
};

type RankingResponse = {
  accepted?: boolean;
  reason?: string;
  record?: CompletionRecord | null;
  sessionStartedAt: string;
  total: number;
  records: CompletionRecord[];
};

type PlayerProfile = {
  id: string;
  name: string;
  role: "host" | "player" | "spectator";
  joinedAt: string;
  lastSeenAt: string;
  connected: boolean;
};

type PlayerResponse = {
  player: PlayerProfile;
  sessionStartedAt: string;
};

type ServerRun = {
  id: string;
  playerId: string;
  playerName: string;
  start: string;
  target: string;
  mode: Mode;
  allRandom: boolean;
  status: "running" | "finished";
  currentTitle: string;
  documentStack: string[];
  routeSteps: RouteStep[];
  startedAt: string;
  finishedAt: string | null;
  elapsedMs: number;
  clicks: number;
  score: number;
  record: CompletionRecord | null;
};

type RunResponse = {
  allowed?: boolean;
  completed?: boolean;
  from?: string;
  to?: string;
  run: ServerRun;
  ranking?: RankingResponse;
  sessionStartedAt?: string;
};

type FindPart = {
  text: string;
  matchIndex: number | null;
};

type RenderSegment = Segment & {
  parts: FindPart[];
};

type RenderBlock =
  | {
      type: "heading";
      text: string;
      parts: FindPart[];
    }
  | {
      type: "paragraph";
      segments: RenderSegment[];
    };

const fairnessItems = [
  { icon: SearchX, label: "주소 검색 잠금", state: "LOCK" },
  { icon: ArrowLeft, label: "뒤로가기 허용", state: "ON" },
  { icon: Search, label: "본문 찾기", state: "ON" },
  { icon: LockKeyhole, label: "URL 봉인", state: "ON" },
];

const modeLabels: Record<Mode, string> = {
  casual: "캐주얼",
  practice: "연습",
};

const randomRunLabels = {
  standard: "일반",
  allRandom: "아예랜덤",
};

const routeActionLabels: Record<RouteStep["action"], string> = {
  start: "시작",
  link: "이동",
  back: "뒤로",
};

const rankingModeLabels: Record<RankingMode, string> = {
  clicks: "클릭 우선",
  time: "시간 우선",
  score: "점수 우선",
};

function formatDuration(totalMs: number) {
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

function formatDate(value: string) {
  if (!value) {
    return "unknown";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString("ko-KR", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function calculateScore(elapsedMs: number, clicks: number) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1000));
  return Math.max(0, 100000 - clicks * 4000 - seconds * 35);
}

function createRouteStepsFromTitles(titles: string[]) {
  return titles.map((title, index) => ({
    title,
    action: index === 0 ? "start" : "link",
  })) satisfies RouteStep[];
}

function formatRouteStepLabel(step: RouteStep, index: number) {
  if (index === 0) {
    return step.title;
  }

  return step.action === "back" ? `↩ ${step.title}` : step.title;
}

function formatNumberedRouteStep(step: RouteStep, index: number) {
  return `${String(index + 1).padStart(2, "0")} ${routeActionLabels[step.action]} ${step.title}`;
}

function formatRouteSteps(steps: RouteStep[]) {
  return steps.map(formatNumberedRouteStep).join(" → ");
}

function sortRecords(records: CompletionRecord[], rankingMode: RankingMode) {
  return [...records].sort((a, b) => {
    if (rankingMode === "score") {
      return b.score - a.score || a.clicks - b.clicks || a.elapsedMs - b.elapsedMs;
    }
    if (rankingMode === "time") {
      return a.elapsedMs - b.elapsedMs || a.clicks - b.clicks || b.score - a.score;
    }
    return a.clicks - b.clicks || a.elapsedMs - b.elapsedMs || b.score - a.score;
  });
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    let message = `${response.status} ${response.statusText}`;
    try {
      const payload = (await response.json()) as { message?: string };
      message = payload.message ?? message;
    } catch {
      // Use the HTTP status when the server returned non-JSON.
    }
    throw new Error(message);
  }

  return (await response.json()) as T;
}

async function copyTextToClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to the legacy copy path.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

function getChallengeOverrideParams() {
  const params = new URLSearchParams(window.location.search);
  const start = params.get("start")?.trim();
  const target = params.get("target")?.trim();

  if (!start || !target) {
    return "";
  }

  return `&start=${encodeURIComponent(start)}&target=${encodeURIComponent(target)}`;
}

function renderFindParts(parts: FindPart[], activeFindIndex: number) {
  return parts.map((part, index) => {
    if (part.matchIndex === null) {
      return <span key={`text-${index}`}>{part.text}</span>;
    }

    return (
      <mark
        className={part.matchIndex === activeFindIndex ? "findMatch active" : "findMatch"}
        data-find-index={part.matchIndex}
        key={`match-${part.matchIndex}-${index}`}
      >
        {part.text}
      </mark>
    );
  });
}

function App() {
  const [mode, setMode] = useState<Mode>("casual");
  const [playerId, setPlayerId] = useState(() => localStorage.getItem("wsr.playerId") ?? "");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("wsr.playerName") ?? "PlayerA");
  const [rankingMode, setRankingMode] = useState<RankingMode>(
    () => (localStorage.getItem("wsr.rankingMode") as RankingMode | null) ?? "clicks",
  );
  const [records, setRecords] = useState<CompletionRecord[]>([]);
  const [rankingSessionStartedAt, setRankingSessionStartedAt] = useState("");
  const [isEntered, setIsEntered] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [article, setArticle] = useState<ApiArticle | null>(null);
  const [runId, setRunId] = useState("");
  const [currentTitle, setCurrentTitle] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [runMeta, setRunMeta] = useState<RunMeta>({ mode: "casual", allRandom: false });
  const [startedAt, setStartedAt] = useState(Date.now());
  const [elapsedMs, setElapsedMs] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isNavigating, setIsNavigating] = useState(false);
  const [error, setError] = useState("");
  const [shareState, setShareState] = useState("대기");
  const [shareText, setShareText] = useState("");
  const [resultImageUrl, setResultImageUrl] = useState("");
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [activeFindIndex, setActiveFindIndex] = useState(-1);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  const isComplete = Boolean(challenge && currentTitle === challenge.target);
  const isPractice = runMeta.mode === "practice";
  const clicks = Math.max(0, routeSteps.length - 1);
  const liveScore = calculateScore(elapsedMs, clicks);
  const resultScore = liveScore;
  const roomCode = "WIKI-4827";
  const normalizedFindQuery = findQuery.trim();
  const runModeLabel = modeLabels[runMeta.mode];
  const runRandomLabel = runMeta.allRandom ? randomRunLabels.allRandom : randomRunLabels.standard;
  const routeTimeline = routeSteps.length > 0 ? formatRouteSteps(routeSteps) : history.join(" → ");

  const findResult = useMemo(() => {
    if (!article) {
      return { blocks: [] as RenderBlock[], matchCount: 0, targets: [] as Array<string | null> };
    }

    const query = normalizedFindQuery.toLocaleLowerCase("ko-KR");
    const targets: Array<string | null> = [];
    let matchCount = 0;

    const createParts = (value: string, target: string | null = null) => {
      if (!query) {
        return [{ text: value, matchIndex: null }] satisfies FindPart[];
      }

      const lowerValue = value.toLocaleLowerCase("ko-KR");
      const parts: FindPart[] = [];
      let cursor = 0;

      while (cursor < value.length) {
        const index = lowerValue.indexOf(query, cursor);
        if (index === -1) {
          parts.push({ text: value.slice(cursor), matchIndex: null });
          break;
        }

        if (index > cursor) {
          parts.push({ text: value.slice(cursor, index), matchIndex: null });
        }

        parts.push({ text: value.slice(index, index + query.length), matchIndex: matchCount });
        targets[matchCount] = target;
        matchCount += 1;
        cursor = index + query.length;
      }

      return parts.filter((part) => part.text.length > 0);
    };

    const blocks: RenderBlock[] = article.blocks.map((block) => {
      if (block.type === "heading") {
        return { ...block, parts: createParts(block.text) };
      }

      return {
        ...block,
        segments: block.segments.map((segment) => ({
          ...segment,
          parts: createParts(segment.kind === "text" ? segment.value : segment.label, segment.kind === "link" ? segment.to : null),
        })),
      };
    });

    return { blocks, matchCount, targets };
  }, [article, normalizedFindQuery]);

  const activeFindTarget = activeFindIndex >= 0 ? findResult.targets[activeFindIndex] : null;

  const openFind = useCallback(() => {
    setFindOpen(true);
    setShareState("문서 찾기");
  }, []);

  const moveFindResult = useCallback(
    (direction: 1 | -1) => {
      if (findResult.matchCount === 0) {
        setActiveFindIndex(-1);
        return;
      }

      setActiveFindIndex((index) => {
        const currentIndex = index < 0 ? 0 : index;
        return (currentIndex + direction + findResult.matchCount) % findResult.matchCount;
      });
    },
    [findResult.matchCount],
  );

  const fetchRankings = useCallback(async () => {
    const payload = await readJson<RankingResponse>("/api/rankings");
    setRecords(payload.records);
    setRankingSessionStartedAt(payload.sessionStartedAt);
  }, []);

  const loadArticle = useCallback(async (title: string) => {
    return readJson<ApiArticle>(`/api/article?title=${encodeURIComponent(title)}`);
  }, []);

  const applyServerRun = useCallback((run: ServerRun) => {
    setRunId(run.id);
    setCurrentTitle(run.currentTitle);
    setHistory(run.documentStack);
    setRouteSteps(run.routeSteps);

    setStartedAt(Date.now() - run.elapsedMs);
    setElapsedMs(run.elapsedMs);
  }, []);

  const ensurePlayer = useCallback(
    async (nextPlayerName: string) => {
      const payload = await readJson<PlayerResponse>("/api/players", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId,
          playerName: nextPlayerName,
        }),
      });

      setPlayerId(payload.player.id);
      localStorage.setItem("wsr.playerId", payload.player.id);
      return payload.player.id;
    },
    [playerId],
  );

  const createServerRun = useCallback(
    async (nextChallenge: Challenge, nextMode: Mode, allRandom: boolean, nextPlayerName: string) => {
      const nextPlayerId = await ensurePlayer(nextPlayerName);
      const payload = await readJson<RunResponse>("/api/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          playerId: nextPlayerId,
          start: nextChallenge.start,
          target: nextChallenge.target,
          mode: nextMode,
          allRandom,
        }),
      });

      return payload.run;
    },
    [ensurePlayer],
  );

  const startChallenge = useCallback(
    async (nextMode: Mode, useOverride = false, allRandom = false, nextPlayerName = playerName) => {
      setIsLoading(true);
      setError("");
      setShareState(allRandom ? "아예랜덤 생성 중" : "제시어 생성 중");

      try {
        const nextChallenge = await readJson<Challenge>(
          `/api/challenge?mode=${allRandom ? "wild" : nextMode}${useOverride ? getChallengeOverrideParams() : ""}`,
        );
        const startArticle = await loadArticle(nextChallenge.start);
        const nextRun = await createServerRun(nextChallenge, nextMode, allRandom, nextPlayerName);

        setChallenge(nextChallenge);
        setArticle(startArticle);
        applyServerRun(nextRun);
        setRunMeta({ mode: nextMode, allRandom });
        setShareText("");
        setResultImageUrl("");
        setFindQuery("");
        setActiveFindIndex(-1);
        setShareState(allRandom ? "아예랜덤 설정됨" : "제시어 자동 설정됨");
        window.history.replaceState({ view: "race", title: nextChallenge.start }, "", window.location.href);
        window.setTimeout(() => setShareState("대기"), 1400);
      } catch (challengeError) {
        setError(challengeError instanceof Error ? challengeError.message : String(challengeError));
        setShareState("제시어 생성 실패");
      } finally {
        setIsLoading(false);
      }
    },
    [applyServerRun, createServerRun, loadArticle, playerName],
  );

  useEffect(() => {
    void fetchRankings();

    const id = window.setInterval(() => {
      void fetchRankings();
    }, 5000);

    return () => window.clearInterval(id);
  }, [fetchRankings]);

  useEffect(() => {
    if (!isEntered || !challenge || isComplete || isLoading) {
      return;
    }

    const id = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAt);
    }, 250);

    return () => window.clearInterval(id);
  }, [challenge, isComplete, isEntered, isLoading, startedAt]);

  useEffect(() => {
    if (!findOpen) {
      return;
    }

    window.setTimeout(() => findInputRef.current?.focus(), 0);
  }, [findOpen]);

  useEffect(() => {
    if (!normalizedFindQuery || findResult.matchCount === 0) {
      setActiveFindIndex(-1);
      return;
    }

    setActiveFindIndex(0);
  }, [currentTitle, findResult.matchCount, normalizedFindQuery]);

  useEffect(() => {
    if (activeFindIndex < 0) {
      return;
    }

    const activeElement = document.querySelector(`[data-find-index="${activeFindIndex}"]`);
    activeElement?.scrollIntoView({ block: "center", inline: "nearest" });
  }, [activeFindIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const isFindShortcut = (event.ctrlKey || event.metaKey) && (key === "f" || event.key === "F5");

      if (isFindShortcut && isEntered) {
        event.preventDefault();
        openFind();
        return;
      }

      if (!findOpen) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        setFindOpen(false);
        return;
      }

      if (event.key === "Enter") {
        event.preventDefault();
        moveFindResult(event.shiftKey ? -1 : 1);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [findOpen, isEntered, moveFindResult, openFind]);

  const racePlayers = useMemo(
    () => [
      {
        name: playerName || "Player",
        doc: currentTitle || "-",
        clicks,
        tone: "self",
        progress: Math.min(100, 24 + clicks * 23 + (isComplete ? 16 : 0)),
      },
      {
        name: "local-2",
        doc: history[Math.max(0, history.length - 2)] ?? "대기",
        clicks: Math.max(0, clicks + 1),
        tone: "rival",
        progress: Math.min(92, 36 + clicks * 18),
      },
      {
        name: "spectator",
        doc: isComplete ? challenge?.target ?? "-" : "관전 중",
        clicks: Math.max(0, clicks + 2),
        tone: "rival",
        progress: Math.min(100, 48 + clicks * 16),
      },
    ],
    [challenge?.target, clicks, currentTitle, history, isComplete, playerName],
  );

  const sortedRecords = useMemo(() => sortRecords(records, rankingMode), [rankingMode, records]);
  const leaderboard = useMemo(
    () =>
      sortedRecords.slice(0, 6).map((record, index) => ({
        rank: index + 1,
        name: record.playerName,
        clicks: record.clicks,
        time: formatDuration(record.elapsedMs),
        score: record.score,
      })),
    [sortedRecords],
  );
  const bestScore = records.length > 0 ? Math.max(...records.map((record) => record.score)) : 0;
  const bestTime = records.length > 0 ? Math.min(...records.map((record) => record.elapsedMs)) : 0;

  const enterGame = async () => {
    const cleanName = playerName.trim() || "PlayerA";
    setPlayerName(cleanName);
    localStorage.setItem("wsr.playerName", cleanName);
    setIsEntered(true);
    await startChallenge(mode, true, false, cleanName);
  };

  const randomizeEverything = async () => {
    const cleanName = playerName.trim() || "PlayerA";
    const nextMode: Mode = Math.random() > 0.5 ? "casual" : "practice";

    setPlayerName(cleanName);
    localStorage.setItem("wsr.playerName", cleanName);
    setMode(nextMode);
    setIsEntered(true);
    await startChallenge(nextMode, false, true, cleanName);
  };

  const switchMode = (nextMode: Mode) => {
    setMode(nextMode);
    if (isEntered) {
      void startChallenge(nextMode);
    }
  };

  const changeRankingMode = (nextMode: RankingMode) => {
    setRankingMode(nextMode);
    localStorage.setItem("wsr.rankingMode", nextMode);
  };

  const exitToMain = useCallback(() => {
    setIsEntered(false);
    setChallenge(null);
    setArticle(null);
    setRunId("");
    setCurrentTitle("");
    setHistory([]);
    setRouteSteps([]);
    setElapsedMs(0);
    setError("");
    setShareText("");
    setResultImageUrl("");
    setFindOpen(false);
    setFindQuery("");
    setActiveFindIndex(-1);
    setShareState("대기");
    window.history.replaceState({ view: "entry" }, "", window.location.href);
  }, []);

  const resetCurrentChallenge = async () => {
    if (!challenge) {
      return;
    }

    setIsLoading(true);
    setError("");

    try {
      const startArticle = await loadArticle(challenge.start);
      const nextRun = await createServerRun(challenge, runMeta.mode, runMeta.allRandom, playerName.trim() || "PlayerA");
      setArticle(startArticle);
      applyServerRun(nextRun);
      setShareText("");
      setResultImageUrl("");
      setFindQuery("");
      setActiveFindIndex(-1);
      setShareState("현재 판 재시작");
      window.history.replaceState({ view: "race", title: challenge.start }, "", window.location.href);
      window.setTimeout(() => setShareState("대기"), 1400);
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : String(resetError));
    } finally {
      setIsLoading(false);
    }
  };

  const goBackArticle = useCallback(async () => {
    if (!runId || history.length <= 1 || isLoading || isNavigating) {
      return;
    }

    setIsNavigating(true);
    setError("");

    try {
      const response = await readJson<RunResponse>(`/api/runs/${encodeURIComponent(runId)}/back`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });

      if (!response.allowed) {
        setShareState("이전 문서 없음");
        window.setTimeout(() => setShareState("대기"), 1200);
        return;
      }

      const previousArticle = await loadArticle(response.run.currentTitle);
      setArticle(previousArticle);
      applyServerRun(response.run);
      setShareText("");
      setResultImageUrl("");
      setFindQuery("");
      setActiveFindIndex(-1);
      setShareState("이전 문서");
      window.setTimeout(() => setShareState("대기"), 1200);
    } catch (backError) {
      setError(backError instanceof Error ? backError.message : String(backError));
    } finally {
      setIsNavigating(false);
    }
  }, [applyServerRun, history.length, isLoading, isNavigating, loadArticle, runId]);

  const navigateToArticle = async (title: string) => {
    if (!article || !challenge || !runId || isComplete || isNavigating) {
      return;
    }

    setIsNavigating(true);
    setError("");

    try {
      const event = await readJson<RunResponse>(`/api/runs/${encodeURIComponent(runId)}/link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: title }),
      });

      if (!event.allowed) {
        setShareState("서버 검증 실패");
        return;
      }

      const nextArticle = await loadArticle(event.run.currentTitle);

      setArticle(nextArticle);
      applyServerRun(event.run);
      setFindQuery("");
      setActiveFindIndex(-1);
      window.history.pushState({ view: "race", title: event.run.currentTitle }, "", window.location.href);

      if (event.completed) {
        setElapsedMs(event.run.elapsedMs);

        if (event.ranking?.records) {
          setRecords(event.ranking.records);
          setRankingSessionStartedAt(event.ranking.sessionStartedAt);
        }

        if (event.ranking?.reason === "practice_mode" || runMeta.mode === "practice") {
          setShareState("연습 완주");
        } else {
          setShareState("세션 랭킹 반영됨");
        }

        window.setTimeout(() => setShareState("대기"), 1400);
      }
    } catch (navigationError) {
      setError(navigationError instanceof Error ? navigationError.message : String(navigationError));
    } finally {
      setIsNavigating(false);
    }
  };

  useEffect(() => {
    const handlePopState = () => {
      if (!isEntered) {
        return;
      }

      if (history.length > 1) {
        void goBackArticle();
        return;
      }

      exitToMain();
    };

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [exitToMain, goBackArticle, history.length, isEntered]);

  const openActiveFindMatch = () => {
    if (!activeFindTarget) {
      setShareState("링크 결과 아님");
      window.setTimeout(() => setShareState("대기"), 1200);
      return;
    }

    void navigateToArticle(activeFindTarget);
  };

  const copyRoomCode = async () => {
    const copied = await copyTextToClipboard(roomCode);
    setShareState(copied ? "세션 코드 복사됨" : `세션 코드 ${roomCode}`);
    window.setTimeout(() => setShareState("대기"), 1400);
  };

  const copyResult = async () => {
    if (!challenge) {
      return;
    }

    const message = [
      "나무위키 스피드런",
      `${challenge.start} -> ${challenge.target}`,
      `모드: ${runModeLabel} · 랜덤 여부: ${runRandomLabel}`,
      `${formatDuration(elapsedMs)} · ${clicks}클릭 · ${resultScore}점`,
      `경로: ${routeTimeline.split(" → ").join(" -> ")}`,
    ].join("\n");

    const copied = await copyTextToClipboard(message);
    setShareText(message);
    setShareState(copied ? "결과 복사됨" : "공유 문구 생성됨");
    window.setTimeout(() => setShareState("대기"), 1400);
  };

  const downloadResultImage = async () => {
    if (!challenge) {
      return;
    }

    if (resultImageUrl) {
      URL.revokeObjectURL(resultImageUrl);
      setResultImageUrl("");
    }

    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const context = canvas.getContext("2d");

    if (!context) {
      return;
    }

    context.fillStyle = "#f5f6f7";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#00a495";
    context.lineWidth = 6;
    context.strokeRect(42, 42, canvas.width - 84, canvas.height - 84);

    context.fillStyle = "#00a495";
    context.font = "700 42px Noto Sans KR, sans-serif";
    context.fillText("나무위키 스피드런", 76, 116);

    context.fillStyle = "#202122";
    context.font = "700 52px Noto Sans KR, sans-serif";
    context.fillText(`${challenge.start} -> ${challenge.target}`.slice(0, 36), 76, 208);

    context.fillStyle = "#54595d";
    context.font = "500 32px Noto Sans KR, sans-serif";
    context.fillText(`Time ${formatDuration(elapsedMs)}   ${clicks} clicks`, 76, 266);
    context.fillStyle = "#00a495";
    context.font = "700 32px Noto Sans KR, sans-serif";
    context.fillText(`${resultScore} points`, 76, 316);
    context.fillStyle = "#54595d";
    context.font = "600 28px Noto Sans KR, sans-serif";
    context.fillText(`모드 ${runModeLabel} · 랜덤 여부 ${runRandomLabel}`, 76, 366);

    const graphSteps = routeSteps.length > 0 ? routeSteps : createRouteStepsFromTitles(history);
    const maxImageRows = 8;
    const imageSteps =
      graphSteps.length > maxImageRows
        ? [...graphSteps.slice(0, maxImageRows - 1), graphSteps[graphSteps.length - 1]]
        : graphSteps;
    const skippedSteps = graphSteps.length - imageSteps.length;
    const graphLeft = 700;
    const badgeWidth = 50;
    const rowGap = 52;
    const firstY = 160;

    context.fillStyle = "#202122";
    context.font = "700 30px Noto Sans KR, sans-serif";
    context.fillText("이동 로그", graphLeft, 116);

    imageSteps.forEach((step, displayIndex) => {
      const originalIndex = skippedSteps > 0 && displayIndex === imageSteps.length - 1 ? graphSteps.length - 1 : displayIndex;
      const y = firstY + displayIndex * rowGap;
      const previousY = firstY + (displayIndex - 1) * rowGap;
      const isTarget = step.title === challenge.target;
      const isBack = step.action === "back";

      if (displayIndex > 0) {
        context.strokeStyle = isBack ? "#899197" : "#00a495";
        context.lineWidth = isBack ? 3 : 4;
        context.setLineDash(isBack ? [8, 8] : []);
        context.beginPath();
        context.moveTo(graphLeft + badgeWidth / 2, previousY + 18);
        context.lineTo(graphLeft + badgeWidth / 2, y - 18);
        context.stroke();
        context.setLineDash([]);
      }

      if (skippedSteps > 0 && displayIndex === imageSteps.length - 1) {
        context.fillStyle = "#6b7278";
        context.font = "700 18px Noto Sans KR, sans-serif";
        context.fillText(`+${skippedSteps}단계`, graphLeft + 66, y - 32);
      }

      context.fillStyle = isTarget ? "#00a495" : isBack ? "#f1f3f5" : "#ffffff";
      context.strokeStyle = isTarget ? "#008275" : isBack ? "#899197" : "#9aa4aa";
      context.lineWidth = 3;
      context.fillRect(graphLeft, y - 18, badgeWidth, 36);
      context.strokeRect(graphLeft, y - 18, badgeWidth, 36);

      context.fillStyle = isTarget ? "#ffffff" : "#202122";
      context.font = "700 18px JetBrains Mono, monospace";
      context.fillText(String(originalIndex + 1).padStart(2, "0"), graphLeft + 11, y + 7);

      context.fillStyle = isBack ? "#6b7278" : "#008275";
      context.font = "700 18px Noto Sans KR, sans-serif";
      context.fillText(routeActionLabels[step.action], graphLeft + 66, y - 2);

      context.fillStyle = "#202122";
      context.font = "600 22px Noto Sans KR, sans-serif";
      context.fillText(step.title.slice(0, 15), graphLeft + 124, y + 8);
    });

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    const imageUrl = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
    setResultImageUrl(imageUrl);
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `wiki-speed-run-result-${Date.now()}.png`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setShareState("결과 이미지 저장됨");
    window.setTimeout(() => setShareState("대기"), 1400);
  };

  return (
    <div className="app">
      <a className="skipLink" href="#main">
        본문으로 이동
      </a>

      <header className="topbar">
        <div className="brandLockup" aria-label="나무위키 스피드런">
          <span className="brandMark">나무</span>
          <div>
            <h1>나무위키 스피드런</h1>
            <p>로컬 문서 레이스</p>
          </div>
        </div>

        <nav className="modeTabs" aria-label="룰 모드">
          {(["casual", "practice"] as Mode[]).map((item) => (
            <button
              className={mode === item ? "tabButton active" : "tabButton"}
              type="button"
              aria-pressed={mode === item}
              onClick={() => switchMode(item)}
              key={item}
            >
              {item === "casual" && <Users aria-hidden="true" size={18} />}
              {item === "practice" && <Target aria-hidden="true" size={18} />}
              <span>{modeLabels[item]}</span>
            </button>
          ))}
          <button className="tabButton randomAllButton" type="button" disabled={isLoading} onClick={() => void randomizeEverything()}>
            <Shuffle aria-hidden="true" size={18} />
            <span>아예랜덤</span>
          </button>
        </nav>

        <div className="liveBadge" aria-live="polite">
          <Radio aria-hidden="true" size={18} />
          <span>{isComplete ? "완주" : isEntered ? "진행 중" : "준비"}</span>
        </div>
      </header>

      {!isEntered ? (
        <main id="main" className="entryLayout">
          <section className="entryHero" aria-label="레이스 대기실">
            <div className="entrySignal">
              <span>나무위키 문서 레이스</span>
              <strong>{modeLabels[mode]}</strong>
            </div>
            <div className="entryTitleBlock">
              <div className="panelKicker">문서 레이스</div>
              <h2>나무위키 스피드런</h2>
              <div className="entryRoutePreview" aria-label="제시어 생성 상태">
                <div>
                  <span>시작 문서</span>
                  <strong>무작위</strong>
                </div>
                <GitBranch aria-hidden="true" size={22} />
                <div>
                  <span>목표 문서</span>
                  <strong>자동 설정</strong>
                </div>
              </div>
            </div>
            <div className="entryTelemetry" aria-label="세션 랭킹 요약">
              <div>
                <span>세션 최고 점수</span>
                <strong>{bestScore || "-"}</strong>
              </div>
              <div>
                <span>세션 최고 시간</span>
                <strong>{bestTime ? formatDuration(bestTime) : "--:--:--"}</strong>
              </div>
              <div>
                <span>세션 완주</span>
                <strong>{records.length}</strong>
              </div>
            </div>
          </section>

          <section className="setupPanel" aria-label="플레이어 설정">
            <div className="panelKicker">플레이어</div>
            <h2>플레이어 설정</h2>
            <div className="playerFields">
              <label htmlFor="playerName">닉네임</label>
              <input
                id="playerName"
                className="playerInput"
                value={playerName}
                maxLength={18}
                onChange={(event) => setPlayerName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    void enterGame();
                  }
                }}
              />
            </div>
            <button className="primaryAction" type="button" onClick={enterGame}>
              <UserRound aria-hidden="true" size={18} />
              <span>입장</span>
            </button>
          </section>

          <aside className="entrySide" aria-label="대기실 상태">
            <section className="entryLockPanel">
              <div className="panelHeader">
                <ShieldCheck aria-hidden="true" size={18} />
                <h2>공정성 잠금</h2>
              </div>
              <div className="guardList">
                {fairnessItems.map(({ icon: Icon, label, state }) => (
                  <div className="guardItem" key={label}>
                    <Icon aria-hidden="true" size={18} />
                    <span>{label}</span>
                    <strong>{state}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="entryRankPanel">
              <div className="panelHeader">
                <Trophy aria-hidden="true" size={18} />
                <h2>세션 랭킹</h2>
              </div>
              <div className="rankSession">서버 시작 {rankingSessionStartedAt ? formatDate(rankingSessionStartedAt) : "-"}</div>
              <div className="entryRankList">
                {leaderboard.length > 0 ? (
                  leaderboard.slice(0, 3).map((row) => (
                    <div className="entryRankRow" key={`${row.rank}-${row.name}-${row.score}`}>
                      <span>{row.rank}</span>
                      <strong>{row.name}</strong>
                      <code>{row.score}</code>
                    </div>
                  ))
                ) : (
                  <div className="emptyRank">기록 대기</div>
                )}
              </div>
            </section>
          </aside>
        </main>
      ) : (
        <main id="main" className="raceLayout">
          <aside className="controlRail" aria-label="경기 상태">
            <section className="challengePanel">
              <div className="panelKicker">제시어</div>
              <h2>{challenge?.label ?? "제시어 대기"}</h2>
              <div className="routePlate">
                <span>{challenge?.start ?? "-"}</span>
                <GitBranch aria-hidden="true" size={18} />
                <strong>{challenge?.target ?? "-"}</strong>
              </div>
              <button className="primaryAction" type="button" disabled={isLoading} onClick={() => startChallenge(mode)}>
                <Shuffle aria-hidden="true" size={18} />
                <span>새 제시어</span>
              </button>
              <button className="ghostAction strongGhostAction" type="button" disabled={isLoading} onClick={() => void randomizeEverything()}>
                <Shuffle aria-hidden="true" size={18} />
                <span>아예랜덤</span>
              </button>
              <button className="ghostAction" type="button" disabled={isLoading || !challenge} onClick={resetCurrentChallenge}>
                <RotateCcw aria-hidden="true" size={18} />
                <span>현재 판 재시작</span>
              </button>
              <button
                className="ghostAction"
                type="button"
                disabled={history.length <= 1 || isLoading || isNavigating}
                onClick={() => void goBackArticle()}
              >
                <ArrowLeft aria-hidden="true" size={18} />
                <span>이전 문서</span>
              </button>
              <button className="ghostAction" type="button" onClick={exitToMain}>
                <Home aria-hidden="true" size={18} />
                <span>메인화면</span>
              </button>
            </section>

            <section className="metricStack" aria-label="플레이어 HUD">
              <Metric icon={Target} label="목표" value={challenge?.target ?? "-"} accent="amber" />
              <Metric icon={Clock3} label="타이머" value={formatDuration(elapsedMs)} accent="cyan" mono />
              <Metric icon={MousePointerClick} label="클릭 수" value={String(clicks)} accent="paper" mono />
              <Metric icon={Award} label="점수" value={String(liveScore)} accent="amber" mono />
            </section>

            <section className="guardPanel" aria-label="공정성 잠금">
              <div className="panelHeader">
                <ShieldCheck aria-hidden="true" size={18} />
                <h2>공정성 잠금</h2>
              </div>
              <div className="guardList">
                {fairnessItems.map(({ icon: Icon, label, state }) => (
                  <div className="guardItem" key={label}>
                    <Icon aria-hidden="true" size={18} />
                    <span>{label}</span>
                    <strong>{state}</strong>
                  </div>
                ))}
              </div>
            </section>

            <section className="historyPanel" aria-label="히스토리">
              <div className="panelHeader">
                <GitBranch aria-hidden="true" size={18} />
                <h2>이동 기록</h2>
              </div>
              <ol className="historyList">
                {routeSteps.map((step, index) => (
                  <li
                    key={`${step.title}-${step.action}-${index}`}
                    className={`${index === routeSteps.length - 1 ? "current" : ""}${step.action === "back" ? " backStep" : ""}`}
                  >
                    <span>{String(index + 1).padStart(2, "0")}</span>
                    <strong>{formatRouteStepLabel(step, index)}</strong>
                  </li>
                ))}
              </ol>
            </section>
          </aside>

          <section className="mobileHud" aria-label="모바일 경기 요약">
            <div className="mobileRoute">
              <span>{challenge?.start ?? "-"}</span>
              <GitBranch aria-hidden="true" size={17} />
              <strong>{challenge?.target ?? "-"}</strong>
            </div>
            <div className="mobileStats">
              <div>
                <span>목표</span>
                <strong>{challenge?.target ?? "-"}</strong>
              </div>
              <div>
                <span>시간</span>
                <strong>{formatDuration(elapsedMs)}</strong>
              </div>
              <div>
                <span>클릭</span>
                <strong>{clicks}</strong>
              </div>
              <div>
                <span>점수</span>
                <strong>{liveScore}</strong>
              </div>
            </div>
            <div className="mobileActions">
              <button className="primaryAction" type="button" disabled={isLoading} onClick={() => startChallenge(mode)}>
                <Shuffle aria-hidden="true" size={18} />
                <span>새 제시어</span>
              </button>
              <button className="ghostAction strongGhostAction" type="button" disabled={isLoading} onClick={() => void randomizeEverything()}>
                <Shuffle aria-hidden="true" size={18} />
                <span>랜덤</span>
              </button>
              <button className="ghostAction" type="button" disabled={isLoading || !challenge} onClick={resetCurrentChallenge}>
                <RotateCcw aria-hidden="true" size={18} />
                <span>재시작</span>
              </button>
              <button
                className="ghostAction"
                type="button"
                disabled={history.length <= 1 || isLoading || isNavigating}
                onClick={() => void goBackArticle()}
              >
                <ArrowLeft aria-hidden="true" size={18} />
                <span>이전</span>
              </button>
              <button className="ghostAction" type="button" onClick={exitToMain}>
                <Home aria-hidden="true" size={18} />
                <span>메인</span>
              </button>
            </div>
          </section>

          <section className="browserZone" aria-label="자체 브라우저">
            <div className="browserChrome">
              <div className="windowControls" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
              <div className="lockedAddress">
                <LockKeyhole aria-hidden="true" size={18} />
                <span>namu.local/{encodeURIComponent(currentTitle || "loading")}</span>
              </div>
              <button className="iconButton" type="button" aria-label="현재 문서 관전 상태">
                <Eye aria-hidden="true" size={19} />
              </button>
              <button className="iconButton" type="button" aria-label="문서 내 찾기 열기" onClick={openFind}>
                <Search aria-hidden="true" size={19} />
              </button>
            </div>

            {findOpen && (
              <section className="findBar" aria-label="문서 내 찾기 도구">
                <Search aria-hidden="true" size={18} />
                <input
                  ref={findInputRef}
                  aria-label="문서 내 찾기"
                  value={findQuery}
                  onChange={(event) => setFindQuery(event.target.value)}
                />
                <output aria-label="찾기 결과">
                  {findResult.matchCount > 0 && activeFindIndex >= 0 ? `${activeFindIndex + 1}/${findResult.matchCount}` : "0/0"}
                </output>
                <button className="iconButton compact" type="button" aria-label="이전 찾기 결과" onClick={() => moveFindResult(-1)}>
                  <ChevronUp aria-hidden="true" size={18} />
                </button>
                <button className="iconButton compact" type="button" aria-label="다음 찾기 결과" onClick={() => moveFindResult(1)}>
                  <ChevronDown aria-hidden="true" size={18} />
                </button>
                <button className="findGoButton" type="button" disabled={!activeFindTarget || isComplete} onClick={openActiveFindMatch}>
                  링크 이동
                </button>
                <button className="iconButton compact" type="button" aria-label="문서 내 찾기 닫기" onClick={() => setFindOpen(false)}>
                  <X aria-hidden="true" size={18} />
                </button>
              </section>
            )}

            {isComplete && (
              <section className="finishPanel" aria-label="결과">
                <div>
                  <div className="panelKicker">결과</div>
                  <h2>{formatDuration(elapsedMs)}</h2>
                  <div className="scoreResult">
                    <strong>{resultScore}</strong>
                    {isPractice && <span>연습 기록 제외</span>}
                  </div>
                  <div className="resultMeta" aria-label="결과 설정">
                    <span>
                      모드 <strong>{runModeLabel}</strong>
                    </span>
                    <span>
                      랜덤 여부 <strong>{runRandomLabel}</strong>
                    </span>
                  </div>
                  <p>
                    {clicks}회 클릭 · {routeTimeline}
                  </p>
                </div>
                <div className="finishActions">
                  <button className="secondaryAction" type="button" onClick={copyResult}>
                    <Share2 aria-hidden="true" size={18} />
                    <span>공유 문구</span>
                  </button>
                  <button className="secondaryAction" type="button" onClick={downloadResultImage}>
                    <ImageDown aria-hidden="true" size={18} />
                    <span>결과 저장</span>
                  </button>
                </div>
                {(shareText || resultImageUrl) && (
                  <div className="shareOutput">
                    {shareText && (
                      <output aria-label="공유 문구">
                        <span>공유 문구</span>
                        <strong>{shareText}</strong>
                      </output>
                    )}
                    {resultImageUrl && (
                      <a className="downloadLink" href={resultImageUrl} download="wiki-speed-run-result.png">
                        결과 이미지 다시 받기
                      </a>
                    )}
                  </div>
                )}
              </section>
            )}

            <article className="wikiArticle" aria-labelledby="article-title">
              {isLoading && (
                <div className="browserPlaceholder">
                  <LoaderCircle aria-hidden="true" size={26} />
                  <strong>나무위키 문서 불러오는 중</strong>
                  <span>로컬 백엔드가 랜덤 문서와 본문 링크를 정제하고 있습니다.</span>
                </div>
              )}

              {!isLoading && error && (
                <div className="browserPlaceholder errorText">
                  <AlertTriangle aria-hidden="true" size={26} />
                  <strong>문서를 가져오지 못했습니다</strong>
                  <span>{error}</span>
                </div>
              )}

              {!isLoading && !error && article && (
                <>
                  <div className="articleMeta">
                    <span>namu.wiki</span>
                    <span>{formatDate(article.updated || article.fetchedAt)}</span>
                    <span>{mode.toUpperCase()}</span>
                  </div>
                  <h2 id="article-title">{article.title}</h2>
                  <div className="factStrip" aria-label="문서 메타데이터">
                    {article.facts.map((fact) => (
                      <div className="factCell" key={fact.label}>
                        <span>{fact.label}</span>
                        <strong>{fact.value}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="articleBody">
                    {findResult.blocks.map((block, blockIndex) =>
                      block.type === "heading" ? (
                        <h3 className="articleHeading" key={`${block.text}-${blockIndex}`}>
                          {renderFindParts(block.parts, activeFindIndex)}
                        </h3>
                      ) : (
                        <p key={`${article.title}-${blockIndex}`}>
                          {block.segments.map((segment, segmentIndex) =>
                            segment.kind === "text" ? (
                              <span key={`${segment.value}-${segmentIndex}`}>{renderFindParts(segment.parts, activeFindIndex)}</span>
                            ) : (
                              <button
                                className="articleLink"
                                key={`${segment.to}-${segmentIndex}`}
                                type="button"
                                disabled={isComplete || isNavigating}
                                onClick={() => navigateToArticle(segment.to)}
                              >
                                {renderFindParts(segment.parts, activeFindIndex)}
                              </button>
                            ),
                          )}
                        </p>
                      ),
                    )}
                  </div>
                </>
              )}
            </article>
          </section>

          <aside className="raceRail" aria-label="로컬 현황과 결과">
            <section className="roomPanel">
              <div className="panelHeader">
                <Swords aria-hidden="true" size={18} />
                <h2>로컬 현황</h2>
              </div>
              <div className="roomCodeLine">
                <code>{roomCode}</code>
                <button className="iconButton" type="button" aria-label="세션 코드 복사" onClick={copyRoomCode}>
                  <Copy aria-hidden="true" size={18} />
                </button>
              </div>
              <div className="playerList">
                {racePlayers.map((player) => (
                  <div className={`playerRow ${player.tone}`} key={player.name}>
                    <div>
                      <strong>{player.name}</strong>
                      <span>{player.doc}</span>
                    </div>
                    <div className="progressTrack" aria-label={`${player.name} 진행도`}>
                      <span style={{ width: `${player.progress}%` }} />
                    </div>
                    <em>{player.clicks}</em>
                  </div>
                ))}
              </div>
            </section>

            <section className="routePanel">
              <div className="panelHeader">
                <Trophy aria-hidden="true" size={18} />
                <h2>이동 경로</h2>
              </div>
              <RouteGraph steps={routeSteps} target={challenge?.target ?? ""} />
            </section>

            <section className="leaderboardPanel">
              <div className="panelHeader">
                <Settings2 aria-hidden="true" size={18} />
                <h2>세션 랭킹</h2>
              </div>
              <div className="rankSession">서버 시작 {rankingSessionStartedAt ? formatDate(rankingSessionStartedAt) : "-"}</div>
              <div className="rankingModes" aria-label="랭킹 정렬 기준">
                {(["clicks", "time", "score"] as RankingMode[]).map((item) => (
                  <button
                    className={rankingMode === item ? "rankingMode active" : "rankingMode"}
                    type="button"
                    aria-pressed={rankingMode === item}
                    onClick={() => changeRankingMode(item)}
                    key={item}
                  >
                    {rankingModeLabels[item]}
                  </button>
                ))}
              </div>
              <div className="rankTable" role="table" aria-label="세션 랭킹">
                {leaderboard.length > 0 ? (
                  leaderboard.map((row) => (
                    <div className="rankRow" role="row" key={`${row.name}-${row.rank}-${row.score}`}>
                      <span role="cell">{row.rank}</span>
                      <strong role="cell">{row.name}</strong>
                      <span role="cell">{row.clicks}</span>
                      <code role="cell">{row.score}</code>
                    </div>
                  ))
                ) : (
                  <div className="emptyRank">완주 기록 없음</div>
                )}
              </div>
            </section>

            <div className="statusToast" aria-live="polite">
              <RotateCcw aria-hidden="true" size={16} />
              <span>{shareState}</span>
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}

type MetricProps = {
  icon: LucideIcon;
  label: string;
  value: string;
  accent: "amber" | "cyan" | "paper";
  mono?: boolean;
};

function Metric({ icon: Icon, label, value, accent, mono = false }: MetricProps) {
  return (
    <div className={`metric ${accent}`}>
      <Icon aria-hidden="true" size={19} />
      <span>{label}</span>
      <strong className={mono ? "mono" : ""}>{value}</strong>
    </div>
  );
}

function RouteGraph({ steps, target }: { steps: RouteStep[]; target: string }) {
  const graphSteps = steps.length > 0 ? steps : [];
  const rowGap = 58;
  const firstY = 36;
  const height = Math.max(146, firstY * 2 + Math.max(0, graphSteps.length - 1) * rowGap);

  if (graphSteps.length === 0) {
    return <div className="emptyRank">경로 대기</div>;
  }

  return (
    <svg className="routeGraph topDown" viewBox={`0 0 640 ${height}`} role="img" aria-label={formatRouteSteps(graphSteps)}>
      {graphSteps.slice(1).map((step, index) => {
        const y1 = firstY + index * rowGap + 20;
        const y2 = firstY + (index + 1) * rowGap - 20;

        return (
          <line
            className={step.action === "back" ? "routeLine backLine" : "routeLine"}
            x1="50"
            x2="50"
            y1={y1}
            y2={y2}
            key={`line-${step.title}-${step.action}-${index}`}
          />
        );
      })}

      {graphSteps.map((step, index) => {
        const y = firstY + index * rowGap;
        const isTarget = step.title === target;
        const isBack = step.action === "back";
        const stepClass = `${isTarget ? " targetStep" : ""}${isBack ? " backStep" : ""}`;

        return (
          <g className="routeStep" key={`${step.title}-${step.action}-${index}`}>
            <rect className={`routeStepNumber${stepClass}`} x="24" y={y - 18} width="52" height="36" rx="4" />
            <text className={`routeStepIndex${stepClass}`} x="50" y={y + 7} textAnchor="middle">
              {String(index + 1).padStart(2, "0")}
            </text>
            <text className={`routeActionLabel${stepClass}`} x="96" y={y - 2}>
              {routeActionLabels[step.action]}
            </text>
            <text className="routeTitle" x="154" y={y + 18}>
              {step.title.length > 22 ? `${step.title.slice(0, 22)}...` : step.title}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

export { App };
