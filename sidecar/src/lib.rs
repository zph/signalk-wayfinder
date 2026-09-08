use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
    pub times_ms: Vec<i64>,
    pub lat_min: f64,
    pub lat_step: f64,
    pub lon_min: f64,
    pub lon_step: f64,
    pub n_lat: usize,
    pub n_lon: usize,
    pub u10: Vec<Vec<f32>>,
    pub v10: Vec<Vec<f32>>,
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
    pub max_heading_change: Option<f64>,
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
    pub grib_file_path: Option<String>,
}

#[derive(Clone, Debug)]
struct Node {
    position: LatLon,
    time_ms: i64,
    heading: f64,
    twa: f64,
    tws: f64,
    boat_speed: Option<f64>,
    wind_dir: f64,
    parent: Option<usize>,
}

pub fn calculate<F>(
    request: &CalculateRequest,
    options: &CalculateOptions,
    polar: &Polar,
    wind: &WindGrid,
    mut progress: F,
) -> Result<Vec<RoutePoint>, String>
where
    F: FnMut(f64, &[LatLon]),
{
    validate(wind, polar)?;
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
    let max_heading_change = bounded(
        options.max_heading_change.unwrap_or(120.0),
        0.0,
        180.0,
        "maxHeadingChange",
    )?;

    let start_idx = nearest_time_index(&wind.times_ms, request.departure_time_ms);
    if start_idx + 1 >= wind.times_ms.len() {
        return Err("departure time is at or after the end of the forecast data".into());
    }
    if !covers(wind, request.start) || !covers(wind, request.end) {
        return Err("start and destination must be inside the supplied wind grid".into());
    }

    let seed_wind = sample_wind(wind, request.start, start_idx)?;
    let mut arena = vec![Node {
        position: request.start,
        time_ms: wind.times_ms[start_idx],
        heading: 0.0,
        twa: 0.0,
        tws: wind_speed_knots(seed_wind),
        boat_speed: None,
        wind_dir: wind_direction(seed_wind),
        parent: None,
    }];
    let mut frontier = vec![0usize];
    let total_steps = wind.times_ms.len() - start_idx - 1;

    for (completed, step) in (start_idx..wind.times_ms.len() - 1).enumerate() {
        let next_time = wind.times_ms[step + 1];
        let dt_hours = (next_time - wind.times_ms[step]) as f64 / 3_600_000.0;
        if !dt_hours.is_finite() || dt_hours <= 0.0 {
            return Err("wind times must be strictly increasing".into());
        }

        let mut candidates = Vec::new();
        let mut arrived: Option<(usize, f64)> = None;
        for parent_index in frontier.iter().copied() {
            let point = arena[parent_index].clone();
            let wind_vector = sample_wind(wind, point.position, step)?;
            let tws = wind_speed_knots(wind_vector);
            let wind_dir = wind_direction(wind_vector);
            let destination_bearing = bearing_to(point.position, request.end);

            let mut raw_heading = 0.0;
            while raw_heading < 360.0 {
                let heading = normalize_degrees(raw_heading);
                if angle_difference(heading, destination_bearing) > cone_half_angle {
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
                let boat_speed = interpolate_boat_speed(polar, twa, tws);
                if boat_speed < min_boat_speed {
                    raw_heading += heading_step;
                    continue;
                }

                let position = destination_point(point.position, boat_speed * dt_hours, heading);
                if !covers(wind, position) {
                    raw_heading += heading_step;
                    continue;
                }
                let node_index = arena.len();
                arena.push(Node {
                    position,
                    time_ms: next_time,
                    heading,
                    twa,
                    tws,
                    boat_speed: Some(boat_speed),
                    wind_dir,
                    parent: Some(parent_index),
                });
                candidates.push(node_index);

                let remaining = haversine_nm(position, request.end);
                if remaining <= arrival_radius_nm
                    && arrived.is_none_or(|(_, best)| remaining < best)
                {
                    arrived = Some((node_index, remaining));
                }
                raw_heading += heading_step;
            }
        }

        if let Some((node_index, remaining)) = arrived {
            progress(100.0, &[]);
            return Ok(backtrack(&arena, node_index, request.end, remaining, wind));
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

fn validate(wind: &WindGrid, polar: &Polar) -> Result<(), String> {
    if wind.n_lat < 2 || wind.n_lon < 2 || wind.times_ms.len() < 2 {
        return Err("wind grid must have at least 2x2 cells and two time steps".into());
    }
    let frame_size = wind.n_lat * wind.n_lon;
    if wind.u10.len() != wind.times_ms.len()
        || wind.v10.len() != wind.times_ms.len()
        || wind.u10.iter().any(|frame| frame.len() != frame_size)
        || wind.v10.iter().any(|frame| frame.len() != frame_size)
    {
        return Err("wind frame dimensions do not match grid metadata".into());
    }
    if polar.tws.len() < 2
        || polar.twa.len() < 2
        || polar.speeds.len() != polar.twa.len()
        || polar.speeds.iter().any(|row| row.len() != polar.tws.len())
    {
        return Err("polar dimensions are invalid".into());
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

fn covers(grid: &WindGrid, point: LatLon) -> bool {
    let lat_max = grid.lat_min + grid.lat_step * (grid.n_lat - 1) as f64;
    let lon_max = grid.lon_min + grid.lon_step * (grid.n_lon - 1) as f64;
    point.lat >= grid.lat_min
        && point.lat <= lat_max
        && point.lon >= grid.lon_min
        && point.lon <= lon_max
}

fn sample_wind(grid: &WindGrid, point: LatLon, time_index: usize) -> Result<(f64, f64), String> {
    if !covers(grid, point) {
        return Err("wind sample is outside grid coverage".into());
    }
    Ok((
        bilinear(&grid.u10[time_index], grid, point) as f64,
        bilinear(&grid.v10[time_index], grid, point) as f64,
    ))
}

fn bilinear(frame: &[f32], grid: &WindGrid, point: LatLon) -> f32 {
    let lat_f = (point.lat - grid.lat_min) / grid.lat_step;
    let lon_f = (point.lon - grid.lon_min) / grid.lon_step;
    let lat_i = (lat_f.floor() as isize).clamp(0, grid.n_lat as isize - 2) as usize;
    let lon_i = (lon_f.floor() as isize).clamp(0, grid.n_lon as isize - 2) as usize;
    let t_lat = lat_f - lat_i as f64;
    let t_lon = lon_f - lon_i as f64;
    let index = |lat: usize, lon: usize| lat * grid.n_lon + lon;
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
    wind: &WindGrid,
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
            RoutePoint {
                lat: node.position.lat,
                lon: node.position.lon,
                time_ms: node.time_ms,
                heading: node.heading,
                twa: node.twa,
                tws: node.tws,
                boat_speed: node.boat_speed,
                propulsion: node.boat_speed.map(|_| "sail"),
                wind_dir: node.wind_dir,
                leg_calc_ms: 0,
                grib_file_path: wind.source_path.clone(),
            }
        })
        .collect();
    let parent = &arena[arrived];
    let speed = parent.boat_speed.unwrap_or(0.0);
    let arrival_ms = parent.time_ms + ((remaining_nm / speed) * 3_600_000.0).round() as i64;
    let wind_index = nearest_time_index(&wind.times_ms, arrival_ms);
    let vector = sample_wind(wind, end, wind_index).unwrap_or((0.0, 0.0));
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
        propulsion: Some("sail"),
        wind_dir,
        leg_calc_ms: 0,
        grib_file_path: wind.source_path.clone(),
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
                times_ms,
                lat_min: 40.0,
                lat_step: 0.5,
                lon_min: 10.0,
                lon_step: 0.5,
                n_lat: 5,
                n_lon: 5,
                u10: vec![frame; 8],
                v10: vec![north; 8],
            },
        )
    }

    #[test]
    fn calculates_an_open_water_route() {
        let (request, options, polar, wind) = fixture();
        let route = calculate(&request, &options, &polar, &wind, |_, _| {}).unwrap();
        assert_eq!(route.first().unwrap().lat, request.start.lat);
        assert_eq!(route.last().unwrap().lat, request.end.lat);
        assert!(route.len() >= 3);
    }

    #[test]
    fn rejects_bad_grid_dimensions() {
        let (request, options, polar, mut wind) = fixture();
        wind.u10[0].pop();
        assert!(
            calculate(&request, &options, &polar, &wind, |_, _| {})
                .unwrap_err()
                .contains("dimensions")
        );
    }
}
