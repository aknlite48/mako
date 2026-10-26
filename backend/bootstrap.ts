/**
 * Entry point for Mako: a low-memory VS Code-style editor with Git
 * Graph built in.
 *
 * Boot sequence: apply the theme, show the landing page (Open Folder), and
 * once any folder is chosen, build the editor shell (explorer + tabs +
 * editors). If the folder is a Git repository (and Git is available), a Git
 * Graph tab is available; the graph view is created when the tab is opened
 * and destroyed when it closes.
 */

import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir, readTextFile, watch } from '@tauri-apps/plugin-fs';
import { findGit } from './gitEnv';
import { getRepoRoot } from './graph/gitCli';
import { GraphView, createGraphView } from './graph/graphView';
import { openDiffTab } from './shell/diffTab';
import { initEditor, openElementTab, reloadExternallyChangedFiles, setStatusListener } from './shell/editor';
import { TreeDecoration, fetchDecorations } from './shell/gitStatus';
import { buildShell } from './shell/layout';
import { initStatusBar, setEditorStatus, setStatusBranch } from './shell/statusBar';
import { initTabs, openFileTab, openGraphTab, setGraphAvailable } from './shell/tabs';
import { initTerminalPanel } from './shell/terminal';
import { initTree } from './shell/tree';
import { applyTheme } from './theme';

const LANDING_CSS = `
body.ggdLanding {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	height: 100vh;
	margin: 0;
	text-align: center;
	-webkit-user-select: none;
	user-select: none;
}
body.ggdLanding h2 {
	font-weight: normal;
	font-size: 26px;
	margin: 0 0 10px 0;
}
body.ggdLanding p {
	margin: 6px 0;
	color: var(--vscode-input-placeholderForeground);
}
.ggdLandingBtn {
	display: inline-block;
	margin-top: 14px;
	padding: 6px 18px;
	background-color: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	border-radius: 4px;
	cursor: pointer;
}
.ggdLandingBtn:hover {
	background-color: var(--vscode-button-hoverBackground);
}`;

function showLanding(message: string | null, showOpenButton: boolean, onOpen?: () => void) {
	if (document.getElementById('ggdLandingStyle') === null) {
		const style = document.createElement('style');
		style.id = 'ggdLandingStyle';
		style.textContent = LANDING_CSS;
		document.head.appendChild(style);
	}
	document.body.className = 'ggdLanding';
	document.body.textContent = '';

	const title = document.createElement('h2');
	title.textContent = 'Mako';
	document.body.appendChild(title);
	const text = document.createElement('p');
	text.textContent = message !== null ? message : 'Open a folder to start editing.';
	document.body.appendChild(text);
	if (showOpenButton) {
		const btn = document.createElement('div');
		btn.className = 'ggdLandingBtn';
		btn.textContent = 'Open Folder';
		if (onOpen) btn.addEventListener('click', onOpen);
		document.body.appendChild(btn);
	}

	// The title bar is a macOS overlay — provide a drag strip on the landing page
	const dragStrip = document.createElement('div');
	dragStrip.setAttribute('data-tauri-drag-region', '');
	dragStrip.style.cssText = 'position:fixed;top:0;left:0;right:0;height:28px;z-index:100;';
	document.body.appendChild(dragStrip);
}

// How deep below the opened folder to look for git repositories
const REPO_SCAN_DEPTH = 3;

/**
 * Find all git repositories shown in the graph's Repo dropdown: the repository
 * containing the opened folder (if any), plus repositories nested anywhere up
 * to REPO_SCAN_DEPTH levels below it (like Git Graph's repo search).
 */
