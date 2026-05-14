use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    io::{BufRead, BufReader, Read},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, State};

const KUBECTL_COMMAND_TIMEOUT: Duration = Duration::from_secs(12);
const KUBECTL_REQUEST_TIMEOUT: &str = "--request-timeout=8s";

#[derive(Clone, Default)]
struct AppState {
    pod_log_streams: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextSummary {
    name: String,
    cluster: String,
    namespace: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ContextsResult {
    contexts: Vec<ContextSummary>,
    current: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PodSummary {
    name: String,
    status: String,
    detail: String,
    ready: String,
    restarts: i64,
    node: String,
    age: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct StartPodLogsOptions {
    id: String,
    context: String,
    namespace: String,
    pod_name: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogDataPayload {
    id: String,
    text: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogErrorPayload {
    id: String,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LogClosedPayload {
    id: String,
    code: Option<i32>,
    signal: Option<String>,
}

fn read_pipe<R: Read + Send + 'static>(mut pipe: R) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut output = Vec::new();
        let _ = pipe.read_to_end(&mut output);
        output
    })
}

fn run_kubectl_blocking(args: Vec<String>, timeout: Duration) -> Result<String, String> {
    let mut child = Command::new("kubectl")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|cause| cause.to_string())?;

    let stdout = child.stdout.take().map(read_pipe);
    let stderr = child.stderr.take().map(read_pipe);
    let deadline = Instant::now() + timeout;
    let timed_out;
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                timed_out = false;
                break status;
            }
            Ok(None) if Instant::now() >= deadline => {
                timed_out = true;
                let _ = child.kill();
                break child.wait().map_err(|cause| cause.to_string())?;
            }
            Ok(None) => thread::sleep(Duration::from_millis(50)),
            Err(cause) => {
                let _ = child.kill();
                return Err(cause.to_string());
            }
        }
    };

    let stdout = stdout
        .map(|handle| handle.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = stderr
        .map(|handle| handle.join().unwrap_or_default())
        .unwrap_or_default();
    let stderr = String::from_utf8_lossy(&stderr).trim().to_string();

    if timed_out {
        let detail = if stderr.is_empty() {
            String::new()
        } else {
            format!(" {stderr}")
        };
        return Err(format!(
            "kubectl timed out after {} seconds.{}",
            timeout.as_secs(),
            detail
        ));
    }

    if !status.success() {
        if stderr.is_empty() {
            return Err(format!("kubectl exited with status {status}"));
        }

        return Err(stderr);
    }

    Ok(String::from_utf8_lossy(&stdout).to_string())
}

async fn run_kubectl(args: Vec<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_kubectl_blocking(args, KUBECTL_COMMAND_TIMEOUT)
    })
    .await
    .map_err(|cause| cause.to_string())?
}

fn string_value(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string()
}

#[tauri::command]
async fn get_contexts() -> Result<ContextsResult, String> {
    let output = run_kubectl(vec![
        "config".into(),
        "view".into(),
        "-o".into(),
        "json".into(),
    ])
    .await?;
    let config: Value = serde_json::from_str(&output).map_err(|cause| cause.to_string())?;
    let current_context = config
        .get("current-context")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    let mut contexts = config
        .get("contexts")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|entry| {
            let name = entry.get("name").and_then(Value::as_str)?.to_string();
            let context = entry.get("context");

            Some(ContextSummary {
                name,
                cluster: string_value(context.and_then(|value| value.get("cluster"))),
                namespace: string_value(context.and_then(|value| value.get("namespace"))),
            })
        })
        .collect::<Vec<_>>();

    contexts.sort_by(|left, right| {
        if left.name == current_context {
            return std::cmp::Ordering::Less;
        }
        if right.name == current_context {
            return std::cmp::Ordering::Greater;
        }
        left.name.cmp(&right.name)
    });

    let current = contexts
        .first()
        .map(|context| context.name.clone())
        .unwrap_or_default();

    Ok(ContextsResult { contexts, current })
}

#[tauri::command]
async fn get_namespaces(context: String) -> Result<Vec<String>, String> {
    let output = run_kubectl(vec![
        "--context".into(),
        context,
        KUBECTL_REQUEST_TIMEOUT.into(),
        "get".into(),
        "namespaces".into(),
        "-o".into(),
        "json".into(),
    ])
    .await?;
    let payload: Value = serde_json::from_str(&output).map_err(|cause| cause.to_string())?;
    let mut namespaces = payload
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| item.pointer("/metadata/name").and_then(Value::as_str))
        .map(ToString::to_string)
        .collect::<Vec<_>>();

    namespaces.sort();
    Ok(namespaces)
}

