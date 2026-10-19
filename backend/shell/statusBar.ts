/**
 * The VS Code-style status bar (22px, #007acc): current branch on the left
 * (click → Git Graph tab), and Ln/Col, encoding, EOL and language of the
 * active editor on the right.
 */

import { ICON_GIT_BRANCH, iconSvg } from './icons';

export interface EditorStatus {
	line: number;
	col: number;
	lang: string;
}

let branchItem: HTMLElement | null = null;
let cursorItem: HTMLElement | null = null;
let encodingItem: HTMLElement | null = null;
let eolItem: HTMLElement | null = null;
let langItem: HTMLElement | null = null;

function makeItem(clickable: boolean): HTMLElement {
	const item = document.createElement('div');
	item.className = 'ggdStatusItem' + (clickable ? ' clickable' : '');
	item.style.display = 'none';
	return item;
}

/** Build the status bar items inside the shell's status bar element. */
export function initStatusBar(statusbar: HTMLElement, onBranchClick: (() => void) | null) {
	const left = document.createElement('div');
	left.className = 'ggdStatusGroup';
	const right = document.createElement('div');
	right.className = 'ggdStatusGroup ggdStatusRight';
	statusbar.appendChild(left);
	statusbar.appendChild(right);

	branchItem = makeItem(onBranchClick !== null);
	branchItem.title = 'Git Graph';
	if (onBranchClick !== null) branchItem.addEventListener('click', onBranchClick);
	left.appendChild(branchItem);

	cursorItem = makeItem(false);
	encodingItem = makeItem(false);
	encodingItem.textContent = 'UTF-8';
	eolItem = makeItem(false);
	eolItem.textContent = 'LF';
	langItem = makeItem(false);
	right.appendChild(cursorItem);
	right.appendChild(encodingItem);
	right.appendChild(eolItem);
	right.appendChild(langItem);
}

/** Show the branch name (null → hide the item). */
export function setStatusBranch(branch: string | null) {
	if (branchItem === null) return;
	if (branch === null) {
		branchItem.style.display = 'none';
	} else {
		branchItem.style.display = '';
		branchItem.innerHTML = iconSvg(ICON_GIT_BRANCH, 14) + '<span></span>';
		branchItem.getElementsByTagName('span')[0].textContent = branch;
	}
}

/** Show cursor position & language of the active editor (null → hide). */
export function setEditorStatus(status: EditorStatus | null) {
	if (cursorItem === null || langItem === null || encodingItem === null || eolItem === null) return;
	const display = status === null ? 'none' : '';
	cursorItem.style.display = display;
	encodingItem.style.display = display;
	eolItem.style.display = display;
	langItem.style.display = display;
	if (status !== null) {
		cursorItem.textContent = 'Ln ' + status.line + ', Col ' + status.col;
		langItem.textContent = status.lang;
	}
}
