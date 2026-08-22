/**
 * Deciding whether a click in the editor's empty space should move the caret.
 *
 * The editor container is wider and taller than the prose column, and clicking
 * that dead space is meant to drop the caret at the end of the document. The
 * catch is that a text selection dragged backwards past the start of a line
 * ends up releasing in exactly that dead space — so the naive "target isn't
 * inside .ProseMirror" test wiped the selection the user had just made.
 */

/** Movement beyond this (in px, either axis) counts as a drag, not a click. */
export const DRAG_THRESHOLD_PX = 4;

export interface EmptySpaceClick {
	/** Did the click land inside the prose column itself? */
	insideProse: boolean;
	/** Is the current document selection collapsed (i.e. a bare caret)? */
	selectionCollapsed: boolean;
	/** How far the pointer travelled between press and release, in px. */
	pointerTravelPx: number;
}

export function shouldPlaceCaretAtEnd(click: EmptySpaceClick): boolean {
	if (click.insideProse) return false;
	// A live selection is the user's, not ours to collapse.
	if (!click.selectionCollapsed) return false;
	// A drag that merely finished out here was never a click on empty space.
	if (click.pointerTravelPx > DRAG_THRESHOLD_PX) return false;
	return true;
}

/** Straight-line distance between two points, or 0 if either is unknown. */
export function pointerTravel(
	from: { x: number; y: number } | null,
	to: { x: number; y: number },
): number {
	if (!from) return 0;
	return Math.hypot(to.x - from.x, to.y - from.y);
}
