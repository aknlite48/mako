//! The `git_exec` command: spawns the user's `git` binary and returns its
//! decoded output. A custom command rather than tauri-plugin-shell because
//! the plugin's raw encoding crosses the IPC boundary as a JSON number array
//! — several times stdout's size in transient WebKit allocations — while a
//! string crosses at ~1x, decoded once here in Rust.

use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
pub struct GitOutput {
	code: i32,
	stdout: String,
	stderr: String,
}

/// Run `git` (resolved from PATH, like tauri-plugin-shell did) in `cwd`.
/// The frontend only ever issues read commands (log / status / show / ...).
#[tauri::command]
pub async fn git_exec(args: Vec<String>, cwd: String) -> Result<GitOutput, String> {
	tauri::async_runtime::spawn_blocking(move || {
		let output = Command::new("git")
			.args(&args)
			.current_dir(&cwd)
			.env("GIT_TERMINAL_PROMPT", "0")
			.output()
			.map_err(|error| error.to_string())?;
		Ok(GitOutput {
			code: output.status.code().unwrap_or(-1),
			stdout: String::from_utf8_lossy(&output.stdout).into_owned(),
			stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
		})
	})
	.await
	.map_err(|error| error.to_string())?
}
