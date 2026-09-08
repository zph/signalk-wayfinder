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
records also include the endpoints, available forecast steps, heading and sector resolution, wall
time, measured time, and unmeasured time.

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
| `progress`            | Frontier serialization and progress callback delivery                                |

Compare summary records using `phasesMs` and each phase's share of `wallMs`. Treat very short runs
as noise: profiling calls have measurable overhead when candidate counts are small. For long runs,
`unmeasuredMs` captures loop overhead, scheduling yields, error construction, backtracking, and other
work not assigned to a phase.
