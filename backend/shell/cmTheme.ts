/**
 * Hand-rolled CodeMirror 6 theme (no extra theme deps).
 *
 * Every colour is a var() reference to the inline variables applied by
 * backend/theme.ts (set on document.documentElement, so var() resolves inside
 * the editor): --vscode-* for shared chrome, --ggd-ed-* for editor chrome and
 * --ggd-tok-* for syntax tokens. Switching themes re-sets the variables — the
 * editor needs no reconfiguration. The { dark: true } flag is static: the few
 * styles CodeMirror derives from it are all overridden below.
 */

import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';

const editorTheme = EditorView.theme({
	'&': {
		backgroundColor: 'var(--vscode-editor-background)',
		color: 'var(--ggd-ed-fg)',
		fontSize: 'var(--vscode-editor-font-size)'
	},
	'.cm-scroller': {
		fontFamily: 'var(--vscode-editor-font-family)',
		lineHeight: '1.5'
	},
	// VS Code scrollbars: flat, edge-to-edge 14px thumbs, transparent track
	'.cm-scroller::-webkit-scrollbar': {
		width: '14px',
		height: '14px'
	},
	'.cm-scroller::-webkit-scrollbar-track': {
		background: 'transparent'
	},
	'.cm-scroller::-webkit-scrollbar-thumb': {
		background: 'var(--vscode-scrollbarSlider-background)'
	},
	'.cm-scroller::-webkit-scrollbar-thumb:hover': {
		background: 'var(--vscode-scrollbarSlider-hoverBackground)'
	},
	'.cm-scroller::-webkit-scrollbar-thumb:active': {
		background: 'var(--vscode-scrollbarSlider-activeBackground)'
	},
	'.cm-scroller::-webkit-scrollbar-corner': {
		background: 'transparent'
	},
	'.cm-content': {
		padding: '0',
		caretColor: 'var(--ggd-ed-caret)'
	},
	'.cm-cursor, .cm-dropCursor': {
		borderLeftColor: 'var(--ggd-ed-caret)',
		borderLeftWidth: '2px'
	},
	'&.cm-focused': {
		outline: 'none'
	},
	// Selection: theme accent when focused, muted when the editor is unfocused
	'.cm-selectionBackground': {
		backgroundColor: 'var(--ggd-ed-selection-blur)'
	},
	'&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground': {
		backgroundColor: 'var(--ggd-ed-selection)'
	},
	// VS Code-style current line: a subtle border box, not a fill
	'.cm-activeLine': {
		backgroundColor: 'transparent',
		outline: '1px solid var(--ggd-ed-activeline)',
		outlineOffset: '-1px'
	},
	'.cm-gutters': {
		backgroundColor: 'var(--vscode-editor-background)',
		color: 'var(--ggd-ed-gutter)',
		border: 'none'
	},
	'.cm-lineNumbers .cm-gutterElement': {
		padding: '0 17px 0 0',
		minWidth: '40px'
	},
	'.cm-activeLineGutter': {
		backgroundColor: 'transparent',
		color: 'var(--ggd-ed-gutter-active)'
	},
	// Fold markers: a 16px column, visible only while hovering the gutters
	// (matching VS Code's editor.showFoldingControls: "mouseover" default)
	'.cm-foldGutter .cm-gutterElement': {
		width: '16px',
		opacity: '0',
		cursor: 'pointer',
		display: 'flex',
		alignItems: 'center',
		justifyContent: 'center'
	},
	'.cm-gutters:hover .cm-foldGutter .cm-gutterElement': {
		opacity: '1'
	},
	'.cm-foldGutter svg': {
		display: 'block'
	},
	'.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
		backgroundColor: 'var(--ggd-ed-bracket-bg)',
		outline: '1px solid var(--ggd-ed-bracket-outline)',
		outlineOffset: '-1px'
	},
	'.cm-nonmatchingBracket, &.cm-focused .cm-nonmatchingBracket': {
		backgroundColor: 'rgba(255, 18, 18, 0.25)'
	},
	'.cm-selectionMatch': {
		backgroundColor: 'var(--ggd-ed-selection-match)'
	},
	'.cm-searchMatch': {
		backgroundColor: 'var(--vscode-editor-findMatchHighlightBackground)'
	},
	'.cm-searchMatch.cm-searchMatch-selected': {
		backgroundColor: 'var(--vscode-editor-findMatchBackground)'
	},
	// Subtle shadow at the top of the editor when scrolled (VS Code style)
	'&.cm-scrolled::before': {
		content: "''",
		position: 'absolute',
		top: '0',
		left: '0',
		right: '0',
		height: '6px',
		zIndex: '10',
		pointerEvents: 'none',
		boxShadow: 'var(--vscode-scrollbar-shadow) 0 6px 6px -6px inset'
	},
	'.cm-tooltip': {
		backgroundColor: 'var(--vscode-menu-background)',
		color: 'var(--vscode-menu-foreground)',
		border: '1px solid var(--vscode-menu-border)'
	}
}, { dark: true });

