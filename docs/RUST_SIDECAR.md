# Rust routing sidecar

The Rust sidecar is an experimental replacement for Wayfinder's CPU-bound isochrone core. It is
not registered as a production routing algorithm yet. Node remains responsible for Signal K HTTP,
configuration, GRIB discovery, file selection, result storage, and route-quality checks.

## Current vertical slice

The initial sidecar supports open-water wind routing with:

- bilinear sampling from one Node-prepared wind grid;
- polar interpolation;
- candidate heading expansion;
- two-survivor bearing-sector frontier pruning; and
- route backtracking and progress events.

It deliberately advertises land avoidance, currents, waves, passage constraints, and navigation
safety as unsupported. The Node plugin must not select this engine for real routes until those
capabilities and parity tests exist.

## Process and protocol

Node starts the sidecar as a separately supervised process. Communication uses newline-delimited
JSON over a Unix-domain socket. Every request carries `protocolVersion` and `requestId`. A `hello`
request returns the engine version and explicit capability flags; a `calculate` request can emit
zero or more `progress` responses followed by exactly one `result` or `error`.

NDJSON is intentionally a bring-up transport, not the final bulk-grid transport. Serializing full
GRIB grids copies too much data. The next transport revision should put immutable numeric grids in
read-only memory-mapped files and send only descriptors over the socket. That keeps Node's cheap
GRIB discovery and selection work while eliminating JSON copies.

## GDAL boundary

The first slice consumes grids decoded by Node, so the Rust crate has no GDAL dependency. A later
revision can let Node pass selected GRIB paths and have Rust open them through the `gdal` crate,
which binds to a system GDAL shared library. GDAL is not a pure-Rust implementation and must be
versioned with the sidecar container or binary package. Keeping this optional lets the routing
engine and its synthetic tests remain portable.

## Development

```sh
scripts/test-rust-sidecar.sh
```

Run the process manually with:

```sh
cargo run --manifest-path sidecar/Cargo.toml -- --socket /tmp/wayfinder-core.sock
```

## Production milestones

1. Add multiple overlapping GRIB sources and memory-mapped grid transport.
2. Port current and wave sampling.
3. Port the edge-grid and avoided-region intersection checks.
4. Port daylight, underway-budget, motoring, and navigation-safety behavior.
5. Run recorded Node/Rust parity fixtures and performance benchmarks on Linux ARM64.
6. Package signed x64 and ARM64 sidecar binaries and add Node lifecycle supervision.
7. Register the Rust engine only after it rejects any request requiring an unsupported feature.
