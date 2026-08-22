import type { EditorView } from '@milkdown/kit/prose/view';
import { findListItem, moveListItemAt } from './listmove';

/**
 * Pointer-driven drag reordering for list items.
 *
 * Uses pointer events rather than HTML5 drag-and-drop so the same code path
 * serves mouse, pen and touch — the latter matters because CrapNote is a PWA
 * that is mostly used on a phone.
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
 * with that item removed — exactly what moveListItemAt expects.
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

/** The grip element shown in the gutter of each list item. */
export function createDragHandle(): HTMLElement {
	const handle = document.createElement('span');
	handle.className = 'list-drag-handle';
	handle.setAttribute('contenteditable', 'false');
	handle.setAttribute('aria-hidden', 'true');
	// Drawn rather than typed: the themes use very different fonts and a glyph
	// like U+283F is not in all of them. An SVG also keeps the grip out of the
	// list item's text content.
	handle.innerHTML =
		'<svg viewBox="0 0 6 10" fill="currentColor" aria-hidden="true">' +
		'<circle cx="1" cy="1" r="1"/><circle cx="5" cy="1" r="1"/>' +
		'<circle cx="1" cy="5" r="1"/><circle cx="5" cy="5" r="1"/>' +
		'<circle cx="1" cy="9" r="1"/><circle cx="5" cy="9" r="1"/></svg>';
	return handle;
}

interface DragOptions {
	handle: HTMLElement;
	dom: HTMLElement;
	view: EditorView;
	getPos: () => number | undefined;
}

/**
 * Wire a handle up to drag its list item. Returns a teardown function the
 * NodeView calls on destroy.
 */
export function enableListItemDrag({ handle, dom, view, getPos }: DragOptions): () => void {
	let siblings: HTMLElement[] = [];
	let originIndex = -1;
	let dropIndex = -1;
	let activePointer: number | null = null;
	let scroller: HTMLElement | null = null;
	let scrollFrame: number | null = null;
	let lastClientY = 0;

	const siblingRects = (): DragRect[] =>
		siblings.map((el) => {
			const r = el.getBoundingClientRect();
			return { top: r.top, height: r.height };
		});

	const clearIndicators = () => {
		for (const el of siblings) {
			el.classList.remove('list-drop-before', 'list-drop-after');
		}
	};

	const showIndicator = (index: number) => {
		clearIndicators();
		const others = siblings.filter((_, i) => i !== originIndex);
		if (others.length === 0) return;
		if (index < others.length) {
			others[index].classList.add('list-drop-before');
		} else {
			others[others.length - 1].classList.add('list-drop-after');
		}
	};

	/** Recompute the drop slot from the pointer's last known position. */
	const refreshDropTarget = () => {
		dropIndex = dropIndexFromY(siblingRects(), originIndex, lastClientY);
		showIndicator(dropIndex);
	};

	const stopEdgeScroll = () => {
		if (scrollFrame != null) cancelAnimationFrame(scrollFrame);
		scrollFrame = null;
	};

	/**
	 * While the pointer sits near the scroller's edge, keep scrolling and
	 * re-deriving the drop slot — the rows move under a stationary finger, so
	 * the indicator has to be recomputed each frame, not just on pointermove.
	 */
	const stepEdgeScroll = () => {
		scrollFrame = null;
		if (originIndex < 0 || !scroller) return;

		const rect = scroller.getBoundingClientRect();
		const delta = edgeScrollDelta(rect, lastClientY);
		if (delta !== 0) {
			const before = scroller.scrollTop;
			scroller.scrollTop = before + delta;
			if (scroller.scrollTop !== before) refreshDropTarget();
		}
		scrollFrame = requestAnimationFrame(stepEdgeScroll);
	};

	const startEdgeScroll = () => {
		if (scrollFrame == null && scroller) scrollFrame = requestAnimationFrame(stepEdgeScroll);
	};

	const finish = (commit: boolean) => {
		if (originIndex < 0) return;

		stopEdgeScroll();
		clearIndicators();
		dom.classList.remove('list-item-dragging');
		if (activePointer != null) {
			try {
				handle.releasePointerCapture(activePointer);
			} catch {
				// Pointer already released (or unsupported) — nothing to undo.
			}
		}

		const from = originIndex;
		const to = dropIndex;
		originIndex = -1;
		dropIndex = -1;
		activePointer = null;
		siblings = [];
		scroller = null;

		if (!commit || to < 0 || to === from) return;

		const pos = getPos();
		if (pos == null) return;
		const ctx = findListItem(view.state.doc.resolve(pos + 1));
		if (!ctx) return;

		moveListItemAt(view.state, view.dispatch.bind(view), ctx, to);
		view.focus();
	};

	const onPointerMove = (e: PointerEvent) => {
		if (originIndex < 0) return;
		e.preventDefault();
		lastClientY = e.clientY;
		refreshDropTarget();
		startEdgeScroll();
	};

	const onPointerUp = (e: PointerEvent) => {
		if (originIndex < 0) return;
		e.preventDefault();
		finish(true);
	};

	const onPointerCancel = () => finish(false);

	const onKeyDown = (e: KeyboardEvent) => {
		if (e.key === 'Escape' && originIndex >= 0) {
			e.preventDefault();
			finish(false);
		}
	};

	const onPointerDown = (e: PointerEvent) => {
		if (!view.editable) return;
		// Primary button only; touch and pen report button 0 too.
		if (e.button !== 0) return;

		const parent = dom.parentElement;
		if (!parent) return;

		const items = Array.from(parent.children).filter(
			(el): el is HTMLElement => el instanceof HTMLElement && el.tagName === 'LI'
		);
		const index = items.indexOf(dom);
		if (index < 0) return;

		// Only take over once we know we can act on the drag.
		e.preventDefault();
		e.stopPropagation();

		siblings = items;
		originIndex = index;
		dropIndex = index;
		activePointer = e.pointerId;
		lastClientY = e.clientY;
		scroller = findScrollParent(dom);

		dom.classList.add('list-item-dragging');
		try {
			handle.setPointerCapture(e.pointerId);
		} catch {
			// Capture is best-effort; the window listeners below still fire.
		}
	};

	handle.addEventListener('pointerdown', onPointerDown);
	handle.addEventListener('pointermove', onPointerMove);
	handle.addEventListener('pointerup', onPointerUp);
	handle.addEventListener('pointercancel', onPointerCancel);
	window.addEventListener('keydown', onKeyDown);

	return () => {
		finish(false);
		handle.removeEventListener('pointerdown', onPointerDown);
		handle.removeEventListener('pointermove', onPointerMove);
		handle.removeEventListener('pointerup', onPointerUp);
		handle.removeEventListener('pointercancel', onPointerCancel);
		window.removeEventListener('keydown', onKeyDown);
	};
}
