import { useEffect, useMemo, useRef, useState } from "react";
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
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Virtuoso } from "react-virtuoso";
import { ArrowDown, ArrowLeft, ArrowUp, Boxes, LoaderCircle, Server, Settings, TerminalSquare, X } from "lucide-react";
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
  async startPodLogs() {},
  async stopPodLogs() {},
  onPodLogsData() {
    return () => {};
  },
  onPodLogsError() {
    return () => {};
  },
  onPodLogsClosed() {
    return () => {};
  }
};
const tauriApi = {
  getContexts: () => invoke("get_contexts"),
  getNamespaces: (context) => invoke("get_namespaces", { context }),
  getPods: (context, namespace) => invoke("get_pods", { context, namespace }),
  describePod: (context, namespace, podName) => invoke("describe_pod", { context, namespace, podName }),
  describeDeployment: (context, namespace, podName) =>
    invoke("describe_deployment_for_pod", { context, namespace, podName }),
  startPodLogs: (options) => invoke("start_pod_logs", { options }),
  stopPodLogs: (id) => invoke("stop_pod_logs", { id }),
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
  }
};
const api = "__TAURI_INTERNALS__" in window ? tauriApi : fallbackApi;
const SELECTED_CONTEXT_KEY = "k100s.selectedContext";
const SELECTED_NAMESPACE_KEY = "k100s.selectedNamespace";
const THEME_KEY = "k100s.theme";
const THEME_OPTIONS = ["system", "light", "dark"];

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

