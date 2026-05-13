import { app, BrowserWindow, ipcMain } from "electron";
import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isDev = Boolean(process.env.ELECTRON_START_URL);
const podWatches = new Map();
const podLogStreams = new Map();

function runKubectl(args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      "kubectl",
      args,
      {
        timeout: options.timeout ?? 15000,
        maxBuffer: 10 * 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const message = stderr.trim() || error.message || "kubectl command failed";
          reject(new Error(message));
          return;
        }

        resolve(stdout);
      }
    );
  });
}

function parseKubectlConfig(configJson) {
  const config = JSON.parse(configJson || "{}");
  const contexts = Array.isArray(config.contexts) ? config.contexts : [];
  const currentContext = config["current-context"] || "";

  return contexts
    .map((entry) => ({
      name: entry.name,
      cluster: entry.context?.cluster ?? "",
      namespace: entry.context?.namespace ?? ""
    }))
    .filter((entry) => entry.name)
    .sort((left, right) => {
      if (left.name === currentContext) return -1;
      if (right.name === currentContext) return 1;
      return left.name.localeCompare(right.name);
    });
}

async function getContexts() {
  const configJson = await runKubectl(["config", "view", "-o", "json"]);
  const contexts = parseKubectlConfig(configJson);
  const current = contexts[0]?.name ?? "";
  return { contexts, current };
}

async function getNamespaces(context) {
  const output = await runKubectl([
    "--context",
    context,
    "get",
    "namespaces",
    "-o",
    "json"
  ]);
  const payload = JSON.parse(output || "{}");

  return (payload.items ?? [])
    .map((item) => item.metadata?.name)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right));
}

function summarizeContainerStatuses(statuses = []) {
  const waiting = statuses.find((container) => container.state?.waiting);
  const terminated = statuses.find((container) => container.state?.terminated);

  if (waiting) return waiting.state.waiting.reason ?? "Waiting";
  if (terminated) return terminated.state.terminated.reason ?? "Terminated";
  if (statuses.length > 0 && statuses.every((container) => container.ready)) return "Ready";

  return "Running";
}

function summarizePod(pod) {
  const statuses = pod.status?.containerStatuses ?? [];
  const ready = statuses.filter((container) => container.ready).length;
  const restarts = statuses.reduce((count, container) => count + (container.restartCount ?? 0), 0);

  return {
    name: pod.metadata?.name ?? "",
    status: pod.status?.phase ?? "Unknown",
    detail: summarizeContainerStatuses(statuses),
    ready: `${ready}/${statuses.length || pod.spec?.containers?.length || 0}`,
    restarts,
    node: pod.spec?.nodeName ?? "",
    age: pod.metadata?.creationTimestamp ?? ""
  };
}

async function getPods(context, namespace) {
  const output = await runKubectl([
    "--context",
    context,
    "-n",
    namespace,
    "get",
    "pods",
    "-o",
    "json"
  ]);
  const payload = JSON.parse(output || "{}");

  return (payload.items ?? [])
    .map(summarizePod)
    .filter((pod) => pod.name)
    .sort((left, right) => left.name.localeCompare(right.name));
}

function createJsonObjectStream(onObject, onError) {
  let buffer = "";
  let depth = 0;
  let inString = false;
  let escaped = false;

  return (chunk) => {
    for (const char of chunk) {
      if (depth === 0 && char !== "{") continue;

      buffer += char;

      if (escaped) {
        escaped = false;
        continue;
      }

      if (char === "\\") {
        escaped = inString;
        continue;
      }

      if (char === "\"") {
        inString = !inString;
        continue;
      }

      if (inString) continue;

      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;

      if (depth === 0 && buffer) {
        try {
          onObject(JSON.parse(buffer));
        } catch (cause) {
          onError(cause);
        } finally {
          buffer = "";
        }
      }
    }
  };
}

