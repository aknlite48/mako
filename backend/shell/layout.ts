/**
 * VS Code-style shell chrome for Mako: title bar, activity bar,
 * Explorer sidebar, tab bar, editor container and status bar.
 *
 * The layout is driven by CSS variables:
 *   --ggd-titlebar  height of the title bar (28px, macOS overlay)
 *   --ggd-top       total top offset: title bar + tab bar (63px)
 *   --ggd-left      total left offset: activity bar + sidebar width
 *   --ggd-bottom    height of the status bar (22px)
 */

import { getThemeId, setTheme, THEMES } from '../theme';
import { ICON_CHEVRON_DOWN, ICON_FILES, ICON_NEW_FILE, ICON_NEW_FOLDER, ICON_SEARCH, ICON_SETTINGS_GEAR, ICON_SOURCE_CONTROL, ICON_TERMINAL, iconSvg } from './icons';

const TITLE_BAR_HEIGHT = 28;
const TAB_BAR_HEIGHT = 35;
const ACTIVITY_BAR_WIDTH = 48;
const STATUS_BAR_HEIGHT = 22;
const SIDEBAR_MIN = 150;
const SIDEBAR_MAX = 600;
const SIDEBAR_DEFAULT = 240;
const SIDEBAR_WIDTH_KEY = 'ggd:sidebarWidth';
const SIDEBAR_VISIBLE_KEY = 'ggd:sidebarVisible';

