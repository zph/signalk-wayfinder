#!/bin/sh
set -e

CONTAINER="${1:-signalk-server}"
PLUGIN_PATH="${2:-/home/node/.signalk/node_modules/signalk-wayfinder}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

version="$(cd "$REPO_ROOT" && git describe --tags --always --dirty 2>/dev/null || echo "unknown")"
branch="$(cd "$REPO_ROOT" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "unknown")"

printf '{"version":"%s/%s"}\n' "$version" "$branch" | \
  docker exec -i "$CONTAINER" sh -c "cat > '$PLUGIN_PATH/public/buildinfo.json'"

docker cp "$REPO_ROOT/public/index.html" "$CONTAINER:$PLUGIN_PATH/public/index.html"

echo "dev-deploy: $version/$branch — index.html + buildinfo.json copied"
