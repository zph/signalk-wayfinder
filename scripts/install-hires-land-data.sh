#!/bin/sh
set -eu

release="v1.0.0"
release_root="https://github.com/kristianwiklund/weather-routing-hires-land-data/releases/download/$release"
edge_name="edge-index-hires.bin.gz"
dilated_name="dilated-edge-index-hires.bin.gz"
edge_sha256="94a7548c428b8cfe6ecb134b327eeb5edba362e3ebb8947f657c4f6e3cc5996f"
dilated_sha256="01de0f7682480d5d7df831702aaa7b7194bd68c3e25907f8b9e495ee9a539233"
signalk_root="${SIGNALK_CONFIG_DIR:-$HOME/.signalk}"
data_dir="${WAYFINDER_LAND_DATA_DIR:-$signalk_root/plugin-config-data/signalk-wayfinder}"

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required to install the high-resolution shoreline data" >&2
  exit 1
fi

if command -v sha256sum >/dev/null 2>&1; then
  sha256_file() {
    sha256sum "$1" | awk '{print $1}'
  }
elif command -v shasum >/dev/null 2>&1; then
  sha256_file() {
    shasum -a 256 "$1" | awk '{print $1}'
  }
else
  echo "sha256sum or shasum is required to verify the shoreline data" >&2
  exit 1
fi

mkdir -p "$data_dir"
edge_tmp="$data_dir/.$edge_name.tmp.$$"
dilated_tmp="$data_dir/.$dilated_name.tmp.$$"
trap 'rm -f "$edge_tmp" "$dilated_tmp"' EXIT HUP INT TERM

install_asset() {
  name="$1"
  expected="$2"
  temporary="$3"
  destination="$data_dir/$name"

  if [ -f "$destination" ] && [ "$(sha256_file "$destination")" = "$expected" ]; then
    echo "$name is already installed and verified"
    return
  fi

  curl -fL --retry 3 "$release_root/$name" -o "$temporary"
  actual="$(sha256_file "$temporary")"
  if [ "$actual" != "$expected" ]; then
    echo "$name checksum mismatch: expected $expected, received $actual" >&2
    exit 1
  fi
  mv "$temporary" "$destination"
  echo "$name installed and verified"
}

install_asset "$edge_name" "$edge_sha256" "$edge_tmp"
install_asset "$dilated_name" "$dilated_sha256" "$dilated_tmp"
echo "High-resolution GSHHG shoreline data $release is ready in $data_dir"
