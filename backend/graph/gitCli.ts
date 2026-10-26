/**
 * Read-only Git CLI layer for the graph view. Every function here is a pure
 * read (log / for-each-ref / status / diff-tree / show) — this application
 * never mutates a repository.
 *
 * Machine-readable output uses custom record formats with the ASCII unit
 * separator (0x1f) between fields and the record separator (0x1e) between
 * records, so arbitrary commit messages can't break parsing.
 */

import { spawnGit } from '../spawn';

const FIELD = '\x1f';
const RECORD = '\x1e';

/** Sentinel "hash" representing the uncommitted working tree state. */
export const UNCOMMITTED = '*';

/** The short form of a commit hash used throughout the UI. */
export function abbrev(hash: string): string {
	return hash === UNCOMMITTED ? hash : hash.substring(0, 8);
}

export type GitFileStatusCode = 'A' | 'M' | 'D' | 'R' | 'U';

export interface GitFileChange {
	status: GitFileStatusCode;
	/** The pre-rename path (equals newPath unless status is 'R'). */
	oldPath: string;
	newPath: string;
	/** Lines added, or null when unknown (binary / untracked). */
	additions: number | null;
	/** Lines deleted, or null when unknown (binary / untracked). */
	deletions: number | null;
}

export interface GitCommit {
	hash: string;
	parents: string[];
	author: string;
	email: string;
	/** Unix timestamp (seconds). */
	date: number;
	message: string;
}

export interface GitRef {
	hash: string;
	/** Short name, e.g. "main", "origin/main", "v1.0.0". */
	name: string;
	type: 'head' | 'remote' | 'tag';
}

export interface GitStash {
	hash: string;
	baseHash: string;
	/** The reflog selector, e.g. "stash@{0}". */
	selector: string;
	date: number;
	message: string;
}

export interface GitCommitDetails {
	parents: string[];
	author: string;
	email: string;
	date: number;
	committer: string;
	body: string;
}

/** Run git, resolving with stdout, rejecting on a non-zero exit. */
async function run(repo: string, args: string[]): Promise<string> {
	const [status, stdout, stderr] = await spawnGit(args, repo);
	if (status.code !== 0) {
		const detail = stderr.trim() !== '' ? stderr.trim()
			: status.error !== null ? status.error.message
				: 'git exited with code ' + status.code;
		throw new Error(detail);
	}
	return stdout;
}

/** Resolve the repository root containing `folder`, or null if not a repo. */
export async function getRepoRoot(folder: string): Promise<string | null> {
	try {
		const out = await run(folder, ['rev-parse', '--show-toplevel']);
		const root = out.trim();
		return root !== '' ? root : null;
	} catch (_) {
		return null;
	}
}

/**
 * Load the newest `maxCount` commits in date order. `branches` restricts the
 * walk to the given refs; null means everything (all branches, tags, HEAD,
 * plus remotes unless `includeRemotes` is false).
 */
export async function getCommits(repo: string, branches: string[] | null, maxCount: number, includeRemotes: boolean): Promise<GitCommit[]> {
	const args = [
		'-c', 'log.showSignature=false', 'log',
		'--max-count=' + maxCount, '--date-order',
		'--format=%H' + FIELD + '%P' + FIELD + '%an' + FIELD + '%ae' + FIELD + '%at' + FIELD + '%s' + RECORD
	];
	if (branches === null) {
		args.push('--branches');
		if (includeRemotes) args.push('--remotes');
		args.push('--tags', 'HEAD');
	} else {
		for (const branch of branches) args.push(branch);
	}
	args.push('--');

	const out = await run(repo, args);
	const commits: GitCommit[] = [];
	for (const record of out.split(RECORD)) {
		const fields = record.replace(/^\n/, '').split(FIELD);
		if (fields.length < 6) continue;
		commits.push({
			hash: fields[0],
			parents: fields[1] !== '' ? fields[1].split(' ') : [],
			author: fields[2],
			email: fields[3],
			date: parseInt(fields[4], 10),
			message: fields[5]
		});
	}
	return commits;
}

/**
 * All branch heads, remote branches and tags, plus the current HEAD (hash +
 * branch name, name null when detached, both null for an empty repository).
 */
