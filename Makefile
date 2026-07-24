# gojo — common developer entrypoints
# Prefer `make check` before opening/pushing a PR (same gate as CI).

.PHONY: help check typecheck test coverage build build-web build-site install-cli \
	dev dev-web dev-site service-install service-status service-restart

help: ## Show targets
	@awk 'BEGIN {FS = ":.*?## "} /^[a-zA-Z0-9_-]+:.*?## / {printf "  %-18s %s\n", $$1, $$2}' $(MAKEFILE_LIST)

# ---------------------------------------------------------------------------
# Quality
# ---------------------------------------------------------------------------

check: ## Full CI gate (typecheck, tests+coverage, web, site, binary)
	@bash scripts/ci-check.sh

typecheck: ## Daemon TypeScript check
	bun run typecheck

test: ## Daemon unit/integration tests
	bun test

coverage: ## Daemon tests with coverage report
	bun test --coverage --coverage-reporter=text

# ---------------------------------------------------------------------------
# Build
# ---------------------------------------------------------------------------

build: ## Compile bin/gojo (+ bundle web when available)
	bun run build

build-web: ## Build Vue admin UI
	bun run build:web

build-site: ## Build Astro docs site
	bun run --cwd site build

install-cli: ## Install compiled gojo onto PATH (~/.local/bin)
	bun run install:cli

# ---------------------------------------------------------------------------
# Dev
# ---------------------------------------------------------------------------

dev: ## Start gojo server from source
	bun run gojo server start

dev-web: ## Vite admin UI dev server
	bun run --cwd web dev

dev-site: ## Astro docs site dev server
	bun run --cwd site dev

# ---------------------------------------------------------------------------
# Service (requires `gojo` on PATH — run make install-cli first)
# ---------------------------------------------------------------------------

service-install: ## Write/reload user systemd|launchd unit
	gojo service install

service-status: ## Show daemon unit status
	gojo service status

service-restart: ## Restart background gojo service
	gojo service restart
