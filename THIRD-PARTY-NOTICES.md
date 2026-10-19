# Third-party notices

Mako bundles or derives from the following third-party components. Each
remains under its own license; full license texts ship with the packages in
`node_modules/` and with the Rust crates on crates.io.

## Bundled into the application

| Component | License | Use |
| --- | --- | --- |
| [CodeMirror 6](https://codemirror.net) (`@codemirror/*`, `@lezer/*`) | MIT | Text editor, syntax highlighting, merge/diff view |
| [@replit/codemirror-indentation-markers](https://github.com/replit/codemirror-indentation-markers) | MIT | Indentation guides |
| [xterm.js](https://xtermjs.org) (`@xterm/xterm`, `@xterm/addon-fit`) | MIT | Integrated terminal |
| [Tauri](https://tauri.app) (`@tauri-apps/api`, plugins, `tauri` crate) | MIT / Apache-2.0 | Application framework |
| [portable-pty](https://crates.io/crates/portable-pty) | MIT | Terminal PTY (part of the WezTerm project) |
| [serde_json](https://crates.io/crates/serde_json) | MIT / Apache-2.0 | JSON (Rust) |

## Icons

- **[VS Code Codicons](https://github.com/microsoft/vscode-codicons)** — icon
  SVG paths are inlined into `backend/shell/icons.ts`. The icons are licensed
  under [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/) and the
  code under MIT. © Microsoft Corporation.
- **[Seti UI icons](https://github.com/jesseweed/seti-ui)** (via the
  `seti-icons` package) — file-type glyphs inlined into
  `backend/shell/fileIcons.ts`. MIT license. © Jesse Weed.

## Design attribution

- Mako's shell layout, theme color values, and terminal styling recreate the
  look of **[Visual Studio Code](https://github.com/microsoft/vscode)**
  (MIT license, © Microsoft Corporation). Individual CSS values (sizes,
  paddings, colors) were referenced from the MIT-licensed VS Code source;
  all code in this repository is original.
- The Git Graph view visually resembles the
  **[Git Graph extension](https://github.com/mhutchie/vscode-git-graph)** by
  mhutchie. No code from that project is included; the view is a clean-room
  implementation and only visual design values (colors, spacing, shapes)
  were referenced.