async function findRepos(folder: string, rootRepo: string | null): Promise<string[]> {
	const repos: string[] = rootRepo !== null ? [rootRepo] : [];
	const scan = async (dir: string, depth: number): Promise<void> => {
		let entries;
		try {
			entries = await readDir(dir);
		} catch (_) {
			return;
		}
		if (entries.some((e) => e.name === '.git')) {
			if (repos.indexOf(dir) === -1) repos.push(dir);
			return; // Don't descend into a repository looking for more
		}
		if (depth === 0) return;
		for (const entry of entries) {
			if (!entry.isDirectory || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
			await scan(dir + '/' + entry.name, depth - 1);
		}
	};
	await scan(folder, REPO_SCAN_DEPTH);
	return repos;
}

function launchApp(folder: string, statusRepo: string | null, repoPaths: string[]) {
	const hasGraph = repoPaths.length > 0;
	const folderName = folder.substring(folder.lastIndexOf('/') + 1);
	// Dropdown names: path relative to the opened folder (or its basename for
	// the folder itself / a repository above it)
	const repos = repoPaths.map((path) => ({
		path: path,
		name: path.startsWith(folder + '/') ? path.substring(folder.length + 1) : path.substring(path.lastIndexOf('/') + 1)
	}));

	document.body.className = '';
	document.body.textContent = '';

	const onOpenGraph = hasGraph ? () => { openGraphTab().catch((e) => console.error('[Mako] Unable to open the Git Graph:', e)); } : null;

	// Build the VS Code-style shell (sidebar + tab bar + editors). The app is
	// editor-first: no tab is open initially.
	const shell = buildShell(folder, onOpenGraph);
	initEditor(shell.editors);
	initTabs(shell.tabbar);
	const tree = initTree(shell.tree, folder, openFileTab);
	shell.onNewFile(() => tree.startCreate('file'));
	shell.onNewFolder(() => tree.startCreate('folder'));
	const terminal = initTerminalPanel(folder);
	shell.onToggleTerminal(terminal.toggle);

	// The live graph view, if its tab is currently open (created per-open,
	// destroyed on tab close — a closed graph costs no memory).
	let graphView: GraphView | null = null;
	let graphRefreshTimer: number | null = null;
	const refreshGraph = () => {
		if (graphView === null || graphRefreshTimer !== null) return;
		graphRefreshTimer = window.setTimeout(() => {
			graphRefreshTimer = null;
			if (graphView !== null) graphView.refresh();
		}, 400);
	};

	if (hasGraph) {
		setGraphAvailable(async (tabId) => {
			const view = createGraphView({
				repos: repos,
				openDiff: (repo, fromHash, toHash, oldPath, newPath, status) =>
					openDiffTab(repo, fromHash, toHash, oldPath, newPath, status)
			});
			openElementTab(tabId, view.element, () => {
				if (graphView === view) graphView = null;
				view.dispose();
			});
			graphView = view;
			await view.refresh();
		});
	}

	// Explorer git decorations: coloured filenames + status letter badges,
	// refreshed (debounced) on any file change or git state change. Fetched
	// for every discovered repository (the opened folder may sit ABOVE the
	// repos) and merged — the maps are keyed by absolute path, so nested
	// repos never collide.
	let decorationsTimer: number | null = null;
	const refreshDecorations = () => {
		if (repoPaths.length === 0 || decorationsTimer !== null) return;
		decorationsTimer = window.setTimeout(async () => {
			decorationsTimer = null;
			// Sequential, not Promise.all: one `git status` process (and one
			// stdout buffer) at a time keeps the memory/CPU burst flat.
			const merged = new Map<string, TreeDecoration>();
			for (const repo of repoPaths) {
				try {
					(await fetchDecorations(repo)).forEach((decoration, path) => merged.set(path, decoration));
				} catch (_) { }
			}
			tree.setDecorations(merged);
		}, 300);
	};
	refreshDecorations();

	// Status bar: cursor/language from the editor, branch from .git/HEAD
	initStatusBar(shell.statusbar, onOpenGraph);
	setStatusListener(setEditorStatus);
	if (statusRepo !== null) {
		const refreshBranch = async () => {
			try {
				const head = await readTextFile(statusRepo + '/.git/HEAD');
				setStatusBranch(head.startsWith('ref: refs/heads/')
					? head.substring('ref: refs/heads/'.length).trim()
					: head.trim().substring(0, 7)); // Detached HEAD → short hash
			} catch (_) {
				setStatusBranch(null); // e.g. .git is a worktree/submodule file
			}
		};
		refreshBranch();
		// Watch .git (non-recursive): HEAD is atomically replaced on checkout,
		// so watch the directory rather than the file itself. Any top-level
		// change (index, HEAD, MERGE_HEAD, COMMIT_EDITMSG, packed-refs, …)
		// also refreshes the graph view & decorations, so terminal git
		// commands show up automatically. Known-safe: `git status` may
		// rewrite .git/index once (stat cache) → one extra refresh, then it
		// converges.
		watch(statusRepo + '/.git', (event) => {
			if (event.paths.some((p) => p.endsWith('/HEAD'))) refreshBranch();
			if (event.paths.some((p) => p.endsWith('/HEAD') || p.endsWith('/index') || p.endsWith('/MERGE_HEAD') || p.endsWith('/ORIG_HEAD'))) {
				refreshDecorations();
			}
			refreshGraph();
		}, { delayMs: 300 }).catch(() => { });
	}

	// File watcher: refresh the explorer on structural changes, and reload
	// open (non-dirty) editor tabs whose files changed on disk. Events inside
	// .git are ignored (the .git watcher above covers git state).
	let treeRefreshTimer: number | null = null;
	watch(folder, (event) => {
		const paths = event.paths.filter((p) => p.indexOf('/.git/') === -1 && !p.endsWith('/.git'));
		if (paths.length === 0) {
			// Git state changed in a nested repo (the statusRepo's own .git has
			// a dedicated watcher above) — keep the graph & decorations in sync.
			if (paths.length < event.paths.length) {
				refreshGraph();
				refreshDecorations();
			}
			return;
		}
		reloadExternallyChangedFiles(paths);
		refreshDecorations(); // Edits make files M, new files U, etc.
		refreshGraph(); // The Uncommitted Changes row tracks the working tree
		const type = event.type;
		const structural = type === 'any' || typeof type === 'object' && ('create' in type || 'remove' in type
			|| 'modify' in type && ((<any>type).modify.kind === 'rename' || (<any>type).modify.kind === 'any'));
		if (structural && treeRefreshTimer === null) {
			treeRefreshTimer = window.setTimeout(() => {
				treeRefreshTimer = null;
				tree.refresh();
			}, 300);
		}
	}, { recursive: true, delayMs: 400 }).catch((e) => {
		console.error('[Mako] Unable to watch the folder for changes:', e);
	});

	// document.title does not reach the native window in Tauri
	getCurrentWindow().setTitle(folderName + ' — Mako').catch(() => { });
}

async function start() {
	applyTheme();

	const openFolder = async () => {
		const selected = await open({ directory: true, multiple: false, title: 'Open Folder' });
		if (typeof selected !== 'string') return; // Dialog cancelled

		// Git is optional: without it (or outside a repository) the editor
		// still works — there is just no Git Graph tab.
		let statusRepo: string | null = null;
		let repoPaths: string[] = [];
		const gitExecutable = await findGit();
		if (gitExecutable !== null) {
			statusRepo = await getRepoRoot(selected);
			repoPaths = await findRepos(selected, statusRepo);
		} else {
			console.warn('[Mako] Git not found — the Git Graph tab is unavailable: ' + String((<any>window).__gitFindError));
		}

		launchApp(selected, statusRepo, repoPaths);
	};

	showLanding(null, true, openFolder);
}

// Cmd+Shift+N opens a new independent window (own folder, tabs, terminals,
// graph), like VS Code's New Window. Capture phase, so it works everywhere
// (the editor host stops key bubbling). Labels must be unique per window.
let newWindowSeq = 0;
window.addEventListener('keydown', (e) => {
	if ((e.metaKey || e.ctrlKey) && e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
		e.preventDefault();
		const win = new WebviewWindow('mako-' + Date.now() + '-' + newWindowSeq++, {
			url: 'index.html',
			title: 'Mako',
			width: 1200,
			height: 800,
			titleBarStyle: 'overlay',
			hiddenTitle: true
		});
		win.once('tauri://error', (event) => console.error('[Mako] Unable to open a new window:', event.payload));
	}
}, true);

window.addEventListener('load', () => {
	start().catch((e) => {
		showLanding('Mako failed to start: ' + (e instanceof Error ? e.message : String(e)), false);
	});
}, { once: true });