const SHELL_CSS = `
/* Disable the macOS rubber-band bounce at scroll boundaries (this is an app
   shell, not a webpage): the document, the Explorer tree, the tab bar, the
   graph view scroller and the CodeMirror scrollers. NOTE: must NOT be set on
   the merge view's inner .cm-scrollers — they are non-scrolling (auto-height)
   scroll containers, and overscroll-behavior:none on those blocks wheel
   scroll chaining up to .cm-mergeView entirely. */
html, body,
#ggdTree, #ggdTabbar, #ggdEditorHost .cm-scroller, .cm-mergeView {
	overscroll-behavior: none;
}

/* --- Title bar (macOS overlay: traffic lights float over it) --- */
#ggdTitlebar {
	position: fixed;
	top: 0; left: 0; right: 0;
	height: var(--ggd-titlebar);
	box-sizing: border-box;
	background-color: var(--vscode-titleBar-activeBackground);
	border-bottom: 1px solid rgba(128, 128, 128, 0.35);
	z-index: 37;
	display: flex;
	align-items: center;
	justify-content: center;
	font-family: var(--vscode-font-family);
	font-size: 13px;
	color: var(--vscode-titleBar-activeForeground);
	-webkit-user-select: none;
	user-select: none;
}
/* Centered command-center-style box (visual only, like VS Code's search box
   in the title bar). pointer-events none keeps the overlay drag region live. */
#ggdTitleBox {
	pointer-events: none;
	display: flex;
	align-items: center;
	justify-content: center;
	gap: 6px;
	box-sizing: border-box;
	height: 22px;
	width: 38vw;
	max-width: 600px;
	padding: 0 12px;
	background-color: rgba(128, 128, 128, 0.12);
	border: 1px solid rgba(128, 128, 128, 0.35);
	border-radius: 6px;
	overflow: hidden;
	opacity: 0.9;
	transform: translateY(0.5px);
}
#ggdTitleBox svg {
	flex-shrink: 0;
	display: block;
	opacity: 0.8;
}
#ggdTitleBox span {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
#ggdTitleRight {
	position: absolute;
	top: 0; right: 8px; bottom: 0;
	display: flex;
	align-items: center;
}
.ggdTitleBtn {
	width: 26px;
	height: 20px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 5px;
	cursor: pointer;
}
.ggdTitleBtn:hover {
	background-color: rgba(128, 128, 128, 0.25);
}
.ggdTitleBtn svg {
	display: block;
}

/* --- Activity bar --- */
#ggdActivitybar {
	position: fixed;
	top: var(--ggd-titlebar); left: 0; bottom: var(--ggd-bottom);
	width: ${ACTIVITY_BAR_WIDTH}px;
	background-color: var(--vscode-activityBar-background);
	z-index: 36;
	display: flex;
	flex-direction: column;
	-webkit-user-select: none;
	user-select: none;
}
.ggdActivityItem {
	position: relative;
	height: 48px;
	display: flex;
	align-items: center;
	justify-content: center;
	color: var(--vscode-activityBar-inactiveForeground);
	cursor: pointer;
}
.ggdActivityItem:hover, .ggdActivityItem.active {
	color: var(--vscode-activityBar-foreground);
}
.ggdActivityItem.active::before {
	content: '';
	position: absolute;
	top: 0; left: 0; bottom: 0;
	width: 2px;
	background-color: var(--vscode-activityBar-foreground);
}
.ggdActivitySpacer {
	flex: 1;
}

/* --- Theme menu (opened by the settings gear) --- */
#ggdThemeMenu {
	position: fixed;
	left: ${ACTIVITY_BAR_WIDTH + 4}px;
	bottom: calc(var(--ggd-bottom) + 8px);
	z-index: 38;
	display: none;
	min-width: 180px;
	padding: 4px 0;
	background-color: var(--vscode-menu-background);
	color: var(--vscode-menu-foreground);
	border: 1px solid var(--vscode-menu-border);
	border-radius: 5px;
	box-shadow: 0 2px 8px var(--vscode-widget-shadow);
	font-family: var(--vscode-font-family);
	font-size: 13px;
	-webkit-user-select: none;
	user-select: none;
}
#ggdThemeMenu.open {
	display: block;
}
.ggdThemeMenuTitle {
	padding: 4px 12px 6px 26px;
	font-size: 11px;
	letter-spacing: 0.4px;
	opacity: 0.75;
}
.ggdThemeItem {
	position: relative;
	padding: 4px 16px 4px 26px;
	white-space: nowrap;
	cursor: pointer;
}
.ggdThemeItem:hover {
	background-color: var(--vscode-menu-selectionBackground);
	color: var(--vscode-menu-selectionForeground);
}
.ggdThemeItem.current::before {
	content: '✓';
	position: absolute;
	left: 9px;
}

/* --- Sidebar --- */
#ggdSidebar {
	position: fixed;
	top: var(--ggd-titlebar);
	left: ${ACTIVITY_BAR_WIDTH}px;
	bottom: var(--ggd-bottom);
	width: calc(var(--ggd-left) - ${ACTIVITY_BAR_WIDTH}px);
	box-sizing: border-box;
	border-left: 1px solid var(--vscode-sideBar-border);
	background-color: var(--vscode-sideBar-background);
	z-index: 35;
	display: flex;
	flex-direction: column;
	overflow: hidden;
	font-family: var(--vscode-font-family);
	font-size: 13px;
	color: var(--vscode-sideBar-foreground);
	-webkit-user-select: none;
	user-select: none;
}
body.ggdSidebarHidden #ggdSidebar, body.ggdSidebarHidden #ggdSidebarResize {
	display: none;
}
.ggdSideHeader {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	height: ${TAB_BAR_HEIGHT}px;
	padding: 0 8px 0 16px;
	font-size: 11px;
	letter-spacing: 0.4px;
	color: var(--vscode-sideBar-foreground);
	overflow: hidden;
}
.ggdSideTitle {
	flex: 1;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
/* Collapsible workspace-folder section bar (VS Code style: bold uppercase
   folder name, chevron, hover-revealed actions) */
.ggdSectionHeader {
	flex-shrink: 0;
	display: flex;
	align-items: center;
	height: 22px;
	padding: 0 8px 0 2px;
	font-size: 11px;
	font-weight: bold;
	color: var(--vscode-sideBar-foreground);
	cursor: pointer;
	overflow: hidden;
}
.ggdSectionChevron {
	flex-shrink: 0;
	width: 16px;
	height: 16px;
}
.ggdSectionChevron svg {
	display: block;
}
.ggdSectionHeader.collapsed .ggdSectionChevron svg {
	transform: rotate(-90deg);
}
.ggdSectionName {
	flex: 1;
	margin-left: 2px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.ggdSectionActions {
	display: none;
	align-items: center;
}
#ggdSidebar:hover .ggdSectionActions {
	display: flex;
}
.ggdSideBtn {
	flex-shrink: 0;
	margin-left: 6px;
	padding: 2px 5px;
	border-radius: 4px;
	cursor: pointer;
	line-height: 14px;
}
.ggdSideBtn:hover {
	background-color: var(--vscode-list-activeSelectionBackground);
}
.ggdSideBtn svg {
	display: block;
}
#ggdTree {
	flex: 1;
	overflow: auto;
	padding: 2px 0 10px 0;
}

#ggdSidebarResize {
	position: fixed;
	top: var(--ggd-titlebar); bottom: var(--ggd-bottom);
	left: calc(var(--ggd-left) - 2px);
	width: 4px;
	cursor: col-resize;
	z-index: 36;
}
#ggdSidebarResize:hover, #ggdSidebarResize.dragging {
	background-color: var(--vscode-focusBorder);
}

/* --- Tab bar --- */
#ggdTabbar {
	position: fixed;
	top: var(--ggd-titlebar);
	left: var(--ggd-left);
	right: 0;
	height: ${TAB_BAR_HEIGHT}px;
	box-sizing: border-box;
	background-color: var(--vscode-editorGroupHeader-tabsBackground);
	border-bottom: 1px solid rgba(128, 128, 128, 0.35);
	z-index: 35;
	display: flex;
	align-items: stretch;
	overflow-x: auto;
	overflow-y: hidden;
	font-family: var(--vscode-font-family);
	-webkit-user-select: none;
	user-select: none;
}
#ggdTabbar::-webkit-scrollbar {
	height: 3px;
}
.ggdTab {
	position: relative;
	display: flex;
	align-items: center;
	padding: 0 4px 0 10px;
	background-color: var(--vscode-tab-inactiveBackground);
	color: var(--vscode-tab-inactiveForeground);
	border-right: 1px solid var(--vscode-tab-border);
	font-size: 13px;
	white-space: nowrap;
	flex-shrink: 0;
	cursor: pointer;
}
.ggdTab.active {
	background-color: var(--vscode-tab-activeBackground);
	color: var(--vscode-tab-activeForeground);
}
/* Top highlight on the active tab (e.g. Dark Modern's blue line); an overlay
   rather than a border so the tab content doesn't shift */
.ggdTab.active::before {
	content: '';
	position: absolute;
	top: 0; left: 0; right: 0;
	height: 1px;
	background-color: var(--vscode-tab-activeBorderTop);
	pointer-events: none;
}
.ggdTabIcon {
	flex-shrink: 0;
	width: 16px;
	height: 16px;
	margin-right: 5px;
	display: flex;
	align-items: center;
	justify-content: center;
}
.ggdTabIcon svg {
	display: block;
}
.ggdTabClose {
	visibility: hidden;
	flex-shrink: 0;
	margin-left: 8px;
	width: 20px;
	height: 20px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 4px;
}
/* Like VS Code: always visible on the active tab, on hover otherwise, and
   the dirty dot is always visible (turning into × when hovered) */
.ggdTab.active .ggdTabClose, .ggdTab:hover .ggdTabClose, .ggdTab.dirty .ggdTabClose {
	visibility: visible;
}
.ggdTabClose:hover {
	background-color: rgba(90, 93, 94, 0.31);
}
.ggdTabClose svg {
	display: block;
}
.ggdTabClose .ggdTabDirtyIcon {
	display: none;
}
.ggdTab.dirty .ggdTabClose:not(:hover) .ggdTabCloseIcon {
	display: none;
}
.ggdTab.dirty .ggdTabClose:not(:hover) .ggdTabDirtyIcon {
	display: block;
}

/* --- Status bar --- */
#ggdStatusbar {
	position: fixed;
	left: 0; right: 0; bottom: 0;
	height: var(--ggd-bottom);
	background-color: var(--vscode-statusBar-background);
	color: var(--vscode-statusBar-foreground);
	z-index: 37;
	display: flex;
	align-items: stretch;
	overflow: hidden;
	font-family: var(--vscode-font-family);
	font-size: 12px;
	-webkit-user-select: none;
	user-select: none;
}
.ggdStatusGroup {
	display: flex;
	align-items: stretch;
}
.ggdStatusRight {
	margin-left: auto;
}
.ggdStatusItem {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 0 8px;
	white-space: nowrap;
}
.ggdStatusItem.clickable {
	cursor: pointer;
}
.ggdStatusItem.clickable:hover {
	background-color: rgba(255, 255, 255, 0.12);
}
.ggdStatusItem svg {
	display: block;
}

/* --- Editor container --- */
#ggdEditors {
	position: fixed;
	top: var(--ggd-top);
	left: var(--ggd-left);
	right: 0;
	bottom: calc(var(--ggd-bottom) + var(--ggd-panel, 0px));
	background-color: var(--vscode-editor-background);
	z-index: 34;
}
#ggdEditorHost {
	width: 100%;
	height: 100%;
}
#ggdEditorHost .cm-editor {
	height: 100%;
}
#ggdEditorNotice {
	display: none;
	padding: 30px 20px;
	text-align: center;
	font-family: var(--vscode-font-family);
	font-size: var(--vscode-font-size);
	color: var(--vscode-input-placeholderForeground);
}
.ggdElementTab {
	width: 100%;
	height: 100%;
	overflow: hidden;
}
/* The merge view scrolls as one unit: .cm-mergeView is the scroll container,
   the inner editors auto-size to their content (per @codemirror/merge docs).
   Do NOT constrain the inner editor heights. */
.ggdElementTab .cm-mergeView {
	height: 100%;
	overflow: auto;
}
.ggdElementTab .cm-mergeView::-webkit-scrollbar {
	width: 14px;
	height: 14px;
}
.ggdElementTab .cm-mergeView::-webkit-scrollbar-track,
.ggdElementTab .cm-mergeView::-webkit-scrollbar-corner {
	background: transparent;
}
.ggdElementTab .cm-mergeView::-webkit-scrollbar-thumb {
	background: var(--vscode-scrollbarSlider-background);
}
.ggdElementTab .cm-mergeView::-webkit-scrollbar-thumb:hover {
	background: var(--vscode-scrollbarSlider-hoverBackground);
}
.ggdElementTab .cm-mergeView::-webkit-scrollbar-thumb:active {
	background: var(--vscode-scrollbarSlider-activeBackground);
}
/* Collapsed unchanged regions in large diffs (VS Code "hidden regions" bar) */
.ggdElementTab .cm-collapsedLines {
	background: var(--vscode-editorWidget-background) !important;
	color: var(--vscode-textLink-foreground) !important;
	border-top: 1px solid var(--vscode-editorWidget-border);
	border-bottom: 1px solid var(--vscode-editorWidget-border);
}
/* Divider between the two diff panes (VS Code sash) */
.ggdElementTab .cm-mergeViewEditor + .cm-mergeViewEditor {
	border-left: 1px solid var(--vscode-editorWidget-border);
}
/* Alignment spacers: VS Code's diagonal fill (diffEditor.diagonalFill) */
.ggdElementTab .cm-mergeSpacer {
	background: repeating-linear-gradient(
		-45deg,
		rgba(204, 204, 204, 0.2) 0,
		rgba(204, 204, 204, 0.2) 1px,
		transparent 1px,
		transparent 5px
	) !important;
}

/* VS Code dark theme diff colours (diffEditor.removed/insertedLineBackground
   & removed/insertedTextBackground). !important: the merge package injects
   its base theme after this stylesheet. */
.ggdElementTab .cm-merge-a .cm-changedLine,
.ggdElementTab .cm-deletedChunk {
	background-color: rgba(255, 0, 0, 0.2) !important;
}
.ggdElementTab .cm-merge-b .cm-changedLine {
	background-color: rgba(155, 185, 85, 0.2) !important;
}
.ggdElementTab .cm-merge-a .cm-changedText,
.ggdElementTab .cm-deletedChunk .cm-deletedText {
	background: rgba(255, 0, 0, 0.28) !important;
}
.ggdElementTab .cm-merge-b .cm-changedText {
	background: rgba(156, 204, 44, 0.28) !important;
}
.ggdElementTab .cm-merge-a .cm-changedLineGutter,
.ggdElementTab .cm-deletedLineGutter {
	background: rgba(255, 0, 0, 0.55) !important;
}
.ggdElementTab .cm-merge-b .cm-changedLineGutter {
	background: rgba(155, 185, 85, 0.7) !important;
}

/* --- Explorer tree --- */
.ggdTreeRow {
	display: flex;
	align-items: center;
	height: 22px;
	line-height: 22px;
	white-space: nowrap;
	cursor: pointer;
	overflow: hidden;
}
.ggdTreeRow:hover {
	background-color: var(--vscode-list-hoverBackground);
}
/* Inline new-file / new-folder name input row */
.ggdTreeInput {
	flex: 1;
	min-width: 0;
	height: 18px;
	box-sizing: border-box;
	margin-right: 8px;
	padding: 0 3px;
	font-family: var(--vscode-font-family);
	font-size: 13px;
	color: var(--vscode-sideBar-foreground);
	background-color: var(--vscode-editor-background);
	border: 1px solid var(--vscode-focusBorder);
	border-radius: 0;
	outline: none;
}
.ggdTreeRow.selected {
	background-color: var(--vscode-list-activeSelectionBackground);
	color: var(--vscode-list-activeSelectionForeground);
}
.ggdTreeChevron {
	flex-shrink: 0;
	width: 16px;
	height: 16px;
	margin-right: 5px;
	display: flex;
	align-items: center;
	justify-content: center;
	transition: transform 0.1s linear;
}
.ggdTreeRow.expanded .ggdTreeChevron {
	transform: rotate(90deg);
}
.ggdTreeIcon {
	flex-shrink: 0;
	width: 16px;
	height: 16px;
	margin-right: 5px;
	display: flex;
	align-items: center;
	justify-content: center;
}
.ggdTreeIcon svg {
	display: block;
}
.ggdTreeLabel {
	flex: 0 1 auto;
	overflow: hidden;
	text-overflow: ellipsis;
}
.ggdTreeBadge {
	flex-shrink: 0;
	margin-left: auto;
	padding: 0 8px 0 6px;
	font-size: 12px;
}
.ggdTreeBadge.ggdTreeDot {
	font-size: 8px;
	opacity: 0.4;
}
.ggdTreeGuide {
	position: absolute;
	top: 0;
	bottom: 0;
	width: 1px;
	background: var(--vscode-tree-indentGuidesStroke);
	pointer-events: none;
}
`;

