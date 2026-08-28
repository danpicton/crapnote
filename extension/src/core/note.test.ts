import { describe, it, expect } from 'vitest';
import { buildLinkNote, buildClipNote } from './note';

describe('buildLinkNote', () => {
	it('builds a note with the page title and a markdown link plus description', () => {
		const note = buildLinkNote({
			title: 'Example Page',
			url: 'https://example.com/a',
			description: 'Worth a read',
		});
		expect(note.title).toBe('Example Page');
		expect(note.body).toBe('[Example Page](https://example.com/a)\n\n&nbsp;\n\nWorth a read');
	});

	it('omits the description block when empty and falls back to the URL as title', () => {
		const note = buildLinkNote({ title: '', url: 'https://example.com/a', description: '  ' });
		expect(note.title).toBe('https://example.com/a');
		expect(note.body).toBe('[https://example.com/a](https://example.com/a)');
	});
});

describe('buildClipNote', () => {
	it('builds a note linking the source page above the clipped content', () => {
		const note = buildClipNote({
			title: 'Example Page',
			url: 'https://example.com/a',
			content: 'Some clipped text',
		});
		expect(note.title).toBe('Example Page');
		expect(note.body).toBe(
			'Clipped from [Example Page](https://example.com/a)\n\n&nbsp;\n\nSome clipped text',
		);
	});

	it('keeps the page title in the source link when the note title differs', () => {
		const note = buildClipNote({
			title: 'My renamed note',
			url: 'https://example.com/a',
			content: 'Text',
			sourceTitle: 'Example Page',
		});
		expect(note.title).toBe('My renamed note');
		expect(note.body).toBe(
			'Clipped from [Example Page](https://example.com/a)\n\n&nbsp;\n\nText',
		);
	});
});
