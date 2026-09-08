# Node routing phase profiling

Wayfinder includes opt-in phase timing for the Node isochrone engine. Profiling is disabled by
default so timing calls do not affect ordinary calculations.

Enable one summary record per completed route attempt:

```sh
WAYFINDER_NODE_PROFILE=1 <your Signal K start command>
```

Add per-forecast-step records when investigating a particular route:

```sh
WAYFINDER_NODE_PROFILE=1 WAYFINDER_NODE_PROFILE_STEPS=1 <your Signal K start command>
```

Records are written as single-line JSON after the `[wayfinder-node-profile]` prefix. Concurrent
alternative workers can interleave log lines, so every record includes the attempt number and the
search stage (`full`, `coarse`, `fine`, or `full-fallback`). Summary
records include route distance (not coordinates), available forecast steps, heading and sector resolution, wall
time, measured time, and unmeasured time.

Both step and summary records include counters for headings considered, polar-cache hits and misses,
disabled cones, wait candidates, accepted and arrival candidates, and rejection reasons. These make
candidate survival ratios visible and help distinguish expensive checks from excessive upstream work.

The measured phases are:

| Phase                 | Work included                                                                        |
| --------------------- | ------------------------------------------------------------------------------------ |
| `frontierGuard`       | Rejecting frontier points already on land or inside avoided regions                  |
| `wind`                | Selecting a GRIB source and interpolating wind, wave, and source metadata            |
| `budget`              | Passage-day, underway-hours, and daylight-at-departure gates                         |
| `cone`                | Destination bearing, corridor, and land/region visibility used to constrain headings |
| `headingAndPolar`     | Heading gates, true-wind-angle calculation, and polar interpolation                  |
| `current`             | Current interpolation and drift application                                          |
| `coverage`            | Candidate GRIB-domain and corridor checks                                            |
| `daylight`            | Full candidate-leg daylight validation                                               |
| `land`                | Candidate and final-arrival shoreline intersection checks                            |
| `safety`              | Depth and shoreline-distance constraints                                             |
| `region`              | Avoided-region segment checks                                                        |
| `candidateAndArrival` | Candidate creation, destination-distance calculation, and arrival bookkeeping        |
| `candidateStamp`      | Copying the step duration onto candidate telemetry                                   |
| `prune`               | Sector dominance and frontier selection                                              |
| `routeAssembly`       | Backtracking and selecting geometrically distinct shared alternatives                |
| `progress`            | Frontier serialization and progress callback delivery                                |

Compare summary records using `phasesMs` and each phase's share of `wallMs`. Treat very short runs
as noise: profiling calls have measurable overhead when candidate counts are small. For long runs,
`unmeasuredMs` captures loop overhead, scheduling yields, error construction, backtracking, and other
work not assigned to a phase. Profile output intentionally omits route coordinates and file paths so
it can be shared without disclosing passage endpoints or local GRIB locations.

## Reading the first profiles

Synthetic shared-search fixtures show two distinct optimization targets. A short search with 2,906
arrival candidates spent about 40% of profiled wall time assembling and separating alternatives, so
alternative selection should avoid backtracking and comparing every arrival. The exact 373 nm
benchmark considered 14.46 million headings; 56% were rejected by the destination cone or
heading-change gate. Coarse-to-fine reduced that to about 1.44 million headings and cut the sampled
profiled run from 6.69 seconds to 0.90 seconds. Generating only the valid heading-index ranges should
therefore be tested before making lower-level wind or polar interpolation changes. The polar cache
missed only six frontier points in the exact run, so further polar-cache work is unlikely to be the
next large gain.

These figures are diagnostic samples, not performance promises. Re-profile real routes after each
algorithm change and compare candidate counts as well as wall time; a faster run that silently
reduces the useful search space is a regression.
