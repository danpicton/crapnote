/**
 * Pointer-driven drag reordering, shared by the editor's list items and the
 * pinned notes in the list pane.
 *
 * Pointer events rather than HTML5 drag-and-drop, so one code path serves
 * mouse, pen and touch — the last matters because CrapNote is a PWA that is
 * mostly used on a phone.
 *
 * Everything here is plain DOM: no Milkdown, no ProseMirror, no Svelte. Both
 * callers can reach it without depending on the other's world.
 */

export interface DragRect {
	top: number;
	height: number;
}

/**
 * Work out which slot the dragged item should land in, given the on-screen
 * geometry of its siblings and the current pointer position.
 *
 * `rects` covers every sibling in document order, including the item being
 * dragged, which is excluded here so the returned index is relative to the list
 * with that item removed — exactly what the move helpers expect.
 */
export function dropIndexFromY(rects: DragRect[], originIndex: number, clientY: number): number {
	let index = 0;
	for (let i = 0; i < rects.length; i++) {
		if (i === originIndex) continue;
		const { top, height } = rects[i];
		if (clientY > top + height / 2) index++;
	}
	return index;
}

/** How close to a scroller's edge the pointer must get before it scrolls. */
export const EDGE_SCROLL_ZONE_PX = 48;
/** Fastest edge scroll, in px per animation frame. */
export const MAX_EDGE_SCROLL_PX = 14;

export interface EdgeRect {
	top: number;
	bottom: number;
}

/**
 * How far to scroll this frame, given where the pointer sits relative to the
 * scrolling container. Negative scrolls up, positive down, 0 leaves it alone.
 *
 * Without this a drag could only reach items already on screen — on a phone,
 * often three or four of them.
 */
export function edgeScrollDelta(
	rect: EdgeRect,
	clientY: number,
	zone = EDGE_SCROLL_ZONE_PX,
	maxSpeed = MAX_EDGE_SCROLL_PX
): number {
	const fromTop = clientY - rect.top;
	if (fromTop < zone) {
		// Ramps from 0 at the zone boundary to maxSpeed at the edge, and stays
		// pinned there if the pointer leaves the container entirely.
		const ratio = Math.min(1, (zone - fromTop) / zone);
		return -Math.ceil(ratio * maxSpeed);
	}
	const fromBottom = rect.bottom - clientY;
	if (fromBottom < zone) {
		const ratio = Math.min(1, (zone - fromBottom) / zone);
		return Math.ceil(ratio * maxSpeed);
	}
	return 0;
}

/** The nearest ancestor that actually scrolls vertically, if any. */
export function findScrollParent(el: HTMLElement | null): HTMLElement | null {
	for (let node = el?.parentElement ?? null; node; node = node.parentElement) {
		const { overflowY } = getComputedStyle(node);
		if (
			(overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay') &&
			node.scrollHeight > node.clientHeight
		) {
			return node;
		}
	}
	return null;
}

export interface EdgeAutoScrollOptions {
	/** The element to scroll; null disables the whole thing. */
	scroller: HTMLElement | null;
	/** The pointer's latest Y, read fresh each frame. */
	getClientY: () => number;
	/** Called after a frame that actually moved the scroll position. */
	onScroll: () => void;
}

export interface EdgeAutoScroll {
	start: () => void;
	stop: () => void;
}

/**
 * Keeps scrolling while the pointer sits near the scroller's edge.
 *
 * `onScroll` fires only on frames that actually moved the view — that callback
 * re-derives the drop slot, and the rows move under a stationary finger, so it
 * cannot be driven by pointermove alone. At the end of travel nothing moves and
 * nothing is recomputed.
 */
export function createEdgeAutoScroll({
	scroller,
	getClientY,
	onScroll,
}: EdgeAutoScrollOptions): EdgeAutoScroll {
	let frame: number | null = null;

	const step = () => {
		frame = null;
		if (!scroller) return;

		const delta = edgeScrollDelta(scroller.getBoundingClientRect(), getClientY());
		if (delta !== 0) {
			const before = scroller.scrollTop;
			scroller.scrollTop = before + delta;
			if (scroller.scrollTop !== before) onScroll();
		}
		frame = requestAnimationFrame(step);
	};

	return {
		start() {
			if (frame == null && scroller) frame = requestAnimationFrame(step);
		},
		stop() {
			if (frame != null) cancelAnimationFrame(frame);
			frame = null;
		},
	};
}
