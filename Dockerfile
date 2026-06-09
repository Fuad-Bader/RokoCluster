# syntax=docker/dockerfile:1
#
# Single-image build: compiles the React frontend and the Node backend, then
# ships a slim runtime where the backend serves the static frontend and proxies
# to the cluster using its in-cluster service account.
#
# The frontend and backend are built independently (no workspace coupling) so
# the Electron workspace is never needed inside the image.

# ---- Build stage -----------------------------------------------------------
FROM node:22-bookworm-slim AS build

# Frontend: install deps, then build the static bundle.
WORKDIR /app/frontend
COPY frontend/package.json ./
RUN npm install --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# Backend: install deps, then compile TypeScript to dist/.
WORKDIR /app/backend
COPY backend/package.json ./
RUN npm install --no-audit --no-fund
COPY backend/ ./
RUN npm run build

# ---- Runtime stage ---------------------------------------------------------
FROM node:22-bookworm-slim AS runtime
WORKDIR /app/backend
ENV NODE_ENV=production \
    PORT=4000 \
    KUBE_AUTH=in-cluster \
    STATIC_DIR=/app/frontend

# Install production-only backend dependencies.
COPY backend/package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund

# Copy compiled output: backend dist + built frontend assets.
COPY --from=build /app/backend/dist ./dist
COPY --from=build /app/frontend/dist /app/frontend

EXPOSE 4000
USER node
CMD ["node", "dist/index.js"]
