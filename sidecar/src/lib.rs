use serde::{Deserialize, Deserializer, Serialize, de::Error as _};
use std::cmp::Ordering;
use std::collections::{BTreeSet, HashMap};
use std::f64::consts::PI;

const EARTH_RADIUS_NM: f64 = 3440.065;
const MPS_TO_KNOTS: f64 = 1.94384;

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatLon {
    pub lat: f64,
    pub lon: f64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WindGrid {
    pub source_path: Option<String>,
    #[serde(default)]
    pub reference_time_ms: i64,
    #[serde(default)]
    pub mtime_ms: i64,
    pub times_ms: Vec<i64>,
    pub lat_min: f64,
    pub lat_step: f64,
    pub lon_min: f64,
    pub lon_step: f64,
    pub n_lat: usize,
    pub n_lon: usize,
    pub u10: Vec<Vec<f32>>,
    pub v10: Vec<Vec<f32>>,
    pub wave: Option<ScalarGrid>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScalarGrid {
    pub times_ms: Vec<i64>,
    pub lat_min: f64,
    pub lat_step: f64,
    pub lon_min: f64,
    pub lon_step: f64,
    pub n_lat: usize,
    pub n_lon: usize,
    pub values: Vec<Vec<f32>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentGrid {
    pub times_ms: Vec<i64>,
    pub lat_min: f64,
    pub lat_step: f64,
    pub lon_min: f64,
    pub lon_step: f64,
    pub n_lat: usize,
    pub n_lon: usize,
    pub u: Vec<Vec<f32>>,
    pub v: Vec<Vec<f32>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandPolygon {
    pub bbox_lat_min: f64,
    pub bbox_lat_max: f64,
    pub bbox_lon_min: f64,
    pub bbox_lon_max: f64,
    pub exterior: Vec<f64>,
    #[serde(default)]
    pub interiors: Vec<Vec<f64>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LandEdgeIndex {
    pub polygons: Vec<LandPolygon>,
    #[serde(deserialize_with = "deserialize_index_grid")]
    pub edge_grid: HashMap<i32, Vec<usize>>,
    #[serde(deserialize_with = "deserialize_index_grid")]
    pub poly_grid: HashMap<i32, Vec<usize>>,
}

fn deserialize_index_grid<'de, D>(deserializer: D) -> Result<HashMap<i32, Vec<usize>>, D::Error>
where
    D: Deserializer<'de>,
{
    HashMap::<String, Vec<usize>>::deserialize(deserializer)?
        .into_iter()
        .map(|(key, value)| {
            key.parse::<i32>()
                .map(|parsed| (parsed, value))
                .map_err(D::Error::custom)
        })
        .collect()
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AvoidedRegion {
    pub bbox_lat_min: f64,
    pub bbox_lat_max: f64,
    pub bbox_lon_min: f64,
    pub bbox_lon_max: f64,
    pub exterior: Vec<f64>,
}

#[derive(Clone, Debug, Deserialize)]
pub struct Polar {
    pub tws: Vec<f64>,
    pub twa: Vec<f64>,
    pub speeds: Vec<Vec<f64>>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CalculateRequest {
    pub start: LatLon,
    pub end: LatLon,
    pub departure_time_ms: i64,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct CalculateOptions {
    pub heading_step: Option<f64>,
    pub sector_size: Option<f64>,
    pub min_boat_speed: Option<f64>,
    pub arrival_radius_nm: Option<f64>,
    pub cone_half_angle: Option<f64>,
    pub cone_disable_lookahead_nm: Option<f64>,
    pub max_heading_change: Option<f64>,
    pub heading_offset_deg: Option<f64>,
    pub max_wind_kn: Option<f64>,
    pub max_wave_m: Option<f64>,
    pub motor_speed_kn: Option<f64>,
    pub motor_below_kn: Option<f64>,
    pub force_motor: Option<bool>,
    pub wait_for_wind: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutePoint {
    pub lat: f64,
    pub lon: f64,
    pub time_ms: i64,
    pub heading: f64,
    pub twa: f64,
    pub tws: f64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub boat_speed: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub propulsion: Option<&'static str>,
    pub wind_dir: f64,
    pub leg_calc_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wave_height: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grib_file_path: Option<String>,
}

#[derive(Clone, Debug)]
struct Node {
    position: LatLon,
    time_ms: i64,
    heading: f64,
    boat_speed: Option<f64>,
    propulsion: Option<&'static str>,
    grib_file_path: Option<String>,
    parent: Option<usize>,
}

pub struct RoutingData<'a> {
    pub wind_sources: &'a [WindGrid],
    pub current: Option<&'a CurrentGrid>,
    pub land: Option<&'a LandEdgeIndex>,
    pub avoided_regions: &'a [AvoidedRegion],
}

pub fn calculate<F>(
    request: &CalculateRequest,
    options: &CalculateOptions,
    polar: &Polar,
    routing: RoutingData<'_>,
    mut progress: F,
) -> Result<Vec<RoutePoint>, String>
where
    F: FnMut(f64, &[LatLon]),
{
    let RoutingData {
        wind_sources,
        current,
        land,
        avoided_regions,
    } = routing;
    validate(wind_sources, current, polar, land, avoided_regions)?;
    let heading_step = positive(options.heading_step.unwrap_or(5.0), "headingStep")?;
    let sector_size = positive(options.sector_size.unwrap_or(1.0), "sectorSize")?;
    let min_boat_speed = non_negative(options.min_boat_speed.unwrap_or(0.3), "minBoatSpeed")?;
    let arrival_radius_nm = positive(options.arrival_radius_nm.unwrap_or(2.0), "arrivalRadiusNm")?;
    let cone_half_angle = bounded(
        options.cone_half_angle.unwrap_or(100.0),
        0.0,
        180.0,
        "coneHalfAngle",
    )?;
    let cone_disable_lookahead_nm = positive(
        options.cone_disable_lookahead_nm.unwrap_or(100.0),
        "coneDisableLookaheadNm",
    )?;
    let max_heading_change = bounded(
        options.max_heading_change.unwrap_or(120.0),
        0.0,
        180.0,
        "maxHeadingChange",
    )?;
    let heading_offset = finite(
        options.heading_offset_deg.unwrap_or(0.0),
        "headingOffsetDeg",
    )?;
    let max_wind_kn = non_negative(options.max_wind_kn.unwrap_or(0.0), "maxWindKn")?;
    let max_wave_m = non_negative(options.max_wave_m.unwrap_or(0.0), "maxWaveM")?;
    let motor_speed_kn = non_negative(options.motor_speed_kn.unwrap_or(0.0), "motorSpeedKn")?;
    let motor_below_kn = non_negative(options.motor_below_kn.unwrap_or(0.0), "motorBelowKn")?;
    let force_motor = options.force_motor.unwrap_or(false);
    let wait_for_wind = options.wait_for_wind.unwrap_or(false);

    let times_ms = merged_times(wind_sources);

    let start_idx = nearest_time_index(&times_ms, request.departure_time_ms);
    if start_idx + 1 >= times_ms.len() {
        return Err("departure time is at or after the end of the forecast data".into());
    }
    if !covers_any(wind_sources, request.start) || !covers_any(wind_sources, request.end) {
        return Err("start and destination must be inside the supplied wind grid".into());
    }
    if point_in_avoided_region(avoided_regions, request.start) {
        return Err(
            "start point is inside an avoided region — move it to open water or unmark that region"
                .into(),
        );
    }
    if point_in_avoided_region(avoided_regions, request.end) {
        return Err(
            "destination is inside an avoided region — move it to open water or unmark that region"
                .into(),
        );
    }

    let mut arena = vec![Node {
        position: request.start,
        time_ms: times_ms[start_idx],
        heading: 0.0,
        boat_speed: None,
        propulsion: None,
        grib_file_path: None,
        parent: None,
    }];
    let mut frontier = vec![0usize];
    let total_steps = times_ms.len() - start_idx - 1;

    for (completed, step) in (start_idx..times_ms.len() - 1).enumerate() {
        let next_time = times_ms[step + 1];
        let dt_hours = (next_time - times_ms[step]) as f64 / 3_600_000.0;
        if !dt_hours.is_finite() || dt_hours <= 0.0 {
            return Err("wind times must be strictly increasing".into());
        }

        let mut candidates = Vec::new();
        let mut arrived: Option<(usize, f64)> = None;
        for parent_index in frontier.iter().copied() {
            let point = arena[parent_index].clone();
            if land.is_some_and(|index| is_point_on_land(index, point.position))
                || point_in_avoided_region(avoided_regions, point.position)
            {
                continue;
            }
            let (wind_vector, source_path) =
                sample_selected_wind(wind_sources, point.position, times_ms[step]);
            let tws = wind_speed_knots(wind_vector);
            let wind_dir = wind_direction(wind_vector);
            let destination_bearing = bearing_to(point.position, request.end);

            let distance_to_destination = haversine_nm(point.position, request.end);
            let cone_check_end = if distance_to_destination <= cone_disable_lookahead_nm {
                request.end
            } else {
                destination_point(
                    point.position,
                    cone_disable_lookahead_nm,
                    destination_bearing,
                )
            };
            let direct_path_blocked = land
                .is_some_and(|index| segment_crosses_land(index, point.position, cone_check_end))
                || segment_crosses_avoided_region(avoided_regions, point.position, cone_check_end);
            let point_cone_half_angle = if direct_path_blocked {
                180.0
            } else {
                cone_half_angle
            };

            if max_wind_kn > 0.0 && tws > max_wind_kn {
                continue;
            }
            if max_wave_m > 0.0
                && sample_selected_wave(wind_sources, point.position, times_ms[step])
                    .is_some_and(|height| height > max_wave_m)
            {
                continue;
            }

            let mut wait_candidate_added = false;
            let mut add_wait_candidate = |arena: &mut Vec<Node>, candidates: &mut Vec<usize>| {
                if wait_candidate_added {
                    return;
                }
                let index = arena.len();
                arena.push(Node {
                    position: point.position,
                    time_ms: next_time,
                    heading: point.heading,
                    boat_speed: Some(0.0),
                    propulsion: Some("wait"),
                    grib_file_path: source_path.clone(),
                    parent: Some(parent_index),
                });
                candidates.push(index);
                wait_candidate_added = true;
            };

            let mut raw_heading = heading_offset;
            while raw_heading < 360.0 + heading_offset {
                let heading = normalize_degrees(raw_heading);
                if angle_difference(heading, destination_bearing) > point_cone_half_angle {
                    raw_heading += heading_step;
                    continue;
                }
                if point.parent.is_some()
                    && angle_difference(heading, point.heading) > max_heading_change
                {
                    raw_heading += heading_step;
                    continue;
                }

                let twa = true_wind_angle(heading, wind_dir);
                let polar_speed = interpolate_boat_speed(polar, twa, tws);
                let motoring = motor_speed_kn > 0.0
                    && (force_motor || (motor_below_kn > 0.0 && polar_speed < motor_below_kn));
                let boat_speed = if motoring {
                    motor_speed_kn
                } else {
                    polar_speed
                };
                if boat_speed < min_boat_speed {
                    if wait_for_wind {
                        add_wait_candidate(&mut arena, &mut candidates);
                    }
                    raw_heading += heading_step;
                    continue;
                }

                let water_track = destination_point(point.position, boat_speed * dt_hours, heading);
                let mut position = water_track;
                if let Some(grid) = current {
                    let drift = sample_current(grid, point.position, next_time);
                    let dt_seconds = dt_hours * 3_600.0;
                    position.lat += (drift.1 * dt_seconds) / (1852.0 * 60.0);
                    position.lon += (drift.0 * dt_seconds)
                        / (1852.0 * 60.0 * radians(point.position.lat).cos());
                }
                if !covers_at_time(wind_sources, position, times_ms[step]) {
                    raw_heading += heading_step;
                    continue;
                }
                if land.is_some_and(|index| segment_crosses_land(index, point.position, position))
                    || segment_crosses_avoided_region(avoided_regions, point.position, position)
                {
                    raw_heading += heading_step;
                    continue;
                }
                let node_index = arena.len();
                arena.push(Node {
                    position,
                    time_ms: next_time,
                    heading,
                    boat_speed: Some(boat_speed),
                    propulsion: Some(if motoring { "motor" } else { "sail" }),
                    grib_file_path: source_path.clone(),
                    parent: Some(parent_index),
                });
                candidates.push(node_index);

                let remaining = haversine_nm(position, request.end);
                if remaining <= arrival_radius_nm
                    && !land.is_some_and(|index| segment_crosses_land(index, position, request.end))
                    && arrived.is_none_or(|(_, best)| remaining < best)
                {
                    arrived = Some((node_index, remaining));
                }
                raw_heading += heading_step;
            }
        }

        if let Some((node_index, remaining)) = arrived {
            progress(100.0, &[]);
            return Ok(backtrack(
                &arena,
                node_index,
                request.end,
                remaining,
                wind_sources,
                &times_ms,
            ));
        }
        if candidates.is_empty() {
            return Err("frontier exhausted before reaching the destination".into());
        }

        frontier = prune_frontier(&arena, &candidates, request.start, sector_size);
        let points: Vec<LatLon> = frontier
            .iter()
            .map(|index| arena[*index].position)
            .collect();
        progress(
            ((completed + 1) as f64 / total_steps as f64) * 100.0,
            &points,
        );
    }

    Err("destination not reached within the supplied forecast period".into())
}

fn edge_cell_key(lat_cell: i32, lon_cell: i32) -> i32 {
    (lat_cell + 900) * 3600 + lon_cell.rem_euclid(3600)
}

fn point_in_ring(point: LatLon, ring: &[f64]) -> bool {
    let count = ring.len() / 2;
    let mut inside = false;
    let mut previous = count - 1;
    for current in 0..count {
        let x = ring[current * 2];
        let y = ring[current * 2 + 1];
        let previous_x = ring[previous * 2];
        let previous_y = ring[previous * 2 + 1];
        if (y > point.lat) != (previous_y > point.lat)
            && point.lon < ((previous_x - x) * (point.lat - y)) / (previous_y - y) + x
        {
            inside = !inside;
        }
        previous = current;
    }
    inside
}

fn is_point_on_land(index: &LandEdgeIndex, point: LatLon) -> bool {
    let key = (point.lat.floor() as i32 + 90) * 360 + (point.lon.floor() as i32 + 180);
    index.poly_grid.get(&key).is_some_and(|candidates| {
        candidates.iter().any(|polygon_index| {
            let polygon = &index.polygons[*polygon_index];
            point.lat >= polygon.bbox_lat_min
                && point.lat <= polygon.bbox_lat_max
                && point.lon >= polygon.bbox_lon_min
                && point.lon <= polygon.bbox_lon_max
                && point_in_ring(point, &polygon.exterior)
                && !polygon
                    .interiors
                    .iter()
                    .any(|ring| point_in_ring(point, ring))
        })
    })
}

#[allow(clippy::too_many_arguments)]
fn segments_intersect(
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
    x3: f64,
    y3: f64,
    x4: f64,
    y4: f64,
) -> bool {
    let first_x = x2 - x1;
    let first_y = y2 - y1;
    let second_x = x4 - x3;
    let second_y = y4 - y3;
    let cross = first_x * second_y - first_y * second_x;
    if cross.abs() < 1e-12 {
        return false;
    }
    let delta_x = x3 - x1;
    let delta_y = y3 - y1;
    let t = (delta_x * second_y - delta_y * second_x) / cross;
    let u = (delta_x * first_y - delta_y * first_x) / cross;
    t > 0.0 && t < 1.0 && u > 0.0 && u < 1.0
}

fn segment_crosses_ring(start: LatLon, end: LatLon, ring: &[f64]) -> bool {
    let count = ring.len() / 2;
    (0..count).any(|edge| {
        let next = if edge + 1 < count { edge + 1 } else { 0 };
        segments_intersect(
            start.lon,
            start.lat,
            end.lon,
            end.lat,
            ring[edge * 2],
            ring[edge * 2 + 1],
            ring[next * 2],
            ring[next * 2 + 1],
        )
    })
}

fn segment_crosses_land(index: &LandEdgeIndex, start: LatLon, end: LatLon) -> bool {
    const CELL_DEGREES: f64 = 0.1;
    let mut lat_cell = (start.lat / CELL_DEGREES).floor() as i32;
    let mut lon_cell = (start.lon / CELL_DEGREES).floor() as i32;
    let lat_end = (end.lat / CELL_DEGREES).floor() as i32;
    let lon_end = (end.lon / CELL_DEGREES).floor() as i32;
    let delta_lat = end.lat - start.lat;
    let delta_lon = end.lon - start.lon;
    let step_lat = if delta_lat > 0.0 {
        1
    } else if delta_lat < 0.0 {
        -1
    } else {
        0
    };
    let step_lon = if delta_lon > 0.0 {
        1
    } else if delta_lon < 0.0 {
        -1
    } else {
        0
    };
    let t_delta_lat = if step_lat == 0 {
        f64::INFINITY
    } else {
        (CELL_DEGREES / delta_lat).abs()
    };
    let t_delta_lon = if step_lon == 0 {
        f64::INFINITY
    } else {
        (CELL_DEGREES / delta_lon).abs()
    };
    let mut t_max_lat = match step_lat {
        1 => ((lat_cell + 1) as f64 * CELL_DEGREES - start.lat) / delta_lat,
        -1 => (lat_cell as f64 * CELL_DEGREES - start.lat) / delta_lat,
        _ => f64::INFINITY,
    };
    let mut t_max_lon = match step_lon {
        1 => ((lon_cell + 1) as f64 * CELL_DEGREES - start.lon) / delta_lon,
        -1 => (lon_cell as f64 * CELL_DEGREES - start.lon) / delta_lon,
        _ => f64::INFINITY,
    };
    let max_cells = (lat_end - lat_cell).unsigned_abs() + (lon_end - lon_cell).unsigned_abs() + 1;

    for _ in 0..max_cells {
        if let Some(entries) = index.edge_grid.get(&edge_cell_key(lat_cell, lon_cell)) {
            for edge_reference in entries.chunks_exact(3) {
                let polygon = &index.polygons[edge_reference[0]];
                let ring = if edge_reference[1] == 0 {
                    &polygon.exterior
                } else {
                    &polygon.interiors[edge_reference[1] - 1]
                };
                let edge = edge_reference[2];
                let next = if edge + 1 < ring.len() / 2 {
                    edge + 1
                } else {
                    0
                };
                if segments_intersect(
                    start.lon,
                    start.lat,
                    end.lon,
                    end.lat,
                    ring[edge * 2],
                    ring[edge * 2 + 1],
                    ring[next * 2],
                    ring[next * 2 + 1],
                ) {
                    return true;
                }
            }
        }
        if lat_cell == lat_end && lon_cell == lon_end {
            break;
        }
        if t_max_lat < t_max_lon {
            t_max_lat += t_delta_lat;
            lat_cell += step_lat;
        } else {
            t_max_lon += t_delta_lon;
            lon_cell += step_lon;
        }
    }
    false
}

fn point_in_avoided_region(regions: &[AvoidedRegion], point: LatLon) -> bool {
    regions.iter().any(|region| {
        point.lat >= region.bbox_lat_min
            && point.lat <= region.bbox_lat_max
            && point.lon >= region.bbox_lon_min
            && point.lon <= region.bbox_lon_max
            && point_in_ring(point, &region.exterior)
    })
}

fn segment_crosses_avoided_region(regions: &[AvoidedRegion], start: LatLon, end: LatLon) -> bool {
    regions.iter().any(|region| {
        start.lat.max(end.lat) >= region.bbox_lat_min
            && start.lat.min(end.lat) <= region.bbox_lat_max
            && start.lon.max(end.lon) >= region.bbox_lon_min
            && start.lon.min(end.lon) <= region.bbox_lon_max
            && segment_crosses_ring(start, end, &region.exterior)
    })
}

fn validate_bbox(
    lat_min: f64,
    lat_max: f64,
    lon_min: f64,
    lon_max: f64,
    name: &str,
) -> Result<(), String> {
    if [lat_min, lat_max, lon_min, lon_max]
        .iter()
        .all(|value| value.is_finite())
        && lat_min <= lat_max
        && lon_min <= lon_max
    {
        Ok(())
    } else {
        Err(format!("{name} bounding box is invalid"))
    }
}

fn validate_ring(ring: &[f64], name: &str) -> Result<(), String> {
    if ring.len() >= 6 && ring.len().is_multiple_of(2) && ring.iter().all(|value| value.is_finite())
    {
        Ok(())
    } else {
        Err(format!("{name} ring is invalid"))
    }
}

fn validate_land_index(index: &LandEdgeIndex) -> Result<(), String> {
    for polygon in &index.polygons {
        validate_bbox(
            polygon.bbox_lat_min,
            polygon.bbox_lat_max,
            polygon.bbox_lon_min,
            polygon.bbox_lon_max,
            "land polygon",
        )?;
        validate_ring(&polygon.exterior, "land polygon exterior")?;
        for ring in &polygon.interiors {
            validate_ring(ring, "land polygon interior")?;
        }
    }
    if index
        .poly_grid
        .values()
        .flatten()
        .any(|polygon| *polygon >= index.polygons.len())
    {
        return Err("land polygon grid contains an invalid polygon index".into());
    }
    for entries in index.edge_grid.values() {
        if !entries.len().is_multiple_of(3) {
            return Err("land edge grid contains an incomplete edge reference".into());
        }
        for edge_reference in entries.chunks_exact(3) {
            let Some(polygon) = index.polygons.get(edge_reference[0]) else {
                return Err("land edge grid contains an invalid polygon index".into());
            };
            let ring = if edge_reference[1] == 0 {
                Some(&polygon.exterior)
            } else {
                polygon.interiors.get(edge_reference[1] - 1)
            };
            if ring.is_none_or(|ring| edge_reference[2] >= ring.len() / 2) {
                return Err("land edge grid contains an invalid ring or edge index".into());
            }
        }
    }
    Ok(())
}

fn validate(
    wind_sources: &[WindGrid],
    current: Option<&CurrentGrid>,
    polar: &Polar,
    land: Option<&LandEdgeIndex>,
    avoided_regions: &[AvoidedRegion],
) -> Result<(), String> {
    if wind_sources.is_empty() {
        return Err("at least one wind source is required".into());
    }
    for wind in wind_sources {
        validate_geometry(
            wind.lat_min,
            wind.lat_step,
            wind.lon_min,
            wind.lon_step,
            wind.n_lat,
            wind.n_lon,
            "wind",
        )?;
        validate_vector_grid(
            wind.n_lat,
            wind.n_lon,
            &wind.times_ms,
            &wind.u10,
            &wind.v10,
            "wind",
        )?;
        if let Some(wave) = &wind.wave {
            validate_geometry(
                wave.lat_min,
                wave.lat_step,
                wave.lon_min,
                wave.lon_step,
                wave.n_lat,
                wave.n_lon,
                "wave",
            )?;
            validate_scalar_grid(wave)?;
        }
    }
    if let Some(grid) = current {
        validate_geometry(
            grid.lat_min,
            grid.lat_step,
            grid.lon_min,
            grid.lon_step,
            grid.n_lat,
            grid.n_lon,
            "current",
        )?;
        validate_vector_grid(
            grid.n_lat,
            grid.n_lon,
            &grid.times_ms,
            &grid.u,
            &grid.v,
            "current",
        )?;
    }
    if polar.tws.len() < 2
        || polar.twa.len() < 2
        || polar.speeds.len() != polar.twa.len()
        || polar.speeds.iter().any(|row| row.len() != polar.tws.len())
        || polar
            .tws
            .iter()
            .chain(&polar.twa)
            .any(|value| !value.is_finite())
        || polar
            .speeds
            .iter()
            .flatten()
            .any(|value| !value.is_finite())
        || polar.tws.windows(2).any(|pair| pair[0] >= pair[1])
        || polar.twa.windows(2).any(|pair| pair[0] >= pair[1])
    {
        return Err("polar dimensions are invalid".into());
    }
    if let Some(index) = land {
        validate_land_index(index)?;
    }
    for region in avoided_regions {
        validate_ring(&region.exterior, "avoided region")?;
        validate_bbox(
            region.bbox_lat_min,
            region.bbox_lat_max,
            region.bbox_lon_min,
            region.bbox_lon_max,
            "avoided region",
        )?;
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_geometry(
    lat_min: f64,
    lat_step: f64,
    lon_min: f64,
    lon_step: f64,
    n_lat: usize,
    n_lon: usize,
    name: &str,
) -> Result<(), String> {
    if !lat_min.is_finite()
        || !lon_min.is_finite()
        || !lat_step.is_finite()
        || !lon_step.is_finite()
        || lat_step <= 0.0
        || lon_step <= 0.0
        || n_lat < 2
        || n_lon < 2
    {
        return Err(format!("{name} grid geometry is invalid"));
    }
    Ok(())
}

fn validate_vector_grid(
    n_lat: usize,
    n_lon: usize,
    times: &[i64],
    u: &[Vec<f32>],
    v: &[Vec<f32>],
    name: &str,
) -> Result<(), String> {
    if n_lat < 2 || n_lon < 2 || times.len() < 2 {
        return Err(format!(
            "{name} grid must have at least 2x2 cells and two time steps"
        ));
    }
    let frame_size = n_lat * n_lon;
    if u.len() != times.len()
        || v.len() != times.len()
        || u.iter().any(|frame| frame.len() != frame_size)
        || v.iter().any(|frame| frame.len() != frame_size)
    {
        return Err(format!(
            "{name} frame dimensions do not match grid metadata"
        ));
    }
    if times.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(format!("{name} times must be strictly increasing"));
    }
    Ok(())
}

fn validate_scalar_grid(grid: &ScalarGrid) -> Result<(), String> {
    let frame_size = grid.n_lat * grid.n_lon;
    if grid.n_lat < 2
        || grid.n_lon < 2
        || grid.times_ms.is_empty()
        || grid.values.len() != grid.times_ms.len()
        || grid.values.iter().any(|frame| frame.len() != frame_size)
    {
        return Err("wave frame dimensions do not match grid metadata".into());
    }
    Ok(())
}

fn positive(value: f64, name: &str) -> Result<f64, String> {
    if value.is_finite() && value > 0.0 {
        Ok(value)
    } else {
        Err(format!("{name} must be positive"))
    }
}

fn finite(value: f64, name: &str) -> Result<f64, String> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(format!("{name} must be finite"))
    }
}

fn non_negative(value: f64, name: &str) -> Result<f64, String> {
    if value.is_finite() && value >= 0.0 {
        Ok(value)
    } else {
        Err(format!("{name} must be non-negative"))
    }
}

fn bounded(value: f64, min: f64, max: f64, name: &str) -> Result<f64, String> {
    if value.is_finite() && value >= min && value <= max {
        Ok(value)
    } else {
        Err(format!("{name} must be between {min} and {max}"))
    }
}

fn nearest_time_index(times: &[i64], target: i64) -> usize {
    times
        .iter()
        .enumerate()
        .min_by_key(|(_, value)| value.abs_diff(target))
        .map(|(index, _)| index)
        .unwrap_or(0)
}

fn merged_times(sources: &[WindGrid]) -> Vec<i64> {
    sources
        .iter()
        .flat_map(|source| source.times_ms.iter().copied())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn covers(grid: &WindGrid, point: LatLon) -> bool {
    covers_geometry(
        grid.lat_min,
        grid.lat_step,
        grid.lon_min,
        grid.lon_step,
        grid.n_lat,
        grid.n_lon,
        point,
    )
}

fn covers_geometry(
    lat_min: f64,
    lat_step: f64,
    lon_min: f64,
    lon_step: f64,
    n_lat: usize,
    n_lon: usize,
    point: LatLon,
) -> bool {
    let lat_max = lat_min + lat_step * (n_lat - 1) as f64;
    let lon_max = lon_min + lon_step * (n_lon - 1) as f64;
    point.lat >= lat_min && point.lat <= lat_max && point.lon >= lon_min && point.lon <= lon_max
}

fn covers_any(sources: &[WindGrid], point: LatLon) -> bool {
    sources.iter().any(|source| covers(source, point))
}

fn covers_at_time(sources: &[WindGrid], point: LatLon, time_ms: i64) -> bool {
    sources.iter().any(|source| {
        covers(source, point)
            && source
                .times_ms
                .first()
                .is_some_and(|start| *start <= time_ms)
            && source.times_ms.last().is_some_and(|end| *end >= time_ms)
    })
}

fn mean_step_ms(times: &[i64]) -> f64 {
    if times.len() < 2 {
        return f64::MAX;
    }
    (times.last().unwrap() - times.first().unwrap()) as f64 / (times.len() - 1) as f64
}

fn source_priority(a: &WindGrid, b: &WindGrid) -> Ordering {
    a.reference_time_ms
        .cmp(&b.reference_time_ms)
        .then_with(|| mean_step_ms(&b.times_ms).total_cmp(&mean_step_ms(&a.times_ms)))
        .then_with(|| b.lat_step.total_cmp(&a.lat_step))
        .then_with(|| a.mtime_ms.cmp(&b.mtime_ms))
}

fn select_wind_source(sources: &[WindGrid], point: LatLon, time_ms: i64) -> Option<&WindGrid> {
    sources
        .iter()
        .filter(|source| {
            covers(source, point)
                && source
                    .times_ms
                    .first()
                    .is_some_and(|start| *start <= time_ms)
                && source.times_ms.last().is_some_and(|end| *end >= time_ms)
        })
        .max_by(|a, b| source_priority(a, b))
}

fn sample_selected_wind(
    sources: &[WindGrid],
    point: LatLon,
    time_ms: i64,
) -> ((f64, f64), Option<String>) {
    let Some(source) = select_wind_source(sources, point, time_ms) else {
        return ((0.0, 0.0), None);
    };
    let time_index = nearest_time_index(&source.times_ms, time_ms);
    (
        (
            bilinear(
                &source.u10[time_index],
                source.lat_min,
                source.lat_step,
                source.lon_min,
                source.lon_step,
                source.n_lat,
                source.n_lon,
                point,
            ) as f64,
            bilinear(
                &source.v10[time_index],
                source.lat_min,
                source.lat_step,
                source.lon_min,
                source.lon_step,
                source.n_lat,
                source.n_lon,
                point,
            ) as f64,
        ),
        source.source_path.clone(),
    )
}

fn sample_selected_wave(sources: &[WindGrid], point: LatLon, time_ms: i64) -> Option<f64> {
    let source = sources
        .iter()
        .filter(|source| {
            source.wave.is_some()
                && covers(source, point)
                && source
                    .times_ms
                    .first()
                    .is_some_and(|start| *start <= time_ms)
                && source.times_ms.last().is_some_and(|end| *end >= time_ms)
        })
        .max_by(|a, b| source_priority(a, b))?;
    let wave = source.wave.as_ref()?;
    if !covers_geometry(
        wave.lat_min,
        wave.lat_step,
        wave.lon_min,
        wave.lon_step,
        wave.n_lat,
        wave.n_lon,
        point,
    ) {
        return None;
    }
    let index = nearest_time_index(&wave.times_ms, time_ms);
    let value = bilinear(
        &wave.values[index],
        wave.lat_min,
        wave.lat_step,
        wave.lon_min,
        wave.lon_step,
        wave.n_lat,
        wave.n_lon,
        point,
    ) as f64;
    (value < 100.0).then_some(value)
}

fn sample_current(grid: &CurrentGrid, point: LatLon, time_ms: i64) -> (f64, f64) {
    if !covers_geometry(
        grid.lat_min,
        grid.lat_step,
        grid.lon_min,
        grid.lon_step,
        grid.n_lat,
        grid.n_lon,
        point,
    ) {
        return (0.0, 0.0);
    }
    let index = nearest_time_index(&grid.times_ms, time_ms);
    (
        bilinear(
            &grid.u[index],
            grid.lat_min,
            grid.lat_step,
            grid.lon_min,
            grid.lon_step,
            grid.n_lat,
            grid.n_lon,
            point,
        ) as f64,
        bilinear(
            &grid.v[index],
            grid.lat_min,
            grid.lat_step,
            grid.lon_min,
            grid.lon_step,
            grid.n_lat,
            grid.n_lon,
            point,
        ) as f64,
    )
}

#[allow(clippy::too_many_arguments)]
fn bilinear(
    frame: &[f32],
    lat_min: f64,
    lat_step: f64,
    lon_min: f64,
    lon_step: f64,
    n_lat: usize,
    n_lon: usize,
    point: LatLon,
) -> f32 {
    let lat_f = (point.lat - lat_min) / lat_step;
    let lon_f = (point.lon - lon_min) / lon_step;
    let lat_i = (lat_f.floor() as isize).clamp(0, n_lat as isize - 2) as usize;
    let lon_i = (lon_f.floor() as isize).clamp(0, n_lon as isize - 2) as usize;
    let t_lat = lat_f - lat_i as f64;
    let t_lon = lon_f - lon_i as f64;
    let index = |lat: usize, lon: usize| lat * n_lon + lon;
    let a = frame[index(lat_i, lon_i)] as f64;
    let b = frame[index(lat_i + 1, lon_i)] as f64;
    let c = frame[index(lat_i, lon_i + 1)] as f64;
    let d = frame[index(lat_i + 1, lon_i + 1)] as f64;
    ((1.0 - t_lat) * (1.0 - t_lon) * a
        + t_lat * (1.0 - t_lon) * b
        + (1.0 - t_lat) * t_lon * c
        + t_lat * t_lon * d) as f32
}

fn interpolate_boat_speed(polar: &Polar, twa: f64, tws: f64) -> f64 {
    let angle = twa.abs().clamp(0.0, 180.0);
    if angle < polar.twa[0] {
        return 0.0;
    }
    let twa_i = bracket(&polar.twa, angle);
    let twa_j = (twa_i + 1).min(polar.twa.len() - 1);
    let angle_fraction = fraction(polar.twa[twa_i], polar.twa[twa_j], angle);
    if tws < polar.tws[0] {
        let minimum = lerp(
            polar.speeds[twa_i][0],
            polar.speeds[twa_j][0],
            angle_fraction,
        );
        return minimum * (tws / polar.tws[0]).max(0.0);
    }
    let tws_i = bracket(&polar.tws, tws);
    let tws_j = (tws_i + 1).min(polar.tws.len() - 1);
    let wind_fraction = fraction(polar.tws[tws_i], polar.tws[tws_j], tws);
    lerp(
        lerp(
            polar.speeds[twa_i][tws_i],
            polar.speeds[twa_j][tws_i],
            angle_fraction,
        ),
        lerp(
            polar.speeds[twa_i][tws_j],
            polar.speeds[twa_j][tws_j],
            angle_fraction,
        ),
        wind_fraction,
    )
}

fn bracket(values: &[f64], value: f64) -> usize {
    if value <= values[0] {
        return 0;
    }
    if value >= values[values.len() - 1] {
        return values.len() - 2;
    }
    values
        .windows(2)
        .position(|pair| value >= pair[0] && value <= pair[1])
        .unwrap_or(0)
}

fn fraction(a: f64, b: f64, value: f64) -> f64 {
    if a == b {
        0.0
    } else {
        ((value - a) / (b - a)).clamp(0.0, 1.0)
    }
}

fn lerp(a: f64, b: f64, fraction: f64) -> f64 {
    a + (b - a) * fraction
}
fn degrees(value: f64) -> f64 {
    value * 180.0 / PI
}
fn radians(value: f64) -> f64 {
    value * PI / 180.0
}
fn normalize_degrees(value: f64) -> f64 {
    ((value % 360.0) + 360.0) % 360.0
}
fn angle_difference(a: f64, b: f64) -> f64 {
    (normalize_degrees(a - b + 180.0) - 180.0).abs()
}
fn true_wind_angle(heading: f64, wind_dir: f64) -> f64 {
    angle_difference(heading, wind_dir)
}
fn wind_speed_knots((u, v): (f64, f64)) -> f64 {
    u.hypot(v) * MPS_TO_KNOTS
}
fn wind_direction((u, v): (f64, f64)) -> f64 {
    normalize_degrees(degrees((-u).atan2(-v)))
}

fn haversine_nm(a: LatLon, b: LatLon) -> f64 {
    let d_lat = radians(b.lat - a.lat);
    let d_lon = radians(b.lon - a.lon);
    let value = (d_lat / 2.0).sin().powi(2)
        + radians(a.lat).cos() * radians(b.lat).cos() * (d_lon / 2.0).sin().powi(2);
    EARTH_RADIUS_NM * 2.0 * value.sqrt().atan2((1.0 - value).sqrt())
}

fn bearing_to(a: LatLon, b: LatLon) -> f64 {
    let d_lon = radians(b.lon - a.lon);
    let a_lat = radians(a.lat);
    let b_lat = radians(b.lat);
    let y = d_lon.sin() * b_lat.cos();
    let x = a_lat.cos() * b_lat.sin() - a_lat.sin() * b_lat.cos() * d_lon.cos();
    normalize_degrees(degrees(y.atan2(x)))
}

fn destination_point(start: LatLon, distance_nm: f64, bearing: f64) -> LatLon {
    let angular = distance_nm / EARTH_RADIUS_NM;
    let heading = radians(bearing);
    let lat = radians(start.lat);
    let lon = radians(start.lon);
    let result_lat = (lat.sin() * angular.cos() + lat.cos() * angular.sin() * heading.cos()).asin();
    let result_lon = lon
        + (heading.sin() * angular.sin() * lat.cos())
            .atan2(angular.cos() - lat.sin() * result_lat.sin());
    LatLon {
        lat: degrees(result_lat),
        lon: normalize_degrees(degrees(result_lon) + 180.0) - 180.0,
    }
}

fn prune_frontier(
    arena: &[Node],
    candidates: &[usize],
    start: LatLon,
    sector_size: f64,
) -> Vec<usize> {
    let mut sectors: HashMap<i32, Vec<(usize, f64)>> = HashMap::new();
    for index in candidates.iter().copied() {
        let point = arena[index].position;
        let sector = (bearing_to(start, point) / sector_size).floor() as i32;
        let d_lat = point.lat - start.lat;
        let d_lon = (point.lon - start.lon) * radians(start.lat).cos();
        let distance_squared = d_lat * d_lat + d_lon * d_lon;
        let values = sectors.entry(sector).or_default();
        if values.len() < 2 {
            values.push((index, distance_squared));
        } else {
            let closer = usize::from(values[1].1 < values[0].1);
            if distance_squared > values[closer].1 {
                values[closer] = (index, distance_squared);
            }
        }
    }
    sectors
        .into_values()
        .flat_map(|values| values.into_iter().map(|(index, _)| index))
        .collect()
}

fn backtrack(
    arena: &[Node],
    arrived: usize,
    end: LatLon,
    remaining_nm: f64,
    wind_sources: &[WindGrid],
    times_ms: &[i64],
) -> Vec<RoutePoint> {
    let mut indexes = Vec::new();
    let mut current = Some(arrived);
    while let Some(index) = current {
        indexes.push(index);
        current = arena[index].parent;
    }
    indexes.reverse();
    let mut route: Vec<RoutePoint> = indexes
        .into_iter()
        .map(|index| {
            let node = &arena[index];
            let (resampled, _) = sample_selected_wind(wind_sources, node.position, node.time_ms);
            let resampled_wind_dir = wind_direction(resampled);
            RoutePoint {
                lat: node.position.lat,
                lon: node.position.lon,
                time_ms: node.time_ms,
                heading: node.heading,
                twa: if node.parent.is_none() {
                    0.0
                } else {
                    true_wind_angle(node.heading, resampled_wind_dir)
                },
                tws: wind_speed_knots(resampled),
                boat_speed: node.boat_speed,
                propulsion: node.propulsion,
                wind_dir: resampled_wind_dir,
                leg_calc_ms: 0,
                wave_height: sample_selected_wave(wind_sources, node.position, node.time_ms),
                grib_file_path: node.grib_file_path.clone(),
            }
        })
        .collect();
    let parent = &arena[arrived];
    let speed = parent.boat_speed.unwrap_or(0.0);
    let arrival_ms = parent.time_ms + ((remaining_nm / speed) * 3_600_000.0).round() as i64;
    let wind_index = nearest_time_index(times_ms, arrival_ms);
    let (vector, _) = sample_selected_wind(wind_sources, end, times_ms[wind_index]);
    let wind_dir = wind_direction(vector);
    let heading = bearing_to(parent.position, end);
    route.push(RoutePoint {
        lat: end.lat,
        lon: end.lon,
        time_ms: arrival_ms,
        heading,
        twa: true_wind_angle(heading, wind_dir),
        tws: wind_speed_knots(vector),
        boat_speed: Some(speed),
        propulsion: parent.propulsion,
        wind_dir,
        leg_calc_ms: 0,
        wave_height: sample_selected_wave(wind_sources, end, arrival_ms),
        grib_file_path: parent.grib_file_path.clone(),
    });
    route
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (CalculateRequest, CalculateOptions, Polar, WindGrid) {
        let times_ms = (0..8)
            .map(|hour| 1_700_000_000_000 + hour * 3_600_000)
            .collect::<Vec<_>>();
        let frame = vec![0.0; 25];
        let north = vec![5.0; 25];
        (
            CalculateRequest {
                start: LatLon {
                    lat: 41.0,
                    lon: 11.0,
                },
                end: LatLon {
                    lat: 41.2,
                    lon: 11.0,
                },
                departure_time_ms: times_ms[0],
            },
            CalculateOptions {
                arrival_radius_nm: Some(1.0),
                ..Default::default()
            },
            Polar {
                tws: vec![1.0, 30.0],
                twa: vec![0.0, 45.0, 90.0, 135.0, 180.0],
                speeds: vec![
                    vec![0.0, 0.0],
                    vec![5.0, 5.0],
                    vec![5.0, 5.0],
                    vec![5.0, 5.0],
                    vec![5.0, 5.0],
                ],
            },
            WindGrid {
                source_path: Some("fixture.grib2".into()),
                reference_time_ms: times_ms[0],
                mtime_ms: 0,
                times_ms,
                lat_min: 40.0,
                lat_step: 0.5,
                lon_min: 10.0,
                lon_step: 0.5,
                n_lat: 5,
                n_lon: 5,
                u10: vec![frame; 8],
                v10: vec![north; 8],
                wave: None,
            },
        )
    }

    fn small_land_index(with_harbor: bool) -> LandEdgeIndex {
        let exterior = vec![11.02, 41.01, 11.04, 41.01, 11.04, 41.04, 11.02, 41.04];
        let interiors = if with_harbor {
            vec![vec![
                11.025, 41.02, 11.035, 41.02, 11.035, 41.03, 11.025, 41.03,
            ]]
        } else {
            vec![]
        };
        let mut edge_entries = Vec::new();
        for edge in 0..4 {
            edge_entries.extend([0, 0, edge]);
        }
        if with_harbor {
            for edge in 0..4 {
                edge_entries.extend([0, 1, edge]);
            }
        }
        LandEdgeIndex {
            polygons: vec![LandPolygon {
                bbox_lat_min: 41.01,
                bbox_lat_max: 41.04,
                bbox_lon_min: 11.02,
                bbox_lon_max: 11.04,
                exterior,
                interiors,
            }],
            edge_grid: HashMap::from([(edge_cell_key(410, 110), edge_entries)]),
            poly_grid: HashMap::from([((41 + 90) * 360 + (11 + 180), vec![0])]),
        }
    }

    #[test]
    fn calculates_an_open_water_route() {
        let (request, options, polar, wind) = fixture();
        let route = calculate(
            &request,
            &options,
            &polar,
            RoutingData {
                wind_sources: &[wind],
                current: None,
                land: None,
                avoided_regions: &[],
            },
            |_, _| {},
        )
        .unwrap();
        assert_eq!(route.first().unwrap().lat, request.start.lat);
        assert_eq!(route.last().unwrap().lat, request.end.lat);
        assert!(route.len() >= 3);
    }

    #[test]
    fn rejects_bad_grid_dimensions() {
        let (request, options, polar, mut wind) = fixture();
        wind.u10[0].pop();
        assert!(
            calculate(
                &request,
                &options,
                &polar,
                RoutingData {
                    wind_sources: &[wind],
                    current: None,
                    land: None,
                    avoided_regions: &[],
                },
                |_, _| {}
            )
            .unwrap_err()
            .contains("dimensions")
        );
    }

    #[test]
    fn selects_the_newest_covering_wind_source() {
        let (request, options, polar, older) = fixture();
        let mut newer = older.clone();
        newer.source_path = Some("newer.grib2".into());
        newer.reference_time_ms += 1;
        let route = calculate(
            &request,
            &options,
            &polar,
            RoutingData {
                wind_sources: &[older, newer],
                current: None,
                land: None,
                avoided_regions: &[],
            },
            |_, _| {},
        )
        .unwrap();
        assert_eq!(route[1].grib_file_path.as_deref(), Some("newer.grib2"));
    }

    #[test]
    fn applies_current_drift_to_candidate_positions() {
        let (request, options, polar, wind) = fixture();
        let frame = vec![1.0; 25];
        let current = CurrentGrid {
            times_ms: wind.times_ms.clone(),
            lat_min: wind.lat_min,
            lat_step: wind.lat_step,
            lon_min: wind.lon_min,
            lon_step: wind.lon_step,
            n_lat: wind.n_lat,
            n_lon: wind.n_lon,
            u: vec![frame.clone(); wind.times_ms.len()],
            v: vec![vec![0.0; 25]; wind.times_ms.len()],
        };
        let route = calculate(
            &request,
            &options,
            &polar,
            RoutingData {
                wind_sources: &[wind],
                current: Some(&current),
                land: None,
                avoided_regions: &[],
            },
            |_, _| {},
        )
        .unwrap();
        assert!(
            route[1..route.len() - 1]
                .iter()
                .any(|point| point.lon != 11.0)
        );
    }

    #[test]
    fn motors_when_the_polar_cannot_make_progress() {
        let (request, mut options, mut polar, wind) = fixture();
        for row in &mut polar.speeds {
            row.fill(0.0);
        }
        options.motor_speed_kn = Some(5.0);
        options.force_motor = Some(true);
        let route = calculate(
            &request,
            &options,
            &polar,
            RoutingData {
                wind_sources: &[wind],
                current: None,
                land: None,
                avoided_regions: &[],
            },
            |_, _| {},
        )
        .unwrap();
        assert!(
            route
                .iter()
                .skip(1)
                .all(|point| point.propulsion == Some("motor"))
        );
    }

    #[test]
    fn waits_through_calm_wind_when_enabled() {
        let (request, mut options, polar, mut wind) = fixture();
        wind.v10[0].fill(0.0);
        options.wait_for_wind = Some(true);
        let route = calculate(
            &request,
            &options,
            &polar,
            RoutingData {
                wind_sources: &[wind],
                current: None,
                land: None,
                avoided_regions: &[],
            },
            |_, _| {},
        )
        .unwrap();
        assert!(route.iter().any(|point| point.propulsion == Some("wait")));
    }

    #[test]
    fn rejects_frontier_when_wave_limit_is_exceeded() {
        let (request, mut options, polar, mut wind) = fixture();
        wind.wave = Some(ScalarGrid {
            times_ms: wind.times_ms.clone(),
            lat_min: wind.lat_min,
            lat_step: wind.lat_step,
            lon_min: wind.lon_min,
            lon_step: wind.lon_step,
            n_lat: wind.n_lat,
            n_lon: wind.n_lon,
            values: vec![vec![3.0; 25]; wind.times_ms.len()],
        });
        options.max_wave_m = Some(2.0);
        let error = calculate(
            &request,
            &options,
            &polar,
            RoutingData {
                wind_sources: &[wind],
                current: None,
                land: None,
                avoided_regions: &[],
            },
            |_, _| {},
        )
        .unwrap_err();
        assert!(error.contains("frontier exhausted"));
    }

    #[test]
    fn land_index_matches_point_and_strict_edge_semantics() {
        let land = small_land_index(false);
        assert!(is_point_on_land(
            &land,
            LatLon {
                lat: 41.02,
                lon: 11.03
            }
        ));
        assert!(!is_point_on_land(
            &land,
            LatLon {
                lat: 41.02,
                lon: 11.01
            }
        ));
        assert!(segment_crosses_land(
            &land,
            LatLon {
                lat: 41.02,
                lon: 11.01
            },
            LatLon {
                lat: 41.02,
                lon: 11.05
            }
        ));
        assert!(!segments_intersect(0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 1.0, 1.0));
    }

    #[test]
    fn land_polygon_interiors_remain_navigable() {
        let land = small_land_index(true);
        assert!(!is_point_on_land(
            &land,
            LatLon {
                lat: 41.025,
                lon: 11.03
            }
        ));
        assert!(is_point_on_land(
            &land,
            LatLon {
                lat: 41.015,
                lon: 11.03
            }
        ));
    }

    #[test]
    fn avoided_regions_reject_endpoints_and_crossing_segments() {
        let region = AvoidedRegion {
            bbox_lat_min: 41.01,
            bbox_lat_max: 41.04,
            bbox_lon_min: 11.02,
            bbox_lon_max: 11.04,
            exterior: vec![11.02, 41.01, 11.04, 41.01, 11.04, 41.04, 11.02, 41.04],
        };
        assert!(point_in_avoided_region(
            std::slice::from_ref(&region),
            LatLon {
                lat: 41.02,
                lon: 11.03
            }
        ));
        assert!(segment_crosses_avoided_region(
            std::slice::from_ref(&region),
            LatLon {
                lat: 41.02,
                lon: 11.01
            },
            LatLon {
                lat: 41.02,
                lon: 11.05
            }
        ));

        let (mut request, options, polar, wind) = fixture();
        request.start = LatLon {
            lat: 41.02,
            lon: 11.03,
        };
        let error = calculate(
            &request,
            &options,
            &polar,
            RoutingData {
                wind_sources: &[wind],
                current: None,
                land: None,
                avoided_regions: &[region],
            },
            |_, _| {},
        )
        .unwrap_err();
        assert!(error.contains("start point is inside an avoided region"));
    }

    #[test]
    fn land_rejects_a_frontier_seed_inside_a_polygon() {
        let (mut request, options, polar, wind) = fixture();
        request.start = LatLon {
            lat: 41.02,
            lon: 11.03,
        };
        let land = small_land_index(false);
        let error = calculate(
            &request,
            &options,
            &polar,
            RoutingData {
                wind_sources: &[wind],
                current: None,
                land: Some(&land),
                avoided_regions: &[],
            },
            |_, _| {},
        )
        .unwrap_err();
        assert!(error.contains("frontier exhausted"));
    }
}
