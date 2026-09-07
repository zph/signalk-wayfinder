#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
container_image="${WAYFINDER_TEST_IMAGE:-node:24-trixie}"
container_platform="${WAYFINDER_TEST_PLATFORM:-linux/arm64}"
npm_cache_volume="${WAYFINDER_NPM_CACHE_VOLUME:-signalk-wayfinder-npm-cache}"

podman run --rm \
  --platform "$container_platform" \
  --volume "$repo_root:/source:ro" \
  --volume "$npm_cache_volume:/npm-cache" \
  --workdir /tmp \
  "$container_image" \
  sh -eu -c '
    mkdir /tmp/workspace
    tar \
      --exclude=.git \
      --exclude=node_modules \
      --exclude=dist \
      --exclude="*.tgz" \
      -C /source -cf - . | tar -C /tmp/workspace -xf -
    cd /tmp/workspace
    npm_config_cache=/npm-cache npm ci --ignore-scripts
    npm run --ignore-scripts build
    node dist/lib/ensure-gdal-binary.js
    npm test
  '
