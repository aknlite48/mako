/**
 * The Git Graph view: a read-only commit visualizer styled after the classic
 * Git Graph extension look — a controls bar (Repo / Branches dropdowns, find,
 * refresh), a colored-lane graph beside a Description / Date / Author /
 * Commit table, ref chips, an Uncommitted Changes row, stash rows, an inline
 * commit-details panel with a changed-file tree, and a find widget.
 *
 * Strictly read-only: it never runs a mutating git command.
 */

import { ICON_GIT_BRANCH, iconSvg } from '../shell/icons';
import {
	GitFileChange, GitRef, GitStash, UNCOMMITTED, abbrev,
	getCommitBody, getCommitChanges, getCommits, getRefs, getStashes, getUncommittedChanges
} from './gitCli';
import { GRAPH_CSS } from './graphCss';
import { RowLayout, assignLanes } from './laneLayout';

const ROW_HEIGHT = 24;
const HEADER_HEIGHT = 24;
const LANE_WIDTH = 16;
const LANE_LEFT = 12;
const MAX_LANES = 13;
const INITIAL_COMMITS = 300;
const LOAD_MORE_COMMITS = 300;

/** Lane palette (hues cycle when a graph needs more than ten lanes). */
const LANE_COLORS = [
	'#0085d9', '#d6009a', '#00d06c', '#d98500', '#8d41d9',
	'#e32b2b', '#00bebe', '#d9d900', '#7f8c8d', '#3dd93d'
];

// Simple inline icon paths (16×16, filled with currentColor)
const P_SEARCH = 'M9.309 10.016a5 5 0 1 1 .707-.707l3.837 3.837-.707.708-3.837-3.838zM6 10a4 4 0 1 0 0-8 4 4 0 0 0 0 8z';
const P_REFRESH = 'M13.5 2.5v4H9.3l1.84-1.84A4.5 4.5 0 1 0 12.5 8h1A5.5 5.5 0 1 1 11.85 3.94L13.5 2.29v.21z';
const P_TAG = 'M2 2v5.59L8.41 14 14 8.41 7.59 2H2zm1 1h4.17L12.59 8.41 8.41 12.59 3 7.17V3zm2.5 1A1.5 1.5 0 1 0 7 5.5 1.5 1.5 0 0 0 5.5 4z';
const P_CLOSE = 'M8 8.7l3.6 3.6.7-.7L8.7 8l3.6-3.6-.7-.7L8 7.3 4.4 3.7l-.7.7L7.3 8l-3.6 3.6.7.7L8 8.7z';
// Octicon (MIT) "stash" box, 14×16 view box
const P_STASH = 'M14 9l-1.13-7.14c-.08-.48-.5-.86-1-.86H2.13c-.5 0-.92.38-1 .86L0 9v5c0 .55.45 1 1 1h12c.55 0 1-.45 1-1V9zm-3.28.55l-.44.89c-.17.34-.52.56-.91.56H4.61c-.38 0-.72-.22-.89-.55l-.44-.91c-.17-.33-.52-.55-.89-.55H1l1-7h10l1 7h-1.38c-.39 0-.73.22-.91.55l.01.01z';
const P_CHEVRON_DOWN = 'M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z';
const P_CHEVRON_RIGHT = 'M5.7 13.7L5 13l5-5-5-5 .7-.7L11.4 8l-5.7 5.7z';
const P_ARROW_UP = 'M8 3l4 4-.7.7L8.5 4.9V13h-1V4.9L4.7 7.7 4 7l4-4z';
const P_ARROW_DOWN = 'M8 13L4 9l.7-.7 2.8 2.8V3h1v8.1l2.8-2.8.7.7-4 4z';
// Octicon-style glyphs (as used by the classic Git Graph file tree);
// non-square view boxes, hence the explicit dimensions
const P_FILE = 'M6 5H2V4h4v1zM2 8h7V7H2v1zm0 2h7V9H2v1zm0 2h7v-1H2v1zm10-7.5V14c0 .55-.45 1-1 1H1c-.55 0-1-.45-1-1V2c0-.55.45-1 1-1h7.5L12 4.5zM11 5L8 2H1v12h10V5z';
const P_FOLDER = 'M13 4H7V3c0-.66-.31-1-1-1H1c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1V5c0-.55-.45-1-1-1zM6 4H1V3h5v1z';

function svgIcon(path: string, size: number): string {
	return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 16 16" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="' + path + '"/></svg>';
}

/** Like svgIcon, but for glyphs with a non-16×16 view box (kept in aspect). */
function svgIconBox(path: string, vbWidth: number, vbHeight: number, size: number): string {
	return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + vbWidth + ' ' + vbHeight + '" fill="currentColor"><path fill-rule="evenodd" clip-rule="evenodd" d="' + path + '"/></svg>';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function pad2(n: number): string {
	return n < 10 ? '0' + n : String(n);
}

/** `d MMM yyyy HH:mm` */
function formatDate(unixSeconds: number): string {
	const d = new Date(unixSeconds * 1000);
	return d.getDate() + ' ' + MONTHS[d.getMonth()] + ' ' + d.getFullYear() + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
}

const STATUS_COLORS: { [status: string]: string } = {
	A: 'var(--vscode-gitDecoration-addedResourceForeground)',
	M: 'var(--vscode-gitDecoration-modifiedResourceForeground)',
	D: 'var(--vscode-gitDecoration-deletedResourceForeground)',
	R: 'var(--vscode-gitDecoration-renamedResourceForeground)',
	U: 'var(--vscode-gitDecoration-untrackedResourceForeground)'
};

/**
 * 64-bit content hash (FNV-1a + djb2) of the serialized load data. A
 * collision would merely skip one re-render until the data changes again.
 */
function dataSignature(json: string): string {
	let h1 = 0x811c9dc5, h2 = 5381;
	for (let i = 0; i < json.length; i++) {
		const c = json.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 0x01000193);
		h2 = Math.imul(h2, 33) ^ c;
	}
	return h1 + ':' + h2;
}

function el(tag: string, className?: string, text?: string): HTMLElement {
	const elem = document.createElement(tag);
	if (className !== undefined) elem.className = className;
	if (text !== undefined) elem.textContent = text;
	return elem;
}

