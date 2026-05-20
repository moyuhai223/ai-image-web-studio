#!/usr/bin/env bash
set -euo pipefail
docker compose down --volumes || docker-compose down --volumes || true