// Token colours via --ggd-tok-* variables (set per theme by backend/theme.ts)
const tokenHighlight = HighlightStyle.define([
	{ tag: [t.controlKeyword, t.moduleKeyword], color: 'var(--ggd-tok-ctrl)' },
	{ tag: [t.keyword, t.modifier, t.operatorKeyword, t.definitionKeyword, t.self, t.atom, t.bool, t.null], color: 'var(--ggd-tok-kw)' },
	{ tag: [t.string, t.special(t.string), t.character], color: 'var(--ggd-tok-str)' },
	{ tag: [t.regexp, t.escape], color: 'var(--ggd-tok-regex)' },
	{ tag: [t.comment, t.blockComment, t.lineComment, t.docComment], color: 'var(--ggd-tok-comment)' },
	{ tag: [t.function(t.variableName), t.function(t.propertyName), t.macroName], color: 'var(--ggd-tok-fn)' },
	{ tag: [t.typeName, t.className, t.namespace], color: 'var(--ggd-tok-type)' },
	{ tag: [t.number, t.integer, t.float], color: 'var(--ggd-tok-num)' },
	{ tag: [t.variableName, t.propertyName, t.definition(t.variableName), t.attributeName], color: 'var(--ggd-tok-var)' },
	{ tag: [t.constant(t.variableName), t.standard(t.variableName)], color: 'var(--ggd-tok-const)' },
	{ tag: t.tagName, color: 'var(--ggd-tok-tag)' },
	{ tag: [t.operator, t.punctuation, t.bracket, t.separator], color: 'var(--ggd-tok-op)' },
	{ tag: t.meta, color: 'var(--ggd-tok-meta)' },
	{ tag: t.heading, color: 'var(--ggd-tok-kw)', fontWeight: 'bold' },
	{ tag: t.strong, fontWeight: 'bold' },
	{ tag: t.emphasis, fontStyle: 'italic' },
	{ tag: t.strikethrough, textDecoration: 'line-through' },
	{ tag: t.link, color: 'var(--ggd-tok-link)', textDecoration: 'underline' },
	{ tag: t.url, color: 'var(--ggd-tok-link)' },
	{ tag: t.invalid, color: 'var(--ggd-tok-invalid)' }
]);

// Toggle the cm-scrolled class (→ top shadow) as the editor scrolls
const scrollShadow = ViewPlugin.define((view) => {
	const onScroll = () => {
		view.dom.classList.toggle('cm-scrolled', view.scrollDOM.scrollTop > 0);
	};
	view.scrollDOM.addEventListener('scroll', onScroll);
	onScroll();
	return {
		destroy: () => view.scrollDOM.removeEventListener('scroll', onScroll)
	};
});

export const darkPlusTheme: Extension = [editorTheme, syntaxHighlighting(tokenHighlight), scrollShadow];
