#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
runtime="${WAYFINDER_CONTAINER_RUNTIME:-podman}"
image="${WAYFINDER_LAND_BUILD_IMAGE:-python:3.12-bookworm}"
output_dir="${WAYFINDER_LAND_OUTPUT_DIR:-$repo_root/data/generated-hires}"
cache_dir="${WAYFINDER_LAND_CACHE_DIR:-/tmp/signalk-wayfinder-land-cache}"
archive="$cache_dir/gshhg-shp-2.3.7.zip"
archive_url="https://www.soest.hawaii.edu/pwessel/gshhg/gshhg-shp-2.3.7.zip"
archive_sha256="8dbbe7e071e77e9e75f2d639239099ebca8d5c16d6a07df8169729d49f15cf41"

command -v "$runtime" >/dev/null 2>&1 || {
  echo "$runtime is required to build the high-resolution shoreline data" >&2
  exit 1
}
command -v curl >/dev/null 2>&1 || {
  echo "curl is required to download the GSHHG source archive" >&2
  exit 1
}

mkdir -p "$cache_dir" "$output_dir"
if command -v sha256sum >/dev/null 2>&1; then
  sha256_file() { sha256sum "$1" | awk '{print $1}'; }
else
  sha256_file() { shasum -a 256 "$1" | awk '{print $1}'; }
fi

if [[ ! -f "$archive" || "$(sha256_file "$archive")" != "$archive_sha256" ]]; then
  temporary="$archive.tmp.$$"
  trap 'rm -f "$temporary"' EXIT HUP INT TERM
  curl -fL --retry 3 "$archive_url" -o "$temporary"
  actual="$(sha256_file "$temporary")"
  [[ "$actual" == "$archive_sha256" ]] || {
    echo "GSHHG archive checksum mismatch: expected $archive_sha256, received $actual" >&2
    exit 1
  }
  mv "$temporary" "$archive"
  trap - EXIT HUP INT TERM
fi

"$runtime" run --rm \
  --platform "${WAYFINDER_LAND_BUILD_PLATFORM:-linux/amd64}" \
  --volume "$repo_root:/source:ro" \
  --volume "$archive:/input/gshhg.zip:ro" \
  --volume "$output_dir:/output" \
  --workdir /source \
  "$image" \
  sh -eu -c '
    python -m pip install --disable-pip-version-check --no-cache-dir \
      fiona==1.10.1 numpy==2.3.3 shapely==2.1.1
    WAYFINDER_GSHHG_ARCHIVE=/input/gshhg.zip \
      WAYFINDER_LAND_OUTPUT_DIR=/output \
      python scripts/prepare-land-data.py --resolution f
  '

echo "Corrected full-resolution shoreline indices are ready in $output_dir"
