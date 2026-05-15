#!/usr/bin/env bash
set -euo pipefail

CLUSTER_NAME="${K100S_DEMO_CLUSTER:-k100s-demo}"
CONTEXT="kind-${CLUSTER_NAME}"
DEMO_KUBECONFIG="${K100S_DEMO_KUBECONFIG:-$HOME/.kube/k100s-demo.kubeconfig}"

usage() {
  cat <<EOF
Usage: scripts/demo-cluster.sh [up|down|reset|status]

Creates a local kind cluster with sample namespaces, deployments, pods, logs,
and a few unhealthy workloads for k100s screenshots.

Requirements:
  - Docker running
  - kind
  - kubectl

The cluster kubeconfig is written to:
  $DEMO_KUBECONFIG
EOF
}

need_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

cluster_exists() {
  kind get clusters | grep -Fxq "$CLUSTER_NAME"
}

kubectl_demo() {
  kubectl --kubeconfig "$DEMO_KUBECONFIG" --context "$CONTEXT" "$@"
}

create_cluster() {
  if cluster_exists; then
    echo "kind cluster $CLUSTER_NAME already exists."
    return
  fi

  mkdir -p "$(dirname "$DEMO_KUBECONFIG")"
  kind create cluster --name "$CLUSTER_NAME" --kubeconfig "$DEMO_KUBECONFIG" --config - <<EOF
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
  - role: control-plane
  - role: worker
  - role: worker
EOF
}

apply_demo_workloads() {
  kubectl_demo apply -f - <<'EOF'
apiVersion: v1
kind: Namespace
metadata:
  name: k100s-demo
---
apiVersion: v1
kind: Namespace
metadata:
  name: k100s-observability
---
apiVersion: v1
kind: Namespace
metadata:
  name: k100s-failures
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: frontend
  namespace: k100s-demo
spec:
  replicas: 3
  selector:
    matchLabels:
      app: frontend
  template:
    metadata:
      labels:
        app: frontend
        tier: web
    spec:
      containers:
        - name: web
          image: nginx:1.27-alpine
          ports:
            - containerPort: 80
          readinessProbe:
            httpGet:
              path: /
              port: 80
            initialDelaySeconds: 2
            periodSeconds: 5
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: api
  namespace: k100s-demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: api
  template:
    metadata:
      labels:
        app: api
        tier: backend
    spec:
      containers:
        - name: api
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              i=0
              while true; do
                i=$((i + 1))
                echo "{\"level\":\"info\",\"service\":\"api\",\"message\":\"request completed\",\"path\":\"/v1/pods\",\"status\":200,\"duration_ms\":$((35 + i % 90)),\"request_id\":\"demo-$i\"}"
                sleep 2
              done
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
  namespace: k100s-demo
spec:
  replicas: 2
  selector:
    matchLabels:
      app: worker
  template:
    metadata:
      labels:
        app: worker
        tier: jobs
    spec:
      containers:
        - name: worker
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              i=0
              while true; do
                i=$((i + 1))
                echo "worker processed queue=payments count=$((1 + i % 25))"
                sleep 4
              done
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: log-stream
  namespace: k100s-observability
spec:
  replicas: 2
  selector:
    matchLabels:
      app: log-stream
  template:
    metadata:
      labels:
        app: log-stream
        tier: telemetry
    spec:
      containers:
        - name: logs
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              i=0
              while true; do
                i=$((i + 1))
                echo "{\"level\":\"info\",\"source\":\"demo\",\"message\":\"synthetic log event\",\"sequence\":$i,\"namespace\":\"k100s-observability\"}"
                sleep 1
              done
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cache
  namespace: k100s-observability
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cache
  template:
    metadata:
      labels:
        app: cache
        tier: data
    spec:
      containers:
        - name: cache
          image: redis:7-alpine
          ports:
            - containerPort: 6379
---
apiVersion: v1
kind: Pod
metadata:
  name: crash-loop-demo
  namespace: k100s-failures
  labels:
    app: crash-loop-demo
spec:
  restartPolicy: Always
  containers:
    - name: crash
      image: busybox:1.36
      command:
        - sh
        - -c
        - |
          echo "{\"level\":\"error\",\"message\":\"demo crash before restart\",\"reason\":\"screenshot fixture\"}"
          exit 1
---
apiVersion: v1
kind: Pod
metadata:
  name: image-pull-demo
  namespace: k100s-failures
  labels:
    app: image-pull-demo
spec:
  containers:
    - name: missing
      image: ghcr.io/andrewvos/k100s-demo-missing-image:never
      imagePullPolicy: Always
---
apiVersion: v1
kind: Pod
metadata:
  name: pending-demo
  namespace: k100s-failures
  labels:
    app: pending-demo
spec:
  containers:
    - name: sleeper
      image: busybox:1.36
      command: ["sh", "-c", "sleep 3600"]
      resources:
        requests:
          cpu: "1000"
          memory: "8Gi"
EOF
}

wait_for_demo() {
  kubectl_demo wait --for=condition=Ready nodes --all --timeout=180s
  kubectl_demo -n k100s-demo wait --for=condition=Available deployment --all --timeout=180s
  kubectl_demo -n k100s-observability wait --for=condition=Available deployment --all --timeout=180s
}

up() {
  need_command docker
  need_command kind
  need_command kubectl

  create_cluster
  apply_demo_workloads
  wait_for_demo
  kubectl --kubeconfig "$DEMO_KUBECONFIG" config use-context "$CONTEXT" >/dev/null

  cat <<EOF

Demo cluster is ready.

Context:    $CONTEXT
Kubeconfig: $DEMO_KUBECONFIG
Namespaces: k100s-demo, k100s-observability, k100s-failures

Launch k100s with this kubeconfig for screenshots:

  KUBECONFIG="$DEMO_KUBECONFIG" bun run dev

Then select $CONTEXT. The failures namespace intentionally contains
CrashLoopBackOff, ImagePullBackOff, and Pending pods for screenshot coverage.
EOF
}

down() {
  need_command kind

  if cluster_exists; then
    kind delete cluster --name "$CLUSTER_NAME"
  else
    echo "kind cluster $CLUSTER_NAME does not exist."
  fi
}

status() {
  need_command kubectl

  kubectl_demo get namespaces
  kubectl_demo get pods -A -o wide
}

case "${1:-up}" in
  up)
    up
    ;;
  down)
    down
    ;;
  reset)
    down
    up
    ;;
  status)
    status
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage >&2
    exit 1
    ;;
esac
