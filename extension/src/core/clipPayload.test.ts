import { describe, it, expect } from 'vitest';
import { clipPayloadFromClick } from './clipPayload';

const tab = { url: 'https://example.com/a', title: 'Example Page' };

describe('clipPayloadFromClick', () => {
	it('wraps a selection click with the captured selection HTML', () => {
		const payload = clipPayloadFromClick(
			{ menuItemId: 'crapnote-clip-selection' },
			tab,
			'<p>Hi <img src="x.png"></p>',
		);
		expect(payload).toEqual({
			url: 'https://example.com/a',
			title: 'Example Page',
			html: '<p>Hi <img src="x.png"></p>',
		});
	});

	it('turns an image click into a single-image clip', () => {
		const payload = clipPayloadFromClick(
			{ menuItemId: 'crapnote-clip-image', srcUrl: 'https://example.com/pic.jpg' },
			tab,
		);
		expect(payload.html).toBe('<img src="https://example.com/pic.jpg">');
		expect(payload.url).toBe('https://example.com/a');
	});
});
