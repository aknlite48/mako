import { describe, expect, it } from 'vitest';
import { parseDecorations } from '../backend/shell/gitStatus';

const REPO = '/repo';

const MODIFIED = 'var(--vscode-gitDecoration-modifiedResourceForeground)';
const ADDED = 'var(--vscode-gitDecoration-addedResourceForeground)';
const DELETED = 'var(--vscode-gitDecoration-deletedResourceForeground)';
const UNTRACKED = 'var(--vscode-gitDecoration-untrackedResourceForeground)';
const RENAMED = 'var(--vscode-gitDecoration-renamedResourceForeground)';
const IGNORED = 'var(--vscode-gitDecoration-ignoredResourceForeground)';
const CONFLICTING = 'var(--vscode-gitDecoration-conflictingResourceForeground)';

/** Join porcelain -z records (and rename "from" fields) with NULs. */
function porcelain(...fields: string[]): string {
	return fields.join('\0') + '\0';
}

describe('parseDecorations', () => {
	it('decodes the common status letters', () => {
		const map = parseDecorations(porcelain(' M mod.txt', 'A  added.txt', ' D gone.txt', '?? new.txt'), REPO);
		expect(map.get('/repo/mod.txt')).toEqual({ letter: 'M', color: MODIFIED });
		expect(map.get('/repo/added.txt')).toEqual({ letter: 'A', color: ADDED });
		expect(map.get('/repo/gone.txt')).toEqual({ letter: 'D', color: DELETED });
		expect(map.get('/repo/new.txt')).toEqual({ letter: 'U', color: UNTRACKED });
	});

	it('skips the "from" field of renames and copies', () => {
		const map = parseDecorations(porcelain('R  new-name.txt', 'old-name.txt', ' M other.txt'), REPO);
		expect(map.get('/repo/new-name.txt')).toEqual({ letter: 'R', color: RENAMED });
		expect(map.has('/repo/old-name.txt')).toBe(false);
		expect(map.get('/repo/other.txt')).toEqual({ letter: 'M', color: MODIFIED });
	});

	it('marks conflicts with ! for all conflict XY codes', () => {
		for (const xy of ['DD', 'AU', 'UD', 'UA', 'DU', 'AA', 'UU']) {
			const map = parseDecorations(porcelain(xy + ' conflict.txt'), REPO);
			expect(map.get('/repo/conflict.txt')).toEqual({ letter: '!', color: CONFLICTING });
		}
	});

	it('propagates colour (letter-less) to ancestor directories and the repo root', () => {
		const map = parseDecorations(porcelain(' M src/deep/mod.txt'), REPO);
		expect(map.get('/repo/src')).toEqual({ letter: null, color: MODIFIED });
		expect(map.get('/repo/src/deep')).toEqual({ letter: null, color: MODIFIED });
		expect(map.get('/repo')).toEqual({ letter: null, color: MODIFIED });
		// A top-level file also marks the repo root (but nothing above it)
		const map2 = parseDecorations(porcelain('?? new.txt'), REPO);
		expect(map2.get('/repo')).toEqual({ letter: null, color: UNTRACKED });
		expect(map2.has('/')).toBe(false);
	});

	it('merges propagated colours as conflicting > untracked > modified', () => {
		const map = parseDecorations(porcelain(' M dir/a.txt', 'UU dir/b.txt'), REPO);
		expect(map.get('/repo/dir')).toEqual({ letter: null, color: CONFLICTING });
		// Order-independent: conflict first, modification second
		const map2 = parseDecorations(porcelain('UU dir/b.txt', ' M dir/a.txt'), REPO);
		expect(map2.get('/repo/dir')).toEqual({ letter: null, color: CONFLICTING });
		// A single untracked file turns the folder green even among M files
		const map3 = parseDecorations(porcelain(' M dir/a.txt', '?? dir/new.txt', ' M dir/b.txt'), REPO);
		expect(map3.get('/repo/dir')).toEqual({ letter: null, color: UNTRACKED });
		expect(map3.get('/repo')).toEqual({ letter: null, color: UNTRACKED });
	});

	it('does not propagate deletions or ignored entries', () => {
		const map = parseDecorations(porcelain(' D dir/gone.txt', '!! other/ignored.txt'), REPO);
		expect(map.has('/repo/dir')).toBe(false);
		expect(map.has('/repo/other')).toBe(false);
	});

	it('strips the trailing slash from ignored directories and colours them letter-less', () => {
		const map = parseDecorations(porcelain('!! node_modules/'), REPO);
		expect(map.get('/repo/node_modules')).toEqual({ letter: null, color: IGNORED });
	});

	it('lets a direct entry win over a propagated colour', () => {
		// dist is itself ignored while containing an untracked file deeper down
		const map = parseDecorations(porcelain('?? dist/sub/file.js', '!! dist/'), REPO);
		expect(map.get('/repo/dist')).toEqual({ letter: null, color: IGNORED });
		expect(map.get('/repo/dist/sub')).toEqual({ letter: null, color: UNTRACKED });
	});

	it('returns an empty map for a clean repository', () => {
		expect(parseDecorations('', REPO).size).toBe(0);
	});
});
