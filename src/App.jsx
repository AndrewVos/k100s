import { forwardRef, memo, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogBackdrop,
  DialogPanel,
  DialogTitle,
  Tab,
  TabGroup,
  TabList,
  TabPanel,
  TabPanels
} from "@headlessui/react";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import jsonLanguage from "react-syntax-highlighter/dist/esm/languages/prism/json";
import yamlLanguage from "react-syntax-highlighter/dist/esm/languages/prism/yaml";
import { oneLight } from "react-syntax-highlighter/dist/esm/styles/prism";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import {
  layout as layoutText,
  prepareWithSegments as prepareText
} from "@chenglou/pretext";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ArrowDown, ArrowLeft, ArrowUp, Boxes, LoaderCircle, Server, Settings, TerminalSquare, X } from "lucide-react";
import "@xterm/xterm/css/xterm.css";
import "./styles.css";

SyntaxHighlighter.registerLanguage("json", jsonLanguage);
SyntaxHighlighter.registerLanguage("yaml", yamlLanguage);

const fallbackApi = {
  async getContexts() {
    return { contexts: [], current: "" };
  },
  async getNamespaces() {
    return [];
  },
  async getPods() {
    return [];
  },
  async describePod() {
    return "";
  },
  async describeDeployment() {
    return "";
  },
  async cancelKubectlRequest() {},
  async startPodLogs() {},
  async stopPodLogs() {},
  async startPodShell() {},
  async writePodShell() {},
  async resizePodShell() {},
  async stopPodShell() {},
  onPodLogsData() {
    return () => {};
  },
  onPodLogsError() {
    return () => {};
  },
  onPodLogsClosed() {
    return () => {};
  },
  onPodShellData() {
    return () => {};
  },
  onPodShellError() {
    return () => {};
  },
  onPodShellClosed() {
    return () => {};
  }
};
const tauriApi = {
  getContexts: () => invoke("get_contexts"),
  getNamespaces: (context, requestId) => invoke("get_namespaces", { context, requestId }),
  getPods: (context, namespace, requestId) => invoke("get_pods", { context, namespace, requestId }),
  describePod: (context, namespace, podName) => invoke("describe_pod", { context, namespace, podName }),
  describeDeployment: (context, namespace, podName) =>
    invoke("describe_deployment_for_pod", { context, namespace, podName }),
  cancelKubectlRequest: (id) => invoke("cancel_kubectl_request", { id }),
  startPodLogs: (options) => invoke("start_pod_logs", { options }),
  stopPodLogs: (id) => invoke("stop_pod_logs", { id }),
  startPodShell: (options) => invoke("start_pod_shell", { options }),
  writePodShell: (id, data) => invoke("write_pod_shell", { id, data }),
  resizePodShell: (id, cols, rows) => invoke("resize_pod_shell", { id, cols, rows }),
  stopPodShell: (id) => invoke("stop_pod_shell", { id }),
  onPodLogsData: (callback) => {
    const unlisten = listen("kubectl:pod-logs-data", (event) => callback(event.payload));
    return () => {
      unlisten.then((dispose) => dispose());
    };
  },
  onPodLogsError: (callback) => {
    const unlisten = listen("kubectl:pod-logs-error", (event) => callback(event.payload));
    return () => {
      unlisten.then((dispose) => dispose());
    };
  },
  onPodLogsClosed: (callback) => {
    const unlisten = listen("kubectl:pod-logs-closed", (event) => callback(event.payload));
    return () => {
      unlisten.then((dispose) => dispose());
    };
  },
  onPodShellData: (callback) => {
    const unlisten = listen("kubectl:pod-shell-data", (event) => callback(event.payload));
    return () => {
      unlisten.then((dispose) => dispose());
    };
  },
  onPodShellError: (callback) => {
    const unlisten = listen("kubectl:pod-shell-error", (event) => callback(event.payload));
    return () => {
      unlisten.then((dispose) => dispose());
    };
  },
  onPodShellClosed: (callback) => {
    const unlisten = listen("kubectl:pod-shell-closed", (event) => callback(event.payload));
    return () => {
      unlisten.then((dispose) => dispose());
    };
  }
};
const api = "__TAURI_INTERNALS__" in window ? tauriApi : fallbackApi;
const SELECTED_CONTEXT_KEY = "k100s.selectedContext";
const SELECTED_NAMESPACE_KEY = "k100s.selectedNamespace";
const THEME_KEY = "k100s.theme";
const LOG_FONT = "12px Menlo, Monaco, Consolas, monospace";
const LOG_LINE_HEIGHT = 20;
const LOG_ROW_VERTICAL_PADDING = 16;
const LOG_TIMESTAMP_HEADER_HEIGHT = 20;
const LOG_TIME_GAP_HEIGHT = 34;
const LOG_SCROLL_OVERSCAN = 600;
const LOG_CONTENT_HORIZONTAL_PADDING = 32;
const LOG_FOOTER_HEIGHT = 56;
const logMeasurementCache = new Map();

function preparedLogText(text) {
  const value = String(text || " ");
  const cached = logMeasurementCache.get(value);
  if (cached) return cached;

  if (logMeasurementCache.size > 10000) {
    logMeasurementCache.clear();
  }

  const prepared = prepareText(value, LOG_FONT, { whiteSpace: "pre-wrap" });
  logMeasurementCache.set(value, prepared);
  return prepared;
}

function measureLogMessageHeight(message, width) {
  try {
    const contentWidth = Math.max(1, width - LOG_CONTENT_HORIZONTAL_PADDING);
    const result = layoutText(preparedLogText(message), contentWidth, LOG_LINE_HEIGHT);
    return Math.max(LOG_LINE_HEIGHT, Math.ceil(result.height));
  } catch {
    return LOG_LINE_HEIGHT;
  }
}

function formatLogTimeGap(milliseconds) {
  const totalSeconds = Math.round(milliseconds / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s later`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) return seconds ? `${minutes}m ${seconds}s later` : `${minutes}m later`;

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h ${remainingMinutes}m later` : `${hours}h later`;
}

function lowerBound(values, target) {
  let low = 0;
  let high = values.length - 1;

  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (values[mid] < target) low = mid + 1;
    else high = mid;
  }

  return low;
}
const THEME_OPTIONS = ["system", "light", "dark"];

function namespaceStorageKey(context) {
  return `${SELECTED_NAMESPACE_KEY}.${context}`;
}

function getStoredTheme() {
  const storedTheme = window.localStorage.getItem(THEME_KEY);
  return THEME_OPTIONS.includes(storedTheme) ? storedTheme : "system";
}

function resolveTheme(theme) {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  return theme;
}

const initialTheme = resolveTheme(getStoredTheme());
document.documentElement.classList.toggle("dark", initialTheme === "dark");
document.documentElement.style.colorScheme = initialTheme;

