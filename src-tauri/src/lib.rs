mod pty;

use tauri::Manager;

pub fn run() {
	tauri::Builder::default()
		.plugin(tauri_plugin_shell::init())
		.plugin(tauri_plugin_dialog::init())
		.plugin(tauri_plugin_opener::init())
		.plugin(tauri_plugin_fs::init())
		.manage(pty::PtyState::default())
		.on_window_event(|window, event| {
			// Closing a window must take its terminals' shells with it — the
			// PTY registry is app-wide, not per-window.
			if let tauri::WindowEvent::Destroyed = event {
				pty::kill_for_window(&window.state::<pty::PtyState>(), window.label());
			}
		})
		.invoke_handler(tauri::generate_handler![
			pty::pty_spawn,
			pty::pty_write,
			pty::pty_resize,
			pty::pty_kill
		])
		.run(tauri::generate_context!())
		.expect("error while running tauri application");
}
