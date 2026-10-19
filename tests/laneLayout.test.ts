import { describe, expect, it } from 'vitest';
import { assignLanes } from '../backend/graph/laneLayout';

describe('assignLanes', () => {
	it('lays out a linear history on a single lane', () => {
		const rows = assignLanes([
			{ hash: 'c3', parents: ['c2'] },
			{ hash: 'c2', parents: ['c1'] },
			{ hash: 'c1', parents: [] }
		]);

		expect(rows).toHaveLength(3);
		for (const row of rows) {
			expect(row.lane).toBe(0);
			expect(row.color).toBe(0);
			expect(row.laneCount).toBe(1);
		}
		// Each segment connects straight down; nothing continues below the root
		expect(rows[0].edges).toEqual([{ fromLane: 0, toLane: 0, color: 0, lockedFirst: false }]);
		expect(rows[1].edges).toEqual([{ fromLane: 0, toLane: 0, color: 0, lockedFirst: false }]);
		expect(rows[2].edges).toEqual([]);
	});

	it('assigns a second lane and color to a merged branch', () => {
		// M merges B into A's line; both branched from R.
		const rows = assignLanes([
			{ hash: 'M', parents: ['A', 'B'] },
			{ hash: 'A', parents: ['R'] },
			{ hash: 'B', parents: ['R'] },
			{ hash: 'R', parents: [] }
		]);

		expect(rows.map((r) => r.lane)).toEqual([0, 0, 1, 0]);
		expect(rows.map((r) => r.color)).toEqual([0, 0, 1, 0]);

		// Merge edge out of M to the branch lane is lockedFirst (bends at the top)
		expect(rows[0].edges).toContainEqual({ fromLane: 0, toLane: 1, color: 1, lockedFirst: true });
		expect(rows[0].edges).toContainEqual({ fromLane: 0, toLane: 0, color: 0, lockedFirst: false });

		// Between A and B both lanes continue straight
		expect(rows[1].edges).toEqual([
			{ fromLane: 0, toLane: 0, color: 0, lockedFirst: false },
			{ fromLane: 1, toLane: 1, color: 1, lockedFirst: false }
		]);

		// The branch lane converges leftward into R: not lockedFirst (bends at the bottom)
		expect(rows[2].edges).toContainEqual({ fromLane: 1, toLane: 0, color: 1, lockedFirst: false });
		expect(rows[3].edges).toEqual([]);
	});

	it('emits edges one row late so merging lanes curve into the next vertex', () => {
		// Two roots: edges for row i are only known once row i+1's vertex is placed
		const rows = assignLanes([
			{ hash: 'M', parents: ['A', 'B'] },
			{ hash: 'B', parents: [] },
			{ hash: 'A', parents: [] }
		]);
		// Segment M→B: lane 0 continues toward A, merge edge lands on B's vertex (lane 1)
		expect(rows[0].edges).toContainEqual({ fromLane: 0, toLane: 1, color: 1, lockedFirst: true });
		expect(rows[1].lane).toBe(1);
		expect(rows[2].lane).toBe(0);
	});

	it('compacts closed lanes', () => {
		// Branch B merges into M, then history continues linearly: the second
		// lane must disappear after the merge point.
		const rows = assignLanes([
			{ hash: 'M', parents: ['A', 'B'] },
			{ hash: 'A', parents: ['R'] },
			{ hash: 'B', parents: ['R'] },
			{ hash: 'R', parents: ['Q'] },
			{ hash: 'Q', parents: [] }
		]);
		expect(rows[2].laneCount).toBe(2);
		expect(rows[3].laneCount).toBe(2); // Lanes arriving at R
		expect(rows[4].laneCount).toBe(1); // B's lane closed at R
		expect(rows[3].edges).toEqual([{ fromLane: 0, toLane: 0, color: 0, lockedFirst: false }]);
	});

	it('runs unresolved parent lanes straight off the bottom row', () => {
		const rows = assignLanes([
			{ hash: 'c2', parents: ['c1'] },
			{ hash: 'c1', parents: ['c0'] } // c0 not loaded
		]);
		expect(rows[1].edges).toEqual([{ fromLane: 0, toLane: 0, color: 0, lockedFirst: false }]);
	});

	it('handles an empty input', () => {
		expect(assignLanes([])).toEqual([]);
	});
});
