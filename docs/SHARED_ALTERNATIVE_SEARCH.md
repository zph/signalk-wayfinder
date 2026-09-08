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

## Exploratory performance

On the synthetic 41×41×37 benchmark, requesting ten routes took 3.88 seconds with the previous
four-worker attempt pool and 0.92 seconds with one shared search, a 4.2× improvement. The shared
search returned five routes under the geometric separation rule; one route passed the blocking
polygon on the opposite side and averaged 22.2 nautical miles from the primary route, while the
other selected routes averaged 2.7–3.0 nautical miles from it.

On the 81×81×97 long profile, the shared search took 1.78 seconds versus 8.87 seconds for repeated
attempts, a 5.0× improvement. Only two paths met the separation rule in that uniform synthetic
scenario. These are warm exploratory measurements, not CI thresholds, and they do not yet meet the
10× target.
