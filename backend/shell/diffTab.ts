/**
 * VS Code-style diff tabs: the Git Graph's file rows open diff tabs in the
 * shell (like VS Code's diff editor), rendered with a readonly side-by-side
 * @codemirror/merge MergeView.
 *
 * The two sides are resolved to full file contents:
 *   fromHash === toHash                → parent (hash^) vs hash
 *   fromHash === toHash === UNCOMMITTED → HEAD vs working tree
 *   otherwise                          → fromHash vs toHash (or working tree
 *                                        when toHash is UNCOMMITTED)
 */

import { MergeView } from '@codemirror/merge';
import { readTextFile } from '@tauri-apps/plugin-fs';
import { GitFileStatusCode, UNCOMMITTED, abbrev, getCommitFile } from '../graph/gitCli';
import { openElementTab, openNoticeTab, readonlyExtensions } from './editor';
import { openViewTab } from './tabs';

function basename(path: string) {
	return path.substring(path.lastIndexOf('/') + 1);
}

function isBinary(text: string) {
	return text.indexOf('\0') > -1;
}

// Same limit as the editor's open-file guard
const MAX_DIFF_SIZE = 5 * 1024 * 1024;
// Above this, unchanged regions are collapsed: the merge view scrolls as one
// unit, so CodeMirror cannot virtualize — the whole document is rendered into
// the DOM. Collapsing keeps the DOM (and memory) proportional to the changes.
const COLLAPSE_THRESHOLD = 256 * 1024;

/**
 * Open a side-by-side diff of a file between two revisions in a view tab
 * (focusing the existing tab if this exact diff is already open).
 */
export async function openDiffTab(repo: string, fromHash: string, toHash: string, oldFilePath: string, newFilePath: string, type: GitFileStatusCode): Promise<void> {
	const desc = fromHash === toHash
		? fromHash === UNCOMMITTED
			? 'Uncommitted Changes'
			: abbrev(fromHash) + '^ ↔ ' + abbrev(fromHash)
		: toHash === UNCOMMITTED
			? abbrev(fromHash) + ' ↔ Present'
			: abbrev(fromHash) + ' ↔ ' + abbrev(toHash);
	const key = 'diff:' + repo + ':' + fromHash + ':' + toHash + ':' + newFilePath;
	const label = basename(newFilePath) + ' (' + desc + ')';

	await openViewTab(key, label, newFilePath + ' (' + desc + ')', async (tabId) => {
		const leftRef = fromHash === toHash
			? (fromHash === UNCOMMITTED ? 'HEAD' : fromHash + '^')
			: fromHash;

		// Left side: empty for files that didn't exist yet ('A' added, 'U'
		// untracked); a failed read of hash^ (e.g. a root commit) is also
		// treated as "didn't exist".
		let left = '';
		if (type !== 'A' && type !== 'U') {
			try {
				left = await getCommitFile(repo, leftRef, oldFilePath);
			} catch (_) {
				left = '';
			}
		}

		// Right side: empty for deleted files; the working tree when the diff
		// is against the present state.
		let right = '';
		if (type !== 'D') {
			right = toHash === UNCOMMITTED
				? await readTextFile(repo + '/' + newFilePath)
				: await getCommitFile(repo, toHash, newFilePath);
		}

		if (isBinary(left) || isBinary(right)) {
			openNoticeTab(tabId, 'This file is binary and cannot be diffed in the editor.');
			return;
		}
		if (left.length > MAX_DIFF_SIZE || right.length > MAX_DIFF_SIZE) {
			openNoticeTab(tabId, 'This file is too large to diff in the editor.');
			return;
		}

		const container = document.createElement('div');
		const large = left.length > COLLAPSE_THRESHOLD || right.length > COLLAPSE_THRESHOLD;
		const mergeView = new MergeView({
			a: { doc: left, extensions: readonlyExtensions(oldFilePath) },
			b: { doc: right, extensions: readonlyExtensions(newFilePath) },
			collapseUnchanged: large ? { margin: 3, minSize: 4 } : undefined,
			parent: container
		});
		openElementTab(tabId, container, () => mergeView.destroy());
	});
}
