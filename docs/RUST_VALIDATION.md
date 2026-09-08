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

Set `WAYFINDER_BENCH_PROFILE=long` for an 81×81×97 forecast and an approximately
375-nautical-mile route. Batch comparisons default to 1, 5, and 10 alternatives using the UI's
bounded Node worker pool and concurrent Rust sidecar requests; configure them with
`WAYFINDER_BENCH_BATCHES` and `WAYFINDER_BENCH_BATCH_ITERATIONS`.
Set `WAYFINDER_BENCH_NODE_WORKERS` to compare a non-default Node worker-pool size (maximum eight).

The benchmark validates endpoint, land-clearance, and arrival-time parity before reporting timing.
It reports Node duration, Rust duration measured inside the sidecar, and Rust end-to-end duration.
The end-to-end number includes connection setup plus the current NDJSON serialization and parsing.
Timing is informational and is not a CI pass/fail threshold because host load and architecture vary.

## Initial local baseline

An optimized seven-iteration run on the development ARM64 host produced:

| Measurement      |      p50 |      p95 |
| ---------------- | -------: | -------: |
| Node calculation | 798.7 ms | 954.5 ms |
| Rust calculation | 602.8 ms | 803.1 ms |
| Rust end-to-end  | 606.0 ms | 819.3 ms |

That is a 1.33× median calculation speedup and a 1.32× median end-to-end speedup. Both engines
returned 30 route points with identical arrival time. This is an early synthetic baseline, not yet
evidence for production performance; recorded public test routes and Linux ARM64 measurements are
still required.

## Scaling investigation

Exploratory long-profile runs were added after setting a 10× performance target. These batch
figures are single measured runs after warmup, so they indicate scale rather than a stable baseline:

| Profile  | Alternatives | Node workers | Node wall time | Rust wall time | Speedup |
| -------- | -----------: | -----------: | -------------: | -------------: | ------: |
| Standard |            5 |            4 |         2.61 s |         0.87 s |   2.99× |
| Standard |           10 |            4 |         4.52 s |         1.60 s |   2.83× |
| Long     |            5 |            4 |         4.67 s |         1.79 s |   2.62× |
| Long     |           10 |            4 |        10.13 s |         3.94 s |   2.57× |
| Long     |           10 |            8 |         6.76 s |         3.96 s |   1.71× |

The long profile's single-route calculation was 1.33× faster in Rust, essentially unchanged from
the standard profile. Increasing the Node pool from its default four workers to eight reduced the
ten-alternative advantage from 2.57× to 1.71×. This shows that most batch improvement comes from
greater concurrency, while the language port itself remains near 1.3×. The current implementation
does not meet the 10× target and should not be deployed on performance grounds alone.

A plausible route to 10× requires algorithmic changes: compute diverse alternatives in one shared
search instead of rerunning nearly identical searches, reduce exhaustive heading expansion, and
reuse registered or memory-mapped forecast/index data across requests. Lower-level allocation and
sector-pruning improvements may help, but are unlikely to close the gap by themselves.

The first algorithmic change is now implemented in Node; see
[SHARED_ALTERNATIVE_SEARCH.md](SHARED_ALTERNATIVE_SEARCH.md). Node is retained as the production
engine while this design is validated because the optimization comes from shared work rather than
from the language port.