export async function getRefs(repo: string): Promise<{ headHash: string | null; headBranch: string | null; refs: GitRef[] }> {
	const out = await run(repo, ['for-each-ref', '--format=%(objectname)' + FIELD + '%(refname)' + FIELD + '%(*objectname)']);
	const refs: GitRef[] = [];
	for (const line of out.split('\n')) {
		const fields = line.split(FIELD);
		if (fields.length < 2) continue;
		const hash = fields[0], refName = fields[1], peeled = fields.length > 2 ? fields[2] : '';
		if (refName.startsWith('refs/heads/')) {
			refs.push({ hash: hash, name: refName.substring(11), type: 'head' });
		} else if (refName.startsWith('refs/remotes/')) {
			const name = refName.substring(13);
			if (!name.endsWith('/HEAD')) refs.push({ hash: hash, name: name, type: 'remote' });
		} else if (refName.startsWith('refs/tags/')) {
			refs.push({ hash: peeled !== '' ? peeled : hash, name: refName.substring(10), type: 'tag' });
		}
	}

	let headHash: string | null = null, headBranch: string | null = null;
	try {
		headHash = (await run(repo, ['rev-parse', 'HEAD'])).trim();
	} catch (_) {
		// Empty repository (no commits yet)
	}
	if (headHash !== null) {
		try {
			const symbolic = (await run(repo, ['symbolic-ref', '-q', 'HEAD'])).trim();
			if (symbolic.startsWith('refs/heads/')) headBranch = symbolic.substring(11);
		} catch (_) {
			// Detached HEAD
		}
	}
	return { headHash: headHash, headBranch: headBranch, refs: refs };
}

/** The stash list (first parent of a stash commit is the commit it is based on). */
export async function getStashes(repo: string): Promise<GitStash[]> {
	let out: string;
	try {
		out = await run(repo, ['stash', 'list', '--format=%H' + FIELD + '%P' + FIELD + '%gd' + FIELD + '%at' + FIELD + '%gs' + RECORD]);
	} catch (_) {
		return []; // e.g. an empty repository
	}
	const stashes: GitStash[] = [];
	for (const record of out.split(RECORD)) {
		const fields = record.replace(/^\n/, '').split(FIELD);
		if (fields.length < 5) continue;
		const parents = fields[1] !== '' ? fields[1].split(' ') : [];
		if (parents.length === 0) continue;
		stashes.push({
			hash: fields[0],
			baseHash: parents[0],
			selector: fields[2],
			date: parseInt(fields[3], 10),
			message: fields[4]
		});
	}
	return stashes;
}

/** Raw `git status --porcelain -z` output including ignored entries (for the explorer decorations). */
export async function getStatusPorcelain(repo: string): Promise<string> {
	// Two calls, not one: combining -uall with --ignored=traditional makes git
	// list every individual file INSIDE ignored directories (tens of MB in
	// node_modules-heavy repos). Untracked entries are fetched per-file, then
	// ignored entries separately with directories collapsed.
	const changes = await run(repo, ['-c', 'core.quotePath=false', 'status', '--porcelain', '-z', '-uall']);
	const ignored = await run(repo, [
		'-c',
		'core.quotePath=false',
		'status',
		'--porcelain',
		'-z',
		'-unormal',
		'--ignored=traditional'
	]);
	const ignoredOnly = ignored.split('\0').filter((record) => record.startsWith('!!'));
	return ignoredOnly.length === 0 ? changes : changes + ignoredOnly.join('\0') + '\0';
}

/**
 * Parse NUL-separated `--numstat -z` output into newPath → line counts.
 * Records are "added TAB deleted TAB path"; with renames the path field is
 * empty and the old/new paths follow as two separate NUL fields. Binary
 * files report "-" counts and are skipped (counts stay unknown).
 */
function parseNumstat(out: string): Map<string, { additions: number; deletions: number }> {
	const fields = out.split('\0');
	const map = new Map<string, { additions: number; deletions: number }>();
	for (let i = 0; i < fields.length; i++) {
		const record = fields[i];
		if (record === '' || /^[0-9a-f]{40,}$/.test(record)) continue; // Blank / the commit id line
		const parts = record.split('\t');
		if (parts.length < 3) continue;
		let path = parts[2];
		if (path === '') { // Rename: the next two fields are old path, new path
			i += 2;
			if (fields[i] === undefined) break;
			path = fields[i];
		}
		if (parts[0] === '-' || parts[1] === '-') continue; // Binary
		map.set(path, { additions: parseInt(parts[0], 10), deletions: parseInt(parts[1], 10) });
	}
	return map;
}

