# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Overview

Monorepo for [Open Cluster Management (OCM)](https://open-cluster-management.io/) experimental lab projects. Three independent projects live as top-level directories, each with its own `OWNERS`, `Makefile`, and Helm chart.

## Projects

- **fleetconfig-controller** — Go/Kubebuilder Kubernetes operator for declarative OCM multi-cluster orchestration. Manages `Hub` and `Spoke` custom resources (v1beta1 API). Runs in two modes: hub manager (`InstanceTypeManager`) or spoke agent (`InstanceTypeAgent`).
- **dashboard** — Full-stack OCM UI. React 19 + MUI 7 + Vite frontend, Go + Gin backend split into `apiserver/` (REST API on :8080) and `uiserver/` (static files + reverse proxy on :3000). Real-time cluster updates via SSE.
- **vscode-extension** — TypeScript VSCode extension for OCM development (snippets, cluster management, local Kind environment bootstrap).

## Build & Test Commands

All projects must implement these required `make` targets: `check-diff`, `test-unit`, `test-e2e`, `images`, `image-push`, `image-manifest`, `image-manifest-annotate`, `image-manifest-push`.

### fleetconfig-controller (run from `fleetconfig-controller/`)

```bash
make build              # Build manager binary
make test-unit          # Unit tests (uses envtest, runs go fmt/vet/generate first)
make test-e2e           # E2E tests via Ginkgo (needs Kind clusters)
make test-e2e LABEL_FILTER=v1beta1  # Filter e2e by label (default: v1beta1)
make check-diff         # Verify code is reviewable (fmt, vet, lint, generate, manifests, helm-doc-gen)
make manifests          # Generate CRDs and webhook configs
make generate           # Generate deepcopy methods
make helm-doc-gen       # Generate Helm chart README from values.yaml
make lint               # golangci-lint (config in .golangci.yml)
make images             # Build all container image variants (base, eks, gke)
```

### dashboard (run from `dashboard/`)

```bash
make build              # Build frontend + both Go servers
make test               # Run all tests (frontend + apiserver + uiserver)
make test-apiserver     # Go tests: cd apiserver && go test ./...
make test-uiserver      # Go tests: cd uiserver && go test ./...
make test-frontend      # npm run test
make lint               # ESLint + go vet for both servers
make dev-ui             # Vite dev server for frontend
make dev-apiserver      # Run API server with mock data
make dev-apiserver-real # Run API server against real cluster
make dev-uiserver       # Build JS then run UI Gin server
```

### vscode-extension (run from `vscode-extension/`)

```bash
npm run compile         # Build TypeScript
npm run test            # Run Mocha tests
npm run lint            # ESLint
```

## Architecture Notes

### fleetconfig-controller

- **Kubebuilder v4 project** — CRDs defined with `+kubebuilder:` markers in `api/v1beta1/` (current) and `api/v1alpha1/` (legacy/deprecated).
- **Controller-runtime** reconciliation in `internal/controller/` — separate reconcilers for Hub and Spoke resources.
- **`internal/exec/`** wraps `clusteradm` CLI for OCM operations (init, join, accept).
- **Admission webhooks** in `internal/webhook/` for validation and defaulting.
- **Two operating modes**: `addonMode: true` (recommended, agent on spoke) vs `addonMode: false` (hub manages spokes directly, EKS only).
- **DevSpace** (`devspace.yaml`) orchestrates local dev with Kind clusters. Profiles: `v1alpha1`, `v1beta1`.
- **Image variants**: `base` (generic), `eks`, `gke` — built from separate Dockerfiles in `build/`.
- CRD manifests are output to `charts/fleetconfig-controller/crds/`.
- Vendored dependencies (uses `go mod vendor`).

### dashboard

- Two-container deployment: `dashboard-api` and `dashboard-ui`, each with its own Dockerfile (`Dockerfile.api`, `Dockerfile.ui`).
- **Backend**: Go + Gin REST API (`apiserver/`) uses OCM typed clients from `open-cluster-management.io/api` (v1.2.0+). Handlers in `apiserver/pkg/handlers/`, models in `apiserver/pkg/models/`, routes in `apiserver/pkg/server/server.go`. The `OCMClient` struct in `apiserver/pkg/client/ocm.go` wraps cluster, work, and addon typed clientsets plus a dynamic client.
- **Frontend**: React 19 + MUI 7 + Vite. Pages in `src/components/`, API services in `src/api/`. Each API service has mock data for dev mode (`import.meta.env.DEV && !import.meta.env.VITE_USE_REAL_API`). Uses `@xyflow/react` for flow chart visualizations.
- **Key OCM resources exposed**: ManagedClusters, ManagedClusterSets, Placements, ManifestWorks, ManifestWorkReplicaSets (v1alpha1), Resources (extracted from ManifestWork specs), Addons. SSE streaming for cluster updates. StatusFeedback values (synced from spoke clusters via OCM FeedbackRules) are extracted and displayed throughout resource detail views.
- Frontend auth via Bearer token in localStorage; backend validates via Kubernetes TokenReview (bypassable with `DASHBOARD_BYPASS_AUTH=true`).
- `make docker-build-local` builds both images for KIND; `kind load docker-image` + `kubectl rollout restart` for iterative dev.
- See `dashboard/ARCHITECTURE.md` for detailed component and API documentation.

## CI/CD

GitHub Actions workflows (`.github/workflows/`):
- **test.yml** — called per-project: runs `check-diff`, `test-unit`, Helm chart linting and install testing on Kind.
- **e2e.yml** — runs `test-e2e` with Kind clusters, uploads artifacts.
- **releaseimage.yml** — multi-arch (amd64/arm64) image builds to `quay.io/open-cluster-management`.

## Conventions

- Go 1.26.1, Node 22+, TypeScript ~5.8.
- Testing: Ginkgo v2 + Gomega for Go integration/e2e tests; standard `go test` for unit tests; Mocha for VSCode extension.
- Container registry: `quay.io/open-cluster-management`.
- Dockerfiles must live under `<project>/build/`, default named `Dockerfile.base`.
- Helm charts must be at `<project>/charts/<project>/` with `image.repository` and `image.tag` in `values.yaml`.
- PR/issue titles should be prefixed with project folder name (e.g., `dashboard - fix foobar bug`).
- `check-diff` must pass before merge — it runs all code generation and formatting, then asserts a clean git diff.
