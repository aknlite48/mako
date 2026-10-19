//! Integrated-terminal PTY backend: spawns the user's shell on a real
//! pseudo-terminal and streams its output to the webview as events.
//!
//! Events (per terminal id): `pty-data-<id>` carries raw output bytes,
//! `pty-exit-<id>` fires once when the shell exits (or the PTY is closed).

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, Window};

pub struct PtySession {
	writer: Box<dyn Write + Send>,
	master: Box<dyn MasterPty + Send>,
	child: Box<dyn Child + Send + Sync>,
	/// Label of the window this terminal belongs to, so its shells can be
	/// killed when that window closes (the registry is app-wide state).
	window_label: String,
}

#[derive(Default)]
pub struct PtyState(pub Mutex<HashMap<u32, PtySession>>);

fn size(cols: u16, rows: u16) -> PtySize {
	PtySize {
		rows,
		cols,
		pixel_width: 0,
		pixel_height: 0,
	}
}

/// Shell integration for zsh, VS Code style: ZDOTDIR points at a directory
/// of ours whose startup files chain-load the user's real ones and then
/// install prompt hooks emitting FinalTerm (OSC 133) marks:
///   A = prompt start, C = command executed, D;<code> = command finished.
/// The frontend turns these into command decorations in the gutter.
const ZSHENV: &str = r#"GGD_ZDOTDIR=$ZDOTDIR
if [[ -f "${GGD_USER_ZDOTDIR:-$HOME}/.zshenv" ]]; then
	ZDOTDIR="${GGD_USER_ZDOTDIR:-$HOME}"
	builtin source "$ZDOTDIR/.zshenv"
fi
if [[ "$ZDOTDIR" != "$GGD_ZDOTDIR" ]]; then
	GGD_USER_ZDOTDIR=$ZDOTDIR
fi
ZDOTDIR=$GGD_ZDOTDIR
"#;

const ZPROFILE: &str = r#"GGD_ZDOTDIR=$ZDOTDIR
if [[ -f "${GGD_USER_ZDOTDIR:-$HOME}/.zprofile" ]]; then
	ZDOTDIR="${GGD_USER_ZDOTDIR:-$HOME}"
	builtin source "$ZDOTDIR/.zprofile"
fi
ZDOTDIR=$GGD_ZDOTDIR
"#;

const ZSHRC: &str = r#"# macOS /etc/zshrc sets HISTFILE=$ZDOTDIR/.zsh_history, which lands in our
# temp dir; point it back at the user's home (their .zshrc may still override).
if [[ "$HISTFILE" == "$ZDOTDIR/.zsh_history" ]]; then
	HISTFILE="${GGD_USER_ZDOTDIR:-$HOME}/.zsh_history"
fi
if [[ -f "${GGD_USER_ZDOTDIR:-$HOME}/.zshrc" ]]; then
	ZDOTDIR="${GGD_USER_ZDOTDIR:-$HOME}"
	builtin source "$ZDOTDIR/.zshrc"
fi
# Hand the rest of startup (.zlogin) and any nested shells back to the
# user's real zdotdir.
ZDOTDIR="${GGD_USER_ZDOTDIR:-$HOME}"
builtin unset GGD_USER_ZDOTDIR GGD_ZDOTDIR

builtin autoload -Uz add-zsh-hook
__ggd_precmd() {
	builtin printf '\e]133;D;%s\a\e]133;A\a' "$?"
}
__ggd_preexec() {
	builtin printf '\e]133;C\a'
}
add-zsh-hook precmd __ggd_precmd
add-zsh-hook preexec __ggd_preexec
"#;

fn write_zsh_integration() -> std::io::Result<std::path::PathBuf> {
	let dir = std::env::temp_dir().join("mako-zsh");
	std::fs::create_dir_all(&dir)?;
	std::fs::write(dir.join(".zshenv"), ZSHENV)?;
	std::fs::write(dir.join(".zprofile"), ZPROFILE)?;
	std::fs::write(dir.join(".zshrc"), ZSHRC)?;
	Ok(dir)
}