/** The working tree's uncommitted changes (staged + unstaged + untracked). */
export async function getUncommittedChanges(repo: string): Promise<GitFileChange[]> {
	const [out, numstatOut] = await Promise.all([
		run(repo, ['-c', 'core.quotePath=false', 'status', '--porcelain', '-z', '-uall']),
		// Working tree vs HEAD (fails in an empty repository → no counts)
		run(repo, ['-c', 'core.quotePath=false', 'diff', '--numstat', '-z', '--find-renames', 'HEAD']).catch(() => '')
	]);
	const stats = parseNumstat(numstatOut);
	const fields = out.split('\0');
	const changes: GitFileChange[] = [];
	const seen = new Set<string>();
	for (let i = 0; i < fields.length; i++) {
		const record = fields[i];
		if (record.length < 4) continue;
		const xy = record.substring(0, 2);
		const path = record.substring(3);
		let oldPath = path;
		if (xy[0] === 'R' || xy[0] === 'C') {
			i++; // The following NUL-separated field is the original path
			if (i < fields.length) oldPath = fields[i];
		}
		if (seen.has(path)) continue;
		seen.add(path);
		let status: GitFileStatusCode;
		if (xy === '??') status = 'U';
		else if (xy[0] === 'R') status = 'R';
		else if (xy[0] === 'A' || xy[1] === 'A') status = 'A';
		else if (xy[0] === 'D' || xy[1] === 'D') status = 'D';
		else status = 'M';
		const stat = stats.get(path);
		changes.push({
			status: status, oldPath: oldPath, newPath: path,
			additions: stat !== undefined ? stat.additions : null,
			deletions: stat !== undefined ? stat.deletions : null
		});
	}
	return changes;
}

/** The files changed by a commit (against its first parent; --root handles the initial commit). */
export async function getCommitChanges(repo: string, hash: string): Promise<GitFileChange[]> {
	const [out, numstatOut] = await Promise.all([
		run(repo, [
			'-c', 'core.quotePath=false', 'diff-tree', '-r', '--root', '-z',
			'--find-renames', '--name-status', '--format=', hash
		]),
		run(repo, [
			'-c', 'core.quotePath=false', 'diff-tree', '-r', '--root', '-z',
			'--find-renames', '--numstat', '--format=', hash
		]).catch(() => '')
	]);
	const stats = parseNumstat(numstatOut);
	const fields = out.split('\0');
	const changes: GitFileChange[] = [];
	for (let i = 0; i < fields.length; i++) {
		const code = fields[i];
		if (code === '' || /^[0-9a-f]{40,}$/.test(code)) continue; // Blank / the commit id line
		const letter = code[0];
		if (letter === 'R' || letter === 'C') {
			const oldPath = fields[i + 1], newPath = fields[i + 2];
			i += 2;
			if (newPath === undefined) break;
			const stat = stats.get(newPath);
			changes.push({
				status: 'R', oldPath: oldPath, newPath: newPath,
				additions: stat !== undefined ? stat.additions : null,
				deletions: stat !== undefined ? stat.deletions : null
			});
		} else {
			const path = fields[i + 1];
			i += 1;
			if (path === undefined) break;
			const status: GitFileStatusCode = letter === 'A' ? 'A' : letter === 'D' ? 'D' : 'M';
			const stat = stats.get(path);
			changes.push({
				status: status, oldPath: path, newPath: path,
				additions: stat !== undefined ? stat.additions : null,
				deletions: stat !== undefined ? stat.deletions : null
			});
		}
	}
	return changes;
}

/** Full details of one commit for the inline details panel. */
export async function getCommitBody(repo: string, hash: string): Promise<GitCommitDetails> {
	const out = await run(repo, [
		'-c', 'log.showSignature=false', 'show', '--no-patch', '--quiet',
		'--format=%P' + FIELD + '%an' + FIELD + '%ae' + FIELD + '%at' + FIELD + '%cn' + FIELD + '%B', hash
	]);
	const fields = out.split(FIELD);
	return {
		parents: fields[0] !== '' ? fields[0].split(' ') : [],
		author: fields[1] !== undefined ? fields[1] : '',
		email: fields[2] !== undefined ? fields[2] : '',
		date: fields[3] !== undefined ? parseInt(fields[3], 10) : 0,
		committer: fields[4] !== undefined ? fields[4] : '',
		body: fields[5] !== undefined ? fields[5].replace(/\n+$/, '') : ''
	};
}

/** The contents of a file at a revision. */
export function getCommitFile(repo: string, hash: string, path: string): Promise<string> {
	return run(repo, ['show', hash + ':' + path]);
}
