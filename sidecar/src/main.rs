use serde::Deserialize;
use serde_json::{Value, json};
use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::os::unix::fs::PermissionsExt;
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::PathBuf;
use std::{env, process};
use wayfinder_core_sidecar::{
    CalculateOptions, CalculateRequest, LatLon, Polar, WindGrid, calculate,
};

const PROTOCOL_VERSION: u32 = 1;
const MAX_REQUEST_BYTES: usize = 512 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum Request {
    Hello {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId")]
        request_id: String,
    },
    Calculate {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "requestId")]
        request_id: String,
        request: CalculateRequest,
        #[serde(default)]
        options: Box<CalculateOptions>,
        polar: Polar,
        wind: Box<WindGrid>,
    },
}

fn send(writer: &mut BufWriter<UnixStream>, value: Value) -> std::io::Result<()> {
    serde_json::to_writer(&mut *writer, &value)?;
    writer.write_all(b"\n")?;
    writer.flush()
}

fn error(writer: &mut BufWriter<UnixStream>, request_id: &str, code: &str, message: &str) {
    let _ = send(
        writer,
        json!({ "type": "error", "protocolVersion": PROTOCOL_VERSION, "requestId": request_id, "code": code, "message": message }),
    );
}

fn handle(stream: UnixStream) -> std::io::Result<()> {
    let reader_stream = stream.try_clone()?;
    let mut reader = BufReader::new(reader_stream);
    let mut writer = BufWriter::new(stream);
    loop {
        let mut bytes = Vec::new();
        let read = reader.read_until(b'\n', &mut bytes)?;
        if read == 0 {
            return Ok(());
        }
        if bytes.len() > MAX_REQUEST_BYTES {
            error(
                &mut writer,
                "unknown",
                "request_too_large",
                "request exceeds the 512 MiB protocol limit",
            );
            return Ok(());
        }
        let message: Request = match serde_json::from_slice(&bytes) {
            Ok(message) => message,
            Err(candidate) => {
                error(
                    &mut writer,
                    "unknown",
                    "invalid_request",
                    &candidate.to_string(),
                );
                continue;
            }
        };
        match message {
            Request::Hello {
                protocol_version,
                request_id,
            } => {
                if protocol_version != PROTOCOL_VERSION {
                    error(
                        &mut writer,
                        &request_id,
                        "protocol_mismatch",
                        "unsupported protocol version",
                    );
                    continue;
                }
                send(
                    &mut writer,
                    json!({
                        "type": "hello",
                        "protocolVersion": PROTOCOL_VERSION,
                        "requestId": request_id,
                        "engineVersion": env!("CARGO_PKG_VERSION"),
                        "capabilities": {
                            "openWaterWind": true,
                            "landAvoidance": false,
                            "currents": false,
                            "waves": false,
                            "passageConstraints": false,
                            "navigationSafety": false,
                            "transport": "unix-ndjson-v1"
                        }
                    }),
                )?;
            }
            Request::Calculate {
                protocol_version,
                request_id,
                request,
                options,
                polar,
                wind,
            } => {
                if protocol_version != PROTOCOL_VERSION {
                    error(
                        &mut writer,
                        &request_id,
                        "protocol_mismatch",
                        "unsupported protocol version",
                    );
                    continue;
                }
                let outcome = calculate(
                    &request,
                    &options,
                    &polar,
                    &wind,
                    |percent, frontier: &[LatLon]| {
                        let _ = send(
                            &mut writer,
                            json!({ "type": "progress", "protocolVersion": PROTOCOL_VERSION, "requestId": request_id, "percent": percent, "frontier": frontier }),
                        );
                    },
                );
                match outcome {
                    Ok(route) => send(
                        &mut writer,
                        json!({ "type": "result", "protocolVersion": PROTOCOL_VERSION, "requestId": request_id, "route": route }),
                    )?,
                    Err(message) => error(&mut writer, &request_id, "calculation_failed", &message),
                }
            }
        }
    }
}

fn socket_argument() -> Result<PathBuf, String> {
    let mut args = env::args().skip(1);
    match (args.next().as_deref(), args.next(), args.next()) {
        (Some("--socket"), Some(path), None) => Ok(PathBuf::from(path)),
        _ => Err("usage: wayfinder-core-sidecar --socket /path/to/socket".into()),
    }
}

fn run() -> Result<(), String> {
    let socket = socket_argument()?;
    if socket.exists() {
        return Err(format!("socket path already exists: {}", socket.display()));
    }
    if let Some(parent) = socket.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let listener = UnixListener::bind(&socket).map_err(|error| error.to_string())?;
    fs::set_permissions(&socket, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    for connection in listener.incoming() {
        match connection {
            Ok(stream) => {
                std::thread::spawn(move || {
                    let _ = handle(stream);
                });
            }
            Err(error) => eprintln!("sidecar accept error: {error}"),
        }
    }
    Ok(())
}

fn main() {
    if let Err(error) = run() {
        eprintln!("wayfinder core sidecar: {error}");
        process::exit(1);
    }
}
