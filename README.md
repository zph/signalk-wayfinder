# Sail Wayfinder

> [!CAUTION]
> ⚠️ **Experimental — read before use.** ⚠️
>
> - Calculated routes have not been validated by sailing them. Verify every route against current official charts and notices.
> - Weather forecasts change. The route calculated now may not reflect conditions at departure time. Always obtain up-to-date forecasts and check for NOTAMs and local hazards.
> - This plugin **does not replace good seamanship**, a qualified navigator, or certified navigation software. Use is entirely at your own risk.

Bug reports and improvement proposals are welcome.

A SignalK plugin that calculates time-optimal sailing routes using GRIB2 weather forecasts and the isochrone method.

![logo](wr-icon-128px.png)

## Features

- Time-optimal isochrone routing using GRIB2 weather forecasts
- Automatic land avoidance using [GSHHG](https://www.soest.hawaii.edu/pwessel/gshhg/) high-resolution coastlines
- Wind and wave overlays on the map with a time scrubber and conditions graph
- Routes saved to SignalK `resources/routes` — visible in freeboard-sk automatically

See [CHANGELOG](CHANGELOG.md) for the full feature history.

![Weather routing webapp](screenshot2.jpg)

## Requirements

- SignalK server >= 2.0.0
- A GRIB2 weather forecast file (e.g. from [OpenSkiron](https://openskiron.org/en/icon-gribs))
- A polar diagram file in ORC/OpenCPN CSV format
- Platform: linux/x64 or linux/arm64 (Raspberry Pi 3/4/5, Node 22 or 24)

The full specification — implemented requirements, open backlog, and design decisions — is in [SPEC.md](SPEC.md).

### Hardware Specs

Not massive:

- I develop on a 2-core Intel(R) Celeron(R) N4505 @ 2.00GHz NUC - a _not very fast_ computer
- Tested on a Raspberry Pi 3 Model B Rev 1.2 - I thought it would be hilariously slow but at least routes within the Baltic works reasonably. The U/I is a bit sluggish, but the routing is okay.

## Setup and configuration

Install from the **SignalK App Store** (Server → Appstore → Available) and restart SignalK.

The land index (GSHHG coastlines) is bundled — no download is needed at install or runtime.

#### High-resolution land data (optional)

By default the plugin uses the GSHHG **h** (high) resolution tier (~1 km coastlines). Full-resolution **f**-tier coastlines (~100 m) are available from [weather-routing-hires-land-data](https://github.com/kristianwiklund/weather-routing-hires-land-data).

For Podman and other persistent Signal K installations, build the full-resolution assets from the
pinned GSHHG 2.3.7 source archive. The builder preserves interior water rings, which the upstream
prebuilt v1 index omits:

```bash
npm run build-hires-land-data:podman
cp data/generated-hires/*-hires.bin.gz \
  /path/to/signalk-data/plugin-config-data/signalk-wayfinder/
podman restart signalk-server
```

The builder verifies the source archive by SHA-256 and runs pinned Fiona, Shapely, and NumPy versions
in an isolated amd64 container, which Podman can run on both Intel and Apple silicon Macs. Wayfinder
prefers the generated files under `plugin-config-data/signalk-wayfinder`, outside the replaceable
plugin package directory. Set `WAYFINDER_LAND_OUTPUT_DIR`, `WAYFINDER_LAND_CACHE_DIR`, or
`WAYFINDER_CONTAINER_RUNTIME` to change the defaults. After restart, Wayfinder detects the files
automatically and labels the layer checkbox **Land overlay (hires)**.

Open **Server → Plugin Config → Sail Wayfinder** in the SignalK admin UI.

### Required settings

| Setting     | Description                                                |
| ----------- | ---------------------------------------------------------- |
| `gribDir`   | Full path to the directory containing GRIB2 forecast files |
| `polarPath` | Full path to the polar diagram CSV file                    |

### Algorithm tuning

The defaults work well for most use cases.

| Setting                     | Default | Description                                                                                                                                                                                                                           |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `headingStep`               | 5°      | Angular resolution when evaluating candidate headings. Lower values produce more accurate routes at the cost of longer calculation time.                                                                                              |
| `sectorSize`                | 1°      | Bearing sector width for frontier pruning. After each timestep the top 2 candidates per sector are kept.                                                                                                                              |
| `minBoatSpeed`              | 0.3 kn  | Headings producing less than this effective speed are discarded. Prevents near-stationary drift being treated as a viable route.                                                                                                      |
| `arrivalRadiusNm`           | 2 NM    | Distance from the destination at which the route is considered complete.                                                                                                                                                              |
| `coneHalfAngle`             | 100°    | Half-angle of the directional cone applied when the straight-line path to the destination is clear of land. Headings outside this cone are not evaluated. Disabled automatically per frontier point when land blocks the direct path. |
| `coneDisableLookaheadNm`    | 100 NM  | How far ahead to check for land when deciding whether to disable the cone for a given frontier point.                                                                                                                                 |
| `maxHeadingChange`          | 120°    | Maximum course change allowed between consecutive timesteps, preventing unrealistic zig-zagging.                                                                                                                                      |
| `daylightOnly`              | false   | Holds position during forecast steps that are not fully in daylight at the route location.                                                                                                                                            |
| `maxHoursPerDay`            | 0 h     | Maximum underway time in each 24-hour passage day, anchored to departure time. Set to 0 for unlimited.                                                                                                                                |
| `minimumDepthM`             | 0 m     | Minimum numeric raster depth along every route leg. Missing raster coverage is rejected. Set to 0 to disable.                                                                                                                         |
| `minimumShoreDistanceNm`    | 0 NM    | Minimum clearance from the configured GSHHG shoreline. Set to 0 to disable.                                                                                                                                                           |
| `maximumOffshoreDistanceNm` | 0 NM    | Maximum distance from the configured GSHHG shoreline along the full route. Set to 0 to disable.                                                                                                                                       |

### Bathymetry safety input

Set `bathymetryPath` to a local, georeferenced raster that GDAL can read. GeoTIFF, Cloud Optimized
GeoTIFF, BAG, S-102, NetCDF, and several other raster drivers are included in the Linux container
runtime. Set `bathymetryValueConvention` to `elevation` for negative values below chart datum, or
`depth` for positive values below chart datum. `bathymetryBand` selects the one-based data band.

The minimum-depth constraint is fail closed. Every raster cell touched by the route line must have a
finite value. A missing cell, a position outside the raster, land elevation in an elevation raster,
or an unreadable source rejects the constrained route. The configured raster datum must match the
depth assumption you intend to use. Wayfinder does not add tide height, vessel draft, or an
under-keel-clearance allowance.

### Display settings

| Setting           | Default | Description                                                                                                                                                                                                                                     |
| ----------------- | ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `windSpeedMs`     | false   | When enabled, wind speed is displayed and entered in m/s throughout the webapp, overriding the SignalK unit preference for wind speed. All other values (boat speed, wave height, distances) continue to follow the active SignalK unit preset. |
| `waveOverlayMaxM` | 3.0     | Upper bound of the wave height colour scale. Heights >= this value appear red. Affects both the colour gradient in the wave overlay and the legend label.                                                                                       |
| `hideTestButtons` | true    | Hides the Run test / Helsinki test / Gothenburg test buttons. Set to `false` to expose them for development and validation.                                                                                                                     |

**Build version:** The git commit SHA or tag is shown as small dimmed text at the very bottom of the settings sidebar, useful for diagnostics and support.

For development builds, see [DEVELOPMENT.md](DEVELOPMENT.md).

## Usage

Open the webapp at `http://<your-signalk-host>:3000/signalk-wayfinder/`.

### Basic workflow

1. Set a **departure point**: click **Set on map** and click the map, click **Use vessel position** to use the vessel's current GPS position (available only when a position is being received), or pick an existing SignalK route or waypoint from the dropdown (for routes, the last waypoint is used as the start)
2. Set a **destination** the same way
3. Optionally select a **Route waypoints** source to route through intermediate waypoints (see below)
4. Set a **departure time**
5. Configure any routing options (see below)
6. Click **Calculate Route**

Isochrones are drawn live on the map as the calculation progresses. The finished route is displayed with wind barbs and ETA at each waypoint and saved automatically to SignalK `resources/routes`.

### Route waypoints

The **Route waypoints** dropdown (below the departure section) lists all routes saved in SignalK `resources/routes`. Selecting a route constrains the calculated route to pass through the route's waypoints in order:

- The route's **first waypoint** becomes the departure point
- The route's **last waypoint** becomes the destination
- Any **intermediate waypoints** are required passing points; they are shown as numbered markers on the map

The algorithm calculates each leg independently (start → wp1 → wp2 → … → destination) and concatenates the results into a single route.

Selecting a route in this dropdown overrides any manually placed start/end markers. Manually placing start or end on the map resets this dropdown.

### GRIB files

The **GRIB Forecast** panel shows a compact summary — the number of wind and ocean-current GRIB files loaded and how many are enabled — and an **Open GRIB Manager** button. Files are managed in the **Grib Manager** modal rather than a flat list.

The Grib Manager shows each loaded file as a row on a coverage timeline (its real forecast span, drawn to scale), with a checkbox to include/exclude it from routing. Stale runs (older than 12 h amber, 24 h red) and files whose forecast has ended are flagged. Files that contain wave data (HTSGW bands, e.g. ICON-EU EWAM combined files) show a **~wave** badge. A yellow **now** line and a pink low-confidence band (beyond the configurable `forecastSkillHorizonHours`, default 96 h) mark the forecast skill horizon; vertical markers show where a file's timestep granularity coarsens (e.g. ICON-EU hourly → 3-hourly).

When multiple overlapping files are loaded, **Accept proposed** applies an optimised combination — the freshest model run (`referenceTime`) wins per region, then finest granularity, geographically stitched. **Enable all** restores every file. The proposal is departure-aware: scoped to the set departure time (set a past departure to propose a historical combination), or now-forward if no departure is set. **Reload GRIB directory** picks up newly downloaded files without restarting SignalK. Each row has a **🗑 archive** button (moves the file to an `archive/` subfolder after confirmation; files are never deleted). **Remove old GRIBs (N)** archives all files whose forecast has ended in one step.

The routing algorithm always picks the highest-priority file that covers each point in space and time — newest model run, then finest granularity (a re-downloaded old forecast no longer overrides a newer model run). A loading indicator (spinner) appears while GRIB data is read at startup.

**Upload GRIB…** in the Grib Manager uploads one or more `.grib2/.grib/.grb2/.grb` files straight into `gribDir` from the webapp (no need to copy files in by hand and reload). On a name collision you choose to archive the existing file and upload, or skip. Uploaded files are validated; a file that isn't a supported wind/current GRIB (e.g. a wave-only file) is rejected with a clear reason — see REQ-140 for standalone wave-GRIB support.

If a file with the same name already exists in the archive folder, a serial number is inserted before the extension (e.g. `forecast.grb2` → `forecast.2.grb2`).

### Routing options

#### Passage schedule

The selected departure date and time anchors both the forecast calculation and the passage-day schedule. Enable **Daylight-only sailing** to hold position while the sun is below the horizon. Set **Maximum underway per day** from 1 to 24 hours to insert rest after that much sailing or motoring; 0 leaves daily underway time unlimited. Waiting consumes elapsed passage time but not underway hours. A new passage day begins every 24 hours from the selected departure time.

#### Coast avoidance

Enabled by default. The router will not cross land. Uncheck to disable for open-ocean routes where land avoidance is unnecessary.

The **Land overlay** checkbox in the Layers section is disabled (greyed out) while a route calculation is in progress and re-enabled when it completes. Toggling the land overlay during an active calculation is not supported.

**Safety margin (0.5 NM):** Dilates the coastline outward by 0.5 NM, closing passages and anchorages narrower than that distance. Useful when the standard land mask leaves the route uncomfortably close to shore or through passages the algorithm cannot thread accurately.

#### Motor

Two fields must both be set to enable motoring:

- **Motor below _ (unit)**: The boat-speed threshold. When the polar-computed speed for a heading falls below this value, the motor kicks in instead.
- **Motor speed _ (unit)**: The speed used when motoring.

The unit label reflects the active SignalK unit preference (e.g. kn, mph, km/h). Leave either field empty to disable the motor entirely. Example: set "Motor below 3 kn, speed 5 kn" to motor at 5 kn whenever the polar predicts less than 3 kn of boat speed — covering light-wind patches and unfavourable angles.

#### Wait for wind

When checked, a frontier point that produces no usable speed for any heading (after motor evaluation) stays in place for one timestep instead of being discarded. This allows the router to "wait" through a calm patch and resume sailing when wind returns in a later forecast step.

Without this option, a frontier point with no viable headings is simply dropped from the frontier. With it, the point is kept at the same position — at the cost of time — and re-evaluated in the next step.

#### Max wind and max wave

- **Max wind:** Candidate positions where the forecasted wind speed exceeds this value are discarded. The router will not route through that area regardless of time savings. The unit shown (kn, m/s, mph, …) follows the active unit preference, or m/s when `windSpeedMs` is enabled. Leave empty for no limit.
- **Max wave:** Candidate positions where the significant wave height exceeds this value are discarded. Only applied when wave data (SWH bands) is present in the loaded GRIB file — OpenSkiron ICON-EU EWAM files include both wind and wave bands. The unit shown follows the active unit preference. Leave empty for no limit.

### Wind overlay

The map displays a GRIB wind overlay showing wind speed and direction as wind barbs. Each barb has an arrowhead at the downwind tip pointing in the direction the wind blows toward, making the TOWARD direction unambiguous. Ticks and pennants on the FROM end encode wind speed in the standard Beaufort scale (half-tick = 5 kn, full tick = 10 kn, pennant = 50 kn). Wind below the polar's minimum measured speed (e.g. 6 kn) is shown as a calm symbol — a ring with a centre dot — indicating conditions outside the polar's measured range. Calm symbols only appear after the polar file is loaded; before that, all barbs render directionally. Hovering over a barb shows a tooltip with wind speed, direction, and the boat's predicted speed at that point from the polar diagram. A time scrubber below the map controls which forecast timestep is shown.

- Before a route is calculated the scrubber spans the union of all currently-checked GRIB files' time ranges; toggling a file checkbox updates the range immediately
- After a route is calculated the scrubber range matches the route (departure to estimated arrival), aligned with the conditions graph
- Dragging the scrubber highlights the route waypoint nearest in time and draws a pink overlay on the corresponding leg
- A **colour bar** above the slider shows one coloured row per loaded GRIB file, each row spanning that file's forecast period in the colour assigned to it in the Grib Manager. Current-file time steps are shown in cyan; uncovered time positions appear in dark grey.
- A yellow downward-pointing **triangle marker** above the colour bar marks the current wall-clock time within the forecast range
- **Now** button (right of the slider): snaps the scrubber to the nearest forecast timestep to the current time
- **Use as departure** button (left of the scrubber): copies the current scrubber time into the departure time field, so you can browse to a forecast window and lock it in as the departure time with one click
- **Collapse/expand** handle bar on the scrubber and conditions graph panels — click a panel's handle to collapse it to a thin strip, reclaiming map space. Click again to expand.
- **⏮ jump button** on each GRIB file row in the Grib Manager: clicking it moves the scrubber to the start of that file's forecast range

Use the **Wind overlay** checkbox to toggle the overlay on or off without affecting the scrubber or route display.

### Wave height overlay

When the loaded GRIB files contain SWH (significant wave height) bands — as in OpenSkiron ICON-EU EWAM files — a **Wave height** overlay is available in the Layers section. It renders a colour raster on the map with blue (low) to red (high) shading. Points below 0.2 m are transparent. The legend in the bottom-right corner shows the scale from 0 to the configured max (default 3 m, configurable via `waveOverlayMaxM`). The time scrubber controls which forecast timestep is shown, and the overlay pans and zooms with the map.

OpenSkiron ICON-EU EWAM files are combined files containing atmospheric wind data and ocean wave data on separate grids. The plugin extracts each grid's native parameters — including the correct data-point coordinates — and renders the canvas in Web Mercator coordinates to match Leaflet's map projection, so the wave overlay is accurately positioned on the chart at all latitudes.

### Ocean current support

The plugin supports ocean current GRIB2 files from [RTOFS](https://nomads.ncep.noaa.gov/pub/data/nccf/com/rtofs/prod/) (NOAA, free, global), [BSH](https://www.bsh.de/EN/DATA/Predictions/Currents/Surface_currents_for_sailors/surface_currents_for_sailors_node.html) (German Federal Maritime and Hydrographic Agency, free, European waters), and [CMEMS](https://marine.copernicus.eu/) (Copernicus, free registration, global). Place any current GRIB file in the same `gribDir` as the wind files — the plugin detects it automatically by its GRIB metadata (UOGRD/VOGRD bands at ocean surface level) and applies the interpolated current vectors to the routing algorithm.

When a current file is loaded:

- The **Grib Manager** lists the current file with its model run age in the same amber/red staleness scheme as wind files (shown as an "ocean current" row).
- The **Currents** layer checkbox in the Layers panel enables a current vector overlay on the map — cyan arrows showing current direction and speed, driven by the time scrubber.
- Clicking the map while the Currents overlay is active shows current speed (kn) and direction (°T) in the popup.
- The routing algorithm adds the current's eastward/northward velocity components to each frontier point's displacement, giving correct ground-track advancement globally.

**Important limitations:**

- **Tidal streams are not modelled.** Ocean current GRIB products (RTOFS, CMEMS global) represent large-scale circulation averaged over hours; they do not capture reversing tidal streams in straits and coastal waters. Plan tide gates separately using tidal atlases.
- **Coverage gaps.** When the current GRIB does not cover part of a route (e.g. RTOFS excludes marginal seas), zero current is applied for those points. The coverage boundary is visible as the dashed box on the map.
- **Model currency.** Use recent current files — Gulf Stream position and eddy structure can shift by 50–100 nm week to week. The staleness indicator helps identify old files.

### Map click info

Clicking anywhere on the map shows a popup with data from all active overlays at that point. If the **Wind overlay** is active the popup includes wind speed (in the active unit) and meteorological direction (°T). If the **Wave height** overlay is active it includes significant wave height. If the **Currents** overlay is active it includes current speed (kn) and direction (°T). If no overlay is active or no data is found within ~6 km of the click, no popup appears.

### Isochrone overlay

The isochrone frontier lines drawn during and after route calculation form a separate toggleable layer. Use the **Isochrones** checkbox in the Layers section to show or hide them without affecting any other overlay or the calculated route itself. The toggle is on by default.

### Conditions graph

A graph below the map shows wind speed, wave height, and boat speed along the calculated route over time. The graph and the time scrubber above it span the same horizontal extent — the left and right edges are aligned at any window width. Click the graph to expand it to fullscreen. Click again or press Escape to return to normal. Boat speed is plotted from the first calculated step; the departure point itself has no computed speed and is not shown on the boat speed line.

The colored bar beneath the graph shows which GRIB file provided the weather data for each leg of the route, using the same color assigned to that file's bounding box on the map.

When the route was calculated through intermediate waypoints (via the **Route waypoints** dropdown), thin dashed vertical lines mark each intermediate waypoint's position on the time axis, labelled WP1, WP2, etc.

### Route failure notifications

When route calculation fails, a popup appears on the map describing the cause:

- **All available paths are blocked by land** — the frontier was stopped by the coastline on all headings
- **Wind is too light or adverse to make progress under sail** — no heading produced enough boat speed (after polar and motor evaluation) to advance the frontier
- **Destination not reached before the forecast period ends** — the GRIB forecast ran out before the destination was reached, or the frontier reached the edge of the GRIB coverage area

A partial route is shown when some progress was made before failure, so you can see how far the algorithm got.

## Polar diagram format

Standard ORC/OpenCPN semicolon-delimited CSV. The first row is a header with TWS values; subsequent rows start with a TWA value followed by boat speeds:

```
twa/tws;6;8;10;12;14;16;20
52;4.5;5.2;5.8;6.1;6.3;6.4;6.5
...
```

**Wind speed cap:** The polar's highest TWS column is a hard cap. Wind above that value is evaluated at the maximum column speed — the router does not extrapolate beyond measured data. This prevents the router from favouring high-wind areas due to artificially inflated speed predictions.

**Minimum TWA:** The polar's lowest TWA row is the close-hauled angle. The router returns zero speed for any heading tighter than this — the boat cannot sail into the wind. Combined with the motor option, the motor kicks in for those headings when configured.

## Land data (GSHHG)

Land avoidance uses the [GSHHG](https://www.soest.hawaii.edu/pwessel/gshhg/) (Global Self-consistent Hierarchical High-resolution Geography) dataset, version 2.3.7, published by NOAA and the University of Hawaii. GSHHG is distributed under the [GNU Lesser General Public License v3](https://www.gnu.org/licenses/lgpl-3.0.html).

The plugin bundles pre-built binary indices derived from the GSHHG `h` (high, approximately 1 km) resolution tier. If you need to regenerate the indices (e.g. to change resolution), see [DEVELOPMENT.md](DEVELOPMENT.md).

## Notes

- GRIB files are not downloaded automatically — obtain them from [OpenSkiron](https://openskiron.org/en/icon-gribs) or another provider and place them in the configured `gribDir`
- Routing accuracy depends on polar quality and forecast accuracy
- The algorithm cannot thread passages narrower than approximately 1 NM at typical leg lengths
- This plugin has not been used for actual navigation; treat calculated routes as planning aids only

## Route quality checks

Every calculated route is checked independently before it can be saved. A route is rejected if it
contains invalid coordinates or times, moves backward in time, does not match the requested
endpoints, crosses the active shoreline or avoided-region index, violates a configured depth or
shore-distance constraint, or contains a true-wind angle that does not agree with its heading and
re-sampled wind direction.

Non-fatal confidence findings are shown with the result and stored as `wayfinderQuality` on the
Signal K route. These include abrupt wind shifts, conditions beyond the configured forecast-skill
horizon, wind above the polar table range, material polar-speed differences, disabled land checks,
and the current arrival-radius time approximation. The report also records route distance, point
count, maximum wind shift, maximum TWA error, maximum forecast lead time, and the minimum observed
raster depth when depth checking is active.

### GDAL boundary

The packaged GDAL 3.12.3 runtime provides the GRIB driver that decodes GRIB1/GRIB2 raster bands,
georeferencing, and per-band forecast metadata. Wayfinder then performs its own bilinear spatial
interpolation and nearest-timestep selection. It does not currently interpolate wind in time.

GDAL does not determine whether a forecast is meteorologically skillful, whether a polar is
realistic, or whether a route is navigationally safe. Land avoidance and shore-distance constraints
come from the separate GSHHG high-resolution shoreline index, not GDAL. When configured, GDAL
supplies numeric bathymetry cells from a local raster. It does not decide whether the raster is
current or authoritative, and Wayfinder still does not model charted hazards, bridge clearance,
traffic separation schemes, tides, or under-keel clearance. The optional 0.5 NM dilated shoreline
and configurable shoreline clearance are conservative geometric margins, not substitutes for those
missing data.
