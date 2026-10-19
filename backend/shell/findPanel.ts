/**
 * VS Code-style floating find widget for CodeMirror 6.
 *
 * Replaces CodeMirror's default docked search bar with a compact widget in
 * the top-right corner of the editor: find input with inline Aa (match case),
 * ab (whole word) and .* (regex) toggles, an "N of M" match counter, ↑/↓
 * navigation, ×, and a chevron-expandable replace row (hidden for readonly
 * editors). Enter → next match, Shift+Enter → previous, Escape → close.
 */

import {
	SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery,
	replaceAll, replaceNext, search, setSearchQuery
} from '@codemirror/search';
import { Extension } from '@codemirror/state';
import { EditorView, Panel, ViewUpdate, runScopeHandlers } from '@codemirror/view';

const MAX_COUNT = 999;

function icon(pathData: string): SVGSVGElement {
	const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
	svg.setAttribute('viewBox', '0 0 16 16');
	svg.setAttribute('width', '16');
	svg.setAttribute('height', '16');
	const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
	path.setAttribute('d', pathData);
	path.setAttribute('fill', 'currentColor');
	path.setAttribute('fill-rule', 'evenodd');
	svg.appendChild(path);
	return svg;
}

// VS Code codicons: chevron-right, arrow-up, arrow-down, close, replace, replace-all
const CHEVRON = 'M5.7 13.7L5 13l5-5-5-5 .7-.7L11.4 8l-5.7 5.7z';
const ARROW_UP = 'M8 3l5 5-.7.7L8.5 4.9V13h-1V4.9L3.7 8.7 3 8l5-5z';
const ARROW_DOWN = 'M8 13L3 8l.7-.7 3.8 3.8V3h1v8.1l3.8-3.8.7.7-5 5z';
const CLOSE = 'M8 8.7l3.6 3.6.7-.7L8.7 8l3.6-3.6-.7-.7L8 7.3 4.4 3.7l-.7.7L7.3 8l-3.6 3.6.7.7L8 8.7z';
const REPLACE = 'M3.2 2.5a1.2 1.2 0 0 0-1.2 1.2v3.1a1.2 1.2 0 0 0 1.2 1.2H4v-1h-.8a.2.2 0 0 1-.2-.2V3.7c0-.11.09-.2.2-.2h3.1c.11 0 .2.09.2.2v.8h1v-.8a1.2 1.2 0 0 0-1.2-1.2H3.2zm4.6 4a1.2 1.2 0 0 0-1.2 1.2v4.6a1.2 1.2 0 0 0 1.2 1.2h4.6a1.2 1.2 0 0 0 1.2-1.2V7.7a1.2 1.2 0 0 0-1.2-1.2H7.8zm-.2 1.2c0-.11.09-.2.2-.2h4.6c.11 0 .2.09.2.2v4.6a.2.2 0 0 1-.2.2H7.8a.2.2 0 0 1-.2-.2V7.7z';
const REPLACE_ALL = 'M11.6 2.7H4.4a.7.7 0 0 0-.7.7v7.2h1V3.7h6.9v-1zm1.7 2.4H6.7a.7.7 0 0 0-.7.7v7.5c0 .39.31.7.7.7h6.6a.7.7 0 0 0 .7-.7V5.8a.7.7 0 0 0-.7-.7zM7 6.1h6v7H7v-7z';

class FindPanel implements Panel {
	public dom: HTMLElement;
	public top = true;

	private view: EditorView;
	private query: SearchQuery;
	private searchInput: HTMLInputElement;
	private replaceInput: HTMLInputElement | null = null;
	private countElem: HTMLElement;
	private caseBtn: HTMLElement;
	private wordBtn: HTMLElement;
	private regexBtn: HTMLElement;
	private chevronBtn: HTMLElement | null = null;
	private replaceRow: HTMLElement | null = null;
	private replaceExpanded = false;

