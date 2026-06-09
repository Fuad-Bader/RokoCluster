# RokoCluster — Visual Kubernetes Viewer & Manager

An interactive, Obsidian-style force-directed graph of your Kubernetes cluster,
with a resource detail panel, context-sensitive actions (scale / restart /
delete), live `watch`-driven updates, and an integrated `xterm.js` terminal for
streaming logs and interactive `exec` shells.

Runs as a **web app**, a **single deployable container**, or an **Electron
desktop app** — all from one codebase.

```
┌──────────────┐   REST + WebSocket   ┌──────────────┐   client-go/watch   ┌────────────┐
│  React UI    │ ───────────────────▶ │  Node backend │ ──────────────────▶ │ Kubernetes │
│ force-graph  │ ◀─── live graph ──── │  Express + ws │ ◀── exec / logs ─── │    API     │
│  xterm.js    │                      │  cache + RBAC │                     └────────────┘
└──────────────┘                      └──────────────┘
```

## Architecture

| Layer | Stack | Responsibility |
|-------|-------|----------------|
| **Frontend** (`frontend/`) | React + TypeScript, Vite, Tailwind, `react-force-graph-2d`, `@xterm/xterm`, Zustand | Graph visualization, detail panel, kubectl toolbar, terminal, search/filter |
| **Backend** (`backend/`) | Node.js + Express, `ws`, `@kubernetes/client-node` | Watch streaming, graph transform, in-memory cache, exec/logs WebSocket bridges, resource actions |
| **Desktop** (`electron/`) | Electron | Launches the backend and loads the UI as a native window |
| **Deploy** (`k8s/`, `Dockerfile`) | Docker, Kubernetes manifests | Single-image container, least-privilege RBAC |

### How resources become a graph

The backend mirrors the cluster in memory via the Kubernetes **watch API**
(`backend/src/k8s/store.ts`) and transforms it into a node/link model
(`backend/src/k8s/graph.ts`):

- **Nodes:** Namespace, Node, Deployment, Pod, Container, Service
- **Edges:** `Namespace contains *`, `Deployment manages Pod`, `Pod runs-on Node`,
  `Pod contains Container`, `Service targets Pod` (selector match)

Every change is debounced and pushed to all connected clients over
`/ws/updates`. The frontend **merges** updates in place
(`frontend/src/store/useStore.ts`) so node positions persist — the layout
relaxes smoothly instead of exploding on each tick, mimicking Obsidian's graph.

## Prerequisites

- **Node.js ≥ 20**
- A reachable cluster and a working `kubectl` context (`~/.kube/config`), or
  run inside the cluster with the provided service account.

## Quick start (development)

```bash
# from the repo root — installs all workspaces
npm install

# run backend (:4000) and frontend (:5173) together
npm run dev
```