/// Spawn the user's default shell (login shell, like VS Code on macOS) in a
/// new PTY. Returns the shell's basename for display (e.g. "zsh").
#[tauri::command]
pub fn pty_spawn(
	app: AppHandle,
	window: Window,
	state: State<'_, PtyState>,
	id: u32,
	cols: u16,
	rows: u16,
	cwd: String,
) -> Result<String, String> {
	let pty_system = native_pty_system();
	let pair = pty_system.openpty(size(cols, rows)).map_err(|e| e.to_string())?;

	let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
	let name = shell.rsplit('/').next().unwrap_or("shell").to_string();
	let mut cmd = CommandBuilder::new(&shell);
	cmd.arg("-l");
	cmd.cwd(&cwd);
	cmd.env("TERM", "xterm-256color");
	cmd.env("COLORTERM", "truecolor");
	cmd.env("TERM_PROGRAM", "mako");
	// `npx tauri dev` injects EDITOR=vi (npm's default editor) into our env;
	// zsh then silently switches to vi keybindings (no Ctrl+R history search).
	// Drop it when it is npm's injected default, keep a user-set EDITOR.
	if std::env::var("npm_execpath").is_ok() && std::env::var("EDITOR").as_deref() == Ok("vi") {
		cmd.env_remove("EDITOR");
	}
	if name == "zsh" {
		if let Ok(dir) = write_zsh_integration() {
			if let Ok(user_zdotdir) = std::env::var("ZDOTDIR") {
				cmd.env("GGD_USER_ZDOTDIR", user_zdotdir);
			}
			cmd.env("ZDOTDIR", dir);
		}
	}

	let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
	drop(pair.slave);
	let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
	let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

	state.0.lock().unwrap().insert(
		id,
		PtySession {
			writer,
			master: pair.master,
			child,
			window_label: window.label().to_string(),
		},
	);

	std::thread::spawn(move || {
		let mut buf = [0u8; 8192];
		loop {
			match reader.read(&mut buf) {
				Ok(0) | Err(_) => break,
				Ok(n) => {
					let _ = app.emit(&format!("pty-data-{}", id), buf[..n].to_vec());
				}
			}
		}
		// Reap the child and free the session (covers the shell exiting on
		// its own; pty_kill removal is a no-op here).
		if let Some(mut session) = app.state::<PtyState>().0.lock().unwrap().remove(&id) {
			let _ = session.child.wait();
		}
		let _ = app.emit(&format!("pty-exit-{}", id), ());
	});

	Ok(name)
}

#[tauri::command]
pub fn pty_write(state: State<'_, PtyState>, id: u32, data: String) -> Result<(), String> {
	let mut sessions = state.0.lock().unwrap();
	let session = sessions.get_mut(&id).ok_or("no such terminal")?;
	session.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(state: State<'_, PtyState>, id: u32, cols: u16, rows: u16) -> Result<(), String> {
	let sessions = state.0.lock().unwrap();
	let session = sessions.get(&id).ok_or("no such terminal")?;
	session.master.resize(size(cols, rows)).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(state: State<'_, PtyState>, id: u32) {
	// Dropping the session closes the PTY; the reader thread then sees EOF
	// and emits the exit event.
	if let Some(mut session) = state.0.lock().unwrap().remove(&id) {
		let _ = session.child.kill();
	}
}

/// Kill every session owned by a window — called when that window is
/// destroyed, so closing a window doesn't leave orphaned shells behind.
pub fn kill_for_window(state: &PtyState, label: &str) {
	let mut sessions = state.0.lock().unwrap();
	let ids: Vec<u32> = sessions
		.iter()
		.filter(|(_, session)| session.window_label == label)
		.map(|(id, _)| *id)
		.collect();
	for id in ids {
		if let Some(mut session) = sessions.remove(&id) {
			let _ = session.child.kill();
		}
	}
}
