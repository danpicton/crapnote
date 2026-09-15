import { describe, expect, it } from 'vitest';
import { finishTitleDraft } from './titleDraft';

describe('finishTitleDraft', () => {
	it('restores the saved title instead of committing a blank draft', () => {
		expect(finishTitleDraft('Saved title', '   \n')).toEqual({
			title: 'Saved title',
			commit: false,
		});
	});

	it('commits a nonblank draft exactly as entered', () => {
		expect(finishTitleDraft('Saved title', ' Replacement ')).toEqual({
			title: ' Replacement ',
			commit: true,
		});
	});

	it('does not write an unchanged title', () => {
		expect(finishTitleDraft('Saved title', 'Saved title')).toEqual({
			title: 'Saved title',
			commit: false,
		});
	});
});
