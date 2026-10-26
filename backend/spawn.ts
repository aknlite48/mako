/**
 * Spawns Git via the `git_exec` Rust command, resolving with
 * [status, stdout, stderr] (both decoded — lossily, as UTF-8 — in Rust).
 *
 * A custom command rather than tauri-plugin-shell: the plugin's raw encoding
 * crossed the IPC boundary as a plain JSON number array, costing several
 * times stdout's size in transient allocations on every git call; a string
 * crosses at ~1x.
 */

import { invoke } from '@tauri-apps/api/core';

export interface SpawnStatus {
	code: number;
	error: Error | null;
}

interface GitOutput {
	code: number;
	stdout: string;
	stderr: string;
}

/**
 * Run the Git executable with the provided arguments, resolving with
 * [status, stdout, stderr].
 */
export async function spawnGit(args: string[], repo: string): Promise<[SpawnStatus, string, string]> {
	try {
		const output = await invoke<GitOutput>('git_exec', { args: args, cwd: repo });
		return [{ code: output.code, error: null }, output.stdout, output.stderr];
	} catch (e) {
		return [{ code: -1, error: e instanceof Error ? e : new Error(String(e)) }, '', ''];
	}
}