function EmptyState({ title, message }) {
  return (
    <div className="grid min-h-80 place-items-center border-t border-slate-200 bg-white px-6 text-center dark:border-slate-800 dark:bg-slate-950">
      <div>
        <Boxes className="mx-auto mb-3 size-9 text-slate-400" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-950 dark:text-slate-100">{title}</h2>
        <p className="mt-1 max-w-md text-sm text-slate-600 dark:text-slate-400">{message}</p>
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

function formatJsonMessage(message) {
  const value = String(message || "").trim();
  if (!value || !["{", "["].includes(value[0])) return "";

  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return "";
  }
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

function LogMessage({ message, filter, wrap, syntaxStyle }) {
  const jsonMessage = formatJsonMessage(message);

  if (!jsonMessage) {
    return (
      <span>
        <HighlightedText text={message} filter={filter} />
      </span>
    );
  }

  if (filter.trim()) {
    return (
      <span className={wrap ? "whitespace-pre-wrap break-words" : "whitespace-pre"}>
        <HighlightedText text={jsonMessage} filter={filter} />
      </span>
    );
  }

  return (
    <SyntaxHighlighter
      language="json"
      style={syntaxStyle}
      customStyle={{
        background: "transparent",
        margin: 0,
        padding: 0,
        whiteSpace: wrap ? "pre-wrap" : "pre",
        overflow: "visible"
      }}
      codeTagProps={{
        style: {
          background: "transparent",
          fontFamily: "inherit",
          fontSize: "inherit",
          lineHeight: "inherit",
          whiteSpace: wrap ? "pre-wrap" : "pre"
        }
      }}
    >
      {jsonMessage}
    </SyntaxHighlighter>
  );
}

function PodDetailsModal({ pod, context, namespace, nodeTone, effectiveTheme, onClose }) {
  const [logLines, setLogLines] = useState([]);
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [wrapLogText, setWrapLogText] = useState(true);
  const [logFilter, setLogFilter] = useState("");
  const [describeText, setDescribeText] = useState("");
  const [describeLoading, setDescribeLoading] = useState(false);
  const [describeError, setDescribeError] = useState("");
  const [deploymentDescribeText, setDeploymentDescribeText] = useState("");
  const [deploymentDescribeLoading, setDeploymentDescribeLoading] = useState(false);
  const [deploymentDescribeError, setDeploymentDescribeError] = useState("");
  const logLineIdRef = useRef(0);
  const logRemainderRef = useRef("");
  const logStreamIdRef = useRef("");
  const bottomStateTimerRef = useRef(null);
  const describeRequestRef = useRef(0);
  const deploymentDescribeRequestRef = useRef(0);
  const syntaxStyle = useMemo(
    () => createSyntaxStyle(effectiveTheme === "dark" ? oneDark : oneLight),
    [effectiveTheme]
  );

  function handleLogBottomStateChange(isAtBottom) {
    if (bottomStateTimerRef.current) {
      window.clearTimeout(bottomStateTimerRef.current);
      bottomStateTimerRef.current = null;
    }

    if (isAtBottom) {
      setLogAutoScroll(true);
      return;
    }

    bottomStateTimerRef.current = window.setTimeout(() => {
      setLogAutoScroll(false);
      bottomStateTimerRef.current = null;
    }, 350);
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

  useEffect(() => {
    const podName = pod?.name;
    if (!podName || !context || !namespace) return undefined;

    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    logStreamIdRef.current = id;
    logRemainderRef.current = "";
    logLineIdRef.current = 0;
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
      <div className="fixed inset-0 flex p-6">
        <DialogPanel className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-white shadow-2xl dark:bg-slate-950">
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

          <TabGroup className="flex min-h-0 flex-1 flex-col">
            <TabList className="flex gap-1 border-b border-slate-200 bg-white px-4 pt-3 dark:border-slate-800 dark:bg-slate-950">
              {["Logs", "Pod", "Deployment"].map((label) => (
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
                        onChange={(event) => setLogAutoScroll(event.target.checked)}
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
                    <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300">
                      <input
                        type="checkbox"
                        checked={wrapLogText}
                        onChange={(event) => setWrapLogText(event.target.checked)}
                        className="size-4 cursor-pointer rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                      />
                      Wrap text
                    </label>
                  </div>
                </div>

                <div className={`min-h-0 flex-1 bg-white dark:bg-slate-950 ${wrapLogText ? "" : "overflow-x-auto"}`}>
                  <Virtuoso
                    data={visibleLogLines}
                    followOutput={logAutoScroll ? "auto" : false}
                    atBottomThreshold={80}
                    atBottomStateChange={handleLogBottomStateChange}
                    itemContent={(_index, line) => (
                      <div
                        className={`flex gap-3 px-4 py-0.5 font-mono text-xs leading-5 ${
                          wrapLogText ? "whitespace-pre-wrap break-words" : "w-max whitespace-pre"
                        } ${
                          line.level === "error"
                            ? "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300"
                            : line.level === "meta"
                              ? "text-slate-500 dark:text-slate-400"
                              : "text-slate-800 dark:text-slate-200"
                        }`}
                      >
                        {showTimestamps && line.timestamp ? (
                          <span className="shrink-0 text-slate-500 dark:text-slate-400">
                            <HighlightedText text={line.timestamp} filter={logFilter} />
                          </span>
                        ) : null}
                        <LogMessage
                          message={line.message}
                          filter={logFilter}
                          wrap={wrapLogText}
                          syntaxStyle={syntaxStyle}
                        />
                      </div>
                    )}
                    components={{
                      EmptyPlaceholder: () => (
                        <div className="grid h-full place-items-center px-4 text-sm text-slate-500">
                          Waiting for log output...
                        </div>
                      ),
                      Footer: () =>
                        logLines.length > 0 ? (
                          <div className="px-4 py-3 text-center font-mono text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                            {logFilter ? `${visibleLogLines.length} matching lines` : "End of logs"}
                          </div>
                        ) : null
                    }}
                  />
                </div>
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
            </TabPanels>
          </TabGroup>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

function SettingsPage({ theme, setTheme, onBack }) {
  return (
    <main className="flex h-screen flex-col overflow-hidden bg-slate-100 text-slate-950 dark:bg-slate-950 dark:text-slate-100">
      <header className="shrink-0 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
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
  const [namespace, setNamespace] = useState("");
  const [pods, setPods] = useState([]);
  const [loading, setLoading] = useState({ contexts: true, namespaces: false, pods: false });
  const [error, setError] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastUpdated, setLastUpdated] = useState("");
  const [selectedPodName, setSelectedPodName] = useState("");
  const [podSort, setPodSort] = useState({ key: "name", direction: "asc" });
  const [podFilter, setPodFilter] = useState("");
  const podsRequestRef = useRef(0);

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

  async function loadContexts() {
    setError("");
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
      setError(cause.message || "Unable to read kubectl contexts.");
    } finally {
      setLoading((current) => ({ ...current, contexts: false }));
    }
  }

  async function loadNamespaces(nextContext) {
    if (!nextContext) return;

    setError("");
    setPods([]);
    setNamespaces([]);
    setNamespace("");
    setLoading((current) => ({ ...current, namespaces: true }));

    try {
      const result = await api.getNamespaces(nextContext);
      const storedNamespace = window.localStorage.getItem(`${SELECTED_NAMESPACE_KEY}.${nextContext}`);

      setNamespaces(result);
      setNamespace(
        storedNamespace && result.includes(storedNamespace)
          ? storedNamespace
          : selectedContext?.namespace && result.includes(selectedContext.namespace)
          ? selectedContext.namespace
          : result[0] || ""
      );
    } catch (cause) {
      setError(cause.message || "Unable to read namespaces.");
    } finally {
      setLoading((current) => ({ ...current, namespaces: false }));
    }
  }

  async function loadPods(nextContext = context, nextNamespace = namespace, options = {}) {
    if (!nextContext || !nextNamespace) return;

    const requestId = podsRequestRef.current + 1;
    podsRequestRef.current = requestId;
    const showLoading = options.showLoading ?? true;

    setError("");
    if (showLoading) {
      setLoading((current) => ({ ...current, pods: true }));
    }

    try {
      const result = await api.getPods(nextContext, nextNamespace);
      if (requestId !== podsRequestRef.current) return;

      setPods(result);
      setLastUpdated(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    } catch (cause) {
      if (requestId !== podsRequestRef.current) return;

      setError(cause.message || "Unable to read pods.");
      setPods([]);
    } finally {
      if (showLoading) {
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
      window.localStorage.setItem(`${SELECTED_NAMESPACE_KEY}.${context}`, namespace);
    }
  }, [context, namespace]);

  useEffect(() => {
    loadNamespaces(context);
  }, [context]);

  useEffect(() => {
    loadPods(context, namespace);
  }, [context, namespace]);

  useEffect(() => {
    if (!autoRefresh || !context || !namespace) return undefined;

    const interval = window.setInterval(() => {
      loadPods(context, namespace, { showLoading: false });
    }, 5000);

    return () => window.clearInterval(interval);
  }, [autoRefresh, context, namespace]);

  const isBusy = loading.contexts || loading.namespaces || loading.pods;

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
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
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

      <section className="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col px-6 py-5">
        <div className="grid shrink-0 gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 md:grid-cols-[1fr_1fr_1fr_auto_auto] md:items-end">
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
            onChange={setNamespace}
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

          <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
              className="size-4 cursor-pointer rounded border-slate-300 text-sky-600 focus:ring-sky-500"
            />
            Auto
          </label>
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
            <EmptyState title="Connection failed" message={error} />
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
