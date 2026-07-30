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

	const finish = (commit: boolean) => {
		if (originIndex < 0) return;

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
		dropIndex = dropIndexFromY(siblingRects(), originIndex, e.clientY);
		showIndicator(dropIndex);
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
