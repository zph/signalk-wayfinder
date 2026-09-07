# Development Build & Install

## Environment

SignalK runs in Docker (`signalk-server` container, Node.js v22+, v24 recommended).  
The SignalK data/plugin directory is bind-mounted:

```
<signalk-server-repo>/docker/signalk_conf/  ←→  /home/node/.signalk  (inside container)
```

Node.js is not installed directly on the host — use `docker exec` for all `node`/`npm` commands.

## Generating land data (one-time, or when updating GSHHG resolution)

The plugin bundles pre-built land indices in `data/edge-index.bin.gz` and
`data/dilated-edge-index.bin.gz`. These are committed to the repository. To regenerate
them (e.g. after changing `GSHHG_RESOLUTION` in `scripts/prepare-land-data.ts`):

```bash
# Install Python dependencies (one-time, inside container)
docker exec signalk-server sh -c \
  "pip3 install --break-system-packages shapely fiona"

# Run the build script
docker exec signalk-server sh -c \
  "cd /home/node/.signalk/_wayfinder-src && \
   python3 scripts/prepare-land-data.py"
```

The script downloads `gshhg-shp-2.3.7.zip` (~150 MB) to `data/` if not present,
then builds both indices. Expect ~1 minute for the edge index and a few minutes for
the dilated index (Shapely/GEOS is much faster than the previous jsts approach).
Progress is printed to stdout.

After the script finishes, copy the generated files to the host repo and commit:

```bash
cp <signalk-server-repo>/docker/signalk_conf/_wayfinder-src/data/edge-index.bin.gz \
   <plugin-src>/data/
cp <signalk-server-repo>/docker/signalk_conf/_wayfinder-src/data/dilated-edge-index.bin.gz \
   <plugin-src>/data/
```

Then commit `data/edge-index.bin.gz` and `data/dilated-edge-index.bin.gz`.

## Install / full rebuild

npm v10 installs a local path as a symlink, not a copy. Use `npm pack` to produce a
tarball, then install from that.

```bash
# 1. Copy source into the bind-mounted volume so the container can see it
cp -r <plugin-src> <signalk-server-repo>/docker/signalk_conf/_wayfinder-src

# 2. Install dev deps, compile TypeScript, pack
docker exec signalk-server sh -c \
  "cd /home/node/.signalk/_wayfinder-src && \
   npm install && \
   npm run build && \
   npm pack --ignore-scripts"

# 3. Install from the tarball (real copy, not symlink)
docker exec signalk-server sh -c \
  "cd /home/node/.signalk && \
   npm install --ignore-scripts ./_wayfinder-src/signalk-wayfinder-0.8.0.tgz"

# 4. Clean up
docker exec signalk-server sh -c "rm -rf /home/node/.signalk/_wayfinder-src"
rm -rf <signalk-server-repo>/docker/signalk_conf/_wayfinder-src

# 5. Restart SignalK to load the plugin
docker restart signalk-server
```

The plugin appears under **Server → Plugin Config → Sail Wayfinder** in the admin UI.  
The webapp is at `http://<host>:3000/signalk-wayfinder/`.

## Rebuilding after TypeScript changes

Recompile in-place inside the installed package, then reload via the SignalK API:

```bash
docker exec signalk-server sh -c \
  "cd /home/node/.signalk/node_modules/signalk-wayfinder && npm run build"

curl -X PUT http://localhost:3000/skServer/plugins/signalk-wayfinder/restart
```

## Deploying static-only changes (public/)

Use `scripts/dev-deploy.sh` to copy frontend changes and refresh the version label:

```bash
./scripts/dev-deploy.sh                          # defaults: signalk-server, default plugin path
./scripts/dev-deploy.sh my-container /custom/path # custom container or plugin path
```

The script writes a fresh `buildinfo.json` (with git version + branch name) directly
into the container's plugin directory, then copies `public/index.html`. No restart
needed — hard-refresh the browser.

The version label shown at the bottom of the sidebar includes the branch name during
development (e.g. `v0.7.0-3-g1234abc/fix/BUG-90-wind-wave-overlay-clear`), making it
easy to verify the expected code is deployed.

