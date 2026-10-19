/**
 * The Explorer tree: lazy directory listing via the Tauri fs plugin.
 *
 * Directories are read on first expand; collapsing keeps the child DOM
 * (display:none) so re-expanding is instant. Refreshes (from the file
 * watcher) re-render from the repository root, preserving which directories
 * were expanded and the selected row.
 */

import { exists, mkdir, readDir, writeTextFile } from '@tauri-apps/plugin-fs';
import { fileIcon } from './fileIcons';
import { COLOR_IGNORED, TreeDecoration } from './gitStatus';

const CHEVRON_SVG = '<svg width="16" height="16" viewBox="0 0 16 16"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const TREE_INDENT = 8; // VS Code tree indent per depth level (px)

interface TreeEntry {
	name: string;
	isDirectory: boolean;
}

const expandedPaths = new Set<string>();
let selectedPath: string | null = null;
let selectedIsDir = false;
let selectedRow: HTMLElement | null = null;

// Rendered child container per directory (for inserting the inline
// new-file/new-folder input row); depth = indent level of its rows.
const dirContainers = new Map<string, { container: HTMLElement, depth: number }>();

// Git decorations: current map (absolute path → decoration) and the rendered
// rows, so a decoration refresh updates rows in place (no re-render → no
// scroll jump when a file is merely edited).
let decorationMap: Map<string, TreeDecoration> = new Map();
const renderedRows = new Map<string, { row: HTMLElement, badge: HTMLElement }>();

/**
 * Decoration for a row: its own entry, or — like VS Code — the inherited
 * grey of the nearest decorated ancestor when that ancestor is gitignored
 * (`git status --ignored=traditional` reports only the ignored directory
 * itself, so its descendants, rendered on expansion, have no entry).
 */
function lookupDecoration(absPath: string): TreeDecoration | undefined {
	const exact = decorationMap.get(absPath);
	if (exact !== undefined) return exact;
	let dir = absPath, slash;
	while ((slash = dir.lastIndexOf('/')) > 0) {
		dir = dir.substring(0, slash);
		const ancestor = decorationMap.get(dir);
		if (ancestor !== undefined) {
			return ancestor.color === COLOR_IGNORED ? { letter: null, color: COLOR_IGNORED } : undefined;
		}
	}
	return undefined;
}

function applyDecoration(absPath: string, row: HTMLElement, badge: HTMLElement) {
	const decoration = lookupDecoration(absPath);
	row.style.color = decoration !== undefined ? decoration.color : '';
	if (decoration !== undefined && decoration.letter !== null) {
		badge.textContent = decoration.letter;
		badge.classList.remove('ggdTreeDot');
	} else if (decoration !== undefined && decoration.color !== COLOR_IGNORED) {
		// A propagated (letter-less, non-ignored) folder colour gets VS Code's
		// bubble dot on the right.
		badge.textContent = '\u25CF';
		badge.classList.add('ggdTreeDot');
	} else {
		badge.textContent = '';
		badge.classList.remove('ggdTreeDot');
	}
}

function selectRow(row: HTMLElement, absPath: string, isDirectory: boolean) {
	if (selectedRow !== null) selectedRow.classList.remove('selected');
	selectedRow = row;
	selectedPath = absPath;
	selectedIsDir = isDirectory;
	row.classList.add('selected');
}

