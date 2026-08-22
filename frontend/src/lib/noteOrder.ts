/**
 * Ordering for the notes list.
 *
 * Pinned notes sit at the top in an order the user sets by dragging them
 * (`pin_order`, ascending, persisted server-side). Everything else follows in
 * order of last touch. Unpinned notes always carry `pin_order === 0`, so for
 * them the pin term drops out and recency decides — which is why unpinning has
 * to reset the column server-side.
 */

export interface OrderableNote {
	pinned: boolean;
	pin_order?: number;
}

/**
 * Comparator for the notes list. `updatedAt` pulls the recency timestamp out,
 * because the cached and server shapes name that field differently.
 */
export function compareNotes<T extends OrderableNote>(
	a: T,
	b: T,
	updatedAt: (n: T) => string
): number {
	if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
	if (a.pinned && b.pinned) {
		const order = (a.pin_order ?? 0) - (b.pin_order ?? 0);
		if (order !== 0) return order;
	}
	return new Date(updatedAt(b)).getTime() - new Date(updatedAt(a)).getTime();
}

/** Sorts a copy of the list into display order. */
export function sortNotes<T extends OrderableNote>(
	list: T[],
	updatedAt: (n: T) => string
): T[] {
	return [...list].sort((a, b) => compareNotes(a, b, updatedAt));
}

/**
 * Moves the item at `from` to index `to` within a copy of the array.
 * Out-of-range indices leave the array untouched.
 */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
	if (from === to) return list;
	if (from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
	const out = [...list];
	const [moved] = out.splice(from, 1);
	out.splice(to, 0, moved);
	return out;
}

/**
 * Applies a pinned-note reorder to the whole list, renumbering `pin_order` so
 * the local array matches what the server is about to be told. Unpinned notes
 * keep their positions and their zero.
 */
export function reorderPinned<T extends OrderableNote>(list: T[], from: number, to: number): T[] {
	const pinned = list.filter((n) => n.pinned);
	const rest = list.filter((n) => !n.pinned);
	const moved = moveItem(pinned, from, to);
	if (moved === pinned) return list;
	return [...moved.map((n, i) => ({ ...n, pin_order: i })), ...rest];
}
