
  ## How we work

  - **TDD.** Use the `tdd` skill (red-green-refactor): write a failing test first, make it pass, then refactor.
  - The highest-value test seams are the pure layers: frontend logic modules in `frontend/src/lib/` (note ordering,
    offline sync/actions, previews, sharing) and the extension's browser-agnostic `src/core/`.
  - Backend tests run against a real in-memory SQLite database (`repository_test.go` → `service_test.go` →
    `handler_test.go` via `httptest`), not mocked repositories. Mock only true external boundaries (network, browser APIs).
  - Reserve Playwright E2E tests (`e2e/`) for full-stack user flows.

  ## Issues and PRs

  Follow [docs/issue-pr-guidelines.md](docs/issue-pr-guidelines.md) and the templates in `.github/` — location-prefixed titles,
  checkable acceptance criteria, explicit out-of-scope, named test plan.
