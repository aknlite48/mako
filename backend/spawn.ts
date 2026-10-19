/**
 * Spawns Git over tauri-plugin-shell, returning the resolved output as
 * [status, stdout (bytes), stderr (string)].
 */

import { Command } from '@tauri-apps/plugin-shell';

export interface SpawnStatus {
	code: number;
	error: Error | null;
}

const decoder = new TextDecoder();

/**
 * Normalise the stdout/stderr produced by tauri-plugin-shell with
 * encoding: 'raw' — the bytes cross the IPC boundary as a plain number array.
 */
function toBytes(data: any): Uint8Array {
	if (data instanceof Uint8Array) return data;
	if (Array.isArray(data)) return new Uint8Array(data);
	return new TextEncoder().encode(String(data));
}

/**
 * Run the Git executable with the provided arguments, resolving with
 * [status, stdout (bytes), stderr (string)].
 */
export async function spawnGitRaw(args: string[], repo: string): Promise<[SpawnStatus, Uint8Array, string]> {
	try {
		const output = await Command.create('git', args, {
			cwd: repo,
			encoding: 'raw',
			env: {
				GIT_TERMINAL_PROMPT: '0'
			}
		}).execute();
		const stdout = toBytes(output.stdout);
		const stderr = typeof output.stderr === 'string' ? output.stderr : decoder.decode(toBytes(output.stderr));
		return [{ code: output.code !== null ? output.code : -1, error: null }, stdout, stderr];
	} catch (e) {
		return [{ code: -1, error: e instanceof Error ? e : new Error(String(e)) }, new Uint8Array(0), ''];
	}
}