function formatAge(creationTimestamp) {
  if (!creationTimestamp) return "Unknown";

  const created = new Date(creationTimestamp).getTime();
  const elapsed = Date.now() - created;
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (elapsed < hour) return `${Math.max(1, Math.floor(elapsed / minute))}m`;
  if (elapsed < day) return `${Math.floor(elapsed / hour)}h`;
  return `${Math.floor(elapsed / day)}d`;
}

function statusTone(status, detail) {
  const value = `${status} ${detail}`.toLowerCase();
  if (value.includes("ready")) {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-800";
  }
  if (value.includes("running")) {
    return "bg-yellow-50 text-yellow-700 ring-yellow-200 dark:bg-yellow-950 dark:text-yellow-300 dark:ring-yellow-800";
  }
  if (value.includes("pending") || value.includes("waiting") || value.includes("containercreating")) {
    return "bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-800";
  }
  if (value.includes("succeeded") || value.includes("completed")) {
    return "bg-sky-50 text-sky-700 ring-sky-200 dark:bg-sky-950 dark:text-sky-300 dark:ring-sky-800";
  }
  if (value.includes("unknown")) {
    return "bg-slate-100 text-slate-700 ring-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:ring-slate-700";
  }
  return "bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-800";
}

const NODE_TONES = [
  { backgroundColor: "#2563eb", color: "#ffffff", borderColor: "#1d4ed8" },
  { backgroundColor: "#16a34a", color: "#ffffff", borderColor: "#15803d" },
  { backgroundColor: "#dc2626", color: "#ffffff", borderColor: "#b91c1c" },
  { backgroundColor: "#9333ea", color: "#ffffff", borderColor: "#7e22ce" },
  { backgroundColor: "#d97706", color: "#ffffff", borderColor: "#b45309" },
  { backgroundColor: "#0891b2", color: "#ffffff", borderColor: "#0e7490" },
  { backgroundColor: "#be185d", color: "#ffffff", borderColor: "#9d174d" },
  { backgroundColor: "#4f46e5", color: "#ffffff", borderColor: "#4338ca" },
  { backgroundColor: "#65a30d", color: "#ffffff", borderColor: "#4d7c0f" },
  { backgroundColor: "#ea580c", color: "#ffffff", borderColor: "#c2410c" },
  { backgroundColor: "#0f766e", color: "#ffffff", borderColor: "#0f5f59" },
  { backgroundColor: "#7c2d12", color: "#ffffff", borderColor: "#641e0a" }
];

function NodePill({ nodeName, tone }) {
  if (!nodeName) {
    return <span className="text-slate-500">Unscheduled</span>;
  }

  return (
    <span
      className="inline-flex max-w-full items-center truncate rounded-full border px-2 py-1 text-xs font-semibold"
      style={tone}
      title={nodeName}
    >
      <span className="truncate">{nodeName}</span>
    </span>
  );
}

function SelectField({ label, value, onChange, disabled, children }) {
  return (
    <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-10 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-400 dark:focus:ring-sky-950 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
      >
        {children}
      </select>
    </label>
  );
}

function EmptyState({ title, message, action }) {
  return (
    <div className="grid min-h-80 place-items-center border-t border-slate-200 bg-white px-6 text-center dark:border-slate-800 dark:bg-slate-950">
      <div>
        <Boxes className="mx-auto mb-3 size-9 text-slate-400" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-950 dark:text-slate-100">{title}</h2>
        <p className="mt-1 max-w-md text-sm text-slate-600 dark:text-slate-400">{message}</p>
        {action ? <div className="mt-4">{action}</div> : null}
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="grid min-h-80 place-items-center border-t border-slate-200 bg-white px-6 text-center dark:border-slate-800 dark:bg-slate-950">
      <LoaderCircle className="size-9 animate-spin text-sky-600" aria-hidden="true" />
    </div>
  );
}

function SortButton({ active, direction, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-full w-full cursor-pointer items-center gap-1 px-4 py-3 text-left text-xs font-semibold uppercase text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100"
    >
      {children}
      {active ? (
        direction === "asc" ? (
          <ArrowUp className="size-3.5" aria-hidden="true" />
        ) : (
          <ArrowDown className="size-3.5" aria-hidden="true" />
        )
      ) : null}
    </button>
  );
}

