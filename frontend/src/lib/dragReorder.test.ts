import { describe, it, expect, vi, afterEach } from 'vitest';
import {
	dropIndexFromY,
	edgeScrollDelta,
	createEdgeAutoScroll,
	EDGE_SCROLL_ZONE_PX,
	MAX_EDGE_SCROLL_PX,
} from './dragReorder';

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

describe('createEdgeAutoScroll', () => {
	/** A 300px-tall scroller starting at y=0, scrolled to the middle. */
	function makeScroller(scrollTop = 400) {
		const el = document.createElement('div');
		el.getBoundingClientRect = () =>
			({ top: 0, bottom: 300, height: 300, left: 0, right: 100, width: 100,
				x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
		let top = scrollTop;
		Object.defineProperty(el, 'scrollTop', {
			get: () => top,
			// Clamped like a real scroller, so the end of travel is reachable.
			set: (v: number) => { top = Math.max(0, Math.min(600, v)); },
			configurable: true,
		});
		return el;
	}

	/** Hand-pumped frames — no timers, no flake. */
	function stubFrames() {
		const queued: FrameRequestCallback[] = [];
		const raf = vi.fn((cb: FrameRequestCallback) => queued.push(cb));
		vi.stubGlobal('requestAnimationFrame', raf);
		vi.stubGlobal('cancelAnimationFrame', vi.fn());
		return {
			queued,
			step: () => queued.shift()?.(0),
			cancelled: () => vi.mocked(globalThis.cancelAnimationFrame),
		};
	}

	afterEach(() => vi.unstubAllGlobals());

	it('scrolls up while the pointer sits in the top edge zone', () => {
		const frames = stubFrames();
		const scroller = makeScroller(400);
		const scroll = createEdgeAutoScroll({
			scroller,
			getClientY: () => 2,
			onScroll: vi.fn(),
		});

		scroll.start();
		frames.step();

		expect(scroller.scrollTop).toBeLessThan(400);
	});

	it('scrolls down in the bottom edge zone and keeps going frame after frame', () => {
		const frames = stubFrames();
		const scroller = makeScroller(0);
		const scroll = createEdgeAutoScroll({
			scroller,
			getClientY: () => 298,
			onScroll: vi.fn(),
		});

		scroll.start();
		frames.step();
		const afterOne = scroller.scrollTop;
		frames.step();

		expect(afterOne).toBeGreaterThan(0);
		expect(scroller.scrollTop).toBeGreaterThan(afterOne);
	});

	it('re-derives the drop slot only on frames that actually moved', () => {
		const frames = stubFrames();
		const onScroll = vi.fn();
		// Already at the top: the pointer is in the zone but nothing can move.
		const scroll = createEdgeAutoScroll({
			scroller: makeScroller(0),
			getClientY: () => 2,
			onScroll,
		});

		scroll.start();
		frames.step();

		expect(onScroll).not.toHaveBeenCalled();
	});

	it('does nothing while the pointer is clear of both edges', () => {
		const frames = stubFrames();
		const scroller = makeScroller(400);
		const onScroll = vi.fn();
		const scroll = createEdgeAutoScroll({ scroller, getClientY: () => 150, onScroll });

		scroll.start();
		frames.step();

		expect(scroller.scrollTop).toBe(400);
		expect(onScroll).not.toHaveBeenCalled();
	});

	it('only ever has one frame in flight', () => {
		const frames = stubFrames();
		const scroll = createEdgeAutoScroll({
			scroller: makeScroller(),
			getClientY: () => 2,
			onScroll: vi.fn(),
		});

		scroll.start();
		scroll.start();
		scroll.start();

		expect(frames.queued).toHaveLength(1);
	});

	it('stops when told to', () => {
		const frames = stubFrames();
		const scroll = createEdgeAutoScroll({
			scroller: makeScroller(),
			getClientY: () => 2,
			onScroll: vi.fn(),
		});

		scroll.start();
		scroll.stop();

		expect(frames.cancelled()).toHaveBeenCalled();
	});

	it('is inert without a scroller', () => {
		const frames = stubFrames();
		const scroll = createEdgeAutoScroll({
			scroller: null,
			getClientY: () => 2,
			onScroll: vi.fn(),
		});

		scroll.start();

		expect(frames.queued).toHaveLength(0);
	});
});
