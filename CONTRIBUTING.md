# Contributing to Mako

Thanks for your interest! Bug reports, feature requests, and pull requests
are all welcome.

## Getting started

```sh
npm install
npm run build          # bundle the frontend into dist/
npx tauri dev          # run the app (serves dist/ as-is)
```

`npx tauri dev` has no build step of its own — after changing anything under
`backend/`, run `npm run build` again and restart the app.

## Before opening a pull request

Run the full check suite:

```sh
npm test               # unit tests (vitest)
npm run check          # strict TypeScript type-check
npm run build          # esbuild bundle must succeed
cargo fmt --check --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings
```

CI runs the same checks on every pull request.

## Guidelines

- **Keep it light.** Mako's reason to exist is low memory use and a small
  footprint. Avoid adding frameworks or heavyweight dependencies; prefer
  plain TypeScript + DOM. New dependencies need a strong justification.
- **The Git Graph stays read-only.** No mutating git commands (commit,
  checkout, merge, push, stash apply, …) anywhere in the graph or the git
  CLI layer. Users run their own git in the integrated terminal.
- **No code from vscode-git-graph.** The graph is a clean-room
  implementation; referencing visual design values is fine, copying code is
  not.
- **Match the existing style**: tabs for indentation, single quotes,
  CSS through `--vscode-*` theme variables (so all themes keep working).
- Add or update unit tests in `tests/` for pure logic (lane layout, parsing,
  themes). UI behavior is verified manually for now.
- Keep pull requests focused — one feature or fix per PR.

## Reporting bugs

Please include:

- macOS version and how you launched the app (`tauri dev` or a built bundle)
- Steps to reproduce
- What you expected vs. what happened (screenshots help a lot)

## Code of conduct

Be kind and constructive. Harassment or personal attacks are not tolerated;
maintainers may remove comments or contributors that violate this.
