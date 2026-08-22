import { describe, it, expect } from 'vitest';
import { shouldPlaceCaretAtEnd, pointerTravel, DRAG_THRESHOLD_PX } from './editorclick';

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
