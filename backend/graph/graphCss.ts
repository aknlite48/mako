/**
 * Stylesheet for the graph view (injected by graphView.ts). All colours come
 * from the shell's --vscode-* theme variables so theme switching recolours
 * the view live; lane colours are inline styles set per element.
 */

export const GRAPH_CSS = `
.ggvRoot {
	position: relative;
	width: 100%;
	height: 100%;
	display: flex;
	flex-direction: column;
	background-color: var(--vscode-editor-background);
	color: var(--vscode-editor-foreground);
	font-family: var(--vscode-font-family);
	font-size: 14px;
	-webkit-user-select: none;
	user-select: none;
	--ggv-sep: rgba(128, 128, 128, 0.2);
}

/* --- Controls bar (centered Repo / Branches / Show Remote Branches group
       with the find / refresh icons pinned to the right, like Git Graph) --- */
.ggvControls {
	position: relative;
	flex-shrink: 0;
	display: flex;
	align-items: center;
	justify-content: center;
	height: 40px;
	padding: 0 64px 0 10px;
	font-size: 13px;
	font-weight: 700;
	border-bottom: 1px solid rgba(128, 128, 128, 0.5);
	white-space: nowrap;
}
.ggvControlsCenter {
	display: flex;
	align-items: center;
	overflow: hidden;
}
.ggvControlsIcons {
	position: absolute;
	top: 0;
	right: 6px;
	height: 100%;
	display: flex;
	align-items: center;
	gap: 2px;
}
.ggvControlLabel {
	margin: 0 3px 0 10px;
}
/* Rounded translucent-grey pill button, like Git Graph's dropdowns */
.ggvDropdownBtn {
	position: relative;
	box-sizing: border-box;
	height: 26px;
	line-height: 24px;
	max-width: 30vw;
	margin-right: 10px;
	padding: 0 20px 0 10px;
	font-weight: normal;
	background-color: rgba(128, 128, 128, 0.1);
	border: 1px solid rgba(128, 128, 128, 0.5);
	border-radius: 6px;
	cursor: pointer;
	overflow: hidden;
}
.ggvDropdownBtn:hover {
	background-color: rgba(128, 128, 128, 0.2);
}
.ggvDropdownBtn.ggvOpen {
	border-radius: 6px 6px 0 0;
}
.ggvDropdownBtn span {
	display: block;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
/* Triangle arrow at the right edge; flips upward while open */
.ggvDropdownBtn::after {
	content: '';
	position: absolute;
	top: 11px;
	right: 7px;
	width: 0;
	height: 0;
	border: 4px solid transparent;
	border-top-color: var(--vscode-editor-foreground);
}
.ggvDropdownBtn.ggvOpen::after {
	top: 7px;
	border-top-color: transparent;
	border-bottom-color: var(--vscode-editor-foreground);
}
.ggvRemoteToggle {
	display: flex;
	align-items: center;
	margin-left: 10px;
	cursor: pointer;
}
/* Custom rounded-square checkbox (Git Graph-style), before the label text */
.ggvRemoteToggle input {
	display: none;
}
.ggvCheckBox {
	position: relative;
	flex-shrink: 0;
	width: 15px;
	height: 15px;
	margin-right: 6px;
	box-sizing: border-box;
	background-color: rgba(128, 128, 128, 0.1);
	border: 1px solid rgba(128, 128, 128, 0.5);
	border-radius: 3px;
}
.ggvRemoteToggle input:checked + .ggvCheckBox::after {
	content: '';
	position: absolute;
	left: 4px;
	top: 1px;
	width: 3px;
	height: 7px;
	border: solid var(--vscode-editor-foreground);
	border-width: 0 2px 2px 0;
	transform: rotate(45deg);
}
.ggvIconBtn {
	flex-shrink: 0;
	width: 24px;
	height: 24px;
	display: flex;
	align-items: center;
	justify-content: center;
	border-radius: 4px;
	cursor: pointer;
	color: var(--vscode-editor-foreground);
}
.ggvIconBtn:hover {
	background-color: var(--vscode-list-hoverBackground);
}
.ggvIconBtn svg {
	display: block;
}

/* --- Dropdown popups --- */
.ggvDropdownMenu {
	position: absolute;
	z-index: 10;
	box-sizing: border-box;
	max-height: 297px;
	overflow-y: auto;
	overflow-x: hidden;
	line-height: 20px;
	font-size: 13px;
	font-weight: normal;
	background-color: var(--vscode-menu-background);
	color: var(--vscode-menu-foreground);
	border: 1px solid rgba(128, 128, 128, 0.5);
	border-radius: 0 0 6px 6px;
	overscroll-behavior: none;
}
.ggvDropdownFilter {
	padding: 3px;
}
.ggvDropdownFilterInput {
	width: 100%;
	box-sizing: border-box;
	background: none;
	border: 1px solid rgba(128, 128, 128, 0.5);
	outline: none;
	border-radius: 4px;
	padding: 3px 6px;
	font-size: 13px;
	line-height: 17px;
	font-family: inherit;
	color: var(--vscode-menu-foreground);
}
.ggvDropdownItem {
	position: relative;
	padding: 4px 10px;
	cursor: pointer;
	white-space: nowrap;
	overflow: hidden;
	text-overflow: ellipsis;
}
.ggvDropdownItem.ggvMulti {
	padding-left: 30px;
}
.ggvDropdownItem.ggvSelected {
	background-color: rgba(128, 128, 128, 0.15);
}
.ggvDropdownItem:hover {
	background-color: var(--vscode-menu-selectionBackground, var(--vscode-menu-background));
	color: var(--vscode-menu-selectionForeground, var(--vscode-menu-foreground));
}
/* Checkmark shown only on selected rows, in the 30px multi-select gutter */
.ggvDropdownItem .ggvCheck {
	position: absolute;
	left: 10px;
	top: 4px;
	width: 12px;
	text-align: center;
	opacity: 0.7;
}
.ggvDropdownItem:hover .ggvCheck {
	opacity: 0.85;
}
.ggvDropdownNoResults {
	padding: 4px 10px;
	font-style: italic;
}

/* --- Scroll area + table --- */
.ggvScroll {
	position: relative;
	flex: 1;
	overflow: auto;
	overscroll-behavior: none;
}
.ggvScroll::-webkit-scrollbar {
	width: 14px;
	height: 14px;
}
.ggvScroll::-webkit-scrollbar-track, .ggvScroll::-webkit-scrollbar-corner {
	background: transparent;
}
.ggvScroll::-webkit-scrollbar-thumb {
	background: var(--vscode-scrollbarSlider-background);
}
.ggvScroll::-webkit-scrollbar-thumb:hover {
	background: var(--vscode-scrollbarSlider-hoverBackground);
}
.ggvScroll::-webkit-scrollbar-thumb:active {
	background: var(--vscode-scrollbarSlider-activeBackground);
}
/* border-collapse: separate + box-sizing: border-box keeps every row at
   exactly 24px (borders inside the box), so the SVG lanes stay aligned. */
.ggvTable {
	width: 100%;
	border-collapse: separate;
	border-spacing: 0;
	table-layout: fixed;
}
.ggvTable th {
	position: sticky;
	top: 0;
	z-index: 3;
	box-sizing: border-box;
	height: 24px;
	padding: 0 8px;
	background-color: var(--vscode-editor-background);
	font-weight: normal;
	text-align: left;
	border-bottom: 1px solid var(--ggv-sep);
}
.ggvTable th + th {
	border-left: 1px solid var(--ggv-sep);
}
.ggvTable td {
	box-sizing: border-box;
	height: 24px;
	padding: 0 8px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.ggvDetailsCell {
	height: auto !important;
}
.ggvRow {
	cursor: pointer;
}
.ggvRow:hover {
	background-color: var(--vscode-list-hoverBackground);
}
.ggvRow.ggvExpanded {
	/* A soft neutral grey (brighter than hover) rather than the theme's
	   selection blue — matches the calmer look of the classic Git Graph */
	background-color: rgba(128, 128, 128, 0.22);
}
.ggvRow.ggvExpanded .ggvMuted {
	opacity: 1;
}
.ggvRow.ggvFindMatch td {
	background-color: var(--vscode-editor-findMatchHighlightBackground);
}
.ggvRow.ggvFindCurrent td {
	background-color: var(--vscode-editor-findMatchBackground);
}
.ggvMuted {
	opacity: 0.9;
}
.ggvColResize {
	position: absolute;
	top: 0;
	right: 0;
	width: 6px;
	height: 100%;
	cursor: col-resize;
}
.ggvColResize::after {
	content: '';
	position: absolute;
	top: 0;
	right: 0;
	width: 2px;
	height: 100%;
}
.ggvColResize:hover::after, .ggvColResize.ggvResizing::after {
	background-color: var(--vscode-focusBorder);
}
.ggvHash {
	font-family: var(--vscode-editor-font-family);
	font-size: 13px;
}
.ggvUncommitted {
	font-weight: bold;
	color: var(--vscode-editor-foreground);
}
.ggvSvg {
	position: absolute;
	left: 0;
	z-index: 2;
	pointer-events: none;
}

/* Hollow ring marking the checked-out commit, tinted with its lane colour */
.ggvHeadDot {
	display: inline-block;
	width: 6px;
	height: 6px;
	border: 2px solid;
	border-radius: 6px;
	margin-right: 5px;
	vertical-align: middle;
	cursor: help;
}

/* --- Ref chips --- */
.ggvChip {
	display: inline-flex;
	align-items: center;
	max-width: 180px;
	margin-right: 5px;
	height: 18px;
	background-color: rgba(128, 128, 128, 0.15);
	border: 1px solid rgba(128, 128, 128, 0.75);
	border-radius: 5px;
	font-size: 12px;
	line-height: 18px;
	vertical-align: middle;
	cursor: default;
	overflow: hidden;
}
/* Lane-coloured icon block at the left; the glyph is punched out in the
   editor background colour */
.ggvChipIcon {
	flex-shrink: 0;
	width: 14px;
	height: 14px;
	padding: 2px;
	color: var(--vscode-editor-background);
}
.ggvChipIcon svg {
	display: block;
}
.ggvChipName, .ggvChipRemote {
	padding: 0 5px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
/* Remote segment of a combined local+remote chip (e.g. [main | origin]) is
   never bold, even on the checked-out branch */
.ggvChip.ggvChipHead .ggvChipName {
	font-weight: bold;
}

/* --- Load More --- */
.ggvLoadMore {
	display: block;
	margin: 8px auto;
	padding: 4px 14px;
	background-color: var(--vscode-button-background);
	color: var(--vscode-button-foreground);
	border: none;
	border-radius: 3px;
	font-family: var(--vscode-font-family);
	font-size: 13px;
	cursor: pointer;
}
.ggvLoadMore:hover {
	background-color: var(--vscode-button-hoverBackground);
}

/* --- Inline commit details --- */
/* Flat full-width section under the clicked row, like the classic Git
   Graph details view; the content is indented past the graph column via an
   inline left margin so it lines up with the Description column. */
.ggvDetailsCell {
	padding: 0 !important;
	white-space: normal !important;
	/* A grey between the plain rows and the selected row's 0.22 overlay */
	background-color: rgba(128, 128, 128, 0.12);
	border-top: 1px solid var(--vscode-editorWidget-border);
	border-bottom: 1px solid var(--vscode-editorWidget-border);
}
.ggvDetails {
	display: flex;
	max-height: 260px;
	font-size: 13px;
	-webkit-user-select: text;
	user-select: text;
}
/* WebKit does not render a scroll container's padding-bottom beyond
   overflowing content — the ::after spacer provides the bottom gap instead */
.ggvDetailsLeft::after, .ggvDetailsRight::after {
	content: '';
	display: block;
	height: 32px;
}
.ggvDetailsLeft {
	flex: 1 1 50%;
	min-width: 0;
	padding: 9px 12px 0 12px;
	overflow: auto;
	overscroll-behavior: none;
}
.ggvDetailsLeft .ggvHash {
	-webkit-user-select: text;
	user-select: text;
}
.ggvDetailsBody {
	margin-top: 6px;
	white-space: pre-wrap;
	word-break: break-word;
	font-family: var(--vscode-font-family);
}
.ggvDetailsField b {
	font-weight: bold;
}
.ggvParentLink {
	color: var(--vscode-textLink-foreground);
	cursor: pointer;
}
.ggvParentLink:hover {
	text-decoration: underline;
}
.ggvDetailsRight {
	flex: 1 1 50%;
	min-width: 0;
	padding: 9px 4px 0 4px;
	border-left: 1px solid var(--vscode-editorWidget-border);
	overflow: auto;
	overscroll-behavior: none;
	-webkit-user-select: none;
	user-select: none;
}

/* --- Changed-file tree --- */
.ggvFileRow {
	display: flex;
	align-items: center;
	height: 22px;
	padding-right: 6px;
	white-space: nowrap;
	cursor: pointer;
	overflow: hidden;
}
.ggvFileRow:hover {
	background-color: var(--vscode-list-hoverBackground);
}
.ggvFileChevron {
	flex-shrink: 0;
	width: 16px;
	height: 16px;
	display: flex;
	align-items: center;
	justify-content: center;
}
.ggvFileIcon {
	flex-shrink: 0;
	width: 16px;
	height: 16px;
	margin-right: 5px;
	display: flex;
	align-items: center;
	justify-content: center;
	opacity: 0.85;
}
.ggvFileIcon svg {
	display: block;
}
.ggvFileName {
	flex: 0 1 auto;
	overflow: hidden;
	text-overflow: ellipsis;
}
.ggvFileOld {
	margin-left: 5px;
	opacity: 0.6;
	overflow: hidden;
	text-overflow: ellipsis;
}
.ggvFileStats {
	flex-shrink: 0;
	margin-left: 6px;
	opacity: 0.9;
	font-variant-numeric: tabular-nums;
}
.ggvStatAdd {
	color: var(--vscode-gitDecoration-addedResourceForeground);
}
.ggvStatDel {
	color: var(--vscode-gitDecoration-deletedResourceForeground);
}

/* --- Find widget --- */
.ggvFind {
	position: absolute;
	top: 32px;
	right: 20px;
	z-index: 11;
	display: none;
	align-items: center;
	gap: 4px;
	padding: 4px 6px;
	background-color: var(--vscode-editorWidget-background);
	border: 1px solid var(--vscode-editorWidget-border);
	border-top: none;
	border-radius: 0 0 4px 4px;
	box-shadow: 0 2px 8px var(--vscode-widget-shadow);
}
.ggvFind.ggvFindOpen {
	display: flex;
}
.ggvFindInput {
	width: 160px;
	padding: 2px 6px;
	background-color: var(--vscode-input-background);
	color: var(--vscode-input-foreground);
	border: 1px solid transparent;
	border-radius: 2px;
	outline: none;
	font-family: var(--vscode-font-family);
	font-size: 12px;
}
.ggvFindInput:focus {
	border-color: var(--vscode-focusBorder);
}
.ggvFindCount {
	min-width: 54px;
	text-align: center;
	font-size: 11px;
	opacity: 0.85;
}

/* --- Messages --- */
.ggvMessage {
	padding: 30px 20px;
	text-align: center;
	color: var(--vscode-input-placeholderForeground);
}
`;
