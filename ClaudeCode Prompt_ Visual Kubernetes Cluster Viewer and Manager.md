# ClaudeCode Prompt: Visual Kubernetes Cluster Viewer and Manager

## Project Goal

Develop a web-based, visual Kubernetes cluster viewer and manager application. The application should provide an interactive, Obsidian-style force-directed graph visualization of Kubernetes resources (nodes, pods, containers, deployments, services, namespaces) and integrate functionality for executing `kubectl` commands directly from the UI.

## System Architecture

The application will follow a client-server architecture:

- **Frontend:** A React (TypeScript) application responsible for the user interface, graph visualization, and interactive terminal.
- **Backend:** A Node.js (or Go) API server that acts as a proxy to the Kubernetes API, handles real-time data streaming, and manages `kubectl` command execution.

## Frontend Requirements

### 1. Graph Visualization

- **Library:** Utilize `react-force-graph` (which uses `d3-force-3d`) for rendering the graph.
- **Nodes:** Represent Kubernetes resources (Nodes, Pods, Containers, Deployments, Services, Namespaces). Each node should display its name and type, and potentially status indicators.
- **Edges:** Represent relationships between resources (e.g., Pod runs on Node, Container belongs to Pod, Deployment manages Pods, Service targets Pods, Resources belong to Namespace).
- **Interactivity:**
  _ **Force-directed layout:** Implement a stable force-directed layout with configurable parameters (link strength, charge, collision detection).
  _ **Obsidian-like behavior:** Aim for a
  stable relaxation and local drag influence, similar to Obsidian's graph view, where dragging a node primarily affects its immediate neighbors and the graph quickly settles.
  _ **Zoom and Pan:** Allow users to navigate the graph using zoom and pan functionalities.
  _ **Node Dragging:** Enable users to drag individual nodes to rearrange the layout.
  _ **Hover Effects:** Highlight nodes and their connected edges on hover.
  _ **Click Actions:** Display a detailed information panel for a selected node on click.
- **Styling:**
  - Differentiate resource types using distinct colors, icons, and potentially node sizes.
  - Visually indicate resource status (e.g., running, pending, error) on the nodes.

### 2. Resource Detail Panel

- A dedicated UI panel that displays comprehensive information (YAML/JSON view, events, status, labels, annotations) of the currently selected Kubernetes resource.
- Include context-sensitive action buttons based on the resource type (e.g., "Restart Pod", "Scale Deployment", "Delete Service").

### 3. `kubectl` Command Interface

- **Command Buttons:** A set of clearly labeled UI buttons for common `kubectl` operations (e.g., `get pods`, `describe pod <name>`, `logs <pod>`, `exec -it <pod> -- bash`).
- **Integrated Terminal:** Embed an `xterm.js` instance to provide an interactive terminal for executing arbitrary `kubectl` commands.
- **Real-time Output:** Stream command output and logs from the backend to the `xterm.js` terminal in real-time.

### 4. Search and Filtering

- Implement a global search bar to find resources by name, type, or label.
- Provide filtering options based on resource type, namespace, status, and custom labels.

## Backend Requirements

### 1. Technology Stack

- **Language/Framework:** Node.js with Express.js (or Fastify) for RESTful API endpoints and WebSocket handling. (Go with Gin/Echo is an alternative if Node.js presents performance bottlenecks for real-time streaming).
- **Kubernetes Client Library:** Use `kubernetes-client/javascript` for Node.js to interact with the Kubernetes API.

### 2. Kubernetes API Interaction

- **Authentication:** Implement secure authentication with the Kubernetes API using service accounts or user-provided kubeconfig credentials.
- **Authorization:** Respect Kubernetes RBAC for all operations.
- **Real-time Updates (Watch API):** Establish WebSocket connections with the Kubernetes API to `watch` for changes in resources (Pods, Deployments, Services, Nodes, etc.) and push these updates to the frontend via WebSockets.
- **`kubectl` Command Proxy:** Expose API endpoints that proxy `kubectl` commands to the Kubernetes API. This includes:
  - `exec`: For interactive shell access to containers (via WebSockets).
  - `logs`: For streaming container logs (via WebSockets).
  - `get`, `describe`, `delete`, `scale`, etc.: For standard CRUD operations.

### 3. Data Management

- **Caching:** Implement an in-memory cache for frequently accessed Kubernetes resource data to minimize direct calls to the Kubernetes API and improve responsiveness.
- **Data Transformation:** Transform raw Kubernetes API responses into a format suitable for graph visualization and UI display.

## Kubernetes Interaction Details

- The application will communicate with the Kubernetes API server directly (via the backend proxy).
- Utilize the Kubernetes `watch` API for efficient, real-time updates of resource states.
- For `exec` and `logs` commands, the backend will establish WebSocket connections with the Kubernetes API and relay the data to the frontend `xterm.js` instance.

## Security Considerations

- All communication between the frontend and backend, and between the backend and Kubernetes API, must be secured (HTTPS/WSS).
- Implement robust authentication and authorization mechanisms.
- Sanitize all user inputs to prevent injection attacks.
- Ensure the backend service account has only the necessary RBAC permissions.

## Deployment

- The application should be containerized (Docker) for easy deployment to any Kubernetes cluster or other container orchestration platforms.
- The application should be deployed as a desktop application as well running using electron JS.
- Provide clear instructions for building and deploying the frontend and backend components.

## Deliverables

- **Frontend Application:** Complete React (TypeScript) application with graph visualization, resource detail panel, `kubectl` command buttons, and integrated `xterm.js` terminal.
- **Desktop Application:** Complete React (TypeScript) application on top of electron with graph visualization, resource detail panel, `kubectl` command buttons, and integrated `xterm.js` terminal.
- **Backend API Server:** Complete Node.js (or Go) application with Kubernetes API proxy, WebSocket handling for real-time updates and `kubectl` interactive commands, and caching.
- **Deployment Manifests:** Example Kubernetes YAML manifests for deploying the frontend and backend components to a cluster.
- **README.md:** Comprehensive documentation covering setup, configuration, usage, and development guidelines.

## Key Libraries/Technologies to Use

- **Frontend:** React, TypeScript, `react-force-graph`, `d3-force-3d`, `xterm.js`, WebSocket API, Tailwind CSS (or similar).
- **Desktop:** React, Electron, TypeScript, `react-force-graph`, `d3-force-3d`, `xterm.js`, WebSocket API, Tailwind CSS (or similar).
- **Backend:** Node.js, Express.js (or Fastify), `kubernetes-client/javascript`, WebSocket library (e.g., `ws`).

This prompt provides a detailed blueprint for developing the Kubernetes Cluster Viewer and Manager. The goal is to create a highly interactive and visually intuitive tool for managing Kubernetes resources.
