/**
 * The tab bar: file editor tabs, view tabs (diffs, files at a revision) and —
 * when the opened folder is a Git repository — a closable "Git Graph" tab.
 *
 * The app is editor-first: it starts with no tabs (empty editor area). The
 * Git Graph view is built lazily each time its tab is opened and destroyed
 * when the tab closes (it is a normal element tab in the editor container),
 * so a closed graph costs no memory.
 */

import { ask } from '@tauri-apps/plugin-dialog';
import { clearEditorDisplay, closeEditorTab, openFileInEditor, setDirtyListener, showEditorTab } from './editor';
import { fileIcon } from './fileIcons';
import { ICON_SOURCE_CONTROL, iconSvg } from './icons';

// Codicons: close (×) and circle-filled (the dirty dot)
const CLOSE_SVG = '<svg class="ggdTabCloseIcon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 8.7l3.6 3.6.7-.7L8.7 8l3.6-3.6-.7-.7L8 7.3 4.4 3.7l-.7.7L7.3 8l-3.6 3.6.7.7L8 8.7z"/></svg>';
const DIRTY_SVG = '<svg class="ggdTabDirtyIcon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="8" r="4"/></svg>';

interface Tab {
	readonly id: number;
	readonly kind: 'graph' | 'file' | 'view';
	/** Dedupe key: the absolute path for file tabs, a synthetic key for view tabs */
	readonly key: string | null;
	readonly elem: HTMLElement;
	dirty: boolean;
	/** Monotonic activation stamp (for least-recently-used eviction). */
	lastUse: number;
}

/** At most this many file tabs — opening more replaces the LRU clean one. */
const MAX_FILE_TABS = 1;

let tabs: Tab[] = [];
let activeTab: Tab | null = null;
let tabbarElem: HTMLElement | null = null;
let nextTabId = 1;
let useCounter = 0;
let graphProvider: ((tabId: number) => Promise<void>) | null = null;

function createTab(kind: Tab['kind'], key: string | null, label: string, tooltip?: string): Tab {
	const elem = document.createElement('div');
	elem.className = 'ggdTab';
	elem.title = tooltip !== undefined ? tooltip : (key !== null ? key : label);

	// Like VS Code: a Seti file icon before the label (the source control
	// icon for the Git Graph tab). View tab labels are "name (desc)" — the
	// icon comes from the file name portion.
	const iconElem = document.createElement('span');
	iconElem.className = 'ggdTabIcon';
	if (kind === 'graph') {
		iconElem.innerHTML = iconSvg(ICON_SOURCE_CONTROL, 16);
	} else {
		const parenIdx = label.indexOf(' (');
		const iconInfo = fileIcon(parenIdx > -1 ? label.substring(0, parenIdx) : label);
		iconElem.innerHTML = iconInfo.svg;
		iconElem.style.color = iconInfo.color;
	}
	elem.appendChild(iconElem);

	const labelElem = document.createElement('span');
	labelElem.textContent = label;
	elem.appendChild(labelElem);

	const tab: Tab = { id: nextTabId++, kind: kind, key: key, elem: elem, dirty: false, lastUse: 0 };

	const closeElem = document.createElement('span');
	closeElem.className = 'ggdTabClose';
	closeElem.title = 'Close';
	closeElem.innerHTML = CLOSE_SVG + DIRTY_SVG;
	closeElem.addEventListener('click', (e) => {
		e.stopPropagation();
		closeTab(tab);
	});
	elem.appendChild(closeElem);

	elem.addEventListener('click', () => activateTab(tab));
	tabbarElem!.appendChild(elem);
	tabs.push(tab);
	return tab;
}

function activateTab(tab: Tab) {
	tab.lastUse = ++useCounter;
	if (activeTab === tab) return;
	if (activeTab !== null) activeTab.elem.classList.remove('active');
	activeTab = tab;
	tab.elem.classList.add('active');
	tab.elem.scrollIntoView({ block: 'nearest', inline: 'nearest' });
	showEditorTab(tab.id);
}

async function closeTab(tab: Tab) {
	if (tab.dirty) {
		const fileName = tab.key !== null ? tab.key.substring(tab.key.lastIndexOf('/') + 1) : '';
		const discard = await ask('"' + fileName + '" has unsaved changes. Close it and discard them?', {
			title: 'Unsaved Changes',
			kind: 'warning'
		});
		if (!discard) return;
	}
	closeEditorTab(tab.id);
	const index = tabs.indexOf(tab);
	if (index > -1) tabs.splice(index, 1);
	tab.elem.remove();
	if (activeTab === tab) {
		activeTab = null;
		if (tabs.length > 0) {
			activateTab(tabs[Math.min(index, tabs.length - 1)]);
		} else {
			// Empty state: no tabs → blank editor area
			clearEditorDisplay();
		}
	}
}