interface Row {
	kind: 'uncommitted' | 'commit' | 'stash';
	hash: string;
	parents: string[];
	author: string;
	date: number;
	message: string;
	stash: GitStash | null;
}

export interface GraphViewOptions {
	/** The repositories selectable in the Repo dropdown (at least one). */
	repos: { path: string; name: string }[];
	openDiff: (repo: string, fromHash: string, toHash: string, oldPath: string, newPath: string, status: 'A' | 'M' | 'D' | 'R' | 'U') => Promise<void>;
}

export interface GraphView {
	readonly element: HTMLElement;
	refresh(): Promise<void>;
	dispose(): void;
}

export function createGraphView(opts: GraphViewOptions): GraphView {
	// --- Stylesheet (shared by all graph view instances, injected once) ---
	if (document.getElementById('ggvStyle') === null) {
		const style = document.createElement('style');
		style.id = 'ggvStyle';
		style.textContent = GRAPH_CSS;
		document.head.appendChild(style);
	}

	// --- State ---
	let disposed = false;
	let loadSeq = 0;
	// Signature (64-bit hash) of the last loaded data: auto-refreshes with
	// identical git state skip the re-render (otherwise an expanded details
	// panel would visibly flicker on every background refresh). A hash keeps
	// memory flat — no retained JSON snapshot of the commit list.
	let lastSignature = '';
	let repoIndex = 0; // Active entry in opts.repos (the Repo dropdown)
	const repoPath = () => opts.repos[repoIndex].path;
	let commitCount = INITIAL_COMMITS;
	let branchFilter: string[] | null = null; // null → Show All
	let showRemotes = true;
	let rows: Row[] = [];
	let layout: RowLayout[] = [];
	let refsByHash = new Map<string, GitRef[]>();
	let branchNames: { local: string[], remote: string[] } = { local: [], remote: [] };
	let headHash: string | null = null;
	let headBranch: string | null = null;
	let uncChanges: GitFileChange[] = [];
	let hasMore = false;
	let expandedKey: string | null = null; // Row hash (UNCOMMITTED for the uncommitted row)
	let rowElems: HTMLTableRowElement[] = [];
	let detailsElem: HTMLTableRowElement | null = null;
	let findMatches: number[] = [];
	let findCurrent = -1;
	let svgElem: SVGSVGElement | null = null;
	let graphColWidth = 0;
	// User-adjustable column widths (graph: null → lane-count default)
	const colWidths: { graph: number | null; date: number; author: number; commit: number } = {
		graph: null, date: 105, author: 100, commit: 76
	};

	/** Re-draw the SVG, splitting it around the open details panel. */
	function updateSvg() {
		if (svgElem === null) return;
		let splitIndex = -1, splitOffset = 0;
		if (detailsElem !== null && expandedKey !== null) {
			splitIndex = rows.findIndex((row) => row.hash === expandedKey);
			splitOffset = detailsElem.offsetHeight;
		}
		const next = buildSvg(graphColWidth, splitIndex, splitOffset);
		svgElem.replaceWith(next);
		svgElem = next;
	}

	// Tracks the details panel's height (it loads asynchronously and its
	// file tree can change height) so the graph below stays aligned.
	const detailsResize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => updateSvg()) : null;

	// --- Static DOM ---
	const root = el('div', 'ggvRoot');
	root.tabIndex = -1;
	root.style.outline = 'none';

	const controls = el('div', 'ggvControls');
	const controlsCenter = el('div', 'ggvControlsCenter');
	controlsCenter.appendChild(el('span', 'ggvControlLabel', 'Repo:'));
	const repoBtn = el('div', 'ggvDropdownBtn');
	const repoBtnLabel = el('span', undefined, opts.repos[0].name);
	repoBtn.appendChild(repoBtnLabel);
	controlsCenter.appendChild(repoBtn);
	controlsCenter.appendChild(el('span', 'ggvControlLabel', 'Branches:'));
	const branchBtn = el('div', 'ggvDropdownBtn');
	const branchBtnLabel = el('span', undefined, 'Show All');
	branchBtn.appendChild(branchBtnLabel);
	controlsCenter.appendChild(branchBtn);
	// Git Graph order: checkbox first, then the label text (no colon)
	const remoteToggle = el('label', 'ggvRemoteToggle');
	const remoteCheck = <HTMLInputElement>document.createElement('input');
	remoteCheck.type = 'checkbox';
	remoteCheck.checked = true;
	remoteToggle.appendChild(remoteCheck);
	remoteToggle.appendChild(el('span', 'ggvCheckBox'));
	remoteToggle.appendChild(document.createTextNode('Show Remote Branches'));
	controlsCenter.appendChild(remoteToggle);
	controls.appendChild(controlsCenter);
	const controlsIcons = el('div', 'ggvControlsIcons');
	const findBtn = el('div', 'ggvIconBtn');
	findBtn.title = 'Find';
	findBtn.innerHTML = svgIcon(P_SEARCH, 16);
	controlsIcons.appendChild(findBtn);
	const refreshBtn = el('div', 'ggvIconBtn');
	refreshBtn.title = 'Refresh';
	refreshBtn.innerHTML = svgIcon(P_REFRESH, 16);
	controlsIcons.appendChild(refreshBtn);
	controls.appendChild(controlsIcons);
	root.appendChild(controls);

	const scroll = el('div', 'ggvScroll');
	root.appendChild(scroll);

	// Find widget
	const findWidget = el('div', 'ggvFind');
	const findInput = <HTMLInputElement>document.createElement('input');
	findInput.className = 'ggvFindInput';
	findInput.placeholder = 'Find';
	findInput.spellcheck = false;
	findWidget.appendChild(findInput);
	const findCount = el('span', 'ggvFindCount', 'No Results');
	findWidget.appendChild(findCount);
	const findPrev = el('div', 'ggvIconBtn');
	findPrev.title = 'Previous match';
	findPrev.innerHTML = svgIcon(P_ARROW_UP, 14);
	findWidget.appendChild(findPrev);
	const findNext = el('div', 'ggvIconBtn');
	findNext.title = 'Next match';
	findNext.innerHTML = svgIcon(P_ARROW_DOWN, 14);
	findWidget.appendChild(findNext);
	const findClose = el('div', 'ggvIconBtn');
	findClose.title = 'Close';
	findClose.innerHTML = svgIcon(P_CLOSE, 14);
	findWidget.appendChild(findClose);
	root.appendChild(findWidget);

	// --- Dropdown menus ---
	let openMenu: HTMLElement | null = null;
	let openMenuAnchor: HTMLElement | null = null;

	function closeMenu() {
		if (openMenu !== null) {
			openMenu.remove();
			openMenu = null;
		}
		if (openMenuAnchor !== null) {
			openMenuAnchor.classList.remove('ggvOpen');
			openMenuAnchor = null;
		}
	}

	function showMenu(anchor: HTMLElement, build: (menu: HTMLElement) => void) {
		closeMenu();
		const menu = el('div', 'ggvDropdownMenu');
		// Attached flush below the button and exactly as wide, so the button
		// and options read as one control (like Git Graph's dropdowns)
		menu.style.left = anchor.offsetLeft + 'px';
		menu.style.top = (anchor.offsetTop + anchor.offsetHeight - 1) + 'px';
		menu.style.width = anchor.offsetWidth + 'px';
		build(menu);
		root.appendChild(menu);
		openMenu = menu;
		openMenuAnchor = anchor;
		anchor.classList.add('ggvOpen');
	}

	function menuItem(menu: HTMLElement, label: string, checked: boolean, multi: boolean, onClick: () => void): HTMLElement {
		const item = el('div', multi ? 'ggvDropdownItem ggvMulti' : 'ggvDropdownItem', label);
		item.title = label;
		if (checked) {
			item.classList.add('ggvSelected');
			if (multi) item.appendChild(el('div', 'ggvCheck', '✓'));
		}
		item.addEventListener('click', onClick);
		menu.appendChild(item);
		return item;
	}

	// Pre-size a dropdown button to fit its widest option (min 138px), so the
	// button and its attached menu share the same width, like Git Graph.
	function sizeDropdownBtn(btn: HTMLElement, names: string[], multi: boolean) {
		const probe = el('div', 'ggvDropdownMenu');
		probe.style.cssText = 'visibility:hidden;left:0;top:0;';
		for (const name of names) probe.appendChild(el('div', multi ? 'ggvDropdownItem ggvMulti' : 'ggvDropdownItem', name));
		root.appendChild(probe);
		const width = Math.ceil(probe.getBoundingClientRect().width) + (names.length > 9 ? 12 : 0);
		probe.remove();
		btn.style.width = Math.max(width, 138) + 'px';
	}

	const onDocMouseDown = (e: MouseEvent) => {
		if (openMenu !== null && !openMenu.contains(<Node>e.target)
			&& !branchBtn.contains(<Node>e.target) && !repoBtn.contains(<Node>e.target)) {
			closeMenu();
		}
	};
	document.addEventListener('mousedown', onDocMouseDown, true);

	repoBtn.addEventListener('click', () => {
		if (openMenu !== null) { closeMenu(); return; }
		showMenu(repoBtn, (menu) => {
			opts.repos.forEach((entry, index) => {
				menuItem(menu, entry.name, index === repoIndex, false, () => {
					closeMenu();
					if (index === repoIndex) return;
					// Switch repository: reset per-repo state, then reload
					repoIndex = index;
					repoBtnLabel.textContent = entry.name;
					repoBtn.title = entry.name;
					branchFilter = null;
					branchBtnLabel.textContent = 'Show All';
					branchBtn.title = 'Show All';
					commitCount = INITIAL_COMMITS;
					expandedKey = null;
					refresh();
				});
			});
		});
	});

	function branchFilterLabel(): string {
		return branchFilter === null ? 'Show All' : branchFilter.join(', ');
	}

	function toggleBranch(name: string | null) {
		if (name === null) {
			branchFilter = null;
		} else if (branchFilter === null) {
			branchFilter = [name];
		} else {
			const index = branchFilter.indexOf(name);
			if (index > -1) branchFilter.splice(index, 1);
			else branchFilter.push(name);
			if (branchFilter.length === 0) branchFilter = null;
		}
		branchBtnLabel.textContent = branchFilterLabel();
		branchBtn.title = branchFilterLabel();
		refresh();
	}

	// Flat options list ("Show All" + every branch, no group dividers) under a
	// filter input, like Git Graph's branches dropdown.
	function buildBranchMenu(menu: HTMLElement) {
		const filter = el('div', 'ggvDropdownFilter');
		const filterInput = <HTMLInputElement>document.createElement('input');
		filterInput.className = 'ggvDropdownFilterInput';
		filterInput.placeholder = 'Filter Branches...';
		filterInput.spellcheck = false;
		filter.appendChild(filterInput);
		menu.appendChild(filter);
		const options = el('div');
		menu.appendChild(options);
		const noResults = el('div', 'ggvDropdownNoResults', 'No results found.');
		noResults.style.display = 'none';
		menu.appendChild(noResults);

		const names: (string | null)[] = [null, ...branchNames.local, ...showRemotes ? branchNames.remote : []];
		const renderOptions = () => {
			options.textContent = '';
			const query = filterInput.value.toLowerCase();
			let matches = 0;
			for (const name of names) {
				const label = name === null ? 'Show All' : name;
				if (label.toLowerCase().indexOf(query) === -1) continue;
				matches++;
				const checked = name === null ? branchFilter === null : branchFilter !== null && branchFilter.indexOf(name) > -1;
				menuItem(options, label, checked, true, () => {
					toggleBranch(name);
					renderOptions();
				});
			}
			noResults.style.display = matches === 0 ? '' : 'none';
		};
		filterInput.addEventListener('input', renderOptions);
		renderOptions();
		setTimeout(() => filterInput.focus(), 0);
	}

	branchBtn.addEventListener('click', () => {
		if (openMenu !== null) { closeMenu(); return; }
		showMenu(branchBtn, buildBranchMenu);
	});

	remoteCheck.addEventListener('change', () => {
		showRemotes = remoteCheck.checked;
		refresh();
	});

	// --- Data loading ---
	/** Returns false when the loaded data is identical to the current view. */
	async function load(): Promise<boolean> {
		const seq = ++loadSeq;
		const [refsData, stashes, unc, commits] = await Promise.all([
			getRefs(repoPath()),
			getStashes(repoPath()),
			getUncommittedChanges(repoPath()),
			getCommits(repoPath(), branchFilter, commitCount, showRemotes)
		]);
		if (disposed || seq !== loadSeq) return false;

		// View options are part of the signature so user-driven refreshes
		// (repo/branch/remotes changes) always render even with equal data.
		const signature = dataSignature(JSON.stringify([repoPath(), branchFilter, showRemotes, commitCount, refsData, stashes, unc, commits]));
		if (signature === lastSignature) return false;
		lastSignature = signature;

		headHash = refsData.headHash;
		headBranch = refsData.headBranch;
		uncChanges = unc;
		refsByHash = new Map();
		branchNames = { local: [], remote: [] };
		for (const ref of refsData.refs) {
			const list = refsByHash.get(ref.hash);
			if (list !== undefined) list.push(ref);
			else refsByHash.set(ref.hash, [ref]);
			if (ref.type === 'head') branchNames.local.push(ref.name);
			else if (ref.type === 'remote') branchNames.remote.push(ref.name);
		}
		sizeDropdownBtn(repoBtn, opts.repos.map((r) => r.name), false);
		sizeDropdownBtn(branchBtn, ['Show All', ...branchNames.local, ...showRemotes ? branchNames.remote : []], true);

		hasMore = commits.length >= commitCount;
		const commitSet = new Set<string>();
		for (const commit of commits) commitSet.add(commit.hash);

		const newRows: Row[] = commits.map((commit): Row => ({
			kind: 'commit',
			hash: commit.hash,
			parents: commit.parents,
			author: commit.author,
			date: commit.date,
			message: commit.message,
			stash: null
		}));

		// Stash rows: inserted in date order, above their base commit
		for (const stash of stashes) {
			if (!commitSet.has(stash.baseHash) || commitSet.has(stash.hash)) continue;
			let index = newRows.findIndex((row) => row.date <= stash.date);
			if (index === -1) index = newRows.length;
			const baseIndex = newRows.findIndex((row) => row.hash === stash.baseHash);
			if (baseIndex > -1 && baseIndex < index) index = baseIndex;
			newRows.splice(index, 0, {
				kind: 'stash',
				hash: stash.hash,
				parents: [stash.baseHash],
				author: '',
				date: stash.date,
				message: stash.message,
				stash: stash
			});
			commitSet.add(stash.hash);
		}

		// Uncommitted Changes row (synthetic head row on top of HEAD)
		if (unc.length > 0 && headHash !== null && commitSet.has(headHash)) {
			newRows.unshift({
				kind: 'uncommitted',
				hash: UNCOMMITTED,
				parents: [headHash],
				author: '',
				date: Math.floor(Date.now() / 1000),
				message: 'Uncommitted Changes (' + unc.length + ')',
				stash: null
			});
		}

		rows = newRows;
		layout = assignLanes(rows);
		return true;
	}

	// --- Rendering ---
	function laneX(lane: number): number {
		return LANE_LEFT + Math.min(lane, MAX_LANES - 1) * LANE_WIDTH;
	}

	/**
	 * Draw the whole graph as one SVG spanning every row. When the inline
	 * details panel is open below row `splitIndex`, everything underneath is
	 * shifted down by `splitOffset` (the panel's height) so the lanes stay
	 * aligned with the shifted table rows.
	 */
	function buildSvg(graphWidth: number, splitIndex: number, splitOffset: number): SVGSVGElement {
		const rowY = (i: number) => i * ROW_HEIGHT + ROW_HEIGHT / 2
			+ (splitIndex > -1 && i > splitIndex ? splitOffset : 0);
		const svgNS = 'http://www.w3.org/2000/svg';
		const svg = <SVGSVGElement>document.createElementNS(svgNS, 'svg');
		svg.setAttribute('class', 'ggvSvg');
		svg.setAttribute('width', String(graphWidth));
		svg.setAttribute('height', String(rows.length * ROW_HEIGHT + splitOffset));
		svg.style.top = HEADER_HEIGHT + 'px';

		// The line from the uncommitted row down to HEAD is grey, not the lane
		// color: it is that lane's color until HEAD's row is reached.
		const uncIndex = rows.length > 0 && rows[0].kind === 'uncommitted' ? 0 : -1;
		const headIndex = headHash !== null ? rows.findIndex((r) => r.hash === headHash) : -1;

		// S-bend over one row height, control points 0.8 of a row from each end
		const curveD = ROW_HEIGHT * 0.8;
		const bend = (xa: number, ya: number, xb: number, yb: number) =>
			' C ' + xa + ' ' + (ya + curveD) + ', ' + xb + ' ' + (yb - curveD) + ', ' + xb + ' ' + yb;

		// Edges first, vertices on top
		for (let i = 0; i < layout.length; i++) {
			const y1 = rowY(i);
			const y2 = rowY(i + 1);
			for (const edge of layout[i].edges) {
				const x1 = laneX(edge.fromLane), x2 = laneX(edge.toLane);
				// Bends always span one row height; when the details panel is
				// open between these rows, the straight run through it is
				// below the bend (lockedFirst) or above it.
				let d = 'M ' + x1 + ' ' + y1;
				if (x1 === x2) {
					d += ' V ' + y2;
				} else if (i !== splitIndex) {
					d += bend(x1, y1, x2, y2);
				} else if (edge.lockedFirst) {
					d += bend(x1, y1, x2, y1 + ROW_HEIGHT) + ' V ' + y2;
				} else {
					d += ' V ' + (y2 - ROW_HEIGHT) + bend(x1, y2 - ROW_HEIGHT, x2, y2);
				}
				// A wide editor-background "shadow" under each line keeps
				// crossing lines visually separated.
				const shadow = document.createElementNS(svgNS, 'path');
				shadow.setAttribute('d', d);
				shadow.setAttribute('fill', 'none');
				shadow.setAttribute('stroke', 'var(--vscode-editor-background)');
				shadow.setAttribute('stroke-width', '4');
				shadow.setAttribute('stroke-opacity', '0.75');
				svg.appendChild(shadow);
				const path = document.createElementNS(svgNS, 'path');
				path.setAttribute('d', d);
				path.setAttribute('fill', 'none');
				const uncommittedLine = uncIndex > -1 && i >= uncIndex
					&& (headIndex === -1 || i < headIndex)
					&& edge.color === layout[uncIndex].color;
				path.setAttribute('stroke', uncommittedLine ? '#808080' : LANE_COLORS[edge.color % LANE_COLORS.length]);
				path.setAttribute('stroke-width', '2');
				svg.appendChild(path);
			}
		}
		for (let i = 0; i < layout.length; i++) {
			const row = rows[i];
			const cx = String(laneX(layout[i].lane)), cy = String(rowY(i));
			const color = row.kind === 'uncommitted' ? '#808080' : LANE_COLORS[layout[i].color % LANE_COLORS.length];
			// The "current" open circle sits on the uncommitted row when there
			// is one, otherwise on the checked-out commit.
			const isCurrent = uncIndex > -1 ? i === uncIndex : row.hash === headHash;
			const circle = document.createElementNS(svgNS, 'circle');
			circle.setAttribute('cx', cx);
			circle.setAttribute('cy', cy);
			if (isCurrent) {
				circle.setAttribute('r', '4');
				circle.setAttribute('fill', 'var(--vscode-editor-background)');
				circle.setAttribute('stroke', color);
				circle.setAttribute('stroke-width', '2');
			} else {
				circle.setAttribute('r', row.kind === 'stash' ? '4.5' : '4');
				circle.setAttribute('fill', color);
				// Subtle background outline separating the dot from lines
				circle.setAttribute('stroke', 'var(--vscode-editor-background)');
				circle.setAttribute('stroke-width', '1');
				circle.setAttribute('stroke-opacity', '0.75');
			}
			svg.appendChild(circle);
			if (row.kind === 'stash' && !isCurrent) {
				const inner = document.createElementNS(svgNS, 'circle');
				inner.setAttribute('cx', cx);
				inner.setAttribute('cy', cy);
				inner.setAttribute('r', '2');
				inner.setAttribute('fill', 'none');
				inner.setAttribute('stroke', 'var(--vscode-editor-background)');
				inner.setAttribute('stroke-width', '1');
				svg.appendChild(inner);
			}
		}
		return svg;
	}

	// Git Graph-style chip: grey pill with a lane-coloured icon block on the
	// left (glyph punched out in the editor background); only the current
	// branch gets a lane-coloured border and bold name.
	function refChip(text: string, iconHtml: string, color: string, isCurrentBranch: boolean): HTMLElement {
		const chip = el('span', 'ggvChip' + (isCurrentBranch ? ' ggvChipHead' : ''));
		if (isCurrentBranch) chip.style.borderColor = color;
		const icon = el('span', 'ggvChipIcon');
		icon.style.backgroundColor = color;
		icon.innerHTML = iconHtml;
		chip.appendChild(icon);
		const name = el('span', 'ggvChipName', text);
		name.title = text;
		chip.appendChild(name);
		return chip;
	}

	function buildDescriptionCell(cell: HTMLElement, row: Row, color: string) {
		if (row.kind === 'uncommitted') {
			cell.appendChild(el('span', 'ggvUncommitted', row.message));
			return;
		}
		// Hollow lane-coloured ring marking the checked-out commit
		if (row.hash === headHash) {
			const dot = el('span', 'ggvHeadDot');
			dot.style.borderColor = color;
			dot.title = headBranch !== null
				? 'The branch "' + headBranch + '" is currently checked out at this commit.'
				: 'This commit is currently checked out.';
			cell.appendChild(dot);
		}
		// Stash chip first, labelled with the full selector (e.g. "stash@{0}")
		if (row.kind === 'stash' && row.stash !== null) {
			cell.appendChild(refChip(row.stash.selector, svgIconBox(P_STASH, 14, 16, 14), color, false));
		}
		const refs = refsByHash.get(row.hash);
		if (refs !== undefined) {
			// Checked-out branch leftmost, next to the dot
			const heads = refs.filter((r) => r.type === 'head');
			heads.sort((a, b) => (a.name === headBranch ? 0 : 1) - (b.name === headBranch ? 0 : 1));
			// A remote branch that shares a local branch's name is shown as a
			// segment of the local chip (e.g. [main | origin]), not on its own
			const combined = new Map<string, string[]>();
			const standalone: typeof refs = [];
			if (showRemotes) {
				for (const ref of refs.filter((r) => r.type === 'remote')) {
					const slash = ref.name.indexOf('/');
					const branch = slash > -1 ? ref.name.substring(slash + 1) : ref.name;
					if (slash > -1 && heads.some((h) => h.name === branch)) {
						const remote = ref.name.substring(0, slash);
						const list = combined.get(branch);
						if (list !== undefined) list.push(remote);
						else combined.set(branch, [remote]);
					} else {
						standalone.push(ref);
					}
				}
			}
			for (const ref of heads) {
				const chip = refChip(ref.name, iconSvg(ICON_GIT_BRANCH, 14), color, ref.name === headBranch);
				const remotes = combined.get(ref.name);
				if (remotes !== undefined) {
					for (const remote of remotes) {
						const seg = el('span', 'ggvChipRemote', remote);
						seg.title = remote + '/' + ref.name;
						chip.appendChild(seg);
					}
				}
				cell.appendChild(chip);
			}
			for (const ref of standalone) {
				cell.appendChild(refChip(ref.name, iconSvg(ICON_GIT_BRANCH, 14), color, false));
			}
			for (const ref of refs.filter((r) => r.type === 'tag')) {
				cell.appendChild(refChip(ref.name, svgIcon(P_TAG, 14), color, false));
			}
		}
		cell.appendChild(document.createTextNode(row.message));
		cell.title = row.message;
	}

	/** The graph column's current width (user override or lane-count default). */
	function graphColPx(): number {
		return colWidths.graph !== null ? colWidths.graph : graphColWidth + 24;
	}

	/**
	 * A drag handle on the right edge of header cell `boundary`. Description
	 * is elastic (auto width), so each boundary maps onto one fixed column:
	 * Graph|Description resizes Graph, while boundaries to the right of
	 * Description resize the fixed column on their right with an inverted
	 * delta — either way the divider follows the mouse.
	 */
	function colResizeHandle(boundary: number, cols: HTMLTableColElement[]): HTMLElement {
		const handle = el('div', 'ggvColResize');
		handle.addEventListener('mousedown', (e) => {
			e.preventDefault();
			e.stopPropagation();
			const startX = e.clientX;
			const colIndex = boundary === 0 ? 0 : boundary + 1;
			const sign = boundary === 0 ? 1 : -1;
			const startWidth = boundary === 0
				? graphColPx()
				: boundary === 1 ? colWidths.date
					: boundary === 2 ? colWidths.author : colWidths.commit;
			handle.classList.add('ggvResizing');
			document.body.style.cursor = 'col-resize';
			const onMove = (ev: MouseEvent) => {
				const width = Math.max(32, startWidth + sign * (ev.clientX - startX));
				if (boundary === 0) colWidths.graph = width;
				else if (boundary === 1) colWidths.date = width;
				else if (boundary === 2) colWidths.author = width;
				else colWidths.commit = width;
				cols[colIndex].style.width = width + 'px';
				// Keep the open details panel aligned with the Description column
				if (boundary === 0 && detailsElem !== null) {
					const panel = <HTMLElement | null>detailsElem.querySelector('.ggvDetails');
					if (panel !== null) panel.style.marginLeft = width + 'px';
				}
			};
			const onUp = () => {
				handle.classList.remove('ggvResizing');
				document.body.style.cursor = '';
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
			};
			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
		return handle;
	}

	function render() {
		const scrollTop = scroll.scrollTop;
		// Open dropdowns survive a re-render: they are anchored to the
		// controls bar (not rebuilt here), and auto-refreshes would otherwise
		// snatch the menu away from under the user's cursor.
		if (detailsResize !== null) detailsResize.disconnect();
		detailsElem = null;
		svgElem = null;
		rowElems = [];
		scroll.textContent = '';

		if (rows.length === 0) {
			scroll.appendChild(el('div', 'ggvMessage', 'There are no commits to display.'));
			return;
		}

		let maxLanes = 1;
		for (const rowLayout of layout) {
			maxLanes = Math.max(maxLanes, rowLayout.lane + 1, rowLayout.laneCount);
			for (const edge of rowLayout.edges) {
				maxLanes = Math.max(maxLanes, edge.fromLane + 1, edge.toLane + 1);
			}
		}
		const graphWidth = laneX(maxLanes - 1) + LANE_LEFT;
		graphColWidth = graphWidth;

		const table = el('table', 'ggvTable');
		const colgroup = document.createElement('colgroup');
		const cols: HTMLTableColElement[] = [];
		const widths = [
			graphColPx() + 'px',
			'', // Description is elastic: it absorbs the remaining width
			colWidths.date + 'px',
			colWidths.author + 'px',
			colWidths.commit + 'px'
		];
		for (const width of widths) {
			const col = document.createElement('col');
			if (width !== '') col.style.width = width;
			colgroup.appendChild(col);
			cols.push(col);
		}
		table.appendChild(colgroup);

		const thead = document.createElement('thead');
		const headRow = document.createElement('tr');
		const headerNames = ['Graph', 'Description', 'Date', 'Author', 'Commit'];
		for (let i = 0; i < headerNames.length; i++) {
			const th = el('th', undefined, headerNames[i]);
			if (i < headerNames.length - 1) th.appendChild(colResizeHandle(i, cols));
			headRow.appendChild(th);
		}
		thead.appendChild(headRow);
		table.appendChild(thead);

		const tbody = document.createElement('tbody');
		for (let i = 0; i < rows.length; i++) {
			const row = rows[i];
			const color = LANE_COLORS[layout[i].color % LANE_COLORS.length];
			const tr = document.createElement('tr');
			tr.className = 'ggvRow';
			tr.appendChild(el('td')); // Graph column (SVG overlays it)
			const descCell = el('td');
			buildDescriptionCell(descCell, row, color);
			tr.appendChild(descCell);
			tr.appendChild(el('td', 'ggvMuted', row.kind === 'uncommitted' ? '*' : formatDate(row.date)));
			tr.appendChild(el('td', 'ggvMuted', row.author));
			tr.appendChild(el('td', 'ggvMuted ggvHash', row.kind === 'uncommitted' ? '*' : abbrev(row.hash)));
			tr.addEventListener('click', () => toggleDetails(i));
			tbody.appendChild(tr);
			rowElems.push(tr);
		}
		if (hasMore) {
			const tr = document.createElement('tr');
			const td = document.createElement('td');
			td.colSpan = 5;
			const btn = el('button', 'ggvLoadMore', 'Load More Commits');
			btn.addEventListener('click', () => {
				commitCount += LOAD_MORE_COMMITS;
				refresh();
			});
			td.appendChild(btn);
			tr.appendChild(td);
			tbody.appendChild(tr);
		}
		table.appendChild(tbody);

		scroll.appendChild(table);
		svgElem = buildSvg(graphWidth, -1, 0);
		scroll.appendChild(svgElem);
		scroll.scrollTop = scrollTop;

		// Restore transient view state across refreshes
		if (expandedKey !== null) {
			const index = rows.findIndex((row) => row.hash === expandedKey);
			if (index > -1) expandDetails(index);
			else expandedKey = null;
		}
		if (findWidget.classList.contains('ggvFindOpen')) runFind(false);
	}

	function showError(error: unknown) {
		detailsElem = null;
		svgElem = null;
		rowElems = [];
		scroll.textContent = '';
		scroll.appendChild(el('div', 'ggvMessage', 'Unable to load the Git repository: '
			+ (error instanceof Error ? error.message : String(error))));
	}

	// --- Commit details panel ---
	function collapseDetails() {
		if (detailsElem !== null) {
			if (detailsResize !== null) detailsResize.disconnect();
			detailsElem.remove();
			detailsElem = null;
		}
		if (expandedKey !== null) {
			const index = rows.findIndex((row) => row.hash === expandedKey);
			if (index > -1 && rowElems[index] !== undefined) rowElems[index].classList.remove('ggvExpanded');
			expandedKey = null;
		}
		updateSvg();
	}

	function toggleDetails(index: number) {
		const wasExpanded = expandedKey === rows[index].hash;
		collapseDetails();
		if (!wasExpanded) expandDetails(index);
	}

	function expandDetails(index: number) {
		const row = rows[index];
		expandedKey = row.hash;
		const tr = rowElems[index];
		tr.classList.add('ggvExpanded');

		detailsElem = document.createElement('tr');
		const td = document.createElement('td');
		td.className = 'ggvDetailsCell';
		td.colSpan = 5;
		const panel = el('div', 'ggvDetails');
		// Indent past the graph column so the panel lines up with Description
		// (the lane lines continue through the gutter this leaves open)
		panel.style.marginLeft = graphColPx() + 'px';
		panel.appendChild(el('div', 'ggvDetailsLeft', 'Loading…'));
		td.appendChild(panel);
		detailsElem.appendChild(td);
		tr.insertAdjacentElement('afterend', detailsElem);
		if (detailsResize !== null) detailsResize.observe(td);
		updateSvg();

		const key = expandedKey;
		loadDetails(row, panel).catch((error) => {
			if (!disposed && expandedKey === key) {
				panel.textContent = '';
				panel.appendChild(el('div', 'ggvDetailsLeft', 'Unable to load the commit details: '
					+ (error instanceof Error ? error.message : String(error))));
			}
		});
	}

	function detailsField(parent: HTMLElement, label: string, value: string, mono: boolean): HTMLElement {
		const field = el('div', 'ggvDetailsField');
		field.appendChild(el('b', undefined, label + ': '));
		field.appendChild(el('span', mono ? 'ggvHash' : undefined, value));
		parent.appendChild(field);
		return field;
	}

	function scrollToCommit(hash: string) {
		const index = rows.findIndex((row) => row.hash === hash);
		if (index > -1 && rowElems[index] !== undefined) {
			rowElems[index].scrollIntoView({ block: 'center' });
			toggleDetails(index);
		}
	}

	async function loadDetails(row: Row, panel: HTMLElement): Promise<void> {
		const key = row.hash;
		let changes: GitFileChange[];
		const left = el('div', 'ggvDetailsLeft');

		if (row.kind === 'uncommitted') {
			changes = uncChanges;
			detailsField(left, 'Uncommitted Changes', changes.length + (changes.length === 1 ? ' file' : ' files')
				+ ' changed since the last commit', false);
			if (headHash !== null) detailsField(left, 'HEAD', abbrev(headHash), true);
		} else {
			const [body, commitChanges] = await Promise.all([
				getCommitBody(repoPath(), row.hash),
				getCommitChanges(repoPath(), row.hash)
			]);
			if (disposed || expandedKey !== key) return;
			changes = commitChanges;
			if (row.kind === 'stash' && row.stash !== null) {
				detailsField(left, 'Stash', row.stash.selector, false);
			}
			detailsField(left, 'Commit', row.hash, true);
			if (body.parents.length > 0) {
				const field = el('div', 'ggvDetailsField');
				field.appendChild(el('b', undefined, 'Parents: '));
				body.parents.forEach((parent, index) => {
					if (index > 0) field.appendChild(document.createTextNode(', '));
					const link = el('span', 'ggvParentLink ggvHash', abbrev(parent));
					link.title = parent;
					link.addEventListener('click', (e) => {
						e.stopPropagation();
						scrollToCommit(parent);
					});
					field.appendChild(link);
				});
				left.appendChild(field);
			}
			detailsField(left, 'Author', body.author + ' <' + body.email + '>', false);
			detailsField(left, 'Date', formatDate(body.date), false);
			if (body.committer !== '' && body.committer !== body.author) {
				detailsField(left, 'Committer', body.committer, false);
			}
			left.appendChild(el('div', 'ggvDetailsBody', body.body));
		}

		const right = el('div', 'ggvDetailsRight');
		right.appendChild(buildFileTree(row, changes));

		panel.textContent = '';
		panel.appendChild(left);
		panel.appendChild(right);
	}

	// --- Changed-file tree ---
	interface DirNode {
		dirs: Map<string, DirNode>;
		files: GitFileChange[];
	}

	function buildFileTree(row: Row, changes: GitFileChange[]): HTMLElement {
		const rootNode: DirNode = { dirs: new Map(), files: [] };
		for (const change of changes) {
			const parts = change.newPath.split('/');
			let node = rootNode;
			for (let i = 0; i < parts.length - 1; i++) {
				let child = node.dirs.get(parts[i]);
				if (child === undefined) {
					child = { dirs: new Map(), files: [] };
					node.dirs.set(parts[i], child);
				}
				node = child;
			}
			node.files.push(change);
		}
		const container = document.createElement('div');
		if (changes.length === 0) {
			container.appendChild(el('div', 'ggvMessage', 'No file changes.'));
			return container;
		}
		renderDirNode(container, rootNode, row, 0);
		return container;
	}

	function renderDirNode(parent: HTMLElement, node: DirNode, row: Row, depth: number) {
		const dirNames = Array.from(node.dirs.keys()).sort();
		for (const dirName of dirNames) {
			const dirRow = el('div', 'ggvFileRow');
			dirRow.style.paddingLeft = (depth * 12 + 4) + 'px';
			const chevron = el('span', 'ggvFileChevron');
			chevron.innerHTML = svgIcon(P_CHEVRON_DOWN, 14);
			dirRow.appendChild(chevron);
			const dirIcon = el('span', 'ggvFileIcon');
			dirIcon.innerHTML = svgIconBox(P_FOLDER, 14, 16, 14);
			dirRow.appendChild(dirIcon);
			dirRow.appendChild(el('span', 'ggvFileName', dirName));
			parent.appendChild(dirRow);
			const children = document.createElement('div');
			renderDirNode(children, node.dirs.get(dirName)!, row, depth + 1);
			parent.appendChild(children);
			let expanded = true;
			dirRow.addEventListener('click', () => {
				expanded = !expanded;
				children.style.display = expanded ? '' : 'none';
				chevron.innerHTML = svgIcon(expanded ? P_CHEVRON_DOWN : P_CHEVRON_RIGHT, 14);
			});
		}
		const files = node.files.slice().sort((a, b) => a.newPath < b.newPath ? -1 : 1);
		for (const change of files) {
			const name = change.newPath.substring(change.newPath.lastIndexOf('/') + 1);
			const fileRow = el('div', 'ggvFileRow');
			fileRow.style.paddingLeft = (depth * 12 + 20) + 'px';
			const fileIcon = el('span', 'ggvFileIcon');
			fileIcon.innerHTML = svgIconBox(P_FILE, 12, 16, 14);
			fileRow.appendChild(fileIcon);
			const nameElem = el('span', 'ggvFileName', name);
			nameElem.title = change.newPath;
			nameElem.style.color = STATUS_COLORS[change.status];
			fileRow.appendChild(nameElem);
			// Line counts right next to the name: (+added | -deleted)
			if ((change.status === 'M' || change.status === 'R')
				&& change.additions !== null && change.deletions !== null) {
				const stats = el('span', 'ggvFileStats');
				stats.appendChild(document.createTextNode('('));
				stats.appendChild(el('span', 'ggvStatAdd', '+' + change.additions));
				stats.appendChild(document.createTextNode(' | '));
				stats.appendChild(el('span', 'ggvStatDel', '-' + change.deletions));
				stats.appendChild(document.createTextNode(')'));
				fileRow.appendChild(stats);
			}
			if (change.status === 'R') {
				fileRow.appendChild(el('span', 'ggvFileOld', '← ' + change.oldPath));
			}
			fileRow.addEventListener('click', () => {
				const hash = row.kind === 'uncommitted' ? UNCOMMITTED : row.hash;
				opts.openDiff(repoPath(), hash, hash, change.oldPath, change.newPath, change.status).catch(() => { });
			});
			parent.appendChild(fileRow);
		}
	}

	// --- Find ---
	function applyFind(scrollToCurrent: boolean) {
		const matchSet = new Set<number>(findMatches);
		for (let i = 0; i < rowElems.length; i++) {
			rowElems[i].classList.toggle('ggvFindMatch', matchSet.has(i));
			rowElems[i].classList.remove('ggvFindCurrent');
		}
		if (findCurrent > -1 && findCurrent < findMatches.length) {
			const tr = rowElems[findMatches[findCurrent]];
			tr.classList.add('ggvFindCurrent');
			if (scrollToCurrent) tr.scrollIntoView({ block: 'nearest' });
			findCount.textContent = (findCurrent + 1) + ' of ' + findMatches.length;
		} else {
			findCount.textContent = findInput.value === '' ? '' : 'No Results';
		}
	}

	function runFind(scrollToCurrent: boolean) {
		const query = findInput.value.toLowerCase();
		findMatches = [];
		if (query !== '') {
			for (let i = 0; i < rows.length; i++) {
				const row = rows[i];
				const refs = refsByHash.get(row.hash);
				if (row.message.toLowerCase().indexOf(query) > -1
					|| row.author.toLowerCase().indexOf(query) > -1
					|| row.hash.toLowerCase().startsWith(query)
					|| (refs !== undefined && refs.some((ref) => ref.name.toLowerCase().indexOf(query) > -1))) {
					findMatches.push(i);
				}
			}
		}
		findCurrent = findMatches.length > 0 ? 0 : -1;
		applyFind(scrollToCurrent);
	}

	function stepFind(delta: number) {
		if (findMatches.length === 0) return;
		findCurrent = (findCurrent + delta + findMatches.length) % findMatches.length;
		applyFind(true);
	}

	function openFind() {
		findWidget.classList.add('ggvFindOpen');
		findInput.focus();
		findInput.select();
	}

	function closeFind() {
		findWidget.classList.remove('ggvFindOpen');
		findMatches = [];
		findCurrent = -1;
		applyFind(false);
		root.focus();
	}

	findBtn.addEventListener('click', () => {
		if (findWidget.classList.contains('ggvFindOpen')) closeFind();
		else openFind();
	});
	findClose.addEventListener('click', closeFind);
	findPrev.addEventListener('click', () => stepFind(-1));
	findNext.addEventListener('click', () => stepFind(1));
	findInput.addEventListener('input', () => runFind(true));
	findInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			stepFind(e.shiftKey ? -1 : 1);
			e.preventDefault();
		}
	});

	root.addEventListener('keydown', (e) => {
		if (e.key === 'Escape') {
			if (openMenu !== null) closeMenu();
			else if (findWidget.classList.contains('ggvFindOpen')) closeFind();
			else collapseDetails();
		} else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
			openFind();
			e.preventDefault();
		}
	});

	// --- Refresh ---
	let refreshing = false;
	let refreshQueued = false;

	async function refresh(): Promise<void> {
		if (disposed) return;
		if (refreshing) {
			refreshQueued = true;
			return;
		}
		refreshing = true;
		try {
			const changed = await load();
			if (!disposed && changed) render();
		} catch (error) {
			// Force the next successful load to render over the error view
			lastSignature = '';
			if (!disposed) showError(error);
		} finally {
			refreshing = false;
		}
		if (refreshQueued && !disposed) {
			refreshQueued = false;
			await refresh();
		}
	}

	refreshBtn.addEventListener('click', () => { refresh(); });

	return {
		element: root,
		refresh: refresh,
		dispose: () => {
			disposed = true;
			loadSeq++;
			document.removeEventListener('mousedown', onDocMouseDown, true);
			if (detailsResize !== null) detailsResize.disconnect();
			rows = [];
			layout = [];
			rowElems = [];
			detailsElem = null;
			svgElem = null;
			refsByHash = new Map();
			root.remove();
		}
	};
}
