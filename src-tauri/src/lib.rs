use std::{
  fs,
  net::TcpStream,
  path::PathBuf,
  process::{Command, Stdio},
  sync::Mutex,
  thread,
  time::{Duration, Instant},
};

use tauri::{
  menu::{Menu, MenuItem, Submenu},
  path::BaseDirectory,
  Manager, RunEvent, State,
};

const MENU_ID_RETRY_LAST_FAILED_TASK: &str = "builder.retry_last_failed_task";
const MENU_ID_OPEN_CURRENT_TASK_LOGS: &str = "builder.open_current_task_logs";
const MENU_ID_CANCEL_RUNNING_TASK: &str = "builder.cancel_running_task";

#[derive(Default)]
struct ManagedProcesses {
  children: Mutex<Vec<std::process::Child>>,
}

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

fn ensure_runtime_home(app: &tauri::App) -> Option<PathBuf> {
  let runtime_home = match app.path().resolve(".", BaseDirectory::AppData) {
    Ok(path) => path,
    Err(error) => {
      log::error!("failed to resolve app data directory: {error}");
      return None;
    }
  };

  if let Err(error) = fs::create_dir_all(&runtime_home) {
    log::error!(
      "failed to create app data directory at {}: {error}",
      runtime_home.display()
    );
    return None;
  }

  let env_path = runtime_home.join(".env");
  if !env_path.exists() {
    match app.path().resolve(".env.example", BaseDirectory::Resource) {
      Ok(example_path) if example_path.exists() => {
        if let Err(error) = fs::copy(&example_path, &env_path) {
          log::error!(
            "failed to seed runtime env file from {} to {}: {error}",
            example_path.display(),
            env_path.display()
          );
        }
      }
      Ok(example_path) => {
        log::warn!("bundled env example not found at {}", example_path.display());
      }
      Err(error) => {
        log::warn!("failed to resolve bundled env example: {error}");
      }
    }
  }

  if let Err(error) = fs::create_dir_all(runtime_home.join("workspace")) {
    log::error!("failed to create runtime workspace directory: {error}");
    return None;
  }

  Some(runtime_home)
}

fn spawn_packaged_node_process(
  server_dir: &PathBuf,
  runtime_home: &PathBuf,
  target_name: &str,
  extra_env: &[(&str, &str)],
) -> Option<std::process::Child> {
  let bootstrap_entry = server_dir.join("server-bootstrap.cjs");
  let target_entry = server_dir.join(target_name);

  if !bootstrap_entry.exists() {
    log::error!("packaged bootstrap entrypoint is missing at {}", bootstrap_entry.display());
    return None;
  }

  if !target_entry.exists() {
    log::error!("packaged target entrypoint is missing at {}", target_entry.display());
    return None;
  }

  let mut command = Command::new("node");
  command
    .arg(&bootstrap_entry)
    .arg(&target_entry)
    .current_dir(server_dir)
    .env("BIZBOT_HOME_DIR", runtime_home)
    .env("BIZBOT_ENV_PATH", runtime_home.join(".env"))
    .stdin(Stdio::null())
    .stdout(Stdio::null())
    .stderr(Stdio::inherit());

  for (key, value) in extra_env {
    command.env(key, value);
  }

  match command.spawn() {
    Ok(child) => Some(child),
    Err(error) => {
      log::error!("failed to launch packaged node target {target_name}: {error}");
      None
    }
  }
}

fn start_bundled_runtime(app: &tauri::App, processes: State<'_, ManagedProcesses>) {
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

  let Some(runtime_home) = ensure_runtime_home(app) else {
    return;
  };

  let Some(server_child) = spawn_packaged_node_process(
    &server_dir,
    &runtime_home,
    "server.js",
    &[("HOSTNAME", "127.0.0.1"), ("PORT", "3000")],
  ) else {
    return;
  };

  let Some(worker_child) = spawn_packaged_node_process(&server_dir, &runtime_home, "worker.cjs", &[]) else {
    return;
  };

  if let Ok(mut children) = processes.children.lock() {
    children.push(server_child);
    children.push(worker_child);
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

fn install_builder_shortcuts_menu(app: &tauri::App) -> tauri::Result<()> {
  let retry_item = MenuItem::with_id(
    app,
    MENU_ID_RETRY_LAST_FAILED_TASK,
    "Retry Last Failed Task",
    true,
    Some("Ctrl+Shift+R"),
  )?;
  let open_logs_item = MenuItem::with_id(
    app,
    MENU_ID_OPEN_CURRENT_TASK_LOGS,
    "Open Current Task Logs",
    true,
    Some("Ctrl+Shift+L"),
  )?;
  let cancel_run_item = MenuItem::with_id(
    app,
    MENU_ID_CANCEL_RUNNING_TASK,
    "Cancel Running Task",
    true,
    Some("Ctrl+Shift+K"),
  )?;

  let builder_submenu = Submenu::with_items(
    app,
    "Builder",
    true,
    &[&retry_item, &open_logs_item, &cancel_run_item],
  )?;
  let menu = Menu::with_items(app, &[&builder_submenu])?;
  app.set_menu(menu)?;
  Ok(())
}

fn dispatch_builder_shortcut(app: &tauri::AppHandle, action: &str) {
  let Some(window) = app.get_webview_window("main") else {
    return;
  };

  let script = format!(
    "window.dispatchEvent(new CustomEvent('bizbot:builder-shortcut', {{ detail: {{ action: {:?} }} }})); if (!window.location.pathname.startsWith('/builder')) {{ window.location.assign('/builder#builder-shortcut={}'); }}",
    action,
    action,
  );

  if let Err(error) = window.eval(&script) {
    log::warn!("failed to dispatch builder shortcut {action}: {error}");
  }
}

fn shutdown_managed_processes(processes: State<'_, ManagedProcesses>) {
  if let Ok(mut children) = processes.children.lock() {
    for child in children.iter_mut() {
      match child.try_wait() {
        Ok(Some(_)) => continue,
        Ok(None) => {
          if let Err(error) = child.kill() {
            log::warn!("failed to terminate child process {}: {error}", child.id());
          }
          let _ = child.wait();
        }
        Err(error) => {
          log::warn!("failed to query child process status {}: {error}", child.id());
        }
      }
    }

    children.clear();
  }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(ManagedProcesses::default())
    .on_menu_event(|app, event| match event.id().as_ref() {
      MENU_ID_RETRY_LAST_FAILED_TASK => dispatch_builder_shortcut(app, "retry-last-failed-task"),
      MENU_ID_OPEN_CURRENT_TASK_LOGS => dispatch_builder_shortcut(app, "open-current-task-logs"),
      MENU_ID_CANCEL_RUNNING_TASK => dispatch_builder_shortcut(app, "cancel-running-task"),
      _ => {}
    })
    .setup(|app| {
      app.handle().plugin(
        tauri_plugin_log::Builder::default()
          .level(log::LevelFilter::Info)
          .build(),
      )?;
      install_builder_shortcuts_menu(app)?;
      let processes = app.state::<ManagedProcesses>();
      start_bundled_runtime(app, processes);
      Ok(())
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|app, event| {
      if matches!(event, RunEvent::Exit | RunEvent::ExitRequested { .. }) {
        let processes = app.state::<ManagedProcesses>();
        shutdown_managed_processes(processes);
      }
    });
}
