const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("k100s", {
  getContexts: () => ipcRenderer.invoke("kubectl:get-contexts"),
  getNamespaces: (context) => ipcRenderer.invoke("kubectl:get-namespaces", context),
  getPods: (context, namespace) => ipcRenderer.invoke("kubectl:get-pods", context, namespace),
  startPodLogs: (options) => ipcRenderer.invoke("kubectl:start-pod-logs", options),
  stopPodLogs: (id) => ipcRenderer.invoke("kubectl:stop-pod-logs", id),
  onPodLogsData: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("kubectl:pod-logs-data", listener);
    return () => ipcRenderer.removeListener("kubectl:pod-logs-data", listener);
  },
  onPodLogsError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("kubectl:pod-logs-error", listener);
    return () => ipcRenderer.removeListener("kubectl:pod-logs-error", listener);
  },
  onPodLogsClosed: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("kubectl:pod-logs-closed", listener);
    return () => ipcRenderer.removeListener("kubectl:pod-logs-closed", listener);
  }
});
