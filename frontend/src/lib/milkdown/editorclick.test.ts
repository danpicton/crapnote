import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	shouldPlaceCaretAtEnd,
	pointerTravel,
	hasLiveSelectionIn,
	DRAG_THRESHOLD_PX,
} from './editorclick';

const base = { insideProse: false, selectionCollapsed: true, pointerTravelPx: 0 };

describe('shouldPlaceCaretAtEnd', () => {
	it('places the caret when empty space is genuinely clicked', () => {
		expect(shouldPlaceCaretAtEnd(base)).toBe(true);
	});

	it('leaves clicks inside the prose column to ProseMirror', () => {
		expect(shouldPlaceCaretAtEnd({ ...base, insideProse: true })).toBe(false);
	});

	it('never collapses a live selection', () => {
		// Backwards drag-select past the start of a line releases in the
		// container padding — the selection must survive.
		expect(shouldPlaceCaretAtEnd({ ...base, selectionCollapsed: false })).toBe(false);
	});

	it('ignores a release that ended a drag', () => {
		expect(
			shouldPlaceCaretAtEnd({ ...base, pointerTravelPx: DRAG_THRESHOLD_PX + 1 })
		).toBe(false);
	});

	it('tolerates the jitter of a real click', () => {
		expect(shouldPlaceCaretAtEnd({ ...base, pointerTravelPx: DRAG_THRESHOLD_PX })).toBe(true);
	});
});

describe('pointerTravel', () => {
	it('is zero when the press position is unknown', () => {
		expect(pointerTravel(null, { x: 40, y: 40 })).toBe(0);
	});

	it('measures the straight-line distance', () => {
		expect(pointerTravel({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
	});
});

describe('hasLiveSelectionIn', () => {
	function selectionOver(node: Node | null, collapsed: boolean): Selection {
		return { isCollapsed: collapsed, anchorNode: node, focusNode: node } as Selection;
	}

	let container: HTMLElement;
	let inside: HTMLElement;
	let outside: HTMLElement;

	beforeEach(() => {
		container = document.createElement('div');
		inside = document.createElement('p');
		container.appendChild(inside);
		outside = document.createElement('p');
		document.body.append(container, outside);
	});

	afterEach(() => {
		container.remove();
		outside.remove();
	});

	it('sees a live selection made inside the editor', () => {
		expect(hasLiveSelectionIn(selectionOver(inside, false), container)).toBe(true);
	});

	it('ignores a selection living elsewhere on the page', () => {
		// A note-list preview left selected must not veto a genuine click in
		// the editor's empty space.
		expect(hasLiveSelectionIn(selectionOver(outside, false), container)).toBe(false);
	});

	it('ignores a collapsed selection inside the editor', () => {
		expect(hasLiveSelectionIn(selectionOver(inside, true), container)).toBe(false);
	});

	it('copes with no selection at all', () => {
		expect(hasLiveSelectionIn(null, container)).toBe(false);
		expect(hasLiveSelectionIn(selectionOver(null, false), container)).toBe(false);
	});
});
