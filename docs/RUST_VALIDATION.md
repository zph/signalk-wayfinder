# Rust engine validation

The Rust sidecar is compared directly with the Node isochrone implementation before it can become
a selectable production engine. The checks use synthetic data only: no vessel position, route,
Signal K values, filenames, hostnames, or shoreline data from a real installation are recorded.

## Regression matrix

Run the cross-engine regression suite with:

```sh
scripts/test-rust-sidecar.sh
```

The integration test builds one deterministic input and sends equivalent data to both engines. It
checks:

- open-water completion, route length, and sub-second arrival-time parity;
- overlapping forecast-source selection;
- wave-limit rejection;
- current drift;
- forced motoring;
- wait-for-wind behavior;
- point-on-land rejection and shoreline detours;
- avoided-region endpoint rejection and detours; and
- Node revalidation of every Rust detour leg against the same shoreline or region index.

Land and region detours allow one forecast step of arrival-time variance. This accommodates
equivalent candidates surviving in a different order while still detecting a material routing
regression. Open-water, current, motor, and wait scenarios use stricter comparisons.

## Performance benchmark

Build an optimized sidecar and run the benchmark with:

```sh
cargo build --release --manifest-path sidecar/Cargo.toml
npm run benchmark:rust-sidecar
```

`WAYFINDER_BENCH_WARMUPS` and `WAYFINDER_BENCH_ITERATIONS` control the sample counts. The default is
two warmups followed by seven measured iterations. The fixture uses a 41×41 grid with 37 hourly
steps, 2° heading expansion, 0.5° frontier sectors, and a blocking polygon on an approximately
150-nautical-mile route.

The benchmark validates endpoint, land-clearance, and arrival-time parity before reporting timing.
It reports Node duration, Rust duration measured inside the sidecar, and Rust end-to-end duration.
The end-to-end number includes connection setup plus the current NDJSON serialization and parsing.
Timing is informational and is not a CI pass/fail threshold because host load and architecture vary.

## Initial local baseline

An optimized seven-iteration run on the development ARM64 host produced:

| Measurement | p50 | p95 |
| --- | ---: | ---: |
| Node calculation | 798.7 ms | 954.5 ms |
| Rust calculation | 602.8 ms | 803.1 ms |
| Rust end-to-end | 606.0 ms | 819.3 ms |

That is a 1.33× median calculation speedup and a 1.32× median end-to-end speedup. Both engines
returned 30 route points with identical arrival time. This is an early synthetic baseline, not yet
evidence for production performance; recorded public test routes and Linux ARM64 measurements are
still required.
