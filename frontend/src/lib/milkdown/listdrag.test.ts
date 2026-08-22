import { describe, it, expect } from 'vitest';
import {
	dropIndexFromY,
	createDragHandle,
	edgeScrollDelta,
	EDGE_SCROLL_ZONE_PX,
	MAX_EDGE_SCROLL_PX,
} from './listdrag';

// Four 20px-tall rows stacked from y=0: midpoints at 10, 30, 50, 70.
const rows = [
	{ top: 0, height: 20 },
	{ top: 20, height: 20 },
	{ top: 40, height: 20 },
	{ top: 60, height: 20 },
];

describe('dropIndexFromY', () => {
	it('returns 0 when the pointer is above every other row', () => {
		expect(dropIndexFromY(rows, 2, 5)).toBe(0);
	});

	it('returns the last slot when the pointer is below every other row', () => {
		// Dragging row 0 to the very bottom: three remaining rows, so index 3.
		expect(dropIndexFromY(rows, 0, 100)).toBe(3);
	});

	it('ignores the dragged row when counting', () => {
		// Dragging row 0. Pointer at y=35 is past row 1's midpoint (30) but not
		// row 2's (50), so it lands in slot 1 of the remaining three.
		expect(dropIndexFromY(rows, 0, 35)).toBe(1);
	});

	it('reports the origin slot when the pointer has not crossed a midpoint', () => {
		// Dragging row 1, pointer still over row 1 — rows 0 counted, 2 and 3 not.
		expect(dropIndexFromY(rows, 1, 25)).toBe(1);
	});

	it('moves up a slot once the pointer crosses the row above', () => {
		// Dragging row 2 up past row 1's midpoint (30).
		expect(dropIndexFromY(rows, 2, 25)).toBe(1);
	});

	it('handles a single-item list', () => {
		expect(dropIndexFromY([{ top: 0, height: 20 }], 0, 50)).toBe(0);
	});

	it('treats the exact midpoint as not yet crossed', () => {
		expect(dropIndexFromY(rows, 3, 10)).toBe(0);
	});
});

describe('createDragHandle', () => {
	it('is inert to the editor: not editable and hidden from assistive tech', () => {
		const handle = createDragHandle();
		expect(handle.getAttribute('contenteditable')).toBe('false');
		expect(handle.getAttribute('aria-hidden')).toBe('true');
		expect(handle.className).toContain('list-drag-handle');
	});
});

describe('edgeScrollDelta', () => {
	// A 400px-tall scroller starting at y=100.
	const rect = { top: 100, bottom: 500 };

	it('does not scroll while the pointer is clear of both edges', () => {
		expect(edgeScrollDelta(rect, 300)).toBe(0);
	});

	it('scrolls up when the pointer nears the top edge', () => {
		expect(edgeScrollDelta(rect, rect.top + 5)).toBeLessThan(0);
	});

	it('scrolls down when the pointer nears the bottom edge', () => {
		expect(edgeScrollDelta(rect, rect.bottom - 5)).toBeGreaterThan(0);
	});

	it('scrolls faster the closer the pointer gets to the edge', () => {
		const near = edgeScrollDelta(rect, rect.bottom - 2);
		const far = edgeScrollDelta(rect, rect.bottom - EDGE_SCROLL_ZONE_PX + 2);
		expect(near).toBeGreaterThan(far);
	});

	it('caps the speed at the maximum, even past the edge', () => {
		expect(edgeScrollDelta(rect, rect.bottom + 500)).toBe(MAX_EDGE_SCROLL_PX);
		expect(edgeScrollDelta(rect, rect.top - 500)).toBe(-MAX_EDGE_SCROLL_PX);
	});

	it('is inert exactly at the zone boundary', () => {
		expect(edgeScrollDelta(rect, rect.top + EDGE_SCROLL_ZONE_PX)).toBe(0);
		expect(edgeScrollDelta(rect, rect.bottom - EDGE_SCROLL_ZONE_PX)).toBe(0);
	});
});
