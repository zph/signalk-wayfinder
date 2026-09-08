# Rust routing sidecar

The Rust sidecar is an experimental replacement for Wayfinder's CPU-bound isochrone core. It is
not registered as a production routing algorithm yet. Node remains responsible for Signal K HTTP,
configuration, GRIB discovery, file selection, result storage, and route-quality checks.

## Current vertical slice

The sidecar currently supports open-water routing with:

- priority selection across multiple overlapping Node-prepared wind grids;
- bilinear wind, wave, and current sampling;
- polar interpolation;
- candidate heading expansion;
- wind and wave limits, motor fallback, and wait-for-wind behavior;
- current-vector drift;
- two-survivor bearing-sector frontier pruning; and
- route backtracking and progress events.

It deliberately advertises land avoidance, passage constraints, and navigation safety as
unsupported. The Node plugin must not select this engine for real routes until those capabilities
and parity tests exist.

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

1. Add memory-mapped grid transport to replace bulk NDJSON arrays.
2. Port the edge-grid and avoided-region intersection checks.
3. Port daylight, underway-budget, and navigation-safety behavior.
4. Run recorded Node/Rust parity fixtures and performance benchmarks on Linux ARM64.
5. Package signed x64 and ARM64 sidecar binaries and add Node lifecycle supervision.
6. Register the Rust engine only after it rejects any request requiring an unsupported feature.