function stopPodsWatch(id) {
  const child = podWatches.get(id);
  if (!child) return;

  podWatches.delete(id);
  child.kill("SIGTERM");
}

function startPodsWatch(sender, { id, context, namespace }) {
  stopPodsWatch(id);

  const child = spawn("kubectl", [
    "--context",
    context,
    "-n",
    namespace,
    "get",
    "pods",
    "--watch-only",
    "--output-watch-events",
    "-o",
    "json"
  ]);

  podWatches.set(id, child);

  const send = (channel, payload) => {
    if (!sender.isDestroyed()) sender.send(channel, { id, ...payload });
  };

  const parseChunk = createJsonObjectStream(
    (event) => {
      const pod = summarizePod(event.object ?? {});
      if (!pod.name) return;

      send("kubectl:pods-watch-event", {
        eventType: event.type ?? "MODIFIED",
        pod
      });
    },
    (cause) => {
      send("kubectl:pods-watch-error", {
        message: cause.message || "Unable to parse kubectl watch event."
      });
    }
  );

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", parseChunk);
  child.stderr.on("data", (chunk) => {
    const message = chunk.trim();
    if (message) send("kubectl:pods-watch-error", { message });
  });

  child.on("error", (cause) => {
    send("kubectl:pods-watch-error", {
      message: cause.message || "Unable to start kubectl watch."
    });
  });

  child.on("close", (code, signal) => {
    if (podWatches.get(id) !== child) return;

    podWatches.delete(id);
    send("kubectl:pods-watch-closed", { code, signal });
  });
}

function stopPodLogs(id) {
  const child = podLogStreams.get(id);
  if (!child) return;

  podLogStreams.delete(id);
  child.kill("SIGTERM");
}

function startPodLogs(sender, { id, context, namespace, podName }) {
  stopPodLogs(id);

  const args = [
    "--context",
    context,
    "-n",
    namespace,
    "logs",
    podName,
    "--follow",
    "--tail=200",
    "--timestamps",
    "--all-containers=true"
  ];

  const child = spawn("kubectl", args);

  podLogStreams.set(id, child);

  const send = (channel, payload) => {
    if (!sender.isDestroyed()) sender.send(channel, { id, ...payload });
  };

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (text) => {
    send("kubectl:pod-logs-data", { text });
  });

  child.stderr.on("data", (text) => {
    const message = text.trim();
    if (message) send("kubectl:pod-logs-error", { message });
  });

  child.on("error", (cause) => {
    send("kubectl:pod-logs-error", {
      message: cause.message || "Unable to start kubectl logs."
    });
  });

  child.on("close", (code, signal) => {
    if (podLogStreams.get(id) !== child) return;

    podLogStreams.delete(id);
    send("kubectl:pod-logs-closed", { code, signal });
  });
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 860,
    minHeight: 580,
    title: "k100s",
    backgroundColor: "#f7f8fb",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (isDev) {
    window.loadURL(process.env.ELECTRON_START_URL);
  } else {
    window.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

ipcMain.handle("kubectl:get-contexts", async () => getContexts());
ipcMain.handle("kubectl:get-namespaces", async (_event, context) => getNamespaces(context));
ipcMain.handle("kubectl:get-pods", async (_event, context, namespace) => getPods(context, namespace));
ipcMain.handle("kubectl:start-pods-watch", async (event, options) => {
  startPodsWatch(event.sender, options);
});
ipcMain.handle("kubectl:stop-pods-watch", async (_event, id) => {
  stopPodsWatch(id);
});
ipcMain.handle("kubectl:start-pod-logs", async (event, options) => {
  startPodLogs(event.sender, options);
});
ipcMain.handle("kubectl:stop-pod-logs", async (_event, id) => {
  stopPodLogs(id);
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  for (const id of podWatches.keys()) stopPodsWatch(id);
  for (const id of podLogStreams.keys()) stopPodLogs(id);

  if (process.platform !== "darwin") app.quit();
});