export interface Shell {
	readonly tabbar: HTMLElement;
	readonly tree: HTMLElement;
	readonly editors: HTMLElement;
	readonly statusbar: HTMLElement;
	onToggleTerminal: (handler: () => void) => void;
	onNewFile: (handler: () => void) => void;
	onNewFolder: (handler: () => void) => void;
}

function clampWidth(width: number) {
	return Math.min(Math.max(width, SIDEBAR_MIN), SIDEBAR_MAX);
}

let sidebarWidth = SIDEBAR_DEFAULT;
let sidebarVisible = true;

function applySidebarLayout() {
	document.body.classList.toggle('ggdSidebarHidden', !sidebarVisible);
	const left = ACTIVITY_BAR_WIDTH + (sidebarVisible ? sidebarWidth : 0);
	document.documentElement.style.setProperty('--ggd-left', left + 'px');
}

/**
 * Build the shell chrome (title bar, activity bar, sidebar, tab bar, editor
 * container, status bar). `onOpenGraph` supplies the Explorer header's "Open
 * Git Graph" action (null → no graph button, folder is not a repo).
 */
export function buildShell(folder: string, onOpenGraph: (() => void) | null): Shell {
	// Injected override stylesheet
	if (document.getElementById('ggdShellStyle') === null) {
		const style = document.createElement('style');
		style.id = 'ggdShellStyle';
		style.textContent = SHELL_CSS;
		document.head.appendChild(style);
	}

	const rootStyle = document.documentElement.style;
	rootStyle.setProperty('--ggd-titlebar', TITLE_BAR_HEIGHT + 'px');
	rootStyle.setProperty('--ggd-top', (TITLE_BAR_HEIGHT + TAB_BAR_HEIGHT) + 'px');
	rootStyle.setProperty('--ggd-bottom', STATUS_BAR_HEIGHT + 'px');
	rootStyle.setProperty('--ggd-panel', '0px');
	sidebarWidth = clampWidth(parseInt(localStorage.getItem(SIDEBAR_WIDTH_KEY) || '', 10) || SIDEBAR_DEFAULT);
	sidebarVisible = localStorage.getItem(SIDEBAR_VISIBLE_KEY) !== 'false';
	document.body.classList.add('ggdShell');
	applySidebarLayout();

	const folderName = folder.substring(folder.lastIndexOf('/') + 1);

	// Title bar (drag region for the macOS overlay title bar)
	const titlebar = document.createElement('div');
	titlebar.id = 'ggdTitlebar';
	titlebar.setAttribute('data-tauri-drag-region', '');
	const titleBox = document.createElement('div');
	titleBox.id = 'ggdTitleBox';
	titleBox.innerHTML = iconSvg(ICON_SEARCH, 12);
	const titleText = document.createElement('span');
	titleText.textContent = folderName;
	titleBox.appendChild(titleText);
	titlebar.appendChild(titleBox);

	// Top-right terminal toggle (like VS Code's layout controls)
	const titleRight = document.createElement('div');
	titleRight.id = 'ggdTitleRight';
	const terminalBtn = document.createElement('div');
	terminalBtn.className = 'ggdTitleBtn';
	terminalBtn.title = 'Toggle Terminal (⌃`)';
	terminalBtn.innerHTML = iconSvg(ICON_TERMINAL, 14);
	titleRight.appendChild(terminalBtn);
	titlebar.appendChild(titleRight);

	// Activity bar: clicking the Explorer icon toggles the sidebar.
	const activitybar = document.createElement('div');
	activitybar.id = 'ggdActivitybar';
	const explorerItem = document.createElement('div');
	explorerItem.className = 'ggdActivityItem';
	explorerItem.title = 'Explorer';
	explorerItem.innerHTML = iconSvg(ICON_FILES, 24);
	activitybar.appendChild(explorerItem);

	// Settings gear (bottom of the activity bar) → theme menu
	const spacer = document.createElement('div');
	spacer.className = 'ggdActivitySpacer';
	activitybar.appendChild(spacer);
	const settingsItem = document.createElement('div');
	settingsItem.className = 'ggdActivityItem';
	settingsItem.title = 'Colour Theme';
	settingsItem.innerHTML = iconSvg(ICON_SETTINGS_GEAR, 24);
	activitybar.appendChild(settingsItem);

	const themeMenu = document.createElement('div');
	themeMenu.id = 'ggdThemeMenu';
	const menuTitle = document.createElement('div');
	menuTitle.className = 'ggdThemeMenuTitle';
	menuTitle.textContent = 'COLOUR THEME';
	themeMenu.appendChild(menuTitle);
	const themeItems: HTMLElement[] = [];
	THEMES.forEach((theme) => {
		const item = document.createElement('div');
		item.className = 'ggdThemeItem';
		item.textContent = theme.label;
		item.addEventListener('click', () => {
			setTheme(theme.id);
			for (let i = 0; i < themeItems.length; i++) {
				themeItems[i].classList.toggle('current', THEMES[i].id === theme.id);
			}
			themeMenu.classList.remove('open');
		});
		themeItems.push(item);
		themeMenu.appendChild(item);
	});
	settingsItem.addEventListener('click', () => {
		if (!themeMenu.classList.contains('open')) {
			for (let i = 0; i < themeItems.length; i++) {
				themeItems[i].classList.toggle('current', THEMES[i].id === getThemeId());
			}
		}
		themeMenu.classList.toggle('open');
	});
	document.addEventListener('mousedown', (e) => {
		if (themeMenu.classList.contains('open') && !themeMenu.contains(<Node>e.target) && !settingsItem.contains(<Node>e.target)) {
			themeMenu.classList.remove('open');
		}
	}, true);

	// Sidebar — the Explorer view
	const sidebar = document.createElement('div');
	sidebar.id = 'ggdSidebar';

	const header = document.createElement('div');
	header.className = 'ggdSideHeader';
	const title = document.createElement('span');
	title.className = 'ggdSideTitle';
	title.textContent = 'EXPLORER';
	header.appendChild(title);
	if (onOpenGraph !== null) {
		const graphBtn = document.createElement('span');
		graphBtn.className = 'ggdSideBtn';
		graphBtn.title = 'Open Git Graph';
		graphBtn.innerHTML = iconSvg(ICON_SOURCE_CONTROL, 14);
		graphBtn.addEventListener('click', onOpenGraph);
		header.appendChild(graphBtn);
	}

	// Collapsible workspace-folder section with new file/folder actions
	const section = document.createElement('div');
	section.className = 'ggdSectionHeader';
	const sectionChevron = document.createElement('span');
	sectionChevron.className = 'ggdSectionChevron';
	sectionChevron.innerHTML = iconSvg(ICON_CHEVRON_DOWN, 16);
	section.appendChild(sectionChevron);
	const sectionName = document.createElement('span');
	sectionName.className = 'ggdSectionName';
	sectionName.textContent = folderName.toUpperCase();
	sectionName.title = folder;
	section.appendChild(sectionName);
	const actions = document.createElement('span');
	actions.className = 'ggdSectionActions';
	const newFileBtn = document.createElement('span');
	newFileBtn.className = 'ggdSideBtn';
	newFileBtn.title = 'New File...';
	newFileBtn.innerHTML = iconSvg(ICON_NEW_FILE, 16);
	actions.appendChild(newFileBtn);
	const newFolderBtn = document.createElement('span');
	newFolderBtn.className = 'ggdSideBtn';
	newFolderBtn.title = 'New Folder...';
	newFolderBtn.innerHTML = iconSvg(ICON_NEW_FOLDER, 16);
	actions.appendChild(newFolderBtn);
	section.appendChild(actions);

	const tree = document.createElement('div');
	tree.id = 'ggdTree';

	section.addEventListener('click', () => {
		const collapsed = section.classList.toggle('collapsed');
		tree.style.display = collapsed ? 'none' : '';
	});
	// Creating always uncollapses the section so the input row is visible
	const actionHandler = (handler: () => void) => (e: MouseEvent) => {
		e.stopPropagation();
		section.classList.remove('collapsed');
		tree.style.display = '';
		handler();
	};

	sidebar.appendChild(header);
	sidebar.appendChild(section);
	sidebar.appendChild(tree);

	const applyView = () => {
		explorerItem.classList.toggle('active', sidebarVisible);
	};
	explorerItem.addEventListener('click', () => {
		sidebarVisible = !sidebarVisible;
		applySidebarLayout();
		applyView();
		try {
			localStorage.setItem(SIDEBAR_VISIBLE_KEY, String(sidebarVisible));
		} catch (_) { }
	});
	applyView();

	// Sidebar resize handle
	const resize = document.createElement('div');
	resize.id = 'ggdSidebarResize';
	resize.addEventListener('mousedown', (e) => {
		e.preventDefault();
		resize.classList.add('dragging');
		const prevCursor = document.body.style.cursor;
		document.body.style.cursor = 'col-resize';
		const onMove = (move: MouseEvent) => {
			sidebarWidth = clampWidth(move.clientX - ACTIVITY_BAR_WIDTH);
			applySidebarLayout();
		};
		const onUp = () => {
			window.removeEventListener('mousemove', onMove);
			window.removeEventListener('mouseup', onUp);
			resize.classList.remove('dragging');
			document.body.style.cursor = prevCursor;
			try {
				localStorage.setItem(SIDEBAR_WIDTH_KEY, String(sidebarWidth));
			} catch (_) { }
		};
		window.addEventListener('mousemove', onMove);
		window.addEventListener('mouseup', onUp);
	});

	// Tab bar
	const tabbar = document.createElement('div');
	tabbar.id = 'ggdTabbar';

	// Editor container
	const editors = document.createElement('div');
	editors.id = 'ggdEditors';

	// Status bar
	const statusbar = document.createElement('div');
	statusbar.id = 'ggdStatusbar';

	document.body.appendChild(titlebar);
	document.body.appendChild(activitybar);
	document.body.appendChild(themeMenu);
	document.body.appendChild(sidebar);
	document.body.appendChild(resize);
	document.body.appendChild(tabbar);
	document.body.appendChild(editors);
	document.body.appendChild(statusbar);

	return {
		tabbar: tabbar,
		tree: tree,
		editors: editors,
		statusbar: statusbar,
		onToggleTerminal: (handler) => terminalBtn.addEventListener('click', handler),
		onNewFile: (handler) => newFileBtn.addEventListener('click', actionHandler(handler)),
		onNewFolder: (handler) => newFolderBtn.addEventListener('click', actionHandler(handler))
	};
}