async function listEntries(dirPath: string): Promise<TreeEntry[]> {
	const entries = await readDir(dirPath);
	return entries
		.filter((entry) => entry.name !== '.git')
		.map((entry) => ({ name: entry.name, isDirectory: entry.isDirectory }))
		.sort((a, b) => a.isDirectory !== b.isDirectory
			? (a.isDirectory ? -1 : 1)
			: a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

function renderRow(container: HTMLElement, dirPath: string, entry: TreeEntry, depth: number, onOpenFile: (absPath: string) => void): Promise<void> | null {
	const absPath = dirPath + '/' + entry.name;

	const item = document.createElement('div');
	const row = document.createElement('div');
	row.className = 'ggdTreeRow';
	row.style.paddingLeft = (depth * TREE_INDENT + 4) + 'px';

	const label = document.createElement('span');
	label.className = 'ggdTreeLabel';
	label.textContent = entry.name;
	label.title = absPath;

	// Like VS Code: the same leading slot holds the folder chevron OR the
	// file's Seti glyph, so file & folder labels align at the same depth.
	if (entry.isDirectory) {
		const chevron = document.createElement('span');
		chevron.className = 'ggdTreeChevron';
		chevron.innerHTML = CHEVRON_SVG;
		row.appendChild(chevron);
	} else {
		const icon = document.createElement('span');
		icon.className = 'ggdTreeIcon';
		const iconInfo = fileIcon(entry.name);
		icon.innerHTML = iconInfo.svg;
		icon.style.color = iconInfo.color;
		row.appendChild(icon);
	}
	row.appendChild(label);

	// Git decoration: coloured row + right-aligned status letter badge
	const badge = document.createElement('span');
	badge.className = 'ggdTreeBadge';
	row.appendChild(badge);
	renderedRows.set(absPath, { row: row, badge: badge });
	applyDecoration(absPath, row, badge);

	item.appendChild(row);

	if (absPath === selectedPath) {
		if (selectedRow !== null) selectedRow.classList.remove('selected');
		selectedRow = row;
		row.classList.add('selected');
	}

	let initialRender: Promise<void> | null = null;
	if (entry.isDirectory) {
		let childContainer: HTMLElement | null = null;
		const expand = (): Promise<void> => {
			childContainer = document.createElement('div');
			childContainer.style.position = 'relative';
			// Indent guide: a vertical line under the parent chevron's centre
			const guide = document.createElement('div');
			guide.className = 'ggdTreeGuide';
			guide.style.left = (depth * TREE_INDENT + 11) + 'px';
			childContainer.appendChild(guide);
			item.appendChild(childContainer);
			return renderChildren(childContainer, absPath, depth + 1, onOpenFile);
		};
		if (expandedPaths.has(absPath)) {
			row.classList.add('expanded');
			initialRender = expand();
		}
		row.addEventListener('click', () => {
			selectRow(row, absPath, true);
			const expanded = row.classList.toggle('expanded');
			if (expanded) expandedPaths.add(absPath);
			else expandedPaths.delete(absPath);
			if (childContainer === null) expand();
			else childContainer.style.display = expanded ? '' : 'none';
		});
	} else {
		row.addEventListener('click', () => {
			selectRow(row, absPath, false);
			onOpenFile(absPath);
		});
	}

	container.appendChild(item);
	return initialRender;
}

async function renderChildren(container: HTMLElement, dirPath: string, depth: number, onOpenFile: (absPath: string) => void): Promise<void> {
	dirContainers.set(dirPath, { container: container, depth: depth });
	try {
		const entries = await listEntries(dirPath);
		const nested: Promise<void>[] = [];
		for (let i = 0; i < entries.length; i++) {
			const render = renderRow(container, dirPath, entries[i], depth, onOpenFile);
			if (render !== null) nested.push(render);
		}
		await Promise.all(nested);
	} catch (e) {
		console.error('[Git Graph] Unable to read directory ' + dirPath + ':', e);
	}
}

/**
 * Render the explorer tree for the repository root. Returns a refresh handler
 * that re-renders from the root (preserving expanded directories & selection)
 * and a setDecorations handler that applies git decorations in place.
 */
export function initTree(container: HTMLElement, repoRoot: string, onOpenFile: (absPath: string) => void): { refresh: () => void, setDecorations: (map: Map<string, TreeDecoration>) => void, startCreate: (kind: 'file' | 'folder') => void } {
	const refresh = (): Promise<void> => {
		container.innerHTML = '';
		selectedRow = null;
		renderedRows.clear();
		dirContainers.clear();
		return renderChildren(container, repoRoot, 0, onOpenFile);
	};
	const setDecorations = (map: Map<string, TreeDecoration>) => {
		decorationMap = map;
		renderedRows.forEach((rendered, absPath) => applyDecoration(absPath, rendered.row, rendered.badge));
	};

	/**
	 * VS Code-style inline creation: an input row inside the selected folder
	 * (or the selected file's parent, else the root). Enter/blur creates the
	 * file or folder, Escape cancels.
	 */
	const startCreate = async (kind: 'file' | 'folder') => {
		let dir = repoRoot;
		if (selectedPath !== null) {
			dir = selectedIsDir ? selectedPath : selectedPath.substring(0, selectedPath.lastIndexOf('/'));
		}
		if (dir !== repoRoot && !expandedPaths.has(dir)) {
			expandedPaths.add(dir);
			await refresh();
		}
		const target = dirContainers.get(dir);
		if (target === undefined) return;

		const item = document.createElement('div');
		const row = document.createElement('div');
		row.className = 'ggdTreeRow';
		row.style.paddingLeft = (target.depth * TREE_INDENT + 4) + 'px';
		const iconSlot = document.createElement('span');
		if (kind === 'folder') {
			iconSlot.className = 'ggdTreeChevron';
			iconSlot.innerHTML = CHEVRON_SVG;
		} else {
			iconSlot.className = 'ggdTreeIcon';
		}
		row.appendChild(iconSlot);
		const input = document.createElement('input');
		input.className = 'ggdTreeInput';
		input.spellcheck = false;
		row.appendChild(input);
		item.appendChild(row);
		// The indent guide is absolutely positioned, so prepending before it
		// is fine: the input appears as the folder's first row.
		target.container.insertBefore(item, target.container.firstChild);
		const updateIcon = () => {
			if (kind === 'file') {
				const info = fileIcon(input.value);
				iconSlot.innerHTML = info.svg;
				iconSlot.style.color = info.color;
			}
		};
		updateIcon();
		input.focus();

		let done = false;
		const cancel = () => {
			if (!done) {
				done = true;
				item.remove();
			}
		};
		const commit = async () => {
			if (done) return;
			const name = input.value.trim();
			if (name === '' || name.includes('/')) {
				cancel();
				return;
			}
			done = true;
			item.remove();
			const path = dir + '/' + name;
			try {
				if (await exists(path)) return;
				if (kind === 'folder') {
					await mkdir(path);
					expandedPaths.add(path);
				} else {
					await writeTextFile(path, '');
				}
				selectedPath = path;
				selectedIsDir = kind === 'folder';
				await refresh();
				if (kind === 'file') onOpenFile(path);
			} catch (e) {
				console.error('[Explorer] Unable to create ' + path + ':', e);
			}
		};
		input.addEventListener('input', updateIcon);
		input.addEventListener('keydown', (e) => {
			e.stopPropagation();
			if (e.key === 'Enter') void commit();
			else if (e.key === 'Escape') cancel();
		});
		input.addEventListener('blur', () => void commit());
	};

	refresh();
	return { refresh: refresh, setDecorations: setDecorations, startCreate: startCreate };
}