/**
 * Open a file in an editor tab (focusing the existing tab if the file is
 * already open). Used by the explorer tree and the Git Graph "Open File"
 * action.
 */
export async function openFileTab(absPath: string): Promise<void> {
	const existing = tabs.find((tab) => tab.kind === 'file' && tab.key === absPath);
	if (existing !== undefined) {
		activateTab(existing);
		return;
	}

	// Cap on file tabs: opening another file replaces the least recently
	// used CLEAN file tab in place. Dirty tabs are never evicted (unsaved
	// work always keeps its tab), so with every file tab dirty the cap is
	// exceeded rather than losing changes.
	let insertIndex = -1;
	let insertBeforeElem: Element | null = null;
	const fileTabs = tabs.filter((tab) => tab.kind === 'file');
	if (fileTabs.length >= MAX_FILE_TABS) {
		let victim: Tab | null = null;
		for (const tab of fileTabs) {
			if (!tab.dirty && (victim === null || tab.lastUse < victim.lastUse)) victim = tab;
		}
		if (victim !== null) {
			closeEditorTab(victim.id);
			insertIndex = tabs.indexOf(victim);
			insertBeforeElem = victim.elem.nextElementSibling;
			tabs.splice(insertIndex, 1);
			victim.elem.remove();
			if (activeTab === victim) activeTab = null;
		}
	}

	const label = absPath.substring(absPath.lastIndexOf('/') + 1);
	const tab = createTab('file', absPath, label);
	if (insertIndex > -1) {
		// Take over the evicted tab's spot (createTab appended at the end)
		if (insertBeforeElem !== null) tabbarElem!.insertBefore(tab.elem, insertBeforeElem);
		tabs.pop();
		tabs.splice(insertIndex, 0, tab);
	}
	await openFileInEditor(tab.id, absPath);
	activateTab(tab);
}

/**
 * Open a view tab (diff / file at revision), deduped by `key`. `prepare` is
 * awaited before the tab is activated; it must register content for the tab id
 * in the editor (openElementTab / openReadonlyDocTab / openNoticeTab).
 */
export async function openViewTab(key: string, label: string, tooltip: string, prepare: (tabId: number) => Promise<void>): Promise<void> {
	const existing = tabs.find((tab) => tab.kind === 'view' && tab.key === key);
	if (existing !== undefined) {
		activateTab(existing);
		return;
	}
	const tab = createTab('view', key, label, tooltip);
	try {
		await prepare(tab.id);
	} catch (e) {
		// Never leave a contentless tab behind
		closeEditorTab(tab.id);
		const index = tabs.indexOf(tab);
		if (index > -1) tabs.splice(index, 1);
		tab.elem.remove();
		throw e;
	}
	activateTab(tab);
}

/**
 * Make the Git Graph tab available (the opened folder is a Git repository).
 * `provider` builds a fresh graph view and registers it as the tab's editor
 * content (openElementTab); it runs every time the tab is (re)opened.
 */
export function setGraphAvailable(provider: (tabId: number) => Promise<void>) {
	graphProvider = provider;
}

/** Open (or focus) the Git Graph tab. No-op if the folder is not a repo. */
export async function openGraphTab(): Promise<void> {
	if (graphProvider === null) return;
	const existing = tabs.find((tab) => tab.kind === 'graph');
	if (existing !== undefined) {
		activateTab(existing);
		return;
	}
	const tab = createTab('graph', null, 'Git Graph', 'Git Graph');
	try {
		await graphProvider(tab.id);
	} catch (e) {
		// Never leave a contentless tab behind
		closeEditorTab(tab.id);
		const index = tabs.indexOf(tab);
		if (index > -1) tabs.splice(index, 1);
		tab.elem.remove();
		throw e;
	}
	activateTab(tab);
}

/**
 * Create the tab bar and install the dirty-state listener & Cmd+W handler.
 * No tabs exist initially (empty editor area).
 */
export function initTabs(tabbar: HTMLElement) {
	tabbarElem = tabbar;

	setDirtyListener((tabId, dirty) => {
		const tab = tabs.find((t) => t.id === tabId);
		if (tab !== undefined) {
			tab.dirty = dirty;
			tab.elem.classList.toggle('dirty', dirty);
		}
	});

	// Cmd+W closes the active tab. Capture phase, so it runs before the
	// editor's stopPropagation key isolation. With no tabs open, the native
	// window close is left in place (VS Code-like).
	window.addEventListener('keydown', (e) => {
		if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'w' && activeTab !== null) {
			e.preventDefault();
			e.stopPropagation();
			closeTab(activeTab);
		}
	}, true);
}
