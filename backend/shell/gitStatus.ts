/**
 * Explorer git decorations: parse `git status --porcelain -z` output
 * (per-file untracked entries + directory-collapsed ignored entries, see
 * gitCli.getStatusPorcelain) into a map of absolute path → { letter, color },
 * matching VS Code's git extension (Resource.getStatusLetter/getStatusColor):
 * coloured filenames with a right-aligned status letter, colours propagated
 * to ancestor directories (except for deletions and ignored entries, which
 * never propagate), ignored entries coloured but letter-less.
 */

import { getStatusPorcelain } from '../graph/gitCli';

export interface TreeDecoration {
	/** The status letter badge (M, U, A, D, R, C, T, !) — null → colour only. */
	letter: string | null;
	/** Full CSS var() reference for the row colour. */
	color: string;
}

const COLOR_MODIFIED = 'var(--vscode-gitDecoration-modifiedResourceForeground)';
const COLOR_ADDED = 'var(--vscode-gitDecoration-addedResourceForeground)';
const COLOR_DELETED = 'var(--vscode-gitDecoration-deletedResourceForeground)';
const COLOR_UNTRACKED = 'var(--vscode-gitDecoration-untrackedResourceForeground)';
const COLOR_RENAMED = 'var(--vscode-gitDecoration-renamedResourceForeground)';
export const COLOR_IGNORED = 'var(--vscode-gitDecoration-ignoredResourceForeground)';
const COLOR_CONFLICTING = 'var(--vscode-gitDecoration-conflictingResourceForeground)';

const CONFLICT_CODES = ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU'];

interface DecodedStatus {
	letter: string | null;
	color: string;
	propagate: boolean;
}

/**
 * Priority when colours bubbled up from different descendants meet in the
 * same ancestor directory: conflicting > untracked > modified > first-come.
 */
function propagationRank(color: string): number {
	if (color === COLOR_CONFLICTING) return 3;
	if (color === COLOR_UNTRACKED) return 2;
	if (color === COLOR_MODIFIED) return 1;
	return 0;
}

/** Map a porcelain XY status code to its VS Code decoration. */
function decodeStatus(xy: string): DecodedStatus | null {
	if (CONFLICT_CODES.indexOf(xy) > -1) return { letter: '!', color: COLOR_CONFLICTING, propagate: true };
	if (xy === '??') return { letter: 'U', color: COLOR_UNTRACKED, propagate: true };
	if (xy === '!!') return { letter: null, color: COLOR_IGNORED, propagate: false };

	// Work tree column takes precedence, then the index column
	switch (xy[1]) {
		case 'M': return { letter: 'M', color: COLOR_MODIFIED, propagate: true };
		case 'T': return { letter: 'T', color: COLOR_MODIFIED, propagate: true };
		case 'D': return { letter: 'D', color: COLOR_DELETED, propagate: false };
		case 'A': return { letter: 'A', color: COLOR_ADDED, propagate: true }; // intent-to-add
	}
	switch (xy[0]) {
		case 'M': return { letter: 'M', color: COLOR_MODIFIED, propagate: true };
		case 'T': return { letter: 'T', color: COLOR_MODIFIED, propagate: true };
		case 'A': return { letter: 'A', color: COLOR_ADDED, propagate: true };
		case 'D': return { letter: 'D', color: COLOR_DELETED, propagate: false };
		case 'R': return { letter: 'R', color: COLOR_RENAMED, propagate: true };
		case 'C': return { letter: 'C', color: COLOR_RENAMED, propagate: true };
	}
	return null;
}

/**
 * Fetch & parse the repository status into a map of absolute path →
 * decoration (keys are absolute so the tree can look rows up directly even
 * when the opened folder is a subdirectory of the repository root).
 */
export async function fetchDecorations(repo: string): Promise<Map<string, TreeDecoration>> {
	return parseDecorations(await getStatusPorcelain(repo), repo);
}

/** Parse NUL-separated porcelain status output (pure — unit-testable). */
export function parseDecorations(stdout: string, repo: string): Map<string, TreeDecoration> {
	const fields = stdout.split('\0');
	const map = new Map<string, TreeDecoration>();
	const propagated = new Map<string, TreeDecoration>();

	for (let i = 0; i < fields.length; i++) {
		const record = fields[i];
		if (record.length < 4) continue; // "XY <path>" at minimum
		const xy = record.substring(0, 2);
		if (xy[0] === 'R' || xy[0] === 'C') i++; // The next field is the "from" path — skip it
		const status = decodeStatus(xy);
		if (status === null) continue;

		let relPath = record.substring(3);
		// Ignored directories are reported with a trailing slash (e.g. "!! node_modules/")
		if (relPath.endsWith('/')) relPath = relPath.substring(0, relPath.length - 1);
		map.set(repo + '/' + relPath, { letter: status.letter, color: status.color });

		if (status.propagate) {
			// Bubble the colour (letter-less) up to the ancestor directories,
			// including the repo root itself (shown as a row when the opened
			// folder is above the repo). Merging follows propagationRank.
			let dir = repo + '/' + relPath, slash;
			while ((slash = dir.lastIndexOf('/')) > -1) {
				dir = dir.substring(0, slash);
				if (dir.length < repo.length) break;
				const existing = propagated.get(dir);
				if (existing === undefined || propagationRank(status.color) > propagationRank(existing.color)) {
					propagated.set(dir, { letter: null, color: status.color });
				}
			}
		}
	}

	// Direct entries (e.g. an ignored directory) win over propagated colours
	propagated.forEach((decoration, path) => {
		if (!map.has(path)) map.set(path, decoration);
	});
	return map;
}