function parseLogLine(line) {
  const match = line.match(/^(\d{4}-\d{2}-\d{2}T\S+)\s?(.*)$/);

  if (!match) {
    return { timestamp: "", message: line };
  }

  return {
    timestamp: match[1],
    message: match[2]
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightedText({ text, filter }) {
  const query = filter.trim();
  if (!query) return text || " ";

  const parts = String(text || "").split(new RegExp(`(${escapeRegExp(query)})`, "gi"));

  return parts.map((part, index) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={`${part}-${index}`} className="rounded bg-amber-200 px-0.5 text-slate-950">
        {part}
      </mark>
    ) : (
      <span key={`${part}-${index}`}>{part}</span>
    )
  );
}

function createSyntaxStyle(baseStyle) {
  return {
    ...baseStyle,
    'pre[class*="language-"]': {
      ...baseStyle['pre[class*="language-"]'],
      background: "transparent",
      margin: 0,
      padding: 0
    },
    'code[class*="language-"]': {
      ...baseStyle['code[class*="language-"]'],
      background: "transparent",
      fontFamily: "inherit",
      fontSize: "inherit",
      lineHeight: "inherit",
      textShadow: "none"
    }
  };
}

function DescribePanel({ loading, error, text, emptyMessage, failureTitle, syntaxStyle }) {
  if (loading) {
    return (
      <div className="grid h-full place-items-center">
        <LoaderCircle className="size-9 animate-spin text-sky-600" aria-hidden="true" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid h-full place-items-center px-6 text-center">
        <div>
          <h3 className="text-base font-semibold text-slate-950 dark:text-slate-100">{failureTitle}</h3>
          <p className="mt-1 max-w-2xl text-sm text-slate-600 dark:text-slate-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 font-mono text-xs leading-5 text-slate-800 dark:text-slate-200">
      <SyntaxHighlighter
        language="yaml"
        style={syntaxStyle}
        customStyle={{
          background: "transparent",
          margin: 0,
          padding: 0,
          whiteSpace: "pre-wrap",
          overflow: "visible"
        }}
        codeTagProps={{
          style: {
            background: "transparent",
            fontFamily: "inherit",
            fontSize: "inherit",
            lineHeight: "inherit",
            whiteSpace: "pre-wrap"
          }
        }}
      >
        {text || emptyMessage}
      </SyntaxHighlighter>
    </div>
  );
}

const LogMessage = memo(function LogMessage({ message, filter }) {
  return (
    <span className="block min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
      <HighlightedText text={message} filter={filter} />
    </span>
  );
});

const LogRow = memo(function LogRow({
  filter,
  height,
  line,
  onMeasure,
  offset,
  showTimestamps,
  timeGapLabel,
  width
}) {
  const contentRef = useRef(null);

  useLayoutEffect(() => {
    const element = contentRef.current;
    if (!element) return undefined;

    function measure() {
      onMeasure(line.id, element.offsetHeight);
    }

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => observer.disconnect();
  }, [line.id, onMeasure]);

  return (
    <div
      className="absolute left-0 top-0"
      style={{
        height,
        transform: `translateY(${offset}px)`,
        width
      }}
    >
      <div
        ref={contentRef}
        className={`min-w-0 border-b border-slate-100 px-4 py-2 font-mono text-xs leading-5 dark:border-slate-900 ${
          line.level === "error"
            ? "bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200"
            : line.level === "meta"
              ? "text-slate-500 dark:text-slate-400"
              : "text-slate-800 dark:text-slate-200"
        }`}
      >
        {timeGapLabel ? (
          <div className="mb-3 flex items-center gap-3 font-sans text-[11px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-300">
            <span className="h-px flex-1 bg-sky-200 dark:bg-sky-900" />
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 shadow-sm dark:border-sky-800 dark:bg-sky-950">
              {timeGapLabel}
            </span>
            <span className="h-px flex-1 bg-sky-200 dark:bg-sky-900" />
          </div>
        ) : null}
        {showTimestamps && line.timestamp ? (
          <div className="mb-1 text-[11px] font-semibold leading-4 text-slate-500 dark:text-slate-400">
            <HighlightedText text={line.timestamp} filter={filter} />
          </div>
        ) : null}
        <LogMessage message={line.message} filter={filter} />
      </div>
    </div>
  );
});

const LogScrollArea = memo(forwardRef(function LogScrollArea(
  {
    lines,
    totalLineCount,
    filter,
    showTimestamps,
    autoScroll,
    onBottomStateChange,
    onUserScrollIntent
  },
  ref
) {
  const scrollRef = useRef(null);
  const [viewport, setViewport] = useState({ width: 1000, height: 600 });
  const [scrollTop, setScrollTop] = useState(0);
  const [measuredHeights, setMeasuredHeights] = useState(() => new Map());

  const handleRowMeasure = useMemo(
    () => (id, height) => {
      setMeasuredHeights((current) => {
        if (Math.abs((current.get(id) || 0) - height) <= 1) return current;

        const next = new Map(current);
        next.set(id, height);
        return next;
      });
    },
    []
  );

  const metrics = useMemo(() => {
    const offsets = [0];
    const heights = [];
    const timeGapLabels = [];
    let previousTimestampMs = null;

    for (const line of lines) {
      const timestampMs = line.timestamp ? Date.parse(line.timestamp) : Number.NaN;
      const timeGapMs =
        Number.isFinite(timestampMs) && Number.isFinite(previousTimestampMs)
          ? timestampMs - previousTimestampMs
          : 0;
      const timeGapLabel = timeGapMs > 10000 ? formatLogTimeGap(timeGapMs) : "";
      const timeGapHeight = timeGapLabel ? LOG_TIME_GAP_HEIGHT : 0;
      const timestampHeight = showTimestamps && line.timestamp ? LOG_TIMESTAMP_HEADER_HEIGHT : 0;
      const messageHeight = measureLogMessageHeight(line.message, viewport.width);
      const estimatedHeight = LOG_ROW_VERTICAL_PADDING + timeGapHeight + timestampHeight + messageHeight;
      const height = measuredHeights.get(line.id) || estimatedHeight;

      heights.push(height);
      timeGapLabels.push(timeGapLabel);
      offsets.push(offsets[offsets.length - 1] + height);

      if (Number.isFinite(timestampMs)) previousTimestampMs = timestampMs;
    }

    const rowsHeight = offsets[offsets.length - 1] || 0;
    const footerHeight = totalLineCount > 0 ? LOG_FOOTER_HEIGHT : 0;

    return {
      footerHeight,
      heights,
      offsets,
      rowsHeight,
      timeGapLabels,
      totalHeight: rowsHeight + footerHeight
    };
  }, [lines, measuredHeights, showTimestamps, totalLineCount, viewport.width]);

  useEffect(() => {
    setMeasuredHeights((current) => {
      if (current.size === 0) return current;

      const liveIds = new Set(lines.map((line) => line.id));
      let changed = false;
      const next = new Map();

      for (const [id, height] of current) {
        if (liveIds.has(id)) {
          next.set(id, height);
        } else {
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [lines]);

  const visibleRange = useMemo(() => {
    if (lines.length === 0) return { start: 0, end: 0 };
    if (viewport.height === 0) {
      const end = autoScroll ? lines.length : Math.min(lines.length, 200);
      return { start: Math.max(0, end - 200), end };
    }

    const start = Math.max(0, lowerBound(metrics.offsets, scrollTop - LOG_SCROLL_OVERSCAN) - 1);
    const end = Math.min(
      lines.length,
      lowerBound(metrics.offsets, scrollTop + viewport.height + LOG_SCROLL_OVERSCAN) + 1
    );

    return { start, end };
  }, [lines.length, metrics.offsets, scrollTop, viewport.height]);

  useImperativeHandle(ref, () => ({
    scrollToIndex({ index, align = "end" }) {
      const element = scrollRef.current;
      if (!element || lines.length === 0) return;

      const safeIndex = Math.max(0, Math.min(index, lines.length - 1));
      const top = metrics.offsets[safeIndex] || 0;
      const bottom = metrics.offsets[safeIndex + 1] || top;
      const targetBottom = align === "end" && safeIndex === lines.length - 1 ? metrics.totalHeight : bottom;
      element.scrollTop = align === "end" ? Math.max(0, targetBottom - element.clientHeight) : top;
      setScrollTop(element.scrollTop);
    }
  }), [lines.length, metrics.offsets, metrics.totalHeight]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;

    function syncViewport() {
      setViewport({
        width: element.clientWidth,
        height: element.clientHeight
      });
    }

    const observer = new ResizeObserver(syncViewport);
    observer.observe(element);
    syncViewport();

    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !autoScroll) return;

    element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
    setScrollTop(element.scrollTop);
  }, [autoScroll, metrics.totalHeight]);

  function handleScroll(event) {
    const element = event.currentTarget;
    setScrollTop(element.scrollTop);
    onBottomStateChange?.(element.scrollHeight - element.scrollTop - element.clientHeight <= 80);
  }

  if (lines.length === 0) {
    return (
      <div className="grid min-h-0 flex-1 place-items-center bg-white px-4 text-sm text-slate-500 dark:bg-slate-950">
        Waiting for log output...
      </div>
    );
  }

  const visibleItems = [];
  for (let index = visibleRange.start; index < visibleRange.end; index += 1) {
    const line = lines[index];
    if (!line) continue;

    visibleItems.push(
      <LogRow
        key={line.id}
        filter={filter}
        height={metrics.heights[index]}
        line={line}
        offset={metrics.offsets[index]}
        onMeasure={handleRowMeasure}
        showTimestamps={showTimestamps}
        timeGapLabel={metrics.timeGapLabels[index]}
        width="100%"
      />
    );
  }

  return (
    <div
      ref={scrollRef}
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden bg-white dark:bg-slate-950"
      onPointerDown={onUserScrollIntent}
      onTouchMove={onUserScrollIntent}
      onWheel={onUserScrollIntent}
      onScroll={handleScroll}
    >
      <div
        className="relative"
        style={{
          height: metrics.totalHeight,
          minWidth: "100%",
          width: "100%"
        }}
      >
        {visibleItems}
        {totalLineCount > 0 ? (
          <div
            className="absolute left-0 flex w-full items-center gap-3 px-4 py-4 font-sans text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300"
            style={{ height: metrics.footerHeight, top: metrics.rowsHeight }}
          >
            <span className="h-px flex-1 bg-slate-300 dark:bg-slate-700" />
            <span className="rounded-full border border-slate-300 bg-slate-100 px-3 py-1.5 shadow-sm dark:border-slate-700 dark:bg-slate-900">
              {filter ? `${lines.length} matching lines` : "End of logs"}
            </span>
            <span className="h-px flex-1 bg-slate-300 dark:bg-slate-700" />
          </div>
        ) : null}
      </div>
    </div>
  );
}));

function PodDetailsModal({ pod, context, namespace, nodeTone, effectiveTheme, onClose }) {
  const detailTabs = ["Logs", "Pod", "Deployment", "Shell"];
  const [logLines, setLogLines] = useState([]);
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [logFilter, setLogFilter] = useState("");
  const [selectedTabIndex, setSelectedTabIndex] = useState(0);
  const [describeText, setDescribeText] = useState("");
  const [describeLoading, setDescribeLoading] = useState(false);
  const [describeError, setDescribeError] = useState("");
  const [deploymentDescribeText, setDeploymentDescribeText] = useState("");
  const [deploymentDescribeLoading, setDeploymentDescribeLoading] = useState(false);
  const [deploymentDescribeError, setDeploymentDescribeError] = useState("");
  const logLineIdRef = useRef(0);
  const logListRef = useRef(null);
  const logRemainderRef = useRef("");
  const logStreamIdRef = useRef("");
  const logUserScrollIntentRef = useRef(false);
  const bottomStateTimerRef = useRef(null);
  const describeRequestRef = useRef(0);
  const deploymentDescribeRequestRef = useRef(0);
  const syntaxStyle = useMemo(
    () => createSyntaxStyle(effectiveTheme === "dark" ? oneDark : oneLight),
    [effectiveTheme]
  );

  useEffect(() => {
    setSelectedTabIndex(0);
  }, [pod?.name]);

  function handleLogBottomStateChange(isAtBottom) {
    if (bottomStateTimerRef.current) {
      window.clearTimeout(bottomStateTimerRef.current);
      bottomStateTimerRef.current = null;
    }

    if (isAtBottom) {
      logUserScrollIntentRef.current = false;
      setLogAutoScroll(true);
      return;
    }

    if (!logUserScrollIntentRef.current) return;

    bottomStateTimerRef.current = window.setTimeout(() => {
      setLogAutoScroll(false);
      bottomStateTimerRef.current = null;
    }, 350);
  }

  function markLogUserScrollIntent() {
    logUserScrollIntentRef.current = true;
  }

  function appendLogLines(text, level = "log") {
    const content = `${logRemainderRef.current}${text}`;
    const lines = content.split(/\r?\n/);
    logRemainderRef.current = lines.pop() ?? "";

    if (lines.length === 0) return;

    setLogLines((current) => {
      const next = lines.map((line) => ({
        id: `${Date.now()}-${logLineIdRef.current++}`,
        level,
        ...parseLogLine(line)
      }));

      return [...current, ...next].slice(-5000);
    });
  }

  const visibleLogLines = useMemo(() => {
    const filter = logFilter.trim().toLowerCase();
    if (!filter) return logLines;

    return logLines.filter((line) => {
      const value = `${line.timestamp} ${line.message}`.toLowerCase();
      return value.includes(filter);
    });
  }, [logFilter, logLines]);

  function scrollLogsToBottom() {
    if (visibleLogLines.length === 0) return;

    window.requestAnimationFrame(() => {
      logListRef.current?.scrollToIndex({
        index: visibleLogLines.length - 1,
        align: "end",
        behavior: "auto"
      });
    });
  }

  function handleLogAutoScrollChange(checked) {
    if (bottomStateTimerRef.current) {
      window.clearTimeout(bottomStateTimerRef.current);
      bottomStateTimerRef.current = null;
    }

    setLogAutoScroll(checked);
    logUserScrollIntentRef.current = !checked;
    if (checked) scrollLogsToBottom();
  }

  useEffect(() => {
    const podName = pod?.name;
    if (!podName || !context || !namespace) return undefined;

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    logStreamIdRef.current = id;
    logRemainderRef.current = "";
    logLineIdRef.current = 0;
    logUserScrollIntentRef.current = false;
    setLogLines([]);
    setLogAutoScroll(true);
    setLogFilter("");

    const unsubscribeData = api.onPodLogsData((payload) => {
      if (payload.id !== id) return;
      appendLogLines(payload.text);
    });
    const unsubscribeError = api.onPodLogsError((payload) => {
      if (payload.id !== id) return;
      appendLogLines(`${payload.message}\n`, "error");
    });
    const unsubscribeClosed = api.onPodLogsClosed((payload) => {
      if (payload.id !== id || payload.signal === "SIGTERM") return;
      appendLogLines(`log stream closed${payload.code === null ? "" : ` with code ${payload.code}`}\n`, "meta");
    });

    api.startPodLogs({ id, context, namespace, podName });

    return () => {
      if (bottomStateTimerRef.current) {
        window.clearTimeout(bottomStateTimerRef.current);
        bottomStateTimerRef.current = null;
      }
      unsubscribeData();
      unsubscribeError();
      unsubscribeClosed();
      api.stopPodLogs(id);
    };
  }, [pod?.name, context, namespace]);

  useEffect(() => {
    const podName = pod?.name;
    if (!podName || !context || !namespace) return undefined;

    const requestId = describeRequestRef.current + 1;
    describeRequestRef.current = requestId;
    setDescribeText("");
    setDescribeError("");
    setDescribeLoading(true);

    api.describePod(context, namespace, podName)
      .then((output) => {
        if (requestId !== describeRequestRef.current) return;
        setDescribeText(output);
      })
      .catch((cause) => {
        if (requestId !== describeRequestRef.current) return;
        setDescribeError(cause.message || "Unable to load pod details.");
      })
      .finally(() => {
        if (requestId !== describeRequestRef.current) return;
        setDescribeLoading(false);
      });

    return () => {
      describeRequestRef.current += 1;
    };
  }, [pod?.name, context, namespace]);

  useEffect(() => {
    const podName = pod?.name;
    if (!podName || !context || !namespace) return undefined;

    const requestId = deploymentDescribeRequestRef.current + 1;
    deploymentDescribeRequestRef.current = requestId;
    setDeploymentDescribeText("");
    setDeploymentDescribeError("");
    setDeploymentDescribeLoading(true);

    api.describeDeployment(context, namespace, podName)
      .then((output) => {
        if (requestId !== deploymentDescribeRequestRef.current) return;
        setDeploymentDescribeText(output);
      })
      .catch((cause) => {
        if (requestId !== deploymentDescribeRequestRef.current) return;
        setDeploymentDescribeError(cause.message || "Unable to load deployment details.");
      })
      .finally(() => {
        if (requestId !== deploymentDescribeRequestRef.current) return;
        setDeploymentDescribeLoading(false);
      });

    return () => {
      deploymentDescribeRequestRef.current += 1;
    };
  }, [pod?.name, context, namespace]);

  return (
    <Dialog open={Boolean(pod)} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-slate-950/45 dark:bg-black/60" />
      <div className="fixed inset-0 flex">
        <DialogPanel className="flex h-full w-full flex-col overflow-hidden bg-white dark:bg-slate-950">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg font-semibold text-slate-950 dark:text-slate-100">
                {pod?.name}
              </DialogTitle>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                {context} / {namespace}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-50"
              title="Close"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 dark:border-slate-800 dark:bg-slate-900 sm:grid-cols-2 lg:grid-cols-6">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Status</div>
              <div className="mt-1">
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusTone(pod?.status, pod?.detail)}`}>
                  {pod?.detail || pod?.status}
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Ready</div>
              <div className="mt-1 text-sm font-medium text-slate-950 dark:text-slate-100">{pod?.ready}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Restarts</div>
              <div className="mt-1 text-sm font-medium text-slate-950 dark:text-slate-100">{pod?.restarts}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Age</div>
              <div className="mt-1 text-sm font-medium text-slate-950 dark:text-slate-100">{formatAge(pod?.age)}</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Node</div>
              <div className="mt-1">
                <NodePill nodeName={pod?.node} tone={nodeTone} />
              </div>
            </div>
          </div>

          <TabGroup selectedIndex={selectedTabIndex} onChange={setSelectedTabIndex} className="flex min-h-0 flex-1 flex-col">
            <TabList className="flex gap-1 border-b border-slate-200 bg-white px-4 pt-3 dark:border-slate-800 dark:bg-slate-950">
              {detailTabs.map((label) => (
                <Tab
                  key={label}
                  className={({ selected }) =>
                    `cursor-pointer rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium outline-none transition ${
                      selected
                        ? "border-slate-200 bg-slate-50 text-slate-950 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-100"
                        : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-950 dark:text-slate-400 dark:hover:bg-slate-900 dark:hover:text-slate-100"
                    }`
                  }
                >
                  {label}
                </Tab>
              ))}
            </TabList>
            <TabPanels className="min-h-0 flex-1">
              <TabPanel className="flex h-full min-h-0 flex-col">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-950">
                  <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Logs</div>
                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                      Filter
                      <input
                        type="search"
                        value={logFilter}
                        onChange={(event) => setLogFilter(event.target.value)}
                        className="h-8 w-56 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-400 dark:focus:ring-sky-950"
                        placeholder="Text in logs"
                      />
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={logAutoScroll}
                        onChange={(event) => handleLogAutoScrollChange(event.target.checked)}
                        className="size-4 cursor-pointer rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      Autoscroll
                    </label>
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={showTimestamps}
                        onChange={(event) => setShowTimestamps(event.target.checked)}
                        className="size-4 cursor-pointer rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      Show timestamps
                    </label>
                  </div>
                </div>

                <LogScrollArea
                  ref={logListRef}
                  lines={visibleLogLines}
                  totalLineCount={logLines.length}
                  filter={logFilter}
                  showTimestamps={showTimestamps}
                  autoScroll={logAutoScroll}
                  onBottomStateChange={handleLogBottomStateChange}
                  onUserScrollIntent={markLogUserScrollIntent}
                />
              </TabPanel>
              <TabPanel className="h-full min-h-0 bg-white dark:bg-slate-950">
                <DescribePanel
                  loading={describeLoading}
                  error={describeError}
                  text={describeText}
                  emptyMessage="No pod details output."
                  failureTitle="Pod details failed"
                  syntaxStyle={syntaxStyle}
                />
              </TabPanel>
              <TabPanel className="h-full min-h-0 bg-white dark:bg-slate-950">
                <DescribePanel
                  loading={deploymentDescribeLoading}
                  error={deploymentDescribeError}
                  text={deploymentDescribeText}
                  emptyMessage="No deployment details output."
                  failureTitle="Deployment details failed"
                  syntaxStyle={syntaxStyle}
                />
              </TabPanel>
              <TabPanel className="h-full min-h-0 bg-white dark:bg-slate-950">
                <ShellPanel
                  pod={pod}
                  context={context}
                  namespace={namespace}
                  effectiveTheme={effectiveTheme}
                  active={selectedTabIndex === detailTabs.indexOf("Shell")}
                />
              </TabPanel>
            </TabPanels>
          </TabGroup>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function ShellPanel({ pod, context, namespace, effectiveTheme, active }) {
  const containerRef = useRef(null);
  const terminalRef = useRef(null);
  const fitAddonRef = useRef(null);
  const shellIdRef = useRef("");
  const resizeFrameRef = useRef(0);
  const [status, setStatus] = useState("Connecting...");

  function fitShellToContainer() {
    if (!terminalRef.current || !fitAddonRef.current) return;

    try {
      fitAddonRef.current.fit();
      if (!shellIdRef.current) return;

      const { cols, rows } = terminalRef.current;
      api.resizePodShell(shellIdRef.current, cols, rows).catch(() => {});
    } catch {
      // The terminal can be temporarily zero-sized while the modal tab is settling.
    }
  }

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: terminalTheme(effectiveTheme)
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    const inputSubscription = terminal.onData((data) => {
      if (!shellIdRef.current) return;
      api.writePodShell(shellIdRef.current, data).catch((cause) => {
        terminal.writeln(`\r\n${cause.message || "Unable to write to shell."}`);
      });
    });

    const observer = new ResizeObserver(() => {
      if (resizeFrameRef.current) window.cancelAnimationFrame(resizeFrameRef.current);
      resizeFrameRef.current = window.requestAnimationFrame(fitShellToContainer);
    });
    observer.observe(containerRef.current);
    window.requestAnimationFrame(fitShellToContainer);

    return () => {
      if (resizeFrameRef.current) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = 0;
      }
      observer.disconnect();
      inputSubscription.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!terminalRef.current) return;
    terminalRef.current.options.theme = terminalTheme(effectiveTheme);
  }, [effectiveTheme]);

  useEffect(() => {
    if (!active || !terminalRef.current) return;

    window.requestAnimationFrame(() => {
      fitShellToContainer();
      terminalRef.current?.focus();
    });
  }, [active]);

  useEffect(() => {
    const podName = pod?.name;
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!podName || !context || !namespace || !terminal || !fitAddon) return undefined;

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    shellIdRef.current = id;
    setStatus("Connecting...");
    terminal.reset();
    terminal.writeln(`Connecting to ${podName}...`);

    try {
      fitAddon.fit();
    } catch {
      // The first fit can fail if the tab is still measuring.
    }
    if (active) terminal.focus();

    const unsubscribeData = api.onPodShellData((payload) => {
      if (payload.id !== id) return;
      terminal.write(payload.text);
      setStatus("Connected");
    });
    const unsubscribeError = api.onPodShellError((payload) => {
      if (payload.id !== id) return;
      terminal.writeln(`\r\n${payload.message || "Shell error."}`);
      setStatus(payload.message || "Shell error");
    });
    const unsubscribeClosed = api.onPodShellClosed((payload) => {
      if (payload.id !== id) return;
      setStatus("Closed");
      terminal.writeln(
        `\r\nShell closed${payload.signal ? ` (${payload.signal})` : payload.code === null ? "" : ` with code ${payload.code}`}`
      );
    });

    api.startPodShell({
      id,
      context,
      namespace,
      podName,
      cols: terminal.cols || 80,
      rows: terminal.rows || 24
    }).catch((cause) => {
      setStatus(cause.message || "Unable to start shell.");
      terminal.writeln(`\r\n${cause.message || "Unable to start shell."}`);
    });

    return () => {
      unsubscribeData();
      unsubscribeError();
      unsubscribeClosed();
      api.stopPodShell(id);
      if (shellIdRef.current === id) shellIdRef.current = "";
    };
  }, [pod?.name, context, namespace]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-white dark:bg-slate-950">
      <div className="flex shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 py-2 dark:border-slate-800 dark:bg-slate-950">
        <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">Shell</div>
        <div className="truncate text-xs text-slate-500 dark:text-slate-400">{status}</div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden bg-white p-3 dark:bg-slate-950">
        <div ref={containerRef} className="h-full min-h-0 overflow-hidden" />
      </div>
    </div>
  );
}

function terminalTheme(effectiveTheme) {
  if (effectiveTheme === "dark") {
    return {
      background: "#020617",
      foreground: "#e2e8f0",
      cursor: "#86efac",
      selectionBackground: "#334155"
    };
  }

  return {
    background: "#ffffff",
    foreground: "#0f172a",
    cursor: "#2563eb",
    selectionBackground: "#bfdbfe"
  };
}

function SettingsPage({ theme, setTheme, onBack }) {
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <header className="shrink-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="flex w-full items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="grid size-10 cursor-pointer place-items-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-50"
              title="Back"
            >
              <ArrowLeft className="size-5" aria-hidden="true" />
            </button>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">Settings</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">Preferences for k100s</p>
            </div>
          </div>
        </div>
      </header>

      <section className="mx-auto grid min-h-0 w-full max-w-7xl flex-1 grid-cols-[220px_1fr] gap-6 px-6 py-5">
        <aside className="rounded-lg border border-slate-200 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <div className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 dark:text-slate-400">
            General
          </div>
          <div className="rounded-md bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-700 dark:bg-sky-950 dark:text-sky-300">
            Appearance
          </div>
        </aside>

        <div className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <section className="border-b border-slate-200 px-5 py-4 dark:border-slate-800">
            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-100">General</h2>
          </section>

          <section className="px-5 py-4">
            <h2 className="text-base font-semibold text-slate-950 dark:text-slate-100">Appearance</h2>
            <div className="mt-4 grid max-w-xl gap-2">
              <div>
                <div className="text-sm font-medium text-slate-800 dark:text-slate-200">Theme</div>
                <div className="mt-1 text-sm text-slate-600 dark:text-slate-400">
                  Choose how k100s should render the interface.
                </div>
              </div>

              <div className="mt-2 inline-grid grid-cols-3 rounded-md border border-slate-200 bg-slate-50 p-1 dark:border-slate-700 dark:bg-slate-950">
                {THEME_OPTIONS.map((option) => (
                  <button
                    key={option}
                    type="button"
                    onClick={() => setTheme(option)}
                    className={`cursor-pointer rounded px-3 py-2 text-sm font-medium capitalize transition ${
                      theme === option
                        ? "bg-white text-slate-950 shadow-sm dark:bg-slate-800 dark:text-slate-50"
                        : "text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-slate-100"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      </section>
    </main>
  );
}

export default function App() {
  const [page, setPage] = useState("pods");
  const [theme, setTheme] = useState(getStoredTheme);
  const [effectiveTheme, setEffectiveTheme] = useState(() => resolveTheme(getStoredTheme()));
  const [contexts, setContexts] = useState([]);
  const [context, setContext] = useState("");
  const [namespaces, setNamespaces] = useState([]);
  const [namespacesContext, setNamespacesContext] = useState("");
  const [namespace, setNamespace] = useState("");
  const [pods, setPods] = useState([]);
  const [loading, setLoading] = useState({ contexts: true, namespaces: false, pods: false });
  const [error, setError] = useState("");
  const [errorSource, setErrorSource] = useState("");
  const [lastUpdated, setLastUpdated] = useState("");
  const [selectedPodName, setSelectedPodName] = useState("");
  const [podSort, setPodSort] = useState({ key: "name", direction: "asc" });
  const [podFilter, setPodFilter] = useState("");
  const namespacesRequestRef = useRef(0);
  const activeNamespaceRequestIdRef = useRef("");
  const podsRequestRef = useRef(0);
  const activePodsRequestIdRef = useRef("");
  const podsRequestInFlightRef = useRef(0);

  const selectedContext = useMemo(
    () => contexts.find((item) => item.name === context),
    [contexts, context]
  );
  const nodeToneByName = useMemo(() => {
    const nodeNames = [...new Set(pods.map((pod) => pod.node).filter(Boolean))].sort((left, right) =>
      left.localeCompare(right)
    );

    return new Map(nodeNames.map((nodeName, index) => [nodeName, NODE_TONES[index % NODE_TONES.length]]));
  }, [pods]);
  const selectedPod = useMemo(
    () => pods.find((pod) => pod.name === selectedPodName) ?? null,
    [pods, selectedPodName]
  );
  const visiblePods = useMemo(() => {
    const filter = podFilter.trim().toLowerCase();
    if (!filter) return pods;

    return pods.filter((pod) => {
      const value = [
        pod.name,
        pod.status,
        pod.detail,
        pod.ready,
        pod.restarts,
        pod.node,
        formatAge(pod.age)
      ]
        .join(" ")
        .toLowerCase();

      return value.includes(filter);
    });
  }, [podFilter, pods]);
  const sortedPods = useMemo(() => {
    const direction = podSort.direction === "asc" ? 1 : -1;

    return [...visiblePods].sort((left, right) => {
      if (podSort.key === "restarts") {
        return (left.restarts - right.restarts) * direction;
      }

      if (podSort.key === "age") {
        return (new Date(left.age).getTime() - new Date(right.age).getTime()) * direction;
      }

      const leftValue = String(left[podSort.key] ?? "");
      const rightValue = String(right[podSort.key] ?? "");
      return leftValue.localeCompare(rightValue, undefined, { numeric: true }) * direction;
    });
  }, [podSort, visiblePods]);

  function changePodSort(key) {
    setPodSort((current) => ({
      key,
      direction: current.key === key && current.direction === "asc" ? "desc" : "asc"
    }));
  }

  function changeNamespace(nextNamespace) {
    setNamespace(nextNamespace);
    if (context && namespacesContext === context && nextNamespace) {
      window.localStorage.setItem(namespaceStorageKey(context), nextNamespace);
    }
  }

  function clearError() {
    setError("");
    setErrorSource("");
  }

  function showError(message, source) {
    setError(message);
    setErrorSource(source);
  }

  function cancelKubectlRequest(id) {
    if (!id) return;
    api.cancelKubectlRequest(id).catch(() => {});
  }

  function requestKey(kind, id) {
    return `${kind}:${id}`;
  }

  async function loadContexts() {
    clearError();
    setLoading((current) => ({ ...current, contexts: true }));

    try {
      const result = await api.getContexts();
      const storedContext = window.localStorage.getItem(SELECTED_CONTEXT_KEY);
      const nextContext = result.contexts.some((item) => item.name === storedContext)
        ? storedContext
        : result.current || result.contexts[0]?.name || "";

      setContexts(result.contexts);
      setContext(nextContext);
    } catch (cause) {
      showError(cause.message || "Unable to read kubectl contexts.", "contexts");
    } finally {
      setLoading((current) => ({ ...current, contexts: false }));
    }
  }

  async function loadNamespaces(nextContext) {
    if (!nextContext) return;

    const requestId = namespacesRequestRef.current + 1;
    namespacesRequestRef.current = requestId;
    const requestKeyValue = requestKey("namespaces", requestId);
    cancelKubectlRequest(activeNamespaceRequestIdRef.current);
    cancelKubectlRequest(activePodsRequestIdRef.current);
    activeNamespaceRequestIdRef.current = requestKeyValue;
    activePodsRequestIdRef.current = "";
    podsRequestRef.current += 1;
    podsRequestInFlightRef.current = 0;
    clearError();
    setPods([]);
    setNamespaces([]);
    setNamespacesContext("");
    setNamespace("");
    setLoading((current) => ({ ...current, namespaces: true }));

    try {
      const result = await api.getNamespaces(nextContext, requestKeyValue);
      if (requestId !== namespacesRequestRef.current) return;

      const storedNamespace = window.localStorage.getItem(namespaceStorageKey(nextContext));
      const nextNamespace =
        storedNamespace && result.includes(storedNamespace)
          ? storedNamespace
          : selectedContext?.namespace && result.includes(selectedContext.namespace)
          ? selectedContext.namespace
          : result[0] || "";

      setNamespaces(result);
      setNamespacesContext(nextContext);
      setNamespace(nextNamespace);
      if (nextNamespace) {
        window.localStorage.setItem(namespaceStorageKey(nextContext), nextNamespace);
      }
    } catch (cause) {
      if (requestId !== namespacesRequestRef.current) return;

      showError(cause.message || "Unable to read namespaces.", "namespaces");
    } finally {
      if (activeNamespaceRequestIdRef.current === requestKeyValue) {
        activeNamespaceRequestIdRef.current = "";
      }
      if (requestId === namespacesRequestRef.current) {
        setLoading((current) => ({ ...current, namespaces: false }));
      }
    }
  }

  async function loadPods(nextContext = context, nextNamespace = namespace, options = {}) {
    if (!nextContext || !nextNamespace) return;

    const showLoading = options.showLoading ?? true;
    if (!showLoading && podsRequestInFlightRef.current) return;

    const requestId = podsRequestRef.current + 1;
    podsRequestRef.current = requestId;
    const requestKeyValue = requestKey("pods", requestId);
    cancelKubectlRequest(activePodsRequestIdRef.current);
    activePodsRequestIdRef.current = requestKeyValue;
    podsRequestInFlightRef.current = requestId;

    clearError();
    if (showLoading) {
      setLoading((current) => ({ ...current, pods: true }));
    }

    try {
      const result = await api.getPods(nextContext, nextNamespace, requestKeyValue);
      if (requestId !== podsRequestRef.current) return;

      setPods(result);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (cause) {
      if (requestId !== podsRequestRef.current) return;

      showError(cause.message || "Unable to read pods.", "pods");
      setPods([]);
    } finally {
      if (activePodsRequestIdRef.current === requestKeyValue) {
        activePodsRequestIdRef.current = "";
      }
      if (podsRequestInFlightRef.current === requestId) {
        podsRequestInFlightRef.current = 0;
      }
      if (showLoading && requestId === podsRequestRef.current) {
        setLoading((current) => ({ ...current, pods: false }));
      }
    }
  }

  useEffect(() => {
    loadContexts();
  }, []);

  useEffect(() => {
    if (context) window.localStorage.setItem(SELECTED_CONTEXT_KEY, context);
  }, [context]);

  useEffect(() => {
    if (context && namespace) {
      if (namespacesContext === context && namespaces.includes(namespace)) {
        window.localStorage.setItem(namespaceStorageKey(context), namespace);
      }
    }
  }, [context, namespace, namespaces, namespacesContext]);

  useEffect(() => {
    loadNamespaces(context);
  }, [context]);

  useEffect(() => {
    loadPods(context, namespace);
  }, [context, namespace]);

  useEffect(() => {
    if (!context || !namespace) return undefined;

    const interval = window.setInterval(() => {
      loadPods(context, namespace, { showLoading: false });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [context, namespace]);

  const isBusy = loading.contexts || loading.namespaces || loading.pods;
  const canRetryNamespaces = errorSource === "namespaces" && context;

  useEffect(() => {
    window.localStorage.setItem(THEME_KEY, theme);

    function syncTheme() {
      const nextTheme = resolveTheme(theme);
      setEffectiveTheme(nextTheme);
      document.documentElement.classList.toggle("dark", nextTheme === "dark");
      document.documentElement.style.colorScheme = nextTheme;
    }

    const media = window.matchMedia("(prefers-color-scheme: dark)");
    syncTheme();
    media.addEventListener("change", syncTheme);

    return () => media.removeEventListener("change", syncTheme);
  }, [theme]);

  if (page === "settings") {
    return <SettingsPage theme={theme} setTheme={setTheme} onBack={() => setPage("pods")} />;
  }

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <header className="shrink-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="flex w-full items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-sky-600 text-white">
              <TerminalSquare className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">k100s</h1>
              <p className="text-sm text-slate-600 dark:text-slate-400">Kubernetes contexts, namespaces, and pods</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setPage("settings")}
            className="grid size-10 cursor-pointer place-items-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-950 dark:border-slate-800 dark:text-slate-300 dark:hover:bg-slate-900 dark:hover:text-slate-50"
            title="Settings"
          >
            <Settings className="size-5" aria-hidden="true" />
          </button>
        </div>
      </header>

      <section className="flex min-h-0 w-full flex-1 flex-col px-6 py-5">
        <div className="grid shrink-0 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
          <SelectField
            label="Cluster"
            value={context}
            onChange={setContext}
            disabled={loading.contexts || contexts.length === 0}
          >
            {contexts.length === 0 ? <option value="">No clusters found</option> : null}
            {contexts.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name}
              </option>
            ))}
          </SelectField>

          <SelectField
            label="Namespace"
            value={namespace}
            onChange={changeNamespace}
            disabled={!context || loading.namespaces || namespaces.length === 0}
          >
            {namespaces.length === 0 ? <option value="">No namespaces found</option> : null}
            {namespaces.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </SelectField>

          <label className="grid gap-1.5 text-sm font-medium text-slate-700 dark:text-slate-300">
            Filter
            <input
              type="search"
              value={podFilter}
              onChange={(event) => setPodFilter(event.target.value)}
              className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-4 focus:ring-sky-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus:border-sky-400 dark:focus:ring-sky-950"
              placeholder="Filter pods"
            />
          </label>

          <div className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            <Server className="size-4 text-slate-500 dark:text-slate-400" aria-hidden="true" />
            {sortedPods.length === pods.length ? `${pods.length} pods` : `${sortedPods.length}/${pods.length} pods`}
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200">
            {error}
          </div>
        ) : null}

        <div className="mt-5 flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-950">
          <div className="shrink-0 flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950 dark:text-slate-100">Pods</h2>
            </div>
            {isBusy ? <span className="text-sm text-slate-500 dark:text-slate-400">Loading...</span> : null}
          </div>

          {!context ? (
            <EmptyState title="No cluster selected" message="Make sure kubectl is installed and has configured contexts." />
          ) : error ? (
            <EmptyState
              title="Connection failed"
              message={error}
              action={
                canRetryNamespaces ? (
                  <button
                    type="button"
                    onClick={() => loadNamespaces(context)}
                    disabled={loading.namespaces}
                    className="inline-flex h-9 cursor-pointer items-center rounded-md bg-sky-600 px-4 text-sm font-semibold text-white transition hover:bg-sky-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:text-slate-600 dark:disabled:bg-slate-800 dark:disabled:text-slate-500"
                  >
                    {loading.namespaces ? "Retrying..." : "Retry"}
                  </button>
                ) : null
              }
            />
          ) : loading.namespaces || (loading.pods && pods.length === 0) ? (
            <LoadingState />
          ) : pods.length === 0 && !loading.pods ? (
            <EmptyState title="No pods found" message="This namespace does not currently have any pods." />
          ) : (
            <div className="flex min-h-0 flex-1 flex-col border-t border-slate-200 dark:border-slate-800">
              <div className="shrink-0 overflow-hidden border-b border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900">
                <table className="min-w-full table-fixed text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500 dark:text-slate-400">
                    <tr>
                      <th className="w-2/5 p-0 font-semibold">
                        <SortButton active={podSort.key === "name"} direction={podSort.direction} onClick={() => changePodSort("name")}>
                          Name
                        </SortButton>
                      </th>
                      <th className="w-32 p-0 font-semibold">
                        <SortButton active={podSort.key === "detail"} direction={podSort.direction} onClick={() => changePodSort("detail")}>
                          Status
                        </SortButton>
                      </th>
                      <th className="w-24 p-0 font-semibold">
                        <SortButton active={podSort.key === "ready"} direction={podSort.direction} onClick={() => changePodSort("ready")}>
                          Ready
                        </SortButton>
                      </th>
                      <th className="w-24 p-0 font-semibold">
                        <SortButton active={podSort.key === "restarts"} direction={podSort.direction} onClick={() => changePodSort("restarts")}>
                          Restarts
                        </SortButton>
                      </th>
                      <th className="w-24 p-0 font-semibold">
                        <SortButton active={podSort.key === "age"} direction={podSort.direction} onClick={() => changePodSort("age")}>
                          Age
                        </SortButton>
                      </th>
                      <th className="w-1/4 p-0 font-semibold">
                        <SortButton active={podSort.key === "node"} direction={podSort.direction} onClick={() => changePodSort("node")}>
                          Node
                        </SortButton>
                      </th>
                    </tr>
                  </thead>
                </table>
              </div>

              <div className="min-h-0 flex-1 overflow-auto">
                <table className="min-w-full table-fixed text-left text-sm">
                  <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                    {sortedPods.map((pod) => (
                      <tr
                        key={pod.name}
                        tabIndex={0}
                        role="button"
                        onClick={() => setSelectedPodName(pod.name)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setSelectedPodName(pod.name);
                          }
                        }}
                        className="cursor-pointer hover:bg-slate-50 focus:bg-sky-50 focus:outline-none dark:hover:bg-slate-900 dark:focus:bg-sky-950"
                      >
                        <td className="w-2/5 truncate px-4 py-3 font-medium text-slate-950 dark:text-slate-100" title={pod.name}>
                          {pod.name}
                        </td>
                        <td className="w-32 px-4 py-3">
                          <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusTone(pod.status, pod.detail)}`}>
                            {pod.detail || pod.status}
                          </span>
                        </td>
                        <td className="w-24 px-4 py-3 text-slate-700 dark:text-slate-300">{pod.ready}</td>
                        <td className="w-24 px-4 py-3 text-slate-700 dark:text-slate-300">{pod.restarts}</td>
                        <td className="w-24 px-4 py-3 text-slate-700 dark:text-slate-300">{formatAge(pod.age)}</td>
                        <td className="w-1/4 px-4 py-3">
                          <NodePill nodeName={pod.node} tone={nodeToneByName.get(pod.node)} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      <PodDetailsModal
        pod={selectedPod}
        context={context}
        namespace={namespace}
        nodeTone={selectedPod ? nodeToneByName.get(selectedPod.node) : undefined}
        effectiveTheme={effectiveTheme}
        onClose={() => setSelectedPodName("")}
      />

    </main>
  );
}
