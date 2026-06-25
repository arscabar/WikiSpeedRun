import {
  AlertTriangle,
  ArrowLeft,
  Award,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Eye,
  Flag,
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

type Mode = "daily" | "infinite" | "room";

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

type CompletionRecord = {
  id: string;
  playerName: string;
  start: string;
  target: string;
  clicks: number;
  elapsedMs: number;
  score: number;
  title: string;
  completedAt: string;
  path: string[];
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
  daily: "오늘의 도전",
  infinite: "무한 모드",
  room: "사설 방",
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

function getScoreTitle(score: number) {
  if (score >= 90000) {
    return "레전드 러너";
  }
  if (score >= 75000) {
    return "스피드러너";
  }
  if (score >= 55000) {
    return "루트 파인더";
  }
  if (score >= 30000) {
    return "완주자";
  }
  return "기록 보존";
}

function readStoredRecords() {
  try {
    return JSON.parse(localStorage.getItem("wsr.records") ?? "[]") as CompletionRecord[];
  } catch {
    return [];
  }
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
  const [mode, setMode] = useState<Mode>("daily");
  const [playerName, setPlayerName] = useState(() => localStorage.getItem("wsr.playerName") ?? "PlayerA");
  const [rankingMode, setRankingMode] = useState<RankingMode>(
    () => (localStorage.getItem("wsr.rankingMode") as RankingMode | null) ?? "clicks",
  );
  const [records, setRecords] = useState<CompletionRecord[]>(readStoredRecords);
  const [isEntered, setIsEntered] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [article, setArticle] = useState<ApiArticle | null>(null);
  const [currentTitle, setCurrentTitle] = useState("");
  const [history, setHistory] = useState<string[]>([]);
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
  const clicks = Math.max(0, history.length - 1);
  const liveScore = calculateScore(elapsedMs, clicks);
  const liveScoreTitle = getScoreTitle(liveScore);
  const currentRecord = challenge
    ? records.find((record) => record.start === challenge.start && record.target === challenge.target)
    : undefined;
  const roomCode = "WIKI-4827";
  const normalizedFindQuery = findQuery.trim();

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

  const loadArticle = useCallback(async (title: string) => {
    return readJson<ApiArticle>(`/api/article?title=${encodeURIComponent(title)}`);
  }, []);

  const startChallenge = useCallback(
    async (nextMode: Mode, useOverride = false) => {
      setIsLoading(true);
      setError("");
      setShareState("제시어 생성 중");

      try {
        const nextChallenge = await readJson<Challenge>(
          `/api/challenge?mode=${nextMode}${useOverride ? getChallengeOverrideParams() : ""}`,
        );
        const startArticle = await loadArticle(nextChallenge.start);

        setChallenge(nextChallenge);
        setArticle(startArticle);
        setCurrentTitle(nextChallenge.start);
        setHistory([nextChallenge.start]);
        setStartedAt(Date.now());
        setElapsedMs(0);
        setShareText("");
        setResultImageUrl("");
        setFindQuery("");
        setActiveFindIndex(-1);
        setShareState("제시어 자동 설정됨");
        window.history.replaceState({ view: "race", title: nextChallenge.start }, "", window.location.href);
        window.setTimeout(() => setShareState("대기"), 1400);
      } catch (challengeError) {
        setError(challengeError instanceof Error ? challengeError.message : String(challengeError));
        setShareState("제시어 생성 실패");
      } finally {
        setIsLoading(false);
      }
    },
    [loadArticle],
  );

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
        title: record.title,
      })),
    [sortedRecords],
  );
  const bestScore = records.length > 0 ? Math.max(...records.map((record) => record.score)) : 0;
  const bestTime = records.length > 0 ? Math.min(...records.map((record) => record.elapsedMs)) : 0;

  const saveCompletionRecord = useCallback(
    (finalElapsedMs: number, finalHistory: string[]) => {
      if (!challenge) {
        return;
      }

      const finalClicks = Math.max(0, finalHistory.length - 1);
      const score = calculateScore(finalElapsedMs, finalClicks);
      const title = getScoreTitle(score);
      const record: CompletionRecord = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        playerName: playerName || "Player",
        start: challenge.start,
        target: challenge.target,
        clicks: finalClicks,
        elapsedMs: finalElapsedMs,
        score,
        title,
        completedAt: new Date().toISOString(),
        path: finalHistory,
      };

      setRecords((items) => {
        const next = [record, ...items].slice(0, 50);
        localStorage.setItem("wsr.records", JSON.stringify(next));
        return next;
      });
    },
    [challenge, playerName],
  );

  const enterGame = async () => {
    const cleanName = playerName.trim() || "PlayerA";
    setPlayerName(cleanName);
    localStorage.setItem("wsr.playerName", cleanName);
    setIsEntered(true);
    await startChallenge(mode, true);
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
    setCurrentTitle("");
    setHistory([]);
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
      setArticle(startArticle);
      setCurrentTitle(challenge.start);
      setHistory([challenge.start]);
      setStartedAt(Date.now());
      setElapsedMs(0);
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
    if (history.length <= 1 || isLoading || isNavigating) {
      return;
    }

    const nextHistory = history.slice(0, -1);
    const previousTitle = nextHistory[nextHistory.length - 1];

    setIsNavigating(true);
    setError("");

    try {
      const previousArticle = await loadArticle(previousTitle);
      setArticle(previousArticle);
      setCurrentTitle(previousTitle);
      setHistory(nextHistory);
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
  }, [history, isLoading, isNavigating, loadArticle]);

  const navigateToArticle = async (title: string) => {
    if (!article || !challenge || isComplete || isNavigating) {
      return;
    }

    setIsNavigating(true);
    setError("");

    try {
      const event = await readJson<{ allowed: boolean; error?: string }>("/api/run/event", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ from: article.title, to: title }),
      });

      if (!event.allowed) {
        setShareState("서버 검증 실패");
        return;
      }

      const nextArticle = await loadArticle(title);
      const nextHistory = [...history, title];
      const finalElapsedMs = Date.now() - startedAt;

      setArticle(nextArticle);
      setCurrentTitle(title);
      setHistory(nextHistory);
      setFindQuery("");
      setActiveFindIndex(-1);
      window.history.pushState({ view: "race", title }, "", window.location.href);

      if (title === challenge.target) {
        setElapsedMs(finalElapsedMs);
        saveCompletionRecord(finalElapsedMs, nextHistory);
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
    setShareState(copied ? "방 코드 복사됨" : `방 코드 ${roomCode}`);
    window.setTimeout(() => setShareState("대기"), 1400);
  };

  const copyResult = async () => {
    if (!challenge) {
      return;
    }

    const message = [
      "나무위키 스피드런",
      `${challenge.start} -> ${challenge.target}`,
      `${formatDuration(elapsedMs)} · ${clicks}클릭 · ${currentRecord?.score ?? liveScore}점 · ${
        currentRecord?.title ?? liveScoreTitle
      }`,
      `경로: ${history.join(" -> ")}`,
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
    context.fillText(`${currentRecord?.score ?? liveScore} points · ${currentRecord?.title ?? liveScoreTitle}`, 76, 316);

    const nodeGap = Math.min(184, 980 / Math.max(1, history.length - 1));
    const startX = 90;
    const y = 420;
    context.strokeStyle = "#00a495";
    context.lineWidth = 5;
    context.beginPath();
    history.forEach((_, index) => {
      const x = startX + nodeGap * index;
      if (index === 0) {
        context.moveTo(x, y);
      } else {
        context.lineTo(x, y);
      }
    });
    context.stroke();

    history.forEach((item, index) => {
      const x = startX + nodeGap * index;
      context.fillStyle = item === challenge.target ? "#00a495" : "#ffffff";
      context.strokeStyle = item === challenge.target ? "#008275" : "#9aa4aa";
      context.lineWidth = 4;
      context.beginPath();
      context.arc(x, y, 18, 0, Math.PI * 2);
      context.fill();
      context.stroke();

      context.fillStyle = "#202122";
      context.font = "600 22px Noto Sans KR, sans-serif";
      context.fillText(item.slice(0, 10), x - 30, y + 62);
    });

    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    const imageUrl = blob ? URL.createObjectURL(blob) : canvas.toDataURL("image/png");
    setResultImageUrl(imageUrl);
    setShareState("이미지 준비됨");
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

        <nav className="modeTabs" aria-label="게임 모드">
          {(["daily", "infinite", "room"] as Mode[]).map((item) => (
            <button
              className={mode === item ? "tabButton active" : "tabButton"}
              type="button"
              aria-pressed={mode === item}
              onClick={() => switchMode(item)}
              key={item}
            >
              {item === "daily" && <Flag aria-hidden="true" size={18} />}
              {item === "infinite" && <Shuffle aria-hidden="true" size={18} />}
              {item === "room" && <Users aria-hidden="true" size={18} />}
              <span>{modeLabels[item]}</span>
            </button>
          ))}
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
            <div className="entryTelemetry" aria-label="로컬 기록 요약">
              <div>
                <span>최고 점수</span>
                <strong>{bestScore || "-"}</strong>
              </div>
              <div>
                <span>최고 시간</span>
                <strong>{bestTime ? formatDuration(bestTime) : "--:--:--"}</strong>
              </div>
              <div>
                <span>완주 기록</span>
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
                <h2>로컬 랭킹</h2>
              </div>
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
              <Metric icon={Trophy} label="칭호" value={currentRecord?.title ?? liveScoreTitle} accent="cyan" />
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
                {history.map((item, index) => (
                  <li key={`${item}-${index}`} className={index === history.length - 1 ? "current" : ""}>
                    <span>{String(index).padStart(2, "0")}</span>
                    <strong>{item}</strong>
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
                    <strong>{currentRecord?.score ?? liveScore}</strong>
                    <span>{currentRecord?.title ?? liveScoreTitle}</span>
                  </div>
                  <p>
                    {clicks}회 클릭 · {history.join(" → ")}
                  </p>
                </div>
                <div className="finishActions">
                  <button className="secondaryAction" type="button" onClick={copyResult}>
                    <Share2 aria-hidden="true" size={18} />
                    <span>공유 문구</span>
                  </button>
                  <button className="secondaryAction" type="button" onClick={downloadResultImage}>
                    <ImageDown aria-hidden="true" size={18} />
                    <span>결과 이미지</span>
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
                        결과 이미지 받기
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

          <aside className="raceRail" aria-label="멀티플레이와 결과">
            <section className="roomPanel">
              <div className="panelHeader">
                <Swords aria-hidden="true" size={18} />
                <h2>사설 방</h2>
              </div>
              <div className="roomCodeLine">
                <code>{roomCode}</code>
                <button className="iconButton" type="button" aria-label="방 코드 복사" onClick={copyRoomCode}>
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
              <RouteGraph history={history} target={challenge?.target ?? ""} />
            </section>

            <section className="leaderboardPanel">
              <div className="panelHeader">
                <Settings2 aria-hidden="true" size={18} />
                <h2>로컬 랭킹</h2>
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
              <div className="rankTable" role="table" aria-label="로컬 랭킹">
                {leaderboard.length > 0 ? (
                  leaderboard.map((row) => (
                    <div className="rankRow" role="row" key={`${row.name}-${row.rank}-${row.score}`}>
                      <span role="cell">{row.rank}</span>
                      <strong role="cell">{row.name}</strong>
                      <span role="cell">{row.clicks}</span>
                      <code role="cell">{row.score}</code>
                      <em role="cell">{row.title}</em>
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

function RouteGraph({ history, target }: { history: string[]; target: string }) {
  const nodeCount = Math.max(history.length, 2);
  const points = history.map((title, index) => ({
    title,
    x: 38 + (index * 564) / (nodeCount - 1),
    y: index % 2 === 0 ? 72 : 112,
  }));

  const linePoints = points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <svg className="routeGraph" viewBox="0 0 640 184" role="img" aria-label={`${history.join("에서 ")} 경로`}>
      <polyline className="routeLine" points={linePoints} />
      {points.map((point, index) => (
        <g key={`${point.title}-${index}`}>
          <circle className={point.title === target ? "targetNode" : "routeNode"} cx={point.x} cy={point.y} r="12" />
          <text x={point.x} y={point.y + 34} textAnchor="middle">
            {point.title.length > 10 ? `${point.title.slice(0, 10)}...` : point.title}
          </text>
        </g>
      ))}
    </svg>
  );
}

export { App };