## Running tests

```bash
docker exec signalk-server sh -c \
  "cd /home/node/.signalk/node_modules/signalk-wayfinder && npm test"
```

## Uninstalling

```bash
docker exec signalk-server sh -c \
  "cd /home/node/.signalk && npm uninstall signalk-wayfinder"
docker restart signalk-server
```

## CI/CD (GitHub Actions)

Three workflows run automatically:

**CI** (`.github/workflows/ci.yml`) — triggers on every push and every pull request targeting `main`. Runs `npm ci`, `npm run build`, and `npm test` on Node.js 24 (ubuntu-latest). No manual action required.

**Build** (`.github/workflows/build.yml`) — manual trigger (`workflow_dispatch`). Builds `gdal-async` from source on both `x64` (ubuntu-latest) and `arm64` (ubuntu-24.04-arm) runners for both Node.js 22 and Node.js 24, assembles the four ABIs into sub-packages, packs the plugin tarball, and uploads it as an artifact. Useful for pre-release verification.

**Publish** (`.github/workflows/publish.yml`) — triggers when a version tag (`v*`) is pushed. Downloads prebuilt `gdal-async` binaries from the `kristianwiklund/wr-gdal-async-prebuilt` GitHub Release matching the resolved `gdal-async` version, then publishes both sub-packages to npm, runs tests, and publishes the main `signalk-wayfinder` package. No native build step on the publish path — binaries must already exist in `wr-gdal-async-prebuilt` before tagging.

### Architecture

The plugin ships its `gdal-async` native binary via platform-specific optional dependencies:

```
signalk-wayfinder                (thin main package, ~2 MB)
  dependencies:    gdal-async, jsts
  optionalDeps:
    @kristianwiklund/wr-gdal-linux-x64    [os:linux, cpu:x64]
    @kristianwiklund/wr-gdal-linux-arm64  [os:linux, cpu:arm64]
```

Each sub-package contains prebuilt `.node` binaries for both Node.js 22 (ABI v127) and Node.js 24 (ABI v137). npm automatically skips non-matching `os`/`cpu` at install time — x64 users never download arm64 binaries and vice versa.

At startup, `src/lib/ensure-gdal-binary.ts` copies the matching binary from the optional dependency into `gdal-async`'s expected binding path (`lib/binding/{node_abi}-{platform}-{arch}/gdal.mod.node`). This is a one-time ~50 MB file copy; subsequent restarts are instant (existence check).

### Publishing a new version

**Prerequisite:** prebuilt gdal-async binaries must exist in [`kristianwiklund/wr-gdal-async-prebuilt`](https://github.com/kristianwiklund/wr-gdal-async-prebuilt) for the exact `gdal-async` version locked in `package-lock.json`. If `gdal-async` has not changed since the last release, the existing release is reused automatically. If `gdal-async` was updated, trigger the **Build gdal-async binaries** workflow in that repo first (set `gdal_async_version` to the new version) and wait for the release to appear before proceeding.

1. Bump `version` in `package.json` following [Semantic Versioning](https://semver.org/).
2. Update `optionalDependencies` in `package.json` to the exact gdal-async version (e.g. `"3.12.3"`) if it changed.
3. In `CHANGELOG.md`, replace the `## Upcoming` header with the new version number (e.g. `## 0.8.0`).
4. Commit: `git commit -m "chore: bump version to vX.Y.Z"`
5. Tag and push:
   ```bash
   git tag vX.Y.Z
   git push origin main --tags
   ```
6. The publish workflow fires automatically. It downloads prebuilt binaries from `wr-gdal-async-prebuilt`, publishes sub-packages `@kristianwiklund/wr-gdal-linux-x64` and `@kristianwiklund/wr-gdal-linux-arm64` (versioned at the gdal-async version), runs tests, then publishes `signalk-wayfinder`.

The repository must have an `NPM_TOKEN` secret configured in GitHub → Settings → Secrets and variables → Actions.
