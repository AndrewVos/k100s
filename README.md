# k100s

A small Electron desktop app for browsing Kubernetes contexts, namespaces, and pods.

## Requirements

- [Bun](https://bun.sh/)
- `kubectl` installed and available on your `PATH`
- A configured kubeconfig with one or more contexts

## Development

```sh
bun install
bun run dev
```

The React renderer runs on `http://127.0.0.1:5173/`, and Electron loads that URL during development.

Pods refresh automatically every 5 seconds while auto refresh is enabled. The refresh still uses `kubectl get pods -o json` through the Electron main process.

## Build

```sh
bun run build
```

The Electron main process calls `kubectl` directly and exposes a small read-only API to the renderer through `electron/preload.cjs`.
