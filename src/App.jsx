import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogBackdrop, DialogPanel, DialogTitle } from "@headlessui/react";
import { Virtuoso } from "react-virtuoso";
import { Boxes, RefreshCw, Server, TerminalSquare, X } from "lucide-react";
import "./styles.css";

const api = window.k100s ?? {
  async getContexts() {
    return { contexts: [], current: "" };
  },
  async getNamespaces() {
    return [];
  },
  async getPods() {
    return [];
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
  if (value.includes("running") || value.includes("ready") || value.includes("succeeded")) {
    return "bg-emerald-50 text-emerald-700 ring-emerald-200";
  }
  if (value.includes("pending") || value.includes("waiting") || value.includes("containercreating")) {
    return "bg-amber-50 text-amber-700 ring-amber-200";
  }
  return "bg-rose-50 text-rose-700 ring-rose-200";
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
    <label className="grid gap-1.5 text-sm font-medium text-slate-700">
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        className="h-10 cursor-pointer rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-950 shadow-sm outline-none transition focus:border-sky-500 focus:ring-4 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
      >
        {children}
      </select>
    </label>
  );
}

function EmptyState({ title, message }) {
  return (
    <div className="grid min-h-80 place-items-center border-t border-slate-200 bg-white px-6 text-center">
      <div>
        <Boxes className="mx-auto mb-3 size-9 text-slate-400" aria-hidden="true" />
        <h2 className="text-base font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 max-w-md text-sm text-slate-600">{message}</p>
      </div>
    </div>
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

function PodDetailsModal({ pod, context, namespace, nodeTone, onClose }) {
  const [logLines, setLogLines] = useState([]);
  const [logAutoScroll, setLogAutoScroll] = useState(true);
  const [showTimestamps, setShowTimestamps] = useState(true);
  const [wrapLogText, setWrapLogText] = useState(true);
  const [logFilter, setLogFilter] = useState("");
  const logLineIdRef = useRef(0);
  const logRemainderRef = useRef("");
  const logStreamIdRef = useRef("");
  const bottomStateTimerRef = useRef(null);

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

  return (
    <Dialog open={Boolean(pod)} onClose={onClose} className="relative z-50">
      <DialogBackdrop className="fixed inset-0 bg-slate-950/45" />
      <div className="fixed inset-0 flex p-6">
        <DialogPanel className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
            <div className="min-w-0">
              <DialogTitle className="truncate text-lg font-semibold text-slate-950">
                {pod?.name}
              </DialogTitle>
              <p className="mt-1 text-sm text-slate-600">
                {context} / {namespace}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-md border border-slate-200 text-slate-600 transition hover:bg-slate-50 hover:text-slate-950"
              title="Close"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </div>

          <div className="grid gap-3 border-b border-slate-200 bg-slate-50 px-5 py-4 sm:grid-cols-2 lg:grid-cols-6">
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Status</div>
              <div className="mt-1">
                <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusTone(pod?.status, pod?.detail)}`}>
                  {pod?.detail || pod?.status}
                </span>
              </div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Ready</div>
              <div className="mt-1 text-sm font-medium text-slate-950">{pod?.ready}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Restarts</div>
              <div className="mt-1 text-sm font-medium text-slate-950">{pod?.restarts}</div>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase text-slate-500">Age</div>
              <div className="mt-1 text-sm font-medium text-slate-950">{formatAge(pod?.age)}</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs font-semibold uppercase text-slate-500">Node</div>
              <div className="mt-1">
                <NodePill nodeName={pod?.node} tone={nodeTone} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-2">
            <div className="text-xs font-semibold uppercase text-slate-500">Logs</div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                Filter
                <input
                  type="search"
                  value={logFilter}
                  onChange={(event) => setLogFilter(event.target.value)}
                  className="h-8 w-56 rounded-md border border-slate-300 bg-white px-2 text-sm text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-sky-500 focus:ring-4 focus:ring-sky-100"
                  placeholder="Text in logs"
                />
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={logAutoScroll}
                  onChange={(event) => setLogAutoScroll(event.target.checked)}
                  className="size-4 cursor-pointer rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                Autoscroll
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={showTimestamps}
                  onChange={(event) => setShowTimestamps(event.target.checked)}
                  className="size-4 cursor-pointer rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                />
                Show timestamps
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-700">
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

          <div className={`min-h-0 flex-1 bg-white ${wrapLogText ? "" : "overflow-x-auto"}`}>
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
                      ? "bg-rose-50 text-rose-700"
                      : line.level === "meta"
                        ? "text-slate-500"
                        : "text-slate-800"
                  }`}
                >
                  {showTimestamps && line.timestamp ? (
                    <span className="shrink-0 text-slate-500">
                      <HighlightedText text={line.timestamp} filter={logFilter} />
                    </span>
                  ) : null}
                  <span>
                    <HighlightedText text={line.message} filter={logFilter} />
                  </span>
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
                    <div className="px-4 py-3 text-center font-mono text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {logFilter ? `${visibleLogLines.length} matching lines` : "End of logs"}
                    </div>
                  ) : null
              }}
            />
          </div>
        </DialogPanel>
      </div>
    </Dialog>
  );
}

