import {
  AlertTriangle,
  ArrowLeft,
  Award,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Download,
  Eye,
  ExternalLink,
  FileJson,
  GitBranch,
  Globe2,
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
  Trash2,
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
    }
  | {
      type: "toc";
      items: TocItem[];
    };

type ApiArticle = {
  title: string;
  sourceUrl: string;
  updated: string;
  fetchedAt: string;
  blocks: ArticleBlock[];
  outgoingLinks: string[];
  backlinkSources: string[];
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
type RankingModeFilter = "all" | Mode;
type RankingRandomFilter = "all" | "standard" | "allRandom";
type RankingPlayerFilter = "all" | "mine";
type ResultImageStyle = "wiki" | "scoreboard" | "route";

type RunMeta = {
  mode: Mode;
  allRandom: boolean;
};

type RouteStep = {
  title: string;
  action: "start" | "link" | "backlink" | "back";
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
  runId?: string;
  playerId?: string;
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

type ShareLinkResponse = {
  sessionStartedAt: string;
  localUrl: string;
  externalUrl: string;
  provider: string;
  updatedAt: string;
  status: "local-only" | "external-online";
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

type TocItem = {
  number: string;
  label: string;
  level: number;
  anchor?: string;
};

type RenderTocItem = TocItem & {
  numberParts: FindPart[];
  labelParts: FindPart[];
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
    }
  | {
      type: "toc";
      items: RenderTocItem[];
    };

const fairnessItems = [
  { icon: SearchX, label: "주소 검색 잠금", state: "LOCK" },
  { icon: ArrowLeft, label: "뒤로가기 허용", state: "ON" },
  { icon: Search, label: "본문 찾기", state: "ON" },
  { icon: LockKeyhole, label: "링크/역링크만", state: "ON" },
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
  backlink: "역링크",
  back: "뒤로",
};

const rankingModeLabels: Record<RankingMode, string> = {
  clicks: "클릭 우선",
  time: "시간 우선",
  score: "점수 우선",
};

const rankingModeFilterLabels: Record<RankingModeFilter, string> = {
  all: "전체 모드",
  casual: "캐주얼",
  practice: "연습",
};

const rankingRandomFilterLabels: Record<RankingRandomFilter, string> = {
  all: "전체 랜덤",
  standard: "일반",
  allRandom: "아예랜덤",
};

const rankingPlayerFilterLabels: Record<RankingPlayerFilter, string> = {
  all: "전체 플레이어",
  mine: "내 기록",
};

const resultImageStyleLabels: Record<ResultImageStyle, string> = {
  wiki: "위키 카드",
  scoreboard: "랭킹 카드",
  route: "경로 카드",
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

  if (step.action === "back") {
    return `↩ ${step.title}`;
  }

  if (step.action === "backlink") {
    return `↗ ${step.title}`;
  }

  return step.title;
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

function readStoredOption<T extends string>(key: string, fallback: T, allowed: readonly T[]) {
  const value = localStorage.getItem(key);
  return value && allowed.includes(value as T) ? (value as T) : fallback;
}

function downloadTextFile(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsvCell(value: string | number | boolean) {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function makeRankingsCsv(records: CompletionRecord[]) {
  const header = ["rank", "player", "mode", "random", "start", "target", "clicks", "time", "score", "completedAt", "route"];
  const rows = records.map((record, index) => [
    index + 1,
    record.playerName,
    modeLabels[record.mode],
    record.allRandom ? randomRunLabels.allRandom : randomRunLabels.standard,
    record.start,
    record.target,
    record.clicks,
    formatDuration(record.elapsedMs),
    record.score,
    record.completedAt,
    record.routeSteps
      ? record.routeSteps.map((step, stepIndex) => formatNumberedRouteStep(step, stepIndex)).join(" -> ")
      : record.path.join(" -> "),
  ]);

  return [header, ...rows].map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

function truncateCanvasText(context: CanvasRenderingContext2D, text: string, maxWidth: number) {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }

  let output = text;
  while (output.length > 1 && context.measureText(`${output}...`).width > maxWidth) {
    output = output.slice(0, -1);
  }
  return `${output}...`;
}

function drawCanvasPill(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  label: string,
  fill = "#ffffff",
  stroke = "#d8dee3",
  color = "#008275",
) {
  const width = Math.max(96, context.measureText(label).width + 28);
  context.fillStyle = fill;
  context.strokeStyle = stroke;
  context.lineWidth = 2;
  context.fillRect(x, y, width, 36);
  context.strokeRect(x, y, width, 36);
  context.fillStyle = color;
  context.fillText(label, x + 14, y + 24);
  return width;
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
    () => readStoredOption<RankingMode>("wsr.rankingMode", "clicks", ["clicks", "time", "score"]),
  );
  const [rankingModeFilter, setRankingModeFilter] = useState<RankingModeFilter>(
    () => readStoredOption<RankingModeFilter>("wsr.rankingModeFilter", "all", ["all", "casual", "practice"]),
  );
  const [rankingRandomFilter, setRankingRandomFilter] = useState<RankingRandomFilter>(
    () => readStoredOption<RankingRandomFilter>("wsr.rankingRandomFilter", "all", ["all", "standard", "allRandom"]),
  );
  const [rankingPlayerFilter, setRankingPlayerFilter] = useState<RankingPlayerFilter>(
    () => readStoredOption<RankingPlayerFilter>("wsr.rankingPlayerFilter", "all", ["all", "mine"]),
  );
  const [resultImageStyle, setResultImageStyle] = useState<ResultImageStyle>(
    () => readStoredOption<ResultImageStyle>("wsr.resultImageStyle", "wiki", ["wiki", "scoreboard", "route"]),
  );
  const [records, setRecords] = useState<CompletionRecord[]>([]);
  const [lastCompletedRecord, setLastCompletedRecord] = useState<CompletionRecord | null>(null);
  const [rankingSessionStartedAt, setRankingSessionStartedAt] = useState("");
  const [shareLink, setShareLink] = useState<ShareLinkResponse | null>(null);
  const [shareLinkError, setShareLinkError] = useState("");
  const [isRestoringRun, setIsRestoringRun] = useState(false);
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

      if (block.type === "toc") {
        return {
          ...block,
          items: block.items.map((item) => ({
            ...item,
            numberParts: createParts(item.number),
            labelParts: createParts(item.label),
          })),
        };
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

  const fetchShareLink = useCallback(async () => {
    try {
      const payload = await readJson<ShareLinkResponse>("/api/share-link");
      setShareLink(payload);
      setShareLinkError("");
    } catch (shareError) {
      setShareLinkError(shareError instanceof Error ? shareError.message : "링크 상태 확인 실패");
    }
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

    if (run.status === "running") {
      localStorage.setItem("wsr.activeRunId", run.id);
    } else {
      localStorage.removeItem("wsr.activeRunId");
    }
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
        setLastCompletedRecord(null);
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

  const restoreActiveRun = useCallback(async () => {
    const activeRunId = localStorage.getItem("wsr.activeRunId");

    if (!activeRunId || isEntered) {
      return;
    }

    setIsRestoringRun(true);
    setShareState("진행 복구 중");

    try {
      const payload = await readJson<RunResponse>(`/api/runs/${encodeURIComponent(activeRunId)}`);
      const restoredArticle = await loadArticle(payload.run.currentTitle);
      const restoredChallenge: Challenge = {
        start: payload.run.start,
        target: payload.run.target,
        label: payload.run.status === "finished" ? "복구된 완주 기록" : "복구된 제시어",
        generatedAt: payload.run.startedAt,
        source: "server-run-restore",
      };

      setPlayerId(payload.run.playerId);
      setPlayerName(payload.run.playerName);
      localStorage.setItem("wsr.playerId", payload.run.playerId);
      localStorage.setItem("wsr.playerName", payload.run.playerName);
      setMode(payload.run.mode);
      setRunMeta({ mode: payload.run.mode, allRandom: payload.run.allRandom });
      setChallenge(restoredChallenge);
      setArticle(restoredArticle);
      setLastCompletedRecord(payload.run.record);
      setIsEntered(true);
      setFindQuery("");
      setActiveFindIndex(-1);
      applyServerRun(payload.run);
      setShareState(payload.run.status === "finished" ? "완주 기록 복구됨" : "진행 복구됨");
      window.setTimeout(() => setShareState("대기"), 1600);
    } catch {
      localStorage.removeItem("wsr.activeRunId");
      setShareState("복구할 진행 없음");
      window.setTimeout(() => setShareState("대기"), 1600);
    } finally {
      setIsRestoringRun(false);
    }
  }, [applyServerRun, isEntered, loadArticle]);

  useEffect(() => {
    void fetchRankings();

    const id = window.setInterval(() => {
      void fetchRankings();
    }, 5000);

    return () => window.clearInterval(id);
  }, [fetchRankings]);

  useEffect(() => {
    void fetchShareLink();

    const id = window.setInterval(() => {
      void fetchShareLink();
    }, 3000);

    return () => window.clearInterval(id);
  }, [fetchShareLink]);

  useEffect(() => {
    void restoreActiveRun();
  }, [restoreActiveRun]);

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

  const filteredRecords = useMemo(
    () =>
      records.filter((record) => {
        const modeMatches = rankingModeFilter === "all" || record.mode === rankingModeFilter;
        const randomMatches =
          rankingRandomFilter === "all" ||
          (rankingRandomFilter === "allRandom" ? record.allRandom : !record.allRandom);
        const playerMatches = rankingPlayerFilter === "all" || record.playerName === playerName;

        return modeMatches && randomMatches && playerMatches;
      }),
    [playerName, rankingModeFilter, rankingPlayerFilter, rankingRandomFilter, records],
  );
  const allSortedRecords = useMemo(() => sortRecords(records, rankingMode), [rankingMode, records]);
  const sortedRecords = useMemo(() => sortRecords(filteredRecords, rankingMode), [filteredRecords, rankingMode]);
  const leaderboard = useMemo(
    () =>
      sortedRecords.slice(0, 8).map((record, index) => ({
        rank: index + 1,
        name: record.playerName,
        clicks: record.clicks,
        time: formatDuration(record.elapsedMs),
        score: record.score,
        modeLabel: modeLabels[record.mode],
        randomLabel: record.allRandom ? randomRunLabels.allRandom : randomRunLabels.standard,
        route: `${record.start} → ${record.target}`,
      })),
    [sortedRecords],
  );
  const rankingSummary = useMemo(
    () => ({
      total: records.length,
      visible: filteredRecords.length,
      casual: records.filter((record) => record.mode === "casual").length,
      allRandom: records.filter((record) => record.allRandom).length,
    }),
    [filteredRecords.length, records],
  );
  const currentRecordRank = useMemo(() => {
    if (!lastCompletedRecord) {
      return 0;
    }

    return allSortedRecords.findIndex((record) => record.id === lastCompletedRecord.id) + 1;
  }, [allSortedRecords, lastCompletedRecord]);
  const resultRecordStatus = isPractice ? "연습 기록 제외" : currentRecordRank > 0 ? `세션 ${currentRecordRank}위` : "세션 기록";
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

  const changeRankingModeFilter = (nextFilter: RankingModeFilter) => {
    setRankingModeFilter(nextFilter);
    localStorage.setItem("wsr.rankingModeFilter", nextFilter);
  };

  const changeRankingRandomFilter = (nextFilter: RankingRandomFilter) => {
    setRankingRandomFilter(nextFilter);
    localStorage.setItem("wsr.rankingRandomFilter", nextFilter);
  };

  const changeRankingPlayerFilter = (nextFilter: RankingPlayerFilter) => {
    setRankingPlayerFilter(nextFilter);
    localStorage.setItem("wsr.rankingPlayerFilter", nextFilter);
  };

  const changeResultImageStyle = (nextStyle: ResultImageStyle) => {
    setResultImageStyle(nextStyle);
    localStorage.setItem("wsr.resultImageStyle", nextStyle);
  };

  const exportRankingsJson = () => {
    const payload = {
      exportedAt: new Date().toISOString(),
      filters: {
        sort: rankingMode,
        mode: rankingModeFilter,
        random: rankingRandomFilter,
        player: rankingPlayerFilter,
      },
      sessionStartedAt: rankingSessionStartedAt,
      records: sortedRecords,
    };

    downloadTextFile(JSON.stringify(payload, null, 2), `wiki-speed-run-rankings-${Date.now()}.json`, "application/json;charset=utf-8");
    setShareState("랭킹 JSON 저장됨");
    window.setTimeout(() => setShareState("대기"), 1400);
  };

  const exportRankingsCsv = () => {
    downloadTextFile(makeRankingsCsv(sortedRecords), `wiki-speed-run-rankings-${Date.now()}.csv`, "text/csv;charset=utf-8");
    setShareState("랭킹 CSV 저장됨");
    window.setTimeout(() => setShareState("대기"), 1400);
  };

  const resetRankings = async () => {
    const accepted = window.confirm("현재 서버 세션 랭킹을 초기화할까요?");

    if (!accepted) {
      return;
    }

    try {
      const payload = await readJson<RankingResponse>("/api/rankings", { method: "DELETE" });
      setRecords(payload.records);
      setRankingSessionStartedAt(payload.sessionStartedAt);
      setShareState("세션 랭킹 초기화");
      window.setTimeout(() => setShareState("대기"), 1400);
    } catch (resetError) {
      setShareState(resetError instanceof Error ? resetError.message : "초기화 실패");
      window.setTimeout(() => setShareState("대기"), 1800);
    }
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
    setLastCompletedRecord(null);
    setFindOpen(false);
    setFindQuery("");
    setActiveFindIndex(-1);
    setShareState("대기");
    localStorage.removeItem("wsr.activeRunId");
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
      setLastCompletedRecord(null);
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
      setLastCompletedRecord(null);
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

  const navigateToArticle = async (title: string, via: "link" | "backlink" = "link") => {
    if (!article || !challenge || !runId || isComplete || isNavigating) {
      return;
    }

    setIsNavigating(true);
    setError("");

    try {
      const event = await readJson<RunResponse>(`/api/runs/${encodeURIComponent(runId)}/link`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ to: title, via }),
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
        setLastCompletedRecord(event.ranking?.record ?? event.run.record);

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

  const copyAccessLink = async (kind: "external" | "local") => {
    const url = kind === "external" ? shareLink?.externalUrl : shareLink?.localUrl;
    const label = kind === "external" ? "외부 링크" : "로컬 링크";

    if (!url) {
      setShareState(kind === "external" ? "외부 링크 대기" : "로컬 링크 없음");
      window.setTimeout(() => setShareState("대기"), 1400);
      return;
    }

    const message = [`나무위키 스피드런 ${label}`, url, `세션 코드: ${roomCode}`].join("\n");
    const copied = await copyTextToClipboard(message);
    setShareState(copied ? `${label} 복사됨` : `${label} 준비됨`);
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

    const graphSteps = routeSteps.length > 0 ? routeSteps : createRouteStepsFromTitles(history);
    const safePlayerName = playerName.trim() || "PlayerA";
    const generatedAt = new Date().toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const titleText = `${challenge.start} -> ${challenge.target}`;
    const metaText = `모드 ${runModeLabel} · 랜덤 여부 ${runRandomLabel} · ${resultRecordStatus}`;

    const drawHeader = (accent = "#00a495", dark = false) => {
      context.fillStyle = dark ? "#ffffff" : accent;
      context.font = "800 38px Noto Sans KR, sans-serif";
      context.fillText("나무위키 스피드런", 76, 112);
      context.font = "600 22px Noto Sans KR, sans-serif";
      context.fillStyle = dark ? "rgba(255,255,255,0.78)" : "#54595d";
      context.fillText(generatedAt, 76, 146);
    };

    const drawMetric = (x: number, y: number, label: string, value: string, accent = "#00a495") => {
      context.fillStyle = "#54595d";
      context.font = "700 20px Noto Sans KR, sans-serif";
      context.fillText(label, x, y);
      context.fillStyle = accent;
      context.font = "800 34px JetBrains Mono, monospace";
      context.fillText(value, x, y + 42);
    };

    const drawRouteLog = (x: number, y: number, maxRows = 7, rowGap = 52, textWidth = 330) => {
      const imageSteps =
        graphSteps.length > maxRows ? [...graphSteps.slice(0, maxRows - 1), graphSteps[graphSteps.length - 1]] : graphSteps;
      const skippedSteps = graphSteps.length - imageSteps.length;
      const badgeWidth = 50;

      imageSteps.forEach((step, displayIndex) => {
        const originalIndex = skippedSteps > 0 && displayIndex === imageSteps.length - 1 ? graphSteps.length - 1 : displayIndex;
        const rowY = y + displayIndex * rowGap;
        const previousY = y + (displayIndex - 1) * rowGap;
        const isTarget = step.title === challenge.target;
        const isBack = step.action === "back";

        if (displayIndex > 0) {
          context.strokeStyle = isBack ? "#899197" : "#00a495";
          context.lineWidth = isBack ? 3 : 4;
          context.setLineDash(isBack ? [8, 8] : []);
          context.beginPath();
          context.moveTo(x + badgeWidth / 2, previousY + 18);
          context.lineTo(x + badgeWidth / 2, rowY - 18);
          context.stroke();
          context.setLineDash([]);
        }

        if (skippedSteps > 0 && displayIndex === imageSteps.length - 1) {
          context.fillStyle = "#6b7278";
          context.font = "700 18px Noto Sans KR, sans-serif";
          context.fillText(`+${skippedSteps}단계`, x + 66, rowY - 32);
        }

        context.fillStyle = isTarget ? "#00a495" : isBack ? "#f1f3f5" : "#ffffff";
        context.strokeStyle = isTarget ? "#008275" : isBack ? "#899197" : "#9aa4aa";
        context.lineWidth = 3;
        context.fillRect(x, rowY - 18, badgeWidth, 36);
        context.strokeRect(x, rowY - 18, badgeWidth, 36);

        context.fillStyle = isTarget ? "#ffffff" : "#202122";
        context.font = "800 18px JetBrains Mono, monospace";
        context.fillText(String(originalIndex + 1).padStart(2, "0"), x + 11, rowY + 7);

        context.fillStyle = isBack ? "#6b7278" : "#008275";
        context.font = "800 18px Noto Sans KR, sans-serif";
        context.fillText(routeActionLabels[step.action], x + 66, rowY - 2);

        context.fillStyle = "#202122";
        context.font = "700 22px Noto Sans KR, sans-serif";
        context.fillText(truncateCanvasText(context, step.title, textWidth), x + 124, rowY + 8);
      });
    };

    if (resultImageStyle === "scoreboard") {
      context.fillStyle = "#f5f6f7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#00a495";
      context.fillRect(0, 0, canvas.width, 164);
      drawHeader("#ffffff", true);

      context.fillStyle = "#ffffff";
      context.fillRect(54, 210, 492, 270);
      context.strokeStyle = "#d8dee3";
      context.lineWidth = 2;
      context.strokeRect(54, 210, 492, 270);

      context.fillStyle = "#202122";
      context.font = "800 48px Noto Sans KR, sans-serif";
      context.fillText(truncateCanvasText(context, titleText, 410), 86, 274);
      context.font = "700 24px Noto Sans KR, sans-serif";
      context.fillStyle = "#54595d";
      context.fillText(truncateCanvasText(context, metaText, 420), 86, 318);

      drawMetric(88, 382, "TIME", formatDuration(elapsedMs), "#008275");
      drawMetric(276, 382, "CLICKS", String(clicks), "#008275");
      drawMetric(420, 382, "SCORE", String(resultScore), "#00a495");

      context.fillStyle = "#202122";
      context.font = "800 30px Noto Sans KR, sans-serif";
      context.fillText("세션 랭킹", 620, 232);
      context.font = "700 20px Noto Sans KR, sans-serif";
      context.fillStyle = "#6b7278";
      context.fillText(`플레이어 ${safePlayerName}`, 620, 264);

      const rankingRows = leaderboard.slice(0, 5);
      rankingRows.forEach((row, index) => {
        const rowY = 310 + index * 54;
        const isSelf = row.name === safePlayerName && row.score === resultScore;
        context.fillStyle = isSelf ? "#f0fbf8" : "#ffffff";
        context.strokeStyle = isSelf ? "#00a495" : "#d8dee3";
        context.lineWidth = 2;
        context.fillRect(620, rowY - 32, 500, 44);
        context.strokeRect(620, rowY - 32, 500, 44);

        context.fillStyle = isSelf ? "#00a495" : "#899197";
        context.font = "800 20px JetBrains Mono, monospace";
        context.fillText(String(row.rank).padStart(2, "0"), 640, rowY - 3);
        context.fillStyle = "#202122";
        context.font = "800 20px Noto Sans KR, sans-serif";
        context.fillText(truncateCanvasText(context, row.name, 160), 692, rowY - 4);
        context.fillStyle = "#54595d";
        context.font = "700 17px Noto Sans KR, sans-serif";
        context.fillText(`${row.clicks}클릭 · ${row.time}`, 866, rowY - 4);
        context.fillStyle = "#008275";
        context.font = "800 18px JetBrains Mono, monospace";
        context.fillText(String(row.score), 1010, rowY - 4);
      });
    } else if (resultImageStyle === "route") {
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = "#f0fbf8";
      context.fillRect(0, 0, 420, canvas.height);
      context.strokeStyle = "#00a495";
      context.lineWidth = 6;
      context.strokeRect(42, 42, canvas.width - 84, canvas.height - 84);

      drawHeader();
      context.fillStyle = "#202122";
      context.font = "800 50px Noto Sans KR, sans-serif";
      context.fillText(truncateCanvasText(context, titleText, 320), 76, 232);
      context.font = "700 24px Noto Sans KR, sans-serif";
      context.fillStyle = "#54595d";
      context.fillText(truncateCanvasText(context, metaText, 300), 78, 278);
      context.font = "800 26px JetBrains Mono, monospace";
      context.fillStyle = "#008275";
      context.fillText(`${formatDuration(elapsedMs)} / ${clicks} clicks / ${resultScore}`, 78, 336);

      context.font = "800 28px Noto Sans KR, sans-serif";
      context.fillStyle = "#202122";
      context.fillText("탑다운 이동 그래프", 486, 110);
      drawRouteLog(486, 168, 8, 50, 430);
    } else {
      context.fillStyle = "#f5f6f7";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.strokeStyle = "#00a495";
      context.lineWidth = 6;
      context.strokeRect(42, 42, canvas.width - 84, canvas.height - 84);

      drawHeader();
      context.fillStyle = "#202122";
      context.font = "800 52px Noto Sans KR, sans-serif";
      context.fillText(truncateCanvasText(context, titleText, 570), 76, 214);
      context.font = "700 24px Noto Sans KR, sans-serif";
      context.fillStyle = "#54595d";
      context.fillText(truncateCanvasText(context, metaText, 560), 76, 258);

      context.font = "800 20px Noto Sans KR, sans-serif";
      drawCanvasPill(context, 76, 304, `플레이어 ${safePlayerName}`);
      drawCanvasPill(context, 248, 304, `모드 ${runModeLabel}`);
      drawCanvasPill(context, 382, 304, `랜덤 ${runRandomLabel}`);

      drawMetric(76, 406, "TIME", formatDuration(elapsedMs), "#008275");
      drawMetric(268, 406, "CLICKS", String(clicks), "#008275");
      drawMetric(420, 406, "SCORE", String(resultScore), "#00a495");

      context.fillStyle = "#202122";
      context.font = "800 30px Noto Sans KR, sans-serif";
      context.fillText("이동 로그", 700, 116);
      drawRouteLog(700, 160, 8, 52, 254);
    }

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
          <span>{isRestoringRun ? "복구 중" : isComplete ? "완주" : isEntered ? "진행 중" : "준비"}</span>
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

            <ShareLinkPanel
              shareLink={shareLink}
              error={shareLinkError}
              onRefresh={() => void fetchShareLink()}
              onCopyExternal={() => void copyAccessLink("external")}
              onCopyLocal={() => void copyAccessLink("local")}
            />
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
                    className={`${index === routeSteps.length - 1 ? "current" : ""}${step.action === "back" ? " backStep" : ""}${
                      step.action === "backlink" ? " backlinkStep" : ""
                    }`}
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
                    <span>{resultRecordStatus}</span>
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
                <div className="finishTools">
                  <div className="resultImagePicker" aria-label="결과 이미지 스타일">
                    {(["wiki", "scoreboard", "route"] as ResultImageStyle[]).map((style) => (
                      <button
                        className={resultImageStyle === style ? "resultImageStyle active" : "resultImageStyle"}
                        type="button"
                        aria-pressed={resultImageStyle === style}
                        onClick={() => changeResultImageStyle(style)}
                        key={style}
                      >
                        {resultImageStyleLabels[style]}
                      </button>
                    ))}
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
                  {article.backlinkSources.length > 0 && (
                    <section className="backlinkPanel" aria-label="역링크 이동">
                      <div className="backlinkHeader">
                        <GitBranch aria-hidden="true" size={17} />
                        <strong>역링크</strong>
                        <span>{article.backlinkSources.length}</span>
                      </div>
                      <div className="backlinkList">
                        {article.backlinkSources.slice(0, 48).map((source) => (
                          <button
                            className="backlinkButton"
                            key={source}
                            type="button"
                            aria-label={`역링크로 ${source} 이동`}
                            title={source}
                            disabled={isComplete || isNavigating}
                            onClick={() => navigateToArticle(source, "backlink")}
                          >
                            {source}
                          </button>
                        ))}
                      </div>
                    </section>
                  )}
                  <div className="articleBody">
                    {findResult.blocks.map((block, blockIndex) =>
                      block.type === "heading" ? (
                        <h3 className="articleHeading" key={`${block.text}-${blockIndex}`}>
                          {renderFindParts(block.parts, activeFindIndex)}
                        </h3>
                      ) : block.type === "toc" ? (
                        <nav className="articleToc" aria-label="문서 목차" key={`toc-${article.title}-${blockIndex}`}>
                          <div className="articleTocTitle">목차</div>
                          <ol>
                            {block.items.map((item, itemIndex) => (
                              <li className={`tocLevel${Math.max(1, Math.min(4, item.level))}`} key={`${item.number}-${item.label}-${itemIndex}`}>
                                <span>
                                  {renderFindParts(item.numberParts, activeFindIndex)}
                                  {item.number ? ". " : ""}
                                </span>
                                <strong>{renderFindParts(item.labelParts, activeFindIndex)}</strong>
                              </li>
                            ))}
                          </ol>
                        </nav>
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

            <ShareLinkPanel
              shareLink={shareLink}
              error={shareLinkError}
              onRefresh={() => void fetchShareLink()}
              onCopyExternal={() => void copyAccessLink("external")}
              onCopyLocal={() => void copyAccessLink("local")}
            />

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
              <div className="rankingSummary" aria-label="랭킹 요약">
                <span>
                  표시 <strong>{rankingSummary.visible}</strong>
                </span>
                <span>
                  전체 <strong>{rankingSummary.total}</strong>
                </span>
                <span>
                  캐주얼 <strong>{rankingSummary.casual}</strong>
                </span>
                <span>
                  아예랜덤 <strong>{rankingSummary.allRandom}</strong>
                </span>
              </div>
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
              <div className="rankingFilters" aria-label="랭킹 필터">
                <label className="rankingFilter">
                  <span>모드</span>
                  <select value={rankingModeFilter} onChange={(event) => changeRankingModeFilter(event.target.value as RankingModeFilter)}>
                    {(["all", "casual", "practice"] as RankingModeFilter[]).map((item) => (
                      <option value={item} key={item}>
                        {rankingModeFilterLabels[item]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="rankingFilter">
                  <span>랜덤</span>
                  <select
                    value={rankingRandomFilter}
                    onChange={(event) => changeRankingRandomFilter(event.target.value as RankingRandomFilter)}
                  >
                    {(["all", "standard", "allRandom"] as RankingRandomFilter[]).map((item) => (
                      <option value={item} key={item}>
                        {rankingRandomFilterLabels[item]}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="rankingFilter">
                  <span>플레이어</span>
                  <select
                    value={rankingPlayerFilter}
                    onChange={(event) => changeRankingPlayerFilter(event.target.value as RankingPlayerFilter)}
                  >
                    {(["all", "mine"] as RankingPlayerFilter[]).map((item) => (
                      <option value={item} key={item}>
                        {rankingPlayerFilterLabels[item]}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="rankingTools" aria-label="랭킹 도구">
                <button className="rankingTool" type="button" disabled={sortedRecords.length === 0} onClick={exportRankingsJson}>
                  <FileJson aria-hidden="true" size={16} />
                  <span>JSON</span>
                </button>
                <button className="rankingTool" type="button" disabled={sortedRecords.length === 0} onClick={exportRankingsCsv}>
                  <Download aria-hidden="true" size={16} />
                  <span>CSV</span>
                </button>
                <button className="rankingTool danger" type="button" disabled={records.length === 0} onClick={() => void resetRankings()}>
                  <Trash2 aria-hidden="true" size={16} />
                  <span>초기화</span>
                </button>
              </div>
              <div className="rankTable" role="table" aria-label="세션 랭킹">
                {leaderboard.length > 0 ? (
                  <>
                    <div className="rankHeader" role="row">
                      <span role="columnheader">#</span>
                      <span role="columnheader">플레이어</span>
                      <span role="columnheader">클릭</span>
                      <span role="columnheader">시간</span>
                      <span role="columnheader">점수</span>
                    </div>
                    {leaderboard.map((row) => (
                      <div
                        className={row.name === playerName ? "rankRow self" : "rankRow"}
                        role="row"
                        key={`${row.name}-${row.rank}-${row.route}-${row.score}`}
                      >
                        <span className="rankIndex" role="cell">
                          {row.rank}
                        </span>
                        <div className="rankIdentity" role="cell">
                          <strong>{row.name}</strong>
                          <em>
                            {row.modeLabel} · {row.randomLabel}
                          </em>
                        </div>
                        <span role="cell">{row.clicks}</span>
                        <code role="cell">{row.time}</code>
                        <code role="cell">{row.score}</code>
                      </div>
                    ))}
                  </>
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

type ShareLinkPanelProps = {
  shareLink: ShareLinkResponse | null;
  error: string;
  onRefresh: () => void;
  onCopyExternal: () => void;
  onCopyLocal: () => void;
};

function ShareLinkPanel({ shareLink, error, onRefresh, onCopyExternal, onCopyLocal }: ShareLinkPanelProps) {
  const externalUrl = shareLink?.externalUrl ?? "";
  const localUrl = shareLink?.localUrl ?? "";
  const hasExternalUrl = Boolean(externalUrl);
  const updatedAt = shareLink?.updatedAt ? formatDate(shareLink.updatedAt) : "";

  return (
    <section className={hasExternalUrl ? "shareLinkPanel online" : "shareLinkPanel"} aria-label="외부 접속 링크">
      <div className="panelHeader">
        <Globe2 aria-hidden="true" size={18} />
        <h2>외부 접속</h2>
      </div>
      <div className="shareLinkStatus">
        <span>{shareLink?.provider ? shareLink.provider.toUpperCase() : "LOCAL"}</span>
        <strong>{hasExternalUrl ? "ONLINE" : "대기"}</strong>
      </div>
      <div className="shareLinkUrl" aria-label="외부 접속 주소">
        <span>외부</span>
        <code>{hasExternalUrl ? externalUrl : "Cloudflare 터널을 시작하면 자동 표시"}</code>
      </div>
      {localUrl && (
        <div className="shareLinkLocal" aria-label="로컬 접속 주소">
          <span>로컬</span>
          <code>{localUrl}</code>
        </div>
      )}
      {updatedAt && <p className="shareLinkUpdated">갱신 {updatedAt}</p>}
      {error && <p className="shareLinkError">{error}</p>}
      <div className="shareLinkActions">
        <button className="shareLinkAction strong" type="button" disabled={!hasExternalUrl} onClick={onCopyExternal}>
          <ExternalLink aria-hidden="true" size={16} />
          <span>외부 링크</span>
        </button>
        <button className="shareLinkAction" type="button" disabled={!localUrl} onClick={onCopyLocal}>
          <Copy aria-hidden="true" size={16} />
          <span>로컬</span>
        </button>
        <button className="shareLinkAction" type="button" onClick={onRefresh}>
          <RotateCcw aria-hidden="true" size={16} />
          <span>갱신</span>
        </button>
      </div>
    </section>
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
        const isBacklink = step.action === "backlink";
        const stepClass = `${isTarget ? " targetStep" : ""}${isBack ? " backStep" : ""}${isBacklink ? " backlinkStep" : ""}`;

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