	constructor(view: EditorView) {
		this.view = view;
		this.query = getSearchQuery(view.state);
		const readonly = view.state.readOnly;

		this.dom = document.createElement('div');
		this.dom.className = 'ggdFindWidget';
		this.dom.addEventListener('keydown', (e) => this.onKeydown(e));

		// Left chevron (expand/collapse replace) — only for editable docs
		if (!readonly) {
			this.chevronBtn = document.createElement('div');
			this.chevronBtn.className = 'ggdFindChevron';
			this.chevronBtn.title = 'Toggle Replace';
			this.chevronBtn.appendChild(icon(CHEVRON));
			this.chevronBtn.addEventListener('click', () => this.toggleReplace());
			this.dom.appendChild(this.chevronBtn);
		} else {
			const spacer = document.createElement('div');
			spacer.className = 'ggdFindChevron ggdFindChevronHidden';
			this.dom.appendChild(spacer);
		}

		const rows = document.createElement('div');
		rows.className = 'ggdFindRows';
		this.dom.appendChild(rows);

		// ---- Find row ----
		const findRow = document.createElement('div');
		findRow.className = 'ggdFindRow';
		rows.appendChild(findRow);

		const inputWrap = document.createElement('div');
		inputWrap.className = 'ggdFindInputWrap';
		findRow.appendChild(inputWrap);

		this.searchInput = document.createElement('input');
		this.searchInput.className = 'ggdFindInput';
		this.searchInput.placeholder = 'Find';
		this.searchInput.value = this.query.search;
		this.searchInput.setAttribute('main-field', 'true');
		this.searchInput.addEventListener('input', () => this.commit());
		inputWrap.appendChild(this.searchInput);

		this.caseBtn = this.makeToggle('Aa', 'Match Case', () => {
			this.commit({ caseSensitive: !this.query.caseSensitive });
		});
		this.wordBtn = this.makeToggle('ab', 'Match Whole Word', () => {
			this.commit({ wholeWord: !this.query.wholeWord });
		});
		this.wordBtn.style.textDecoration = 'underline';
		this.regexBtn = this.makeToggle('.*', 'Use Regular Expression', () => {
			this.commit({ regexp: !this.query.regexp });
		});
		inputWrap.appendChild(this.caseBtn);
		inputWrap.appendChild(this.wordBtn);
		inputWrap.appendChild(this.regexBtn);

		this.countElem = document.createElement('div');
		this.countElem.className = 'ggdFindCount';
		findRow.appendChild(this.countElem);

		findRow.appendChild(this.makeButton(ARROW_UP, 'Previous Match (Shift+Enter)', () => findPrevious(this.view)));
		findRow.appendChild(this.makeButton(ARROW_DOWN, 'Next Match (Enter)', () => findNext(this.view)));
		findRow.appendChild(this.makeButton(CLOSE, 'Close (Escape)', () => closeSearchPanel(this.view)));

		// ---- Replace row ----
		if (!readonly) {
			this.replaceRow = document.createElement('div');
			this.replaceRow.className = 'ggdFindRow';
			this.replaceRow.style.display = 'none';
			rows.appendChild(this.replaceRow);

			const replaceWrap = document.createElement('div');
			replaceWrap.className = 'ggdFindInputWrap';
			this.replaceRow.appendChild(replaceWrap);

			this.replaceInput = document.createElement('input');
			this.replaceInput.className = 'ggdFindInput';
			this.replaceInput.placeholder = 'Replace';
			this.replaceInput.value = this.query.replace;
			this.replaceInput.addEventListener('input', () => this.commit());
			replaceWrap.appendChild(this.replaceInput);

			this.replaceRow.appendChild(this.makeButton(REPLACE, 'Replace', () => replaceNext(this.view)));
			this.replaceRow.appendChild(this.makeButton(REPLACE_ALL, 'Replace All', () => replaceAll(this.view)));
		}

		this.updateCount();
	}

	private makeToggle(label: string, title: string, onClick: () => void): HTMLElement {
		const btn = document.createElement('div');
		btn.className = 'ggdFindToggle';
		btn.title = title;
		btn.textContent = label;
		btn.addEventListener('mousedown', (e) => {
			e.preventDefault(); // Keep focus in the input
			onClick();
		});
		return btn;
	}

