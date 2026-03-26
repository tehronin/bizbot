use std::{
  net::TcpStream,
  process::{Command, Stdio},
  thread,
  time::{Duration, Instant},
};

use tauri::{path::BaseDirectory, Manager};

fn wait_for_local_server(address: &str, timeout: Duration) -> bool {
  let started = Instant::now();
  while started.elapsed() < timeout {
    if TcpStream::connect(address).is_ok() {
      return true;
    }
    thread::sleep(Duration::from_millis(250));
  }
  false
}

fn start_bundled_next_server(app: &tauri::App) {
  if cfg!(debug_assertions) {
    return;
  }

  let server_dir = match app.path().resolve("standalone", BaseDirectory::Resource) {
    Ok(path) => path,
    Err(error) => {
      log::error!("failed to resolve packaged Next standalone directory: {error}");
      return;
    }
  };

  let server_entry = server_dir.join("server.js");
  if !server_entry.exists() {
    log::error!(
      "packaged Next standalone entrypoint is missing at {}",
      server_entry.display()
    );
    return;
  }

  if let Err(error) = Command::new("node")
    .arg(&server_entry)
    .current_dir(&server_dir)
    .env("HOSTNAME", "127.0.0.1")
    .env("PORT", "3000")
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::inherit())
    .spawn()
  {
    log::error!("failed to launch packaged Next standalone server with node: {error}");
    return;
  }

  if let Some(window) = app.get_webview_window("main") {
    thread::spawn(move || {
      if wait_for_local_server("127.0.0.1:3000", Duration::from_secs(20)) {
        if let Err(error) = window.eval("window.location.replace('http://127.0.0.1:3000');") {
          log::error!("failed to redirect packaged window to local Next server: {error}");
        }
      } else {
        log::error!("timed out waiting for packaged Next standalone server on 127.0.0.1:3000");
      }
    });
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .setup(|app| {
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;
      start_bundled_next_server(app);
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
