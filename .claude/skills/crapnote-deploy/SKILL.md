---
name: crapnote-deploy
description: >-
  Deployment and infrastructure for CrapNote — Dockerfile, docker-compose, Kubernetes manifests,
  and observability stack. Use when working on deploy/, Dockerfile, k8s manifests, Prometheus,
  Grafana, Loki, Alloy config, or any deployment/infrastructure changes.
---

# CrapNote Deployment

## Dockerfile

Multi-stage build: node build (frontend) → go build (backend) → distroless runtime.

## Docker Compose

`deploy/docker-compose.yml` runs the full stack locally:
- App (CrapNote)
- Prometheus (`deploy/prometheus.yml`)
- Loki (log aggregation)
- Grafana (dashboards)
- Alloy (`deploy/alloy-config.alloy` — log/metric collection)

## Kubernetes

Manifests in `deploy/k8s/`:
- `deployment.yaml` — single-replica (SQLite single-writer constraint)
- `service.yaml` — ClusterIP
- `ingress.yaml` — Traefik IngressRoute
- `pvc.yaml` — persistent volume for SQLite data
- `secret.yaml` — credentials (do not read this file)

## Releases

Cut a release with a **lightweight** tag, matching existing history — do not use `git tag -a`:

```
git tag vX.Y.Z <sha> && git push origin vX.Y.Z
```

CI then mirrors it to `cli/vX.Y.Z` (`.github/workflows/release-cli-tag.yml`). Verify both landed
with `git ls-remote --tags origin`. The CLI's `version` command reads the module version from the
prefixed tag, so a root tag whose mirror failed leaves `go install @latest` on the previous version
— push `cli/vX.Y.Z` by hand if so.

## Key Constraints

- SQLite means single-writer — do not scale replicas beyond 1 unless migrating to PostgreSQL.
- The PVC must persist across pod restarts to retain data.
- The distroless base image has no shell — debug via logs or ephemeral containers.
