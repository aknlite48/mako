/**
 * Lane assignment for the commit graph.
 *
 * Rows are processed newest → oldest while maintaining an ordered list of
 * active lanes, each "expecting" the hash of the next (older) commit on its
 * line. A commit's vertex is placed on the leftmost lane expecting its hash
 * (a new lane is appended if none does); every other lane expecting that hash
 * converges into the vertex; the vertex lane then continues expecting the
 * first parent, and each additional parent either joins an existing lane that
 * already expects it or opens a new lane. Closed lanes are compacted away
 * each row.
 *
 * The output per row is the vertex position plus the edge segments drawn
 * between that row's centre and the next row's centre.
 */

export interface Edge {
	/** Lane (x index) at this row. */
	fromLane: number;
	/** Lane (x index) at the next row. */
	toLane: number;
	color: number;
	/**
	 * Where the bend is anchored when the segment is stretched by the inline
	 * details panel: true = transition at the top (then straight down),
	 * false = straight down then transition at the bottom. True for merge
	 * edges out of a vertex and rightward moves, false for leftward moves.
	 */
	lockedFirst: boolean;
}

export interface RowLayout {
	/** The lane the commit's vertex sits on. */
	lane: number;
	color: number;
	/** Edge segments between this row and the next. */
	edges: Edge[];
	/** Total active lanes at this row (for sizing). */
	laneCount: number;
}

export interface RowInput {
	hash: string;
	parents: string[];
}

interface Lane {
	expects: string;
	color: number;
}

/** A pending edge whose destination lane index is resolved at the next row. */
interface PendingEdge {
	from: number;
	to: Lane;
	color: number;
	/** Edge from a vertex to an extra (non-first) parent's lane. */
	merge: boolean;
}

function resolveEdge(edge: PendingEdge, toLane: number): Edge {
	return {
		fromLane: edge.from,
		toLane: toLane,
		color: edge.color,
		lockedFirst: edge.merge || edge.from < toLane
	};
}

export function assignLanes(rows: ReadonlyArray<RowInput>): RowLayout[] {
	const out: RowLayout[] = [];
	let state: Lane[] = []; // Lanes arriving at the current row
	let pending: PendingEdge[] = []; // Edges of the segment above the current row
	let nextColor = 0;

	for (let i = 0; i < rows.length; i++) {
		const row = rows[i];

		// Vertex: leftmost arriving lane expecting this commit
		let vertex = state.findIndex((lane) => lane.expects === row.hash);
		if (vertex === -1) {
			state.push({ expects: row.hash, color: nextColor++ });
			vertex = state.length - 1;
		}
		const color = state[vertex].color;

		// Finalise the previous row's edges now that this row's vertex is
		// known: every edge heading for a lane that expects this commit
		// converges into the vertex position.
		if (i > 0) {
			out[i - 1].edges = pending.map((edge) =>
				resolveEdge(edge, edge.to.expects === row.hash ? vertex : state.indexOf(edge.to)));
		}

		out.push({ lane: vertex, color: color, edges: [], laneCount: state.length });

		// Transform the state for the next row & queue this segment's edges
		const next: Lane[] = [];
		pending = [];
		for (let j = 0; j < state.length; j++) {
			const lane = state[j];
			if (lane.expects === row.hash) {
				if (j === vertex && row.parents.length > 0) {
					const continuation: Lane = { expects: row.parents[0], color: lane.color };
					next.push(continuation);
					pending.push({ from: j, to: continuation, color: lane.color, merge: false });
				}
				// Other lanes expecting this commit closed here (they already
				// converged into the vertex in the segment above).
			} else {
				next.push(lane);
				pending.push({ from: j, to: lane, color: lane.color, merge: false });
			}
		}
		for (let p = 1; p < row.parents.length; p++) {
			const parent = row.parents[p];
			let target = next.find((lane) => lane.expects === parent);
			if (target === undefined) {
				target = { expects: parent, color: nextColor++ };
				next.push(target);
			}
			pending.push({ from: vertex, to: target, color: target.color, merge: true });
		}
		state = next;
	}

	// Lanes continuing below the final loaded row run straight off the bottom
	if (out.length > 0) {
		out[out.length - 1].edges = pending.map((edge) => resolveEdge(edge, state.indexOf(edge.to)));
	}
	return out;
}