fn summarize_container_statuses(statuses: &[Value]) -> String {
    if let Some(waiting) = statuses.iter().find_map(|container| {
        container
            .pointer("/state/waiting/reason")
            .and_then(Value::as_str)
    }) {
        return waiting.to_string();
    }

    if let Some(terminated) = statuses.iter().find_map(|container| {
        container
            .pointer("/state/terminated/reason")
            .and_then(Value::as_str)
    }) {
        return terminated.to_string();
    }

    if !statuses.is_empty()
        && statuses.iter().all(|container| {
            container
                .get("ready")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
    {
        return "Ready".to_string();
    }

    "Running".to_string()
}

fn summarize_pod(pod: &Value) -> Option<PodSummary> {
    let name = pod
        .pointer("/metadata/name")
        .and_then(Value::as_str)?
        .to_string();
    let statuses = pod
        .pointer("/status/containerStatuses")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let container_count = if statuses.is_empty() {
        pod.pointer("/spec/containers")
            .and_then(Value::as_array)
            .map(|containers| containers.len())
            .unwrap_or_default()
    } else {
        statuses.len()
    };
    let ready_count = statuses
        .iter()
        .filter(|container| {
            container
                .get("ready")
                .and_then(Value::as_bool)
                .unwrap_or(false)
        })
        .count();
    let restarts = statuses
        .iter()
        .map(|container| {
            container
                .get("restartCount")
                .and_then(Value::as_i64)
                .unwrap_or_default()
        })
        .sum();

    Some(PodSummary {
        name,
        status: string_value(pod.pointer("/status/phase")),
        detail: summarize_container_statuses(&statuses),
        ready: format!("{ready_count}/{container_count}"),
        restarts,
        node: string_value(pod.pointer("/spec/nodeName")),
        age: string_value(pod.pointer("/metadata/creationTimestamp")),
    })
}

#[tauri::command]
async fn get_pods(context: String, namespace: String) -> Result<Vec<PodSummary>, String> {
    let output = run_kubectl(vec![
        "--context".into(),
        context,
        "-n".into(),
        namespace,
        KUBECTL_REQUEST_TIMEOUT.into(),
        "get".into(),
        "pods".into(),
        "-o".into(),
        "json".into(),
    ])
    .await?;
    let payload: Value = serde_json::from_str(&output).map_err(|cause| cause.to_string())?;
    let mut pods = payload
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(summarize_pod)
        .collect::<Vec<_>>();

    pods.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(pods)
}

#[tauri::command]
async fn describe_pod(
    context: String,
    namespace: String,
    pod_name: String,
) -> Result<String, String> {
    run_kubectl(vec![
        "--context".into(),
        context,
        "-n".into(),
        namespace,
        KUBECTL_REQUEST_TIMEOUT.into(),
        "describe".into(),
        "pod".into(),
        pod_name,
    ])
    .await
}

fn owner_reference_name(payload: &Value, kind: &str) -> Option<String> {
    payload
        .pointer("/metadata/ownerReferences")
        .and_then(Value::as_array)?
        .iter()
        .find(|owner| owner.get("kind").and_then(Value::as_str) == Some(kind))
        .and_then(|owner| owner.get("name").and_then(Value::as_str))
        .map(ToString::to_string)
}

#[tauri::command]
async fn describe_deployment_for_pod(
    context: String,
    namespace: String,
    pod_name: String,
) -> Result<String, String> {
    let pod_output = run_kubectl(vec![
        "--context".into(),
        context.clone(),
        "-n".into(),
        namespace.clone(),
        KUBECTL_REQUEST_TIMEOUT.into(),
        "get".into(),
        "pod".into(),
        pod_name.clone(),
        "-o".into(),
        "json".into(),
    ])
    .await?;
    let pod: Value = serde_json::from_str(&pod_output).map_err(|cause| cause.to_string())?;

    let deployment_name = if let Some(name) = owner_reference_name(&pod, "Deployment") {
        name
    } else if let Some(replica_set_name) = owner_reference_name(&pod, "ReplicaSet") {
        let replica_set_output = run_kubectl(vec![
            "--context".into(),
            context.clone(),
            "-n".into(),
            namespace.clone(),
            KUBECTL_REQUEST_TIMEOUT.into(),
            "get".into(),
            "replicaset".into(),
            replica_set_name.clone(),
            "-o".into(),
            "json".into(),
        ])
        .await?;
        let replica_set: Value =
            serde_json::from_str(&replica_set_output).map_err(|cause| cause.to_string())?;

        owner_reference_name(&replica_set, "Deployment").ok_or_else(|| {
            format!("Pod {pod_name} is owned by ReplicaSet {replica_set_name}, which is not owned by a Deployment.")
        })?
    } else {
        return Err(format!("No owning Deployment found for pod {pod_name}."));
    };

    run_kubectl(vec![
        "--context".into(),
        context,
        "-n".into(),
        namespace,
        KUBECTL_REQUEST_TIMEOUT.into(),
        "describe".into(),
        "deployment".into(),
        deployment_name,
    ])
    .await
}

fn stop_pod_logs_by_id(state: &AppState, id: &str) {
    let child = state.pod_log_streams.lock().unwrap().remove(id);
    if let Some(child) = child {
        let _ = child.lock().unwrap().kill();
    }
}

#[tauri::command]
fn start_pod_logs(
    app: AppHandle,
    state: State<'_, AppState>,
    options: StartPodLogsOptions,
) -> Result<(), String> {
    let app_state = state.inner().clone();
    stop_pod_logs_by_id(&app_state, &options.id);

    let mut child = Command::new("kubectl")
        .args([
            "--context",
            &options.context,
            "-n",
            &options.namespace,
            "logs",
            &options.pod_name,
            "--follow",
            "--tail=200",
            "--timestamps",
            "--all-containers=true",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|cause| cause.to_string())?;

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let child = Arc::new(Mutex::new(child));

    app_state
        .pod_log_streams
        .lock()
        .unwrap()
        .insert(options.id.clone(), child.clone());

    if let Some(stdout) = stdout {
        let app = app.clone();
        let id = options.id.clone();
        thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();

            loop {
                line.clear();
                match reader.read_line(&mut line) {
                    Ok(0) => break,
                    Ok(_) => {
                        let _ = app.emit(
                            "kubectl:pod-logs-data",
                            LogDataPayload {
                                id: id.clone(),
                                text: line.clone(),
                            },
                        );
                    }
                    Err(cause) => {
                        let _ = app.emit(
                            "kubectl:pod-logs-error",
                            LogErrorPayload {
                                id: id.clone(),
                                message: cause.to_string(),
                            },
                        );
                        break;
                    }
                }
            }
        });
    }

    if let Some(stderr) = stderr {
        let app = app.clone();
        let id = options.id.clone();
        thread::spawn(move || {
            for line in BufReader::new(stderr).lines().map_while(Result::ok) {
                if !line.trim().is_empty() {
                    let _ = app.emit(
                        "kubectl:pod-logs-error",
                        LogErrorPayload {
                            id: id.clone(),
                            message: line,
                        },
                    );
                }
            }
        });
    }

    let app = app.clone();
    let wait_state = app_state.clone();
    let id = options.id.clone();
    thread::spawn(move || loop {
        let status = child.lock().unwrap().try_wait();

        match status {
            Ok(Some(status)) => {
                let code = status.code();
                wait_state.pod_log_streams.lock().unwrap().remove(&id);
                let _ = app.emit(
                    "kubectl:pod-logs-closed",
                    LogClosedPayload {
                        id: id.clone(),
                        code,
                        signal: None,
                    },
                );
                break;
            }
            Ok(None) => thread::sleep(Duration::from_millis(250)),
            Err(cause) => {
                wait_state.pod_log_streams.lock().unwrap().remove(&id);
                let _ = app.emit(
                    "kubectl:pod-logs-error",
                    LogErrorPayload {
                        id: id.clone(),
                        message: cause.to_string(),
                    },
                );
                break;
            }
        }
    });

    Ok(())
}

#[tauri::command]
fn stop_pod_logs(state: State<'_, AppState>, id: String) -> Result<(), String> {
    stop_pod_logs_by_id(state.inner(), &id);
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            get_contexts,
            get_namespaces,
            get_pods,
            describe_pod,
            describe_deployment_for_pod,
            start_pod_logs,
            stop_pod_logs
        ])
        .run(tauri::generate_context!())
        .expect("error while running k100s");
}
