import { describe, it, expect } from 'vitest';
import { compareNotes, sortNotes, moveItem, reorderPinned, nextPinOrder } from './noteOrder';

interface N {
	id: number;
	pinned: boolean;
	pin_order?: number;
	updated_at: string;
}

const at = (n: N) => n.updated_at;
const note = (id: number, pinned: boolean, pin_order = 0, updated_at = '2024-01-01T00:00:00Z'): N => ({
	id,
	pinned,
	pin_order,
	updated_at,
});
const ids = (list: N[]) => list.map((n) => n.id);

describe('compareNotes', () => {
	it('puts pinned notes ahead of unpinned ones', () => {
		expect(compareNotes(note(1, true), note(2, false), at)).toBeLessThan(0);
		expect(compareNotes(note(2, false), note(1, true), at)).toBeGreaterThan(0);
	});

	it('orders pinned notes by their drag position, not recency', () => {
		const older = note(1, true, 0, '2024-01-01T00:00:00Z');
		const newer = note(2, true, 1, '2024-06-01T00:00:00Z');
		expect(compareNotes(older, newer, at)).toBeLessThan(0);
	});

	it('falls back to recency for unpinned notes', () => {
		const older = note(1, false, 0, '2024-01-01T00:00:00Z');
		const newer = note(2, false, 0, '2024-06-01T00:00:00Z');
		expect(compareNotes(newer, older, at)).toBeLessThan(0);
	});

	it('treats a missing pin_order as 0', () => {
		const a: N = { id: 1, pinned: true, updated_at: '2024-01-01T00:00:00Z' };
		const b = note(2, true, 1);
		expect(compareNotes(a, b, at)).toBeLessThan(0);
	});
});

describe('sortNotes', () => {
	it('produces pinned-by-order then unpinned-by-recency', () => {
		const list = [
			note(1, false, 0, '2024-01-01T00:00:00Z'),
			note(2, true, 1),
			note(3, false, 0, '2024-06-01T00:00:00Z'),
			note(4, true, 0),
		];
		expect(ids(sortNotes(list, at))).toEqual([4, 2, 3, 1]);
	});

	it('leaves the input array alone', () => {
		const list = [note(1, false), note(2, true)];
		sortNotes(list, at);
		expect(ids(list)).toEqual([1, 2]);
	});
});

describe('moveItem', () => {
	it('moves an item down', () => {
		expect(moveItem(['a', 'b', 'c'], 0, 2)).toEqual(['b', 'c', 'a']);
	});

	it('moves an item up', () => {
		expect(moveItem(['a', 'b', 'c'], 2, 0)).toEqual(['c', 'a', 'b']);
	});

	it('returns the same array for a no-op or an out-of-range move', () => {
		const list = ['a', 'b'];
		expect(moveItem(list, 1, 1)).toBe(list);
		expect(moveItem(list, 5, 0)).toBe(list);
		expect(moveItem(list, 0, 9)).toBe(list);
	});
});

describe('reorderPinned', () => {
	it('renumbers pin_order and keeps unpinned notes trailing', () => {
		const list = [note(1, true, 0), note(2, true, 1), note(3, true, 2), note(9, false)];

		const out = reorderPinned(list, 2, 0);

		expect(ids(out)).toEqual([3, 1, 2, 9]);
		expect(out.slice(0, 3).map((n) => n.pin_order)).toEqual([0, 1, 2]);
	});

	it('never touches the unpinned notes pin_order', () => {
		const list = [note(1, true, 0), note(2, true, 1), note(9, false)];
		const out = reorderPinned(list, 0, 1);
		expect(out[2].pin_order).toBe(0);
	});

	it('returns the original list when the move is a no-op', () => {
		const list = [note(1, true, 0), note(2, true, 1)];
		expect(reorderPinned(list, 1, 1)).toBe(list);
	});
});

describe('nextPinOrder', () => {
	it('claims the slot above every pinned note', () => {
		// Mirrors the server's MIN(pin_order) - 1 in SetPinned.
		expect(nextPinOrder([note(1, true, 0), note(2, true, -3), note(9, false)])).toBe(-4);
	});

	it('is 0 when nothing is pinned yet', () => {
		expect(nextPinOrder([note(9, false)])).toBe(0);
	});

	it('ignores the pin_order of unpinned notes', () => {
		const stale: N = { id: 9, pinned: false, pin_order: -50, updated_at: '2024-01-01T00:00:00Z' };
		expect(nextPinOrder([note(1, true, 0), stale])).toBe(-1);
	});

	it('sorts a note given the next slot to the top', () => {
		const list = [note(1, true, 0), note(2, true, -1), note(3, false)];
		const promoted = { ...note(3, true, nextPinOrder(list)), pinned: true };
		expect(ids(sortNotes([...list.slice(0, 2), promoted], at))).toEqual([3, 2, 1]);
	});
});