Open <http://localhost:5173>. On first load the app prompts you to **connect a
cluster** — upload (or paste) a kubeconfig in the dialog and it connects live.
See [Connecting to a cluster](#connecting-to-a-cluster) for the other modes.

Run them separately if you prefer:

```bash
npm run dev:backend     # tsx watch, http://localhost:4000
npm run dev:frontend    # vite,      http://localhost:5173
```

## Production build

```bash
npm run build           # builds backend (tsc) + frontend (vite)

# serve the built UI from the backend on a single port
STATIC_DIR=../frontend/dist PORT=4000 npm run start
# → http://localhost:4000
```

## Desktop app (Electron)

```bash
# dev: loads the Vite dev server (run `npm run dev:frontend` first)
npm run electron:dev

# packaged: build everything, then launch the bundled backend + UI
npm run build
npm run electron        # or: npm --workspace electron run dist  (installers)
```

The desktop build uses your **local kubeconfig** (`KUBE_AUTH=default`), so it
manages exactly the cluster `kubectl` would.

## Connecting to a cluster

`KUBE_AUTH` controls how the backend gets its **initial** connection. Regardless
of the mode, you can always upload a different kubeconfig from the UI at runtime
(the header **🔌 connect cluster** button) to switch clusters.

| `KUBE_AUTH` | Behavior | Use for |
|-------------|----------|---------|
| `upload` _(default)_ | Start with **no** connection; upload a kubeconfig in the UI | Web / Docker — no kubeconfig on the server |
| `default` | Load the local kubeconfig (`~/.kube/config`) on startup | Local dev, desktop app |
| `in-cluster` | Use the mounted service-account token | Deployed in the cluster |

The uploaded kubeconfig is held **in memory only** by the backend and is never
written to disk. If it contains multiple contexts, the connect dialog lets you
switch between them.

## Docker

```bash
docker build -t roko-cluster:latest .

# Default: start with no connection, then upload your kubeconfig in the UI.
docker run --rm -p 4000:4000 roko-cluster:latest
# → http://localhost:4000

# Or auto-load a mounted kubeconfig instead of uploading:
docker run --rm -p 4000:4000 \
  -e KUBE_AUTH=default \
  -v $HOME/.kube:/home/node/.kube:ro \
  roko-cluster:latest
```

Or with Compose (`docker compose up --build`) — see `docker-compose.yml`.

## Deploy to a cluster

The container serves the UI and uses its in-cluster service account.

```bash
# 1. build & push your image, then set it in k8s/deployment.yaml
#    image: ghcr.io/your-org/roko-cluster:latest

kubectl apply -f k8s/namespace.yaml
kubectl apply -f k8s/rbac.yaml         # least-privilege ServiceAccount + ClusterRole
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/service.yaml

# reach it locally
kubectl -n roko port-forward svc/roko-cluster 4000:80
# → http://localhost:4000
```

See `k8s/service.yaml` for an Ingress example to expose it externally.

## Configuration

Backend (see `backend/.env.example`):

| Variable | Default | Purpose |
|----------|---------|---------|
| `PORT` | `4000` | HTTP/WS listen port |
| `KUBE_AUTH` | `upload` | `upload` (connect in UI), `default` (local kubeconfig), or `in-cluster` |
| `CORS_ORIGINS` | dev origins | Comma-separated allow-list |
| `STATIC_DIR` | _unset_ | Serve a built frontend from this dir |
| `CACHE_TTL_MS` | `5000` | Detail/manifest cache TTL |
| `REBUILD_DEBOUNCE_MS` | `300` | Watch-event coalescing window |

## API surface

REST (`/api`):

- `GET /health` — liveness/readiness
- `GET /connect/status` — connection status (configured?, source, context, available contexts)
- `POST /connect/kubeconfig` `{kubeconfig, context?}` — upload a kubeconfig and connect
- `POST /connect/context` `{context}` — switch context within the loaded kubeconfig
- `POST /connect/disconnect` — drop the in-memory config and clear the graph
- `GET /graph` — current graph snapshot
- `GET /resource?kind=&name=&namespace=&container=` — manifest + recent events
- `POST /actions/scale` `{namespace,name,replicas}`
- `POST /actions/restart` `{namespace,name}` — rollout restart a Deployment
- `POST /actions/delete` `{kind,namespace,name}` — Pod / Service / Deployment

WebSocket:

- `/ws/updates` — live graph snapshots (broadcast on every cluster change)
- `/ws/exec?namespace=&pod=&container=&command=` — interactive shell
- `/ws/logs?namespace=&pod=&container=&tail=` — streaming logs

## Security

- All object names are validated against DNS-1123 before reaching the API
  (`backend/src/routes/validate.ts`) to prevent path/parameter injection.
- `exec` is restricted to a fixed set of shells (`/bin/sh`, `/bin/bash`).
- An uploaded kubeconfig is kept in process memory only (never persisted) and is
  size-capped. Since it carries cluster credentials, run the backend over TLS and
  treat the endpoint as privileged — front it with auth if exposed beyond
  localhost.
- Authorization is delegated entirely to **Kubernetes RBAC** — the app can only
  do what its identity is allowed to (see `k8s/rbac.yaml`). Scope the role to
  specific namespaces (swap `ClusterRole`/`ClusterRoleBinding` for
  `Role`/`RoleBinding`) to lock it down further.
- Run behind TLS (HTTPS/WSS) in production — terminate at your ingress/load
  balancer; the WebSocket URLs auto-upgrade to `wss://` on `https://` origins.
- The container runs as non-root with a read-only root filesystem and all
  capabilities dropped.

## Project layout

```
RokoCluster/
├── backend/        Express + ws + @kubernetes/client-node
│   └── src/
│       ├── k8s/    client, store/watch, graph transform, exec, logs
│       ├── routes/ meta, detail, actions, input validation
│       └── ws/     WebSocket routing (updates / exec / logs)
├── frontend/       React + Vite + Tailwind
│   └── src/
│       ├── components/  GraphView, DetailPanel, TerminalPanel, Sidebar, Header
│       ├── store/       Zustand store (graph merge + WS lifecycle)
│       └── lib/         api client, filters, palette, resource helpers
├── electron/       Desktop shell (main + preload)
├── k8s/            namespace, rbac, deployment, service
├── Dockerfile      single-image build (UI served by backend)
└── README.md
```

## Development notes

- **Type-check:** `npm --workspace backend run typecheck` /
  `npm --workspace frontend run typecheck`
- The graph model is intentionally duplicated in `backend/src/types.ts` and
  `frontend/src/types.ts` so neither package builds against the other.
- Layout tuning (forces, link distances, drag-to-pin) lives in
  `frontend/src/components/GraphView.tsx`.

## Roadmap

Resource create/edit forms, saved/custom views, Prometheus/Grafana metrics
overlay, and multi-cluster switching (see the design docs in the repo root).
