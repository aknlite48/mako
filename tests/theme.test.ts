import { describe, expect, it } from 'vitest';
import { THEMES } from '../backend/theme';

describe('THEMES', () => {
	it('has unique ids and non-empty labels', () => {
		const ids = THEMES.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const theme of THEMES) {
			expect(theme.id.length).toBeGreaterThan(0);
			expect(theme.label.length).toBeGreaterThan(0);
		}
	});

	it('defines the identical set of CSS variables in every theme', () => {
		// The shell/editor/graph reference vars unconditionally — a key missing
		// from one theme would leave stale colours after switching to it.
		const reference = Object.keys(THEMES[0].vars).sort();
		expect(reference.length).toBeGreaterThan(0);
		for (const theme of THEMES.slice(1)) {
			expect(Object.keys(theme.vars).sort(), 'theme ' + theme.id).toEqual(reference);
		}
	});

	it('gives every variable a non-empty value', () => {
		for (const theme of THEMES) {
			for (const [name, value] of Object.entries(theme.vars)) {
				expect(name.startsWith('--'), theme.id + ' ' + name).toBe(true);
				expect(value.trim().length, theme.id + ' ' + name).toBeGreaterThan(0);
			}
		}
	});
});
