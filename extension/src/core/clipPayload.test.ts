import { describe, it, expect } from 'vitest';
import {
	clipPayloadFromClick,
	escapeHTML,
	isFreshClip,
	restoreTableFragment,
} from './clipPayload';
import { clipTextFromHTML } from './clip';

// Captured from real Chromium by running background.ts's captureSelectionHTML
// (range.cloneContents() serialised through a detached div) over a two-column
// table with a <thead>. cloneContents returns the children of the selection's
// common ancestor and never the ancestor itself, so any drag that starts and
// ends inside the table arrives with no <table> wrapper.
const CAPTURE = {
	withinOneRow: '<td id="a">Basic</td><td id="b">4.99</td>',
	acrossTwoRows:
		'<tr><td id="a">Basic</td><td id="b">4.99</td></tr>' +
		'<tr><td id="c">Pro</td><td id="d">12.50</td></tr>',
	headerThroughBody:
		'<thead><tr><th id="h1">Plan</th><th id="h2">Price</th></tr></thead>' +
		'<tbody><tr><td id="a">Basic</td><td id="b">4.99</td></tr>' +
		'<tr><td id="c">Pro</td><td id="d">12.50</td></tr></tbody>',
	spanningWholeTable:
		'<p>lead-in text</p><table id="t">' +
		'<thead><tr><th id="h1">Plan</th><th id="h2">Price</th></tr></thead>' +
		'<tbody><tr><td id="a">Basic</td><td id="b">4.99</td></tr>' +
		'<tr><td id="c">Pro</td><td id="d">12.50</td></tr></tbody>' +
		'</table><p id="after">trailing text</p>',
};

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

	it('escapes a srcUrl containing quotes so the img survives parsing intact', () => {
		// data: URLs have an opaque path, so the URL parser leaves quotes
		// verbatim — unescaped they terminate the src attribute early.
		const srcUrl =
			'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"></svg>';
		const payload = clipPayloadFromClick(
			{ menuItemId: 'crapnote-clip-image', srcUrl },
			tab,
		);

		const doc = new DOMParser().parseFromString(payload.html, 'text/html');
		expect(doc.body.querySelectorAll('*')).toHaveLength(1);
		// Unescaped, the attribute closes early and the rest of the URL is
		// reparsed as further attributes on the img.
		expect(doc.body.querySelector('img')?.attributes).toHaveLength(1);
		expect(doc.body.querySelector('img')?.getAttribute('src')).toBe(srcUrl);
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

describe('restoreTableFragment', () => {
	it('wraps a bare cell fragment in a row and a table', () => {
		// The <tr> is explicit rather than left to the parser's implied-tag
		// generation, which happy-dom does not perform.
		expect(restoreTableFragment(CAPTURE.withinOneRow)).toBe(
			`<table><tr>${CAPTURE.withinOneRow}</tr></table>`,
		);
	});

	it('wraps bare row-level fragments in a table', () => {
		expect(restoreTableFragment(CAPTURE.acrossTwoRows)).toBe(
			`<table>${CAPTURE.acrossTwoRows}</table>`,
		);
		expect(restoreTableFragment(CAPTURE.headerThroughBody)).toBe(
			`<table>${CAPTURE.headerThroughBody}</table>`,
		);
	});

	it('leaves a fragment that already carries its own table alone', () => {
		expect(restoreTableFragment(CAPTURE.spanningWholeTable)).toBe(
			CAPTURE.spanningWholeTable,
		);
	});

	it('leaves ordinary prose alone', () => {
		expect(restoreTableFragment('<p>Hi <img src="x.png"></p>')).toBe(
			'<p>Hi <img src="x.png"></p>',
		);
		expect(restoreTableFragment('plain text')).toBe('plain text');
	});

	it('is not fooled by a table tag appearing later in the fragment', () => {
		const html = '<p>intro</p><table><tr><td>A</td></tr></table>';
		expect(restoreTableFragment(html)).toBe(html);
	});
});

describe('clip capture end to end', () => {
	it('reads back a table clipped by a selection made inside it', () => {
		const text = (capture: string) =>
			clipTextFromHTML(
				clipPayloadFromClick({ menuItemId: 'crapnote-clip-selection' }, tab, capture).html,
			);

		expect(text(CAPTURE.withinOneRow)).toBe('Basic | 4.99');
		expect(text(CAPTURE.acrossTwoRows)).toBe('Basic | 4.99\n\nPro | 12.50');
		expect(text(CAPTURE.headerThroughBody)).toBe(
			'Plan | Price\n\nBasic | 4.99\n\nPro | 12.50',
		);
		expect(text(CAPTURE.spanningWholeTable)).toBe(
			'lead-in text\n\nPlan | Price\n\nBasic | 4.99\n\nPro | 12.50\n\ntrailing text',
		);
	});
});