	private makeButton(pathData: string, title: string, onClick: () => void): HTMLElement {
		const btn = document.createElement('div');
		btn.className = 'ggdFindBtn';
		btn.title = title;
		btn.appendChild(icon(pathData));
		btn.addEventListener('mousedown', (e) => {
			e.preventDefault();
			onClick();
		});
		return btn;
	}

	private toggleReplace() {
		if (this.replaceRow === null || this.chevronBtn === null) return;
		this.replaceExpanded = !this.replaceExpanded;
		this.replaceRow.style.display = this.replaceExpanded ? '' : 'none';
		this.chevronBtn.classList.toggle('expanded', this.replaceExpanded);
	}

	/** Build a new SearchQuery from the inputs (+ overrides) and dispatch it. */
	private commit(overrides?: Partial<{ caseSensitive: boolean; wholeWord: boolean; regexp: boolean }>) {
		const query = new SearchQuery({
			search: this.searchInput.value,
			replace: this.replaceInput !== null ? this.replaceInput.value : '',
			caseSensitive: overrides && overrides.caseSensitive !== undefined ? overrides.caseSensitive : this.query.caseSensitive,
			wholeWord: overrides && overrides.wholeWord !== undefined ? overrides.wholeWord : this.query.wholeWord,
			regexp: overrides && overrides.regexp !== undefined ? overrides.regexp : this.query.regexp
		});
		if (!query.eq(this.query)) {
			this.query = query;
			this.view.dispatch({ effects: setSearchQuery.of(query) });
		}
		this.syncToggles();
		this.updateCount();
	}

	private syncToggles() {
		this.caseBtn.classList.toggle('active', this.query.caseSensitive);
		this.wordBtn.classList.toggle('active', this.query.wholeWord);
		this.regexBtn.classList.toggle('active', this.query.regexp);
	}

	private updateCount() {
		if (this.query.search === '' || !this.query.valid) {
			this.countElem.textContent = '';
			this.countElem.classList.remove('noResults');
			return;
		}
		const state = this.view.state;
		const sel = state.selection.main;
		let total = 0, current = 0;
		const cursor = this.query.getCursor(state);
		let item = cursor.next();
		while (!item.done && total <= MAX_COUNT) {
			total++;
			if (item.value.from === sel.from && item.value.to === sel.to) current = total;
			item = cursor.next();
		}
		if (total === 0) {
			this.countElem.textContent = 'No results';
			this.countElem.classList.add('noResults');
		} else {
			this.countElem.classList.remove('noResults');
			const totalText = total > MAX_COUNT ? MAX_COUNT + '+' : String(total);
			this.countElem.textContent = (current > 0 ? current : '?') + ' of ' + totalText;
		}
	}

	private onKeydown(e: KeyboardEvent) {
		if (runScopeHandlers(this.view, e, 'search-panel')) {
			e.preventDefault();
		} else if (e.key === 'Enter' && e.target === this.searchInput) {
			e.preventDefault();
			(e.shiftKey ? findPrevious : findNext)(this.view);
		} else if (e.key === 'Enter' && this.replaceInput !== null && e.target === this.replaceInput) {
			e.preventDefault();
			replaceNext(this.view);
		}
	}

	public mount() {
		this.searchInput.focus();
		this.searchInput.select();
		this.query = getSearchQuery(this.view.state);
		this.searchInput.value = this.query.search;
		this.syncToggles();
		this.updateCount();
	}

	public update(update: ViewUpdate) {
		for (const tr of update.transactions) {
			for (const effect of tr.effects) {
				if (effect.is(setSearchQuery) && !effect.value.eq(this.query)) {
					this.query = effect.value;
					this.searchInput.value = this.query.search;
					if (this.replaceInput !== null) this.replaceInput.value = this.query.replace;
					this.syncToggles();
				}
			}
		}
		if (update.docChanged || update.selectionSet) this.updateCount();
	}
}

