# k100s

A small Tauri desktop app for browsing Kubernetes contexts, namespaces, pods, logs, and pod descriptions.

## Requirements

- [Bun](https://bun.sh/)
- [Rust](https://www.rust-lang.org/tools/install)
- `kubectl` installed and available on your `PATH`
- A configured kubeconfig with one or more contexts

## Development

```sh
bun install
bun run dev
```

The React renderer runs on `http://127.0.0.1:5173/`, and Tauri loads that URL during development.

Pods refresh automatically every 5 seconds while auto refresh is enabled. The refresh uses `kubectl get pods -o json` through Tauri commands.

## Build

```sh
bun run build
```

The Tauri Rust backend calls `kubectl` directly and exposes commands/events to the renderer.
