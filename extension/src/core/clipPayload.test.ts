import { describe, it, expect } from 'vitest';
import { clipPayloadFromClick, escapeHTML, isFreshClip } from './clipPayload';

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
			includeImages: true,
		});
	});

	it('marks a "without images" selection click so the popup strips them', () => {
		const payload = clipPayloadFromClick(
			{ menuItemId: 'crapnote-clip-selection-no-images' },
			tab,
			'<p>Hi <img src="x.png"></p>',
		);
		expect(payload.includeImages).toBe(false);
		expect(payload.html).toBe('<p>Hi <img src="x.png"></p>');
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

describe('isFreshClip', () => {
	it('accepts a payload stored moments ago and rejects stale or untimestamped ones', () => {
		const now = 1_000_000;
		expect(isFreshClip({ createdAt: now - 5_000 }, now)).toBe(true);
		expect(isFreshClip({ createdAt: now - 60_000 }, now)).toBe(false);
		expect(isFreshClip({}, now)).toBe(false);
	});
});

describe('escapeHTML', () => {
	it('escapes markup-significant characters so plain text survives HTML parsing', () => {
		expect(escapeHTML('for i<10 && j>2 do "x"')).toBe(
			'for i&lt;10 &amp;&amp; j&gt;2 do &quot;x&quot;',
		);
	});
});