const findTheme = EditorView.theme({
	'.cm-panels.cm-panels-top': {
		position: 'absolute',
		top: '0',
		left: '0',
		right: '0',
		zIndex: '10',
		pointerEvents: 'none',
		backgroundColor: 'transparent',
		borderBottom: 'none'
	},
	'.ggdFindWidget': {
		pointerEvents: 'auto',
		position: 'absolute',
		top: '0',
		right: '14px',
		display: 'flex',
		alignItems: 'stretch',
		backgroundColor: 'var(--vscode-editorWidget-background)',
		border: '1px solid var(--vscode-editorWidget-border)',
		borderTop: 'none',
		borderRadius: '0 0 4px 4px',
		boxShadow: '0 0 8px 2px var(--vscode-widget-shadow)',
		padding: '4px 4px 4px 0',
		color: 'var(--vscode-foreground)',
		fontSize: '12px',
		fontFamily: 'var(--vscode-font-family)'
	},
	'.ggdFindChevron': {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		width: '18px',
		cursor: 'pointer',
		color: 'var(--vscode-foreground)',
		borderRadius: '3px'
	},
	'.ggdFindChevron:hover': {
		backgroundColor: 'rgba(90, 93, 94, 0.31)'
	},
	'.ggdFindChevron.expanded svg': {
		transform: 'rotate(90deg)'
	},
	'.ggdFindChevronHidden': {
		visibility: 'hidden',
		cursor: 'default'
	},
	'.ggdFindRows': {
		display: 'flex',
		flexDirection: 'column',
		gap: '4px'
	},
	'.ggdFindRow': {
		display: 'flex',
		alignItems: 'center'
	},
	'.ggdFindInputWrap': {
		display: 'flex',
		alignItems: 'center',
		width: '220px',
		backgroundColor: 'var(--vscode-input-background)',
		border: '1px solid transparent',
		borderRadius: '2px',
		padding: '0 2px 0 0'
	},
	'.ggdFindInputWrap:focus-within': {
		borderColor: 'var(--vscode-focusBorder)'
	},
	'.ggdFindInput': {
		flex: '1',
		minWidth: '0',
		background: 'transparent',
		border: 'none',
		outline: 'none',
		color: 'var(--vscode-input-foreground)',
		fontSize: '12px',
		fontFamily: 'var(--vscode-font-family)',
		padding: '3px 4px',
		lineHeight: '18px'
	},
	'.ggdFindToggle': {
		flexShrink: '0',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		minWidth: '20px',
		height: '20px',
		margin: '0 1px',
		cursor: 'pointer',
		borderRadius: '3px',
		border: '1px solid transparent',
		fontSize: '11px',
		color: 'var(--vscode-foreground)',
		userSelect: 'none'
	},
	'.ggdFindToggle:hover': {
		backgroundColor: 'rgba(90, 93, 94, 0.31)'
	},
	'.ggdFindToggle.active': {
		backgroundColor: 'var(--vscode-inputOption-activeBackground)',
		borderColor: 'var(--vscode-inputOption-activeBorder)'
	},
	'.ggdFindCount': {
		minWidth: '60px',
		padding: '0 4px 0 8px',
		color: 'var(--vscode-foreground)',
		whiteSpace: 'nowrap'
	},
	'.ggdFindCount.noResults': {
		color: '#f48771'
	},
	'.ggdFindBtn': {
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center',
		width: '22px',
		height: '22px',
		marginLeft: '2px',
		cursor: 'pointer',
		borderRadius: '3px',
		color: 'var(--vscode-foreground)'
	},
	'.ggdFindBtn:hover': {
		backgroundColor: 'rgba(90, 93, 94, 0.31)'
	}
}, { dark: true });

/** The search extension configured with the VS Code-style floating widget. */
export function vscodeSearch(): Extension {
	return [
		search({ top: true, createPanel: (view) => new FindPanel(view) }),
		findTheme
	];
}
