import { describe, it, expect } from 'vitest';
import { createDragHandle } from './listdrag';

describe('createDragHandle', () => {
	it('is inert to the editor: not editable and hidden from assistive tech', () => {
		const handle = createDragHandle();
		expect(handle.getAttribute('contenteditable')).toBe('false');
		expect(handle.getAttribute('aria-hidden')).toBe('true');
		expect(handle.className).toContain('list-drag-handle');
	});
});
