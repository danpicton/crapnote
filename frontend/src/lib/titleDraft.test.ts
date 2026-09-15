import { describe, expect, it } from 'vitest';
import { finishTitleDraft } from './titleDraft';

describe('finishTitleDraft', () => {
	it('restores the saved title instead of committing a blank draft', () => {
		expect(finishTitleDraft('Saved title', '   \n')).toEqual({
			title: 'Saved title',
			commit: false,
		});
	});
});