export default function App() {
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

  async function loadContexts() {
    setError("");
    setLoading((current) => ({ ...current, contexts: true }));

    try {
      const result = await api.getContexts();
      setContexts(result.contexts);
      setContext(result.current || result.contexts[0]?.name || "");
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
      setNamespaces(result);
      setNamespace(
        selectedContext?.namespace && result.includes(selectedContext.namespace)
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

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-lg bg-sky-600 text-white">
              <TerminalSquare className="size-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">k100s</h1>
              <p className="text-sm text-slate-600">Kubernetes contexts, namespaces, and pods</p>
            </div>
          </div>

          <button
            type="button"
            onClick={() => loadPods()}
            disabled={!context || !namespace || isBusy}
            className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md bg-slate-950 px-3 text-sm font-medium text-white shadow-sm transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
            title="Refresh pods"
          >
            <RefreshCw className={`size-4 ${isBusy ? "animate-spin" : ""}`} aria-hidden="true" />
            Refresh now
          </button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-5">
        <div className="grid gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-[1fr_1fr_auto_auto] md:items-end">
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

          <div className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm text-slate-700">
            <Server className="size-4 text-slate-500" aria-hidden="true" />
            {pods.length} pods
          </div>

          <label className="flex h-10 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-700">
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
          <div className="mt-4 rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </div>
        ) : null}

        <div className="mt-5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between gap-4 px-4 py-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Pods</h2>
            </div>
            {isBusy ? <span className="text-sm text-slate-500">Loading...</span> : null}
          </div>

          {!context ? (
            <EmptyState title="No cluster selected" message="Make sure kubectl is installed and has configured contexts." />
          ) : !namespace ? (
            <EmptyState title="No namespace selected" message="Choose a namespace to inspect its pods." />
          ) : pods.length === 0 && !loading.pods ? (
            <EmptyState title="No pods found" message="This namespace does not currently have any pods." />
          ) : (
            <div className="overflow-x-auto border-t border-slate-200">
              <table className="min-w-full table-fixed text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="w-2/5 px-4 py-3 font-semibold">Name</th>
                    <th className="w-32 px-4 py-3 font-semibold">Status</th>
                    <th className="w-24 px-4 py-3 font-semibold">Ready</th>
                    <th className="w-24 px-4 py-3 font-semibold">Restarts</th>
                    <th className="w-24 px-4 py-3 font-semibold">Age</th>
                    <th className="w-1/4 px-4 py-3 font-semibold">Node</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {pods.map((pod) => (
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
                      className="cursor-pointer hover:bg-slate-50 focus:bg-sky-50 focus:outline-none"
                    >
                      <td className="truncate px-4 py-3 font-medium text-slate-950" title={pod.name}>
                        {pod.name}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${statusTone(pod.status, pod.detail)}`}>
                          {pod.detail || pod.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{pod.ready}</td>
                      <td className="px-4 py-3 text-slate-700">{pod.restarts}</td>
                      <td className="px-4 py-3 text-slate-700">{formatAge(pod.age)}</td>
                      <td className="px-4 py-3">
                        <NodePill nodeName={pod.node} tone={nodeToneByName.get(pod.node)} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      <PodDetailsModal
        pod={selectedPod}
        context={context}
        namespace={namespace}
        nodeTone={selectedPod ? nodeToneByName.get(selectedPod.node) : undefined}
        onClose={() => setSelectedPodName("")}
      />
    </main>
  );
}
