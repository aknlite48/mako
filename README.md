<p align="center">
  <img src="app-icon.svg" width="128" alt="Mako icon">
</p>

<h1 align="center">Mako</h1>

<p align="center">A low-memory code editor with a Git Graph built in.</p>

Mako is a lean, VS Code-style desktop editor built on [Tauri](https://tauri.app) — a small Rust core plus the system WebView instead of a bundled Chromium, so it starts fast and stays light on memory.

## Features

- **Editor-first** — open any folder (git optional), file explorer with inline file/folder creation, tabs, CodeMirror 6 editing with syntax highlighting for common languages, diff view, find
- **Git Graph** — a read-only commit graph as a normal closable tab: colored lanes, ref chips (branches / remotes / tags / stashes), uncommitted-changes row, inline commit details with a changed-file tree that opens diffs, branch filtering, find, multi-repo support (nested repositories are discovered automatically)
- **Integrated terminal** — real PTY (zsh/your shell), splits, tabs, VS Code-style command decorations via shell integration, maximize/restore
- **Live everything** — file watcher keeps the explorer, open editors, git decorations, status-bar branch, and the graph in sync with changes made outside the app (e.g. git commands in any terminal)
- **Multiple windows** — Cmd+Shift+N opens a new independent window (own folder, tabs, terminals, graph)
- **Themes** — Dark+, Dark Modern, Light+, Monokai, Solarized Dark; switch instantly from the activity-bar gear
- **Low memory by design** — one shared editor instance across tabs, the graph DOM is destroyed when its tab closes, no bundled browser engine

The Git Graph is deliberately **read-only**: it visualizes history but never runs a mutating git command. Use your own terminal (there's one built in) for commits, checkouts, merges, and pushes.

## Install / Build

Prerequisites:

- [Rust](https://rustup.rs) (stable)
- [Node.js](https://nodejs.org) 18+
- macOS (currently the only tested platform — the title bar, terminal shell integration, and keybindings assume macOS)

```sh
npm install
npm run build          # bundle the frontend into dist/
npx tauri build        # produce the .app bundle (src-tauri/target/release/bundle)
```

## Development

```sh
npm run build          # rebuild dist/ after any frontend change
npx tauri dev          # run the app (serves dist/ as-is — rebuild + restart to pick up changes)
```

Checks:

```sh
npm test               # unit tests (vitest)
npm run check          # strict TypeScript type-check
cargo check --manifest-path src-tauri/Cargo.toml
```

Note: there is no `beforeDevCommand` — `npx tauri dev` serves whatever is in `dist/`, so always run `npm run build` first.

## Architecture

```
backend/              TypeScript frontend (bundled by esbuild into dist/backend.js)
  bootstrap.ts        entry point: landing page, folder open, wiring
  theme.ts            theme definitions (CSS variables)
  gitEnv.ts, spawn.ts git discovery + process spawning over tauri-plugin-shell
  graph/              read-only Git Graph (git CLI layer, lane layout, view)
  shell/              VS Code-style shell: layout, tabs, tree, editor, diff,
                      terminal, status bar, icons
src-tauri/            Rust core (Tauri v2)
  src/pty.rs          integrated-terminal PTY (portable-pty) + zsh shell integration
tests/                vitest unit tests
```

The frontend is plain TypeScript + DOM (no framework) built with esbuild; the editor is CodeMirror 6; the terminal is xterm.js. Git is invoked through the user's own `git` binary — nothing is linked in.

## License

[MIT](LICENSE). Bundled third-party components are listed in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md).
