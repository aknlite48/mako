/**
 * The file editor: one shared CodeMirror 6 EditorView living in #ggdEditors,
 * with per-tab EditorState retention (store `view.state` when a tab is
 * switched away from, `view.setState()` when it is switched back) — the
 * canonical low-memory CM6 multi-document pattern.
 *
 * Besides editable file tabs, the editor container also hosts:
 *  - readonly document tabs (file at a revision), sharing the same view
 *  - element tabs (side-by-side diff MergeViews), one DOM subtree per tab
 *  - notice tabs (too large / binary files)
 *
 * Dirty tracking is VS Code-like: the document is compared against the last
 * saved text, so undoing back to the saved state clears the dirty dot.
 */

import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { bracketMatching, foldGutter, foldKeymap, indentOnInput } from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { EditorState, Extension, Text } from '@codemirror/state';
import { EditorView, drawSelection, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { readTextFile, stat, writeTextFile } from '@tauri-apps/plugin-fs';
import { darkPlusTheme } from './cmTheme';
import { vscodeSearch } from './findPanel';

// VS Code editorIndentGuide.background / .activeBackground. Light & dark keys
// both use the theme vars (the CM dark flag is static across themes).
function indentGuides(): Extension {
	return indentationMarkers({
		highlightActiveBlock: true,
		hideFirstIndent: false,
		markerType: 'codeOnly',
		thickness: 1,
		colors: {
			light: 'var(--ggd-ed-indent)',
			dark: 'var(--ggd-ed-indent)',
			activeLight: 'var(--ggd-ed-indent-active)',
			activeDark: 'var(--ggd-ed-indent-active)'
		}
	});
}

// Codicons chevron-down / chevron-right for the fold gutter (shown on gutter
// hover only, like VS Code — see the .cm-foldGutter rules in cmTheme.ts)
const CHEVRON_DOWN = 'M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z';
const CHEVRON_RIGHT = 'M5.7 13.7L5 13l5-5-5-5 .7-.7L11.4 8l-5.7 5.7z';

function foldMarker(open: boolean): HTMLElement {
	const marker = document.createElement('span');
	marker.innerHTML = '<svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="' + (open ? CHEVRON_DOWN : CHEVRON_RIGHT) + '"/></svg>';
	return marker;
}

function codeFolding(): Extension {
	return foldGutter({ markerDOM: foldMarker });
}

const MAX_FILE_SIZE = 5 * 1024 * 1024;

interface DocTabData {
	kind: 'doc';
	path: string | null; // null → readonly, not saveable
	state: EditorState;
	savedDoc: Text;
	scrollTop: number;
	dirty: boolean;
	langLabel: string;
}
interface NoticeTabData {
	kind: 'notice';
	text: string;
}
interface ElementTabData {
	kind: 'element';
	elem: HTMLElement;
	destroy: () => void;
}
type EditorTabData = DocTabData | NoticeTabData | ElementTabData;

const tabData = new Map<number, EditorTabData>();
let view: EditorView | null = null;
let editorsRoot: HTMLElement | null = null;
let hostElem: HTMLElement | null = null;
let noticeElem: HTMLElement | null = null;
let displayedTabId: number | null = null;
let displayedElem: HTMLElement | null = null;
let dirtyListener: (tabId: number, dirty: boolean) => void = () => { };
let statusListener: (status: { line: number, col: number, lang: string } | null) => void = () => { };

/** Register the callback notified when a tab's dirty state changes. */
export function setDirtyListener(listener: (tabId: number, dirty: boolean) => void) {
	dirtyListener = listener;
}

/** Register the callback notified with the displayed editor's cursor/lang. */
export function setStatusListener(listener: (status: { line: number, col: number, lang: string } | null) => void) {
	statusListener = listener;
}

/** Report the displayed doc tab's cursor position & language (or null). */
function reportStatus() {
	if (displayedTabId === null || view === null) {
		statusListener(null);
		return;
	}
	const data = tabData.get(displayedTabId);
	if (data === undefined || data.kind !== 'doc') {
		statusListener(null);
		return;
	}
	const head = view.state.selection.main.head;
	const line = view.state.doc.lineAt(head);
	statusListener({ line: line.number, col: head - line.from + 1, lang: data.langLabel });
}

function statusReporter(): Extension {
	return EditorView.updateListener.of((update) => {
		if (update.selectionSet || update.docChanged) reportStatus();
	});
}

/**
 * Mount the shared EditorView & notice element inside the editor container.
 */
export function initEditor(editorsElem: HTMLElement) {
	editorsRoot = editorsElem;
	hostElem = document.createElement('div');
	hostElem.id = 'ggdEditorHost';
	hostElem.style.display = 'none'; // Nothing displayed until a tab is shown
	noticeElem = document.createElement('div');
	noticeElem.id = 'ggdEditorNotice';
	editorsElem.appendChild(hostElem);
	editorsElem.appendChild(noticeElem);

	// Key isolation: stop keyboard events (already handled by CodeMirror on
	// its contentDOM) from bubbling to the document-level handlers installed
	// by web.js (e.g. "r" refresh, "f" find, Escape).
	editorsElem.addEventListener('keydown', (e) => e.stopPropagation());
	editorsElem.addEventListener('keyup', (e) => e.stopPropagation());
	editorsElem.addEventListener('keypress', (e) => e.stopPropagation());

	view = new EditorView({ parent: hostElem });
}

function languageFor(path: string): ReadonlyArray<Extension> {
	const name = path.substring(path.lastIndexOf('/') + 1);
	const ext = name.lastIndexOf('.') > 0 ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : '';
	switch (ext) {
		case 'js': case 'mjs': case 'cjs': return [javascript()];
		case 'jsx': return [javascript({ jsx: true })];
		case 'ts': case 'mts': case 'cts': return [javascript({ typescript: true })];
		case 'tsx': return [javascript({ typescript: true, jsx: true })];
		case 'json': return [json()];
		case 'css': return [css()];
		case 'html': case 'htm': case 'xml': case 'svg': case 'vue': case 'svelte': return [html()];
		case 'md': case 'markdown': return [markdown()];
		case 'py': return [python()];
		case 'rs': return [rust()];
		default: return [];
	}
}

function langLabelFor(path: string): string {
	const name = path.substring(path.lastIndexOf('/') + 1);
	const ext = name.lastIndexOf('.') > 0 ? name.substring(name.lastIndexOf('.') + 1).toLowerCase() : '';
	switch (ext) {
		case 'ts': case 'mts': case 'cts': return 'TypeScript';
		case 'tsx': return 'TypeScript JSX';
		case 'js': case 'mjs': case 'cjs': return 'JavaScript';
		case 'jsx': return 'JavaScript JSX';
		case 'json': return 'JSON';
		case 'css': return 'CSS';
		case 'html': case 'htm': return 'HTML';
		case 'xml': return 'XML';
		case 'svg': return 'SVG';
		case 'vue': return 'Vue';
		case 'svelte': return 'Svelte';
		case 'md': case 'markdown': return 'Markdown';
		case 'py': return 'Python';
		case 'rs': return 'Rust';
		default: return 'Plain Text';
	}
}

function setDirty(tabId: number, data: DocTabData, dirty: boolean) {
	if (data.dirty !== dirty) {
		data.dirty = dirty;
		dirtyListener(tabId, dirty);
	}
}

async function saveTab(tabId: number): Promise<void> {
	const data = tabData.get(tabId);
	if (data === undefined || data.kind !== 'doc' || data.path === null || view === null || displayedTabId !== tabId) return;
	try {
		await writeTextFile(data.path, view.state.doc.toString());
		data.state = view.state;
		data.savedDoc = view.state.doc;
		setDirty(tabId, data, false);
	} catch (e) {
		console.error('[Git Graph] Unable to save ' + data.path + ':', e);
	}
}

function buildExtensions(tabId: number, path: string): Extension[] {
	return [
		lineNumbers(),
		codeFolding(),
		highlightActiveLineGutter(),
		highlightActiveLine(),
		history(),
		drawSelection(),
		EditorState.allowMultipleSelections.of(true),
		indentOnInput(),
		bracketMatching(),
		closeBrackets(),
		highlightSelectionMatches(),
		indentGuides(),
		vscodeSearch(),
		statusReporter(),
		keymap.of([
			{ key: 'Mod-s', run: () => { saveTab(tabId); return true; } },
			...closeBracketsKeymap,
			...defaultKeymap,
			...searchKeymap,
			...historyKeymap,
			...foldKeymap,
			indentWithTab
		]),
		...languageFor(path),
		darkPlusTheme,
		EditorView.updateListener.of((update) => {
			if (!update.docChanged) return;
			const data = tabData.get(tabId);
			if (data !== undefined && data.kind === 'doc' && data.path !== null) {
				setDirty(tabId, data, !update.state.doc.eq(data.savedDoc));
			}
		})
	];
}

/** Extensions for readonly documents (file at a revision). */
export function readonlyExtensions(langPath: string): Extension[] {
	return [
		EditorState.readOnly.of(true),
		EditorView.editable.of(false),
		lineNumbers(),
		codeFolding(),
		highlightActiveLineGutter(),
		highlightActiveLine(),
		drawSelection(),
		highlightSelectionMatches(),
		indentGuides(),
		vscodeSearch(),
		statusReporter(),
		keymap.of([...defaultKeymap, ...searchKeymap, ...foldKeymap]),
		...languageFor(langPath),
		darkPlusTheme
	];
}

/** Persist the displayed tab's view state & scroll position back to the map. */
function storeCurrent() {
	if (displayedTabId === null || view === null) return;
	const data = tabData.get(displayedTabId);
	if (data !== undefined && data.kind === 'doc') {
		data.state = view.state;
		data.scrollTop = view.scrollDOM.scrollTop;
	}
}

/**
 * Load a file into a (not yet displayed) editor tab. Never rejects — load
 * failures become a notice shown in place of the editor.
 */
export async function openFileInEditor(tabId: number, path: string): Promise<void> {
	try {
		const info = await stat(path);
		if (info.size > MAX_FILE_SIZE) {
			openNoticeTab(tabId, 'This file is too large to open in the editor (' + (info.size / (1024 * 1024)).toFixed(1) + ' MB, limit is 5 MB).');
			return;
		}
	} catch (e) {
		openNoticeTab(tabId, 'Unable to open this file: ' + (e instanceof Error ? e.message : String(e)));
		return;
	}
	try {
		const text = await readTextFile(path);
		const state = EditorState.create({ doc: text, extensions: buildExtensions(tabId, path) });
		tabData.set(tabId, { kind: 'doc', path: path, state: state, savedDoc: state.doc, scrollTop: 0, dirty: false, langLabel: langLabelFor(path) });
	} catch (e) {
		openNoticeTab(tabId, 'This file cannot be displayed in the editor (it is binary or not valid UTF-8).');
	}
}

/** Register a readonly document tab (e.g. a file at a revision). */
export function openReadonlyDocTab(tabId: number, text: string, langPath: string) {
	const state = EditorState.create({ doc: text, extensions: readonlyExtensions(langPath) });
	tabData.set(tabId, { kind: 'doc', path: null, state: state, savedDoc: state.doc, scrollTop: 0, dirty: false, langLabel: langLabelFor(langPath) });
}

/** Register a notice tab (too large / binary / error). */
export function openNoticeTab(tabId: number, text: string) {
	tabData.set(tabId, { kind: 'notice', text: text });
}

/**
 * Register an element tab: an arbitrary DOM subtree (e.g. a diff MergeView)
 * hosted in the editor container. `destroy` is called when the tab closes.
 */
export function openElementTab(tabId: number, elem: HTMLElement, destroy: () => void) {
	if (editorsRoot === null) return;
	elem.classList.add('ggdElementTab');
	elem.style.display = 'none';
	editorsRoot.appendChild(elem);
	tabData.set(tabId, { kind: 'element', elem: elem, destroy: destroy });
}

/** Display a previously opened editor tab (storing the current one first). */
export function showEditorTab(tabId: number) {
	if (view === null || hostElem === null || noticeElem === null) return;
	const data = tabData.get(tabId);
	if (data === undefined) return;
	storeCurrent();
	displayedTabId = tabId;

	if (displayedElem !== null) {
		displayedElem.style.display = 'none';
		displayedElem = null;
	}
	hostElem.style.display = 'none';
	noticeElem.style.display = 'none';

	if (data.kind === 'notice') {
		noticeElem.style.display = 'block';
		noticeElem.textContent = data.text;
		statusListener(null);
	} else if (data.kind === 'element') {
		data.elem.style.display = '';
		displayedElem = data.elem;
		statusListener(null);
	} else {
		hostElem.style.display = '';
		view.setState(data.state);
		// Restore scroll now and again after CodeMirror's measure cycle
		view.scrollDOM.scrollTop = data.scrollTop;
		const scrollTop = data.scrollTop;
		requestAnimationFrame(() => {
			if (displayedTabId === tabId && view !== null) view.scrollDOM.scrollTop = scrollTop;
		});
		view.focus();
		reportStatus();
	}
}

/** Show nothing (no tab active): hide all editor surfaces. */
export function clearEditorDisplay() {
	storeCurrent();
	displayedTabId = null;
	if (displayedElem !== null) {
		displayedElem.style.display = 'none';
		displayedElem = null;
	}
	if (hostElem !== null) hostElem.style.display = 'none';
	if (noticeElem !== null) noticeElem.style.display = 'none';
	if (view !== null) view.setState(EditorState.create({ doc: '' }));
	statusListener(null);
}

/** Discard an editor tab's retained state (when its tab is closed). */
export function closeEditorTab(tabId: number) {
	const data = tabData.get(tabId);
	tabData.delete(tabId);
	if (data !== undefined && data.kind === 'element') {
		if (displayedElem === data.elem) displayedElem = null;
		data.destroy();
		data.elem.remove();
	}
	if (displayedTabId === tabId) {
		displayedTabId = null;
		if (view !== null) view.setState(EditorState.create({ doc: '' }));
	}
}

/**
 * File watcher hook: reload the given paths in any open, non-dirty file tabs
 * (dirty tabs are left untouched so unsaved work is never clobbered).
 */
export async function reloadExternallyChangedFiles(paths: ReadonlyArray<string>): Promise<void> {
	for (const entry of tabData.entries()) {
		const tabId = entry[0], data = entry[1];
		if (data.kind !== 'doc' || data.path === null || data.dirty || paths.indexOf(data.path) === -1) continue;
		let text: string;
		try {
			text = await readTextFile(data.path);
		} catch (_) {
			continue; // Deleted or unreadable — keep the current buffer
		}
		const isDisplayed = displayedTabId === tabId && view !== null;
		const currentDoc = isDisplayed ? view!.state.doc : data.state.doc;
		if (currentDoc.toString() === text) continue; // e.g. our own save
		const changes = { from: 0, to: currentDoc.length, insert: text };
		if (isDisplayed) {
			view!.dispatch({ changes: changes });
			data.state = view!.state;
		} else {
			data.state = data.state.update({ changes: changes }).state;
		}
		data.savedDoc = data.state.doc;
		setDirty(tabId, data, false);
	}
}
