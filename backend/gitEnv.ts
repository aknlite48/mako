/**
 * Git executable discovery. The Tauri shell capability only permits the
 * command name "git" (resolved from PATH by the Rust process), so the path is
 * always the literal "git".
 */

import { spawnGitRaw } from './spawn';

export interface GitExecutable {
	readonly path: string;
	readonly version: string;
}

const decoder = new TextDecoder();

/**
 * Run `git --version` to verify Git is available, returning the GitExecutable
 * (or null if Git could not be executed).
 */
export async function findGit(): Promise<GitExecutable | null> {
	const [status, stdout, stderr] = await spawnGitRaw(['--version'], '/');
	if (status.code !== 0) {
		(<any>window).__gitFindError = 'code=' + status.code + (status.error !== null ? ' error=' + status.error.message : '') + (stderr !== '' ? ' stderr=' + stderr : '');
		return null;
	}

	const output = decoder.decode(stdout).trim();
	if (!output.startsWith('git version ')) {
		(<any>window).__gitFindError = 'unexpected output: ' + JSON.stringify(output.substring(0, 100));
		return null;
	}

	return {
		path: 'git',
		version: output.substring('git version '.length)
	};
}
