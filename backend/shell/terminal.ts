/**
 * VS Code-style integrated terminal panel (terminals only — no Problems/
 * Output/Debug tabs). Sits between the editor area and the status bar,
 * toggled with Ctrl+` or the title-bar terminal button.
 *
 * Each terminal is an xterm.js instance attached to a real PTY provided by
 * the Rust side (pty_spawn/pty_write/pty_resize/pty_kill; output streams
 * over a raw-payload IPC channel, exit via a pty-exit-<id> event).
 * Terminals are arranged in groups;
 * splitting adds a pane to the active group (side by side with a draggable
 * sash, like VS Code), and the tabs list on the right (shown with 2+
 * terminals) switches between them. Design values (35px title row, 11px
 * underlined TERMINAL label, 22px list rows with a 1px active indicator,
 * 20px xterm gutter, codicon toolbar) follow VS Code's terminal panel.
 */

import { Channel, invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { ICON_ADD, ICON_CHEVRON_DOWN, ICON_CHEVRON_UP, ICON_CLOSE, ICON_SPLIT, ICON_TERMINAL, ICON_TRASH, Icon, iconSvg } from './icons';

const HEIGHT_KEY = 'ggd:panelHeight';
const DEFAULT_HEIGHT = 250;
const MIN_HEIGHT = 100;
const MIN_PANE_WIDTH = 100;

/*
 * All sizes/colours below are taken from VS Code's own panel styling (MIT):
 * part.css (35px title, 8px side padding, 13px content), paneCompositePart.css
 * (11px uppercase composite-bar item, padding 0 10px, 1px active underline
 * 2px above the bottom), actionbar.css (action-label padding 3px, 4px item
 * gap, toolbar.hoverBackground hover), terminal.css (20px xterm gutter,
 * bottom-aligned xterm, terminal.border split borders, 22px tabs-list entries
 * padded 0 10px with a 1px terminal.tab.activeBorder indicator) and
 * panelpart.css (panel.border top border).
 */
const TERMINAL_CSS = `
#ggdPanel {
	position: fixed;
	left: var(--ggd-left);
	right: 0;
	bottom: var(--ggd-bottom);
	box-sizing: border-box;
	background-color: var(--vscode-panel-background);
	border-top: 1px solid var(--vscode-panel-border);
	z-index: 36;
	display: none;
	flex-direction: column;
	font-family: var(--vscode-font-family);
	font-size: 13px;
	color: var(--vscode-foreground);
	-webkit-user-select: none;
	user-select: none;
}
#ggdPanel.open {
	display: flex;
}
#ggdPanelResize {
	position: absolute;
	top: -2px; left: 0; right: 0;
	height: 5px;
	cursor: row-resize;
	z-index: 10;
}
#ggdPanelResize:hover, #ggdPanelResize.dragging {
	background-color: var(--vscode-focusBorder);
}

/* --- Panel title (35px) --- */
#ggdPanelHeader {
	flex-shrink: 0;
	box-sizing: border-box;
	display: flex;
	align-items: center;
	height: 35px;
	padding-left: 8px;
	padding-right: 8px;
	overflow: hidden;
}
.ggdPanelTitle {
	position: relative;
	display: flex;
	align-items: center;
	height: 100%;
	padding: 0 10px;
	font-size: 11px;
	text-transform: uppercase;
	color: var(--vscode-panelTitle-activeForeground);
	cursor: default;
}
.ggdPanelTitle::after {
	content: '';
	position: absolute;
	left: 10px; right: 10px; bottom: 2px;
	border-top: 1px solid var(--vscode-panelTitle-activeBorder);
}
.ggdPanelActions {
	flex: 1;
	height: 100%;
	padding-left: 5px;
	display: flex;
	align-items: center;
	justify-content: flex-end;
}
.ggdPanelShellTab {
	display: flex;
	align-items: center;
	padding: 3px;
	margin-right: 4px;
	border-radius: 5px;
	font-size: 11px;
	cursor: pointer;
	white-space: nowrap;
}
.ggdPanelShellTab:hover {
	background-color: var(--vscode-toolbar-hoverBackground);
}
.ggdPanelShellTab svg {
	display: block;
	margin-right: 4px;
}
.ggdPanelBtn {
	padding: 3px;
	margin-right: 4px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 5px;
	cursor: pointer;
}
.ggdPanelBtn:hover {
	background-color: var(--vscode-toolbar-hoverBackground);
}
.ggdPanelBtn svg {
	display: block;
}
.ggdPanelGlobal {
	display: flex;
	margin-left: 4px;
}

/* --- Terminal groups & panes --- */
#ggdPanelBody {
	flex: 1;
	display: flex;
	min-height: 0;
}
#ggdPanelTerms {
	flex: 1;
	position: relative;
	min-width: 0;
}
.ggdTermGroup {
	position: absolute;
	top: 0; left: 0; right: 0; bottom: 0;
	display: none;
}
.ggdTermGroup.active {
	display: flex;
}
.ggdTermPane {
	position: relative;
	box-sizing: border-box;
	min-width: 0;
	overflow: hidden;
}
/* Split separation: 1px terminal.border on the pane, invisible 4px sash on
   top of it that lights up with focusBorder on hover/drag (as VS Code) */
.ggdTermSash + .ggdTermPane {
	border-left: 1px solid var(--vscode-panel-border);
}
.ggdTermSash {
	flex: 0 0 4px;
	margin: 0 -2px;
	z-index: 35;
	cursor: ew-resize;
}
.ggdTermSash:hover, .ggdTermSash.dragging {
	background-color: var(--vscode-focusBorder);
}
/* Terminals are bottom-aligned in their pane and get a 20px left gutter */
.ggdTermPane .xterm {
	position: absolute;
	bottom: 0; left: 0; right: 0;
	padding-left: 20px;
}
.xterm-viewport {
	/* stock xterm.css paints this #000, which shows as a black bar in the
	   20px gutter the screen doesn't cover */
	background-color: transparent !important;
	overscroll-behavior: none;
}
/* Command decorations: a dot in the gutter at each command's prompt line,
   driven by OSC 133 shell-integration marks (VS Code's
   terminalCommandDecoration.* default colors) */
/* xterm re-sets inline display:block on the decoration element every render,
   so don't rely on its display at all: absolutely position the dot instead
   (the element itself is position:absolute, so it is a containing block). */
.ggdTermCmd {
	margin-left: -17px;
	pointer-events: none;
}
.ggdTermCmd::before {
	content: '';
	position: absolute;
	top: 50%;
	transform: translateY(-50%);
	width: 8px;
	height: 8px;
	box-sizing: border-box;
	border-radius: 50%;
}
/* Current prompt: hollow dot until its command runs */
.ggdTermCmd.prompt::before { border: 1px solid #585a63; }
.ggdTermCmd.default::before { background-color: #40414a; }
.ggdTermCmd.success::before { background-color: #1b81a8; }
.ggdTermCmd.error::before { background-color: #f14c4c; }

/* --- Terminal tabs list (right, shown with 2+ terminals) --- */
#ggdPanelList {
	flex-shrink: 0;
	width: 120px;
	box-sizing: border-box;
	border-left: 1px solid var(--vscode-panel-border);
	overflow-y: auto;
	overflow-x: hidden;
	display: none;
}
#ggdPanelList.visible {
	display: block;
}
.ggdTermRow {
	position: relative;
	display: flex;
	align-items: center;
	height: 22px;
	line-height: 22px;
	padding: 0 10px;
	cursor: pointer;
	white-space: nowrap;
	overflow: hidden;
}
.ggdTermRow:hover {
	background-color: var(--vscode-list-hoverBackground);
}
.ggdTermRow.active {
	background-color: var(--vscode-list-activeSelectionBackground);
	color: var(--vscode-list-activeSelectionForeground);
}
.ggdTermRow.active::before {
	content: '';
	display: block;
	position: absolute;
	left: 0; top: 0; bottom: 0;
	width: 1px;
	background-color: var(--vscode-terminal-tab-activeBorder);
}
.ggdTermRow > svg {
	flex-shrink: 0;
	margin-right: 5px;
}
/* Split-group tree guide (┌ ├ └) before the icon, VS Code style */
.ggdTermRowGuide {
	flex-shrink: 0;
	margin-right: 4px;
	color: var(--vscode-panelTitle-inactiveForeground);
}
.ggdTermRow span {
	overflow: hidden;
	text-overflow: ellipsis;
}
.ggdTermRowActions {
	display: none;
	margin-left: auto;
	flex-shrink: 0;
}
.ggdTermRow:hover .ggdTermRowActions {
	display: flex;
}
.ggdTermRowBtn {
	padding: 2px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 5px;
	cursor: pointer;
}
.ggdTermRowBtn:hover {
	background-color: var(--vscode-toolbar-hoverBackground);
}
.ggdTermRowBtn svg {
	display: block;
}`;

interface Pane {
	readonly id: number;
	readonly group: Group;
	readonly term: Terminal;
	readonly fit: FitAddon;
	readonly el: HTMLElement;
	name: string;
	size: number;
	disposed: boolean;
	fitQueued: boolean;
	observer: ResizeObserver | null;
	readonly unlisteners: UnlistenFn[];
}

interface Group {
	readonly el: HTMLElement;
	panes: Pane[];
}

function cssVar(name: string): string {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

// Background/foreground follow the theme (terminal.background defaults to
// panel.background in VS Code); the ANSI palette is VS Code's default
// terminal palette (fixed, like the graph's lane colors).
function xtermTheme() {
	const background = cssVar('--vscode-panel-background');
	const foreground = cssVar('--vscode-editor-foreground');
	return {
		background: background,
		foreground: foreground,
		cursor: foreground,
		cursorAccent: background,
		selectionBackground: 'rgba(128, 128, 128, 0.4)',
		black: '#000000', red: '#cd3131', green: '#0dbc79', yellow: '#e5e510',
		blue: '#2472c8', magenta: '#bc3fbc', cyan: '#11a8cd', white: '#e5e5e5',
		brightBlack: '#666666', brightRed: '#f14c4c', brightGreen: '#23d18b', brightYellow: '#f5f543',
		brightBlue: '#3b8eea', brightMagenta: '#d670d6', brightCyan: '#29b8db', brightWhite: '#e5e5e5'
	};
}

/**
 * Build the terminal panel (hidden initially). Returns the toggle used by
 * Ctrl+` and the title-bar button.
 */
export function initTerminalPanel(cwd: string): { toggle: () => void } {
	const style = document.createElement('style');
	style.id = 'ggdTerminalStyle';
	style.textContent = TERMINAL_CSS;
	document.head.appendChild(style);

	const panel = document.createElement('div');
	panel.id = 'ggdPanel';

	const resize = document.createElement('div');
	resize.id = 'ggdPanelResize';
	panel.appendChild(resize);

	const header = document.createElement('div');
	header.id = 'ggdPanelHeader';
	const title = document.createElement('div');
	title.className = 'ggdPanelTitle';
	title.textContent = 'TERMINAL';
	header.appendChild(title);
	const actions = document.createElement('div');
	actions.className = 'ggdPanelActions';
	// Active shell label, shown while the tabs list is hidden (single
	// terminal) — like VS Code's single-terminal-tab in the title actions.
	const shellTab = document.createElement('div');
	shellTab.className = 'ggdPanelShellTab';
	actions.appendChild(shellTab);
	const actionBtn = (parent: HTMLElement, icon: Icon, tip: string, onClick: () => void) => {
		const btn = document.createElement('div');
		btn.className = 'ggdPanelBtn';
		btn.title = tip;
		btn.innerHTML = iconSvg(icon, 16);
		btn.addEventListener('click', onClick);
		parent.appendChild(btn);
		return btn;
	};
	header.appendChild(actions);
	panel.appendChild(header);

	const body = document.createElement('div');
	body.id = 'ggdPanelBody';
	const termsHost = document.createElement('div');
	termsHost.id = 'ggdPanelTerms';
	const list = document.createElement('div');
	list.id = 'ggdPanelList';
	body.appendChild(termsHost);
	body.appendChild(list);
	panel.appendChild(body);
	document.body.appendChild(panel);

	let groups: Group[] = [];
	let activePane: Pane | null = null;
	let visible = false;
	// Terminal ids must be unique across ALL app windows: the PTY registry in
	// Rust is shared state and pty-data-<id> events broadcast to every
	// window, so each window starts from its own random base.
	let nextId = 1 + Math.floor(Math.random() * 0x7fffffff);
	let height = Math.max(parseInt(localStorage.getItem(HEIGHT_KEY) || '', 10) || DEFAULT_HEIGHT, MIN_HEIGHT);
	let restoreHeight: number | null = null; // non-null while maximized

	const maxHeight = () => window.innerHeight
		- parseInt(cssVar('--ggd-top'), 10)
		- parseInt(cssVar('--ggd-bottom'), 10);

	const applyHeight = () => {
		panel.style.height = height + 'px';
		document.documentElement.style.setProperty('--ggd-panel', visible ? height + 'px' : '0px');
	};

	const fitPane = (pane: Pane) => {
		if (pane.disposed || !visible || !pane.group.el.classList.contains('active') || pane.fitQueued) return;
		pane.fitQueued = true;
		requestAnimationFrame(() => {
			pane.fitQueued = false;
			if (pane.disposed || !visible) return;
			pane.fit.fit();
			invoke('pty_resize', { id: pane.id, cols: pane.term.cols, rows: pane.term.rows }).catch(() => { });
		});
	};
	const fitActiveGroup = () => {
		const group = activePane !== null ? activePane.group : null;
		if (group !== null) group.panes.forEach(fitPane);
	};

	// Rebuild a group's DOM: panes interleaved with draggable sashes, each
	// pane's width share held in pane.size (flex-grow).
	const layoutGroup = (group: Group) => {
		group.el.textContent = '';
		group.panes.forEach((pane, index) => {
			if (index > 0) group.el.appendChild(makeSash(group, index));
			pane.el.style.flex = pane.size + ' 1 0%';
			group.el.appendChild(pane.el);
		});
	};
	const makeSash = (group: Group, index: number): HTMLElement => {
		const sash = document.createElement('div');
		sash.className = 'ggdTermSash';
		sash.addEventListener('mousedown', (e) => {
			e.preventDefault();
			const left = group.panes[index - 1];
			const right = group.panes[index];
			const leftWidth = left.el.getBoundingClientRect().width;
			const rightWidth = right.el.getBoundingClientRect().width;
			const sizeTotal = left.size + right.size;
			const widthTotal = leftWidth + rightWidth;
			const startX = e.clientX;
			sash.classList.add('dragging');
			const prevCursor = document.body.style.cursor;
			document.body.style.cursor = 'ew-resize';
			const onMove = (move: MouseEvent) => {
				const newLeft = Math.min(Math.max(leftWidth + (move.clientX - startX), MIN_PANE_WIDTH), widthTotal - MIN_PANE_WIDTH);
				left.size = sizeTotal * (newLeft / widthTotal);
				right.size = sizeTotal - left.size;
				left.el.style.flex = left.size + ' 1 0%';
				right.el.style.flex = right.size + ' 1 0%';
			};
			const onUp = () => {
				window.removeEventListener('mousemove', onMove);
				window.removeEventListener('mouseup', onUp);
				sash.classList.remove('dragging');
				document.body.style.cursor = prevCursor;
			};
			window.addEventListener('mousemove', onMove);
			window.addEventListener('mouseup', onUp);
		});
		return sash;
	};

	const rowBtn = (parent: HTMLElement, icon: Icon, tip: string, onClick: () => void) => {
		const btn = document.createElement('div');
		btn.className = 'ggdTermRowBtn';
		btn.title = tip;
		btn.innerHTML = iconSvg(icon, 16);
		btn.addEventListener('click', (e) => {
			e.stopPropagation();
			onClick();
		});
		parent.appendChild(btn);
	};

	const renderList = () => {
		list.textContent = '';
		let total = 0;
		groups.forEach((g) => { total += g.panes.length; });
		list.classList.toggle('visible', total > 1);
		shellTab.style.display = total > 1 ? 'none' : '';
		if (total <= 1 && activePane !== null) {
			shellTab.innerHTML = iconSvg(ICON_TERMINAL, 16);
			const label = document.createElement('span');
			label.textContent = activePane.name;
			shellTab.appendChild(label);
		}
		groups.forEach((group) => {
			group.panes.forEach((pane, index) => {
				const row = document.createElement('div');
				row.className = 'ggdTermRow' + (pane === activePane ? ' active' : '');
				// VS Code-style split guides: panes of a split group are
				// prefixed ┌ / ├ / └ like a tree.
				if (group.panes.length > 1) {
					const guide = document.createElement('span');
					guide.className = 'ggdTermRowGuide';
					guide.textContent = index === 0 ? '\u250c' : index === group.panes.length - 1 ? '\u2514' : '\u251c';
					row.appendChild(guide);
				}
				row.insertAdjacentHTML('beforeend', iconSvg(ICON_TERMINAL, 16));
				const label = document.createElement('span');
				label.textContent = pane.name;
				row.appendChild(label);
				const rowActions = document.createElement('div');
				rowActions.className = 'ggdTermRowActions';
				rowBtn(rowActions, ICON_SPLIT, 'Split Terminal', () => splitPane(pane));
				rowBtn(rowActions, ICON_TRASH, 'Kill Terminal', () => removePane(pane, false));
				row.appendChild(rowActions);
				row.addEventListener('click', () => setActive(pane));
				list.appendChild(row);
			});
		});
	};

	const setActive = (pane: Pane) => {
		activePane = pane;
		groups.forEach((g) => g.el.classList.toggle('active', g === pane.group));
		renderList();
		fitActiveGroup();
		pane.term.focus();
	};

	const removePane = (pane: Pane, exited: boolean) => {
		if (pane.disposed) return;
		pane.disposed = true;
		if (pane.observer !== null) pane.observer.disconnect();
		pane.unlisteners.forEach((u) => u());
		if (!exited) invoke('pty_kill', { id: pane.id }).catch(() => { });
		pane.term.dispose();
		pane.el.remove();
		const group = pane.group;
		group.panes = group.panes.filter((p) => p !== pane);
		if (group.panes.length === 0) {
			groups = groups.filter((g) => g !== group);
			group.el.remove();
		} else {
			// Renormalize sizes to sum to 1: flex-grow sums below 1 only
			// distribute that fraction of the free space, leaving the rest
			// of the group empty (e.g. a lone survivor at flex 0.5).
			const total = group.panes.reduce((sum, p) => sum + p.size, 0);
			group.panes.forEach((p) => { p.size = p.size / total; });
			layoutGroup(group);
			// Don't rely on the panes' ResizeObservers alone: refit the
			// survivors into the reclaimed space explicitly.
			group.panes.forEach(fitPane);
		}
		if (activePane === pane) {
			activePane = null;
			const nextGroup = group.panes.length > 0 ? group : groups.length > 0 ? groups[groups.length - 1] : null;
			if (nextGroup !== null) {
				setActive(nextGroup.panes[nextGroup.panes.length - 1]);
				return; // setActive re-renders the list
			}
			setVisible(false);
		}
		renderList();
	};

	const createPane = (group: Group, index: number, size: number): Pane => {
		const id = nextId++;
		const el = document.createElement('div');
		el.className = 'ggdTermPane';
		const term = new Terminal({
			allowProposedApi: true, // registerDecoration throws without it
			cursorBlink: true,
			fontFamily: cssVar('--vscode-editor-font-family'),
			fontSize: 12,
			theme: xtermTheme()
		});
		const fit = new FitAddon();
		term.loadAddon(fit);
		const pane: Pane = { id: id, group: group, term: term, fit: fit, el: el, name: 'shell', size: size, disposed: false, fitQueued: false, observer: null, unlisteners: [] };
		group.panes.splice(index, 0, pane);
		layoutGroup(group);
		term.open(el);
		if (term.textarea) term.textarea.addEventListener('focus', () => { if (activePane !== pane) setActive(pane); });
		term.onData((data) => { invoke('pty_write', { id: id, data: data }).catch(() => { }); });

		// Command decorations from the zsh shell-integration OSC 133 marks:
		// A (prompt start) places a hollow dot on the prompt line, C (command
		// executed) fills it grey, D;<code> colours it by exit status. A
		// prompt that never ran a command (empty Enter) keeps its hollow dot.
		interface Cmd { status: string; el: HTMLElement | null }
		let promptCmd: Cmd | null = null;
		let runningCmd: Cmd | null = null;
		const setStatus = (cmd: Cmd, status: string) => {
			if (cmd.el !== null) cmd.el.classList.replace(cmd.status, status);
			cmd.status = status;
		};
		term.parser.registerOscHandler(133, (data) => {
			// An exception here would kill xterm's parser (and with it all
			// further output), so decorations must never throw through.
			try {
				const kind = data.charAt(0);
				if (kind === 'A') {
					promptCmd = null;
					const marker = term.registerMarker(0);
					if (marker !== undefined) {
						const dec = term.registerDecoration({ marker: marker });
						if (dec !== undefined) {
							const cmd: Cmd = { status: 'prompt', el: null };
							dec.onRender((decEl) => {
								// classList, never className=: xterm's own
								// xterm-decoration class carries position:absolute.
								cmd.el = decEl;
								decEl.classList.add('ggdTermCmd', cmd.status);
							});
							promptCmd = cmd;
						}
					}
				} else if (kind === 'C') {
					if (promptCmd !== null) {
						setStatus(promptCmd, 'default');
						runningCmd = promptCmd;
						promptCmd = null;
					}
				} else if (kind === 'D') {
					if (runningCmd !== null) {
						setStatus(runningCmd, parseInt(data.substring(2), 10) === 0 ? 'success' : 'error');
						runningCmd = null;
					}
				}
			} catch (_) { }
			return true;
		});

		const track = (p: Promise<UnlistenFn>) => p.then((u) => { pane.disposed ? u() : pane.unlisteners.push(u); }).catch(() => { });
		track(listen('pty-exit-' + id, () => removePane(pane, true)));

		// Output arrives over a raw-payload IPC channel: an ArrayBuffer per
		// chunk — never a JSON number array — and only in this window.
		const onData = new Channel<ArrayBuffer>();
		onData.onmessage = (data) => { if (!pane.disposed) term.write(new Uint8Array(data)); };

		if (visible && group.el.classList.contains('active')) fit.fit();
		invoke<string>('pty_spawn', { id: id, cols: term.cols, rows: term.rows, cwd: cwd, onData: onData })
			.then((name) => { pane.name = name; renderList(); })
			.catch((e) => { term.write('Failed to start the shell: ' + String(e) + '\r\n'); });

		// Keep a reference on the pane: an unreferenced ResizeObserver may be
		// garbage-collected (WebKit), silently stopping refits.
		pane.observer = new ResizeObserver(() => fitPane(pane));
		pane.observer.observe(el);
		return pane;
	};

	const createTerminal = () => {
		const el = document.createElement('div');
		el.className = 'ggdTermGroup';
		termsHost.appendChild(el);
		const group: Group = { el: el, panes: [] };
		groups.push(group);
		setActive(createPane(group, 0, 1));
	};
	// Split a specific pane 50/50, inserting the new pane to its right
	const splitPane = (pane: Pane) => {
		pane.size = pane.size / 2;
		setActive(createPane(pane.group, pane.group.panes.indexOf(pane) + 1, pane.size));
	};

	const setVisible = (v: boolean) => {
		visible = v;
		panel.classList.toggle('open', v);
		applyHeight();
		if (v) {
			if (groups.length === 0) createTerminal();
			else if (activePane !== null) setActive(activePane);
		}
	};
	const toggle = () => setVisible(!visible);

	actionBtn(actions, ICON_ADD, 'New Terminal', () => { setVisible(true); createTerminal(); });
	actionBtn(actions, ICON_SPLIT, 'Split Terminal', () => { setVisible(true); if (activePane !== null) splitPane(activePane); });
	actionBtn(actions, ICON_TRASH, 'Kill Terminal', () => { if (activePane !== null) removePane(activePane, false); });
	const globalActions = document.createElement('div');
	globalActions.className = 'ggdPanelGlobal';
	actions.appendChild(globalActions);
	const setMaximized = (max: boolean) => {
		if (max) {
			restoreHeight = height;
			height = maxHeight();
		} else {
			height = restoreHeight !== null ? restoreHeight : DEFAULT_HEIGHT;
			restoreHeight = null;
		}
		maxBtn.innerHTML = iconSvg(max ? ICON_CHEVRON_DOWN : ICON_CHEVRON_UP, 16);
		maxBtn.title = max ? 'Restore Panel Size' : 'Maximize Panel Size';
		applyHeight();
		fitActiveGroup();
	};
	const maxBtn = actionBtn(globalActions, ICON_CHEVRON_UP, 'Maximize Panel Size', () => setMaximized(restoreHeight === null));
	actionBtn(globalActions, ICON_CLOSE, 'Hide Panel', () => setVisible(false));
	shellTab.addEventListener('click', () => { if (activePane !== null) activePane.term.focus(); });

	// Drag the top edge to resize the panel
	resize.addEventListener('mousedown', (e) => {
		e.preventDefault();
		resize.classList.add('dragging');
		const bottom = panel.getBoundingClientRect().bottom;
		const prevCursor = document.body.style.cursor;
		document.body.style.cursor = 'row-resize';
		restoreHeight = null; // Manual resize leaves the maximized state
		maxBtn.innerHTML = iconSvg(ICON_CHEVRON_UP, 16);
		maxBtn.title = 'Maximize Panel Size';
		const onMove = (move: MouseEvent) => {
			height = Math.min(Math.max(Math.round(bottom - move.clientY), MIN_HEIGHT), maxHeight());
			applyHeight();
			fitActiveGroup();
		};
		const onUp = () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			resize.classList.remove('dragging');
			document.body.style.cursor = prevCursor;
			try {
				localStorage.setItem(HEIGHT_KEY, String(height));
			} catch (_) { }
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	});

	// Ctrl+` toggles the panel (capture: fires even when the editor or a
	// terminal has focus, before xterm can swallow the keystroke)
	window.addEventListener('keydown', (e) => {
		if (e.ctrlKey && e.code === 'Backquote') {
			e.preventDefault();
			e.stopPropagation();
			toggle();
		}
	}, true);

	// Re-colour open terminals when the colour theme changes
	window.addEventListener('ggd-theme-changed', () => {
		const theme = xtermTheme();
		groups.forEach((g) => g.panes.forEach((p) => { p.term.options.theme = theme; }));
	});

	applyHeight();
	return { toggle: toggle };
}
