# Shared alternative-route search

Wayfinder now derives direct-route alternatives from one Node isochrone search instead of running
two offset searches for every requested UI alternative. Node remains the production engine so the
shared search retains the existing Signal K integration, passage constraints, shoreline checks,
avoided regions, currents, waves, and navigation-safety behavior.

When more than one route is requested, the search collects valid arrivals from the fastest arrival
step and six subsequent forecast steps. It greedily selects paths by geometric separation while
keeping the original fastest route first. Routes must average at least 0.25 nautical miles from
every already-selected route across sampled interior waypoints. If the search cannot find the
requested number of meaningfully distinct paths, the existing UI warning reports the smaller
number instead of padding the result with near-duplicates.

Routes containing required waypoints continue to use the previous repeated-attempt behavior. A
shared multi-leg search needs a separate design because alternatives from one leg create a
combinatorial set of continuation states for the next leg.

## Coarse-to-fine search

Direct alternative searches now start with a coarse 10° heading / 2° sector pass. The production
2° / 0.5° pass is then limited to a 30-nautical-mile, time-indexed corridor around that route.
When the direct line toward the destination is obstructed, branches may leave the corridor so the
fine search can still escape around land or an avoided region. If the coarse pass cannot complete,
Wayfinder automatically runs the original unrestricted fine search.

This is intentionally an approximation for alternative generation, not a change to the single
route engine's default optimality. It is enabled for direct UI alternative searches and can be
disabled with `coarseToFine: false` for comparisons or troubleshooting.

## Precomputed hot-path data

The Node engine now reuses data that does not change during candidate expansion:

- sine and cosine values for the configured heading lattice;
- exact polar results for repeated wind-vector and heading combinations;
- inverse GRIB grid steps and row offsets used by bilinear interpolation;
- per-file mappings from the merged forecast timeline to source frames; and
- nearest wave and current frame indexes for repeated timestamps.

The caches preserve the existing interpolation and navigation calculations; no quantized polar or
position approximation is introduced.

## Exploratory performance

In a three-sample warm synthetic 41×41×37 run, requesting ten routes took 3.54 seconds p50 with the
previous four-worker attempt pool and 0.58 seconds with the coarse-to-fine shared search, a 6.1× improvement.
The shared search returned five routes under the geometric separation rule; one passed the blocking
polygon on the opposite side and averaged 21.1 nautical miles from the primary route, while the
other selected routes averaged 2.7–3.0 nautical miles from it.

In the three-sample 81×81×97 long fixture, repeated attempts took 7.48 seconds p50 and the shared
search took 0.35 seconds, a 21.6× reduction. Its uniform wind and simple rectangular obstruction
produce only two meaningfully distinct paths, however. Route count is therefore
reported alongside timing: a fast search that pads its result with near-duplicates is not treated
as success. These are exploratory local measurements, not CI thresholds.
