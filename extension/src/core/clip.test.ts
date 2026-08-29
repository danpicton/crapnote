import { describe, it, expect } from 'vitest';
import { clipTextFromHTML, imageSourcesFromHTML, stripImagesFromHTML } from './clip';

describe('clipTextFromHTML', () => {
	it('returns plain text unchanged for a text-only selection', () => {
		expect(clipTextFromHTML('<p>Hello <b>world</b></p>')).toBe('Hello world');
	});

	it('masks images with <image content>', () => {
		expect(clipTextFromHTML('<p>Before <img src="x.png" alt="pic"> after</p>')).toBe(
			'Before <image content> after',
		);
	});

	it('handles an image-only selection', () => {
		expect(clipTextFromHTML('<img src="solo.jpg">')).toBe('<image content>');
	});

	it('numbers the masks when the selection has more than one image', () => {
		expect(clipTextFromHTML('<p><img src="a.png"> and <img src="b.png"></p>')).toBe(
			'<image content 1> and <image content 2>',
		);
	});

	it('preserves line breaks and indentation inside <pre>', () => {
		expect(clipTextFromHTML('<pre>if x:\n    y()\n</pre>')).toBe('if x:\n    y()');
	});

	it('keeps paragraphs on separate lines', () => {
		expect(clipTextFromHTML('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
	});

	it('separates table cells within a row while keeping rows on their own lines', () => {
		expect(
			clipTextFromHTML(
				'<table><tr><td>A</td><td>B</td></tr><tr><td>C</td><td>D</td></tr></table>',
			),
		).toBe('A | B\n\nC | D');
	});

	it('separates header cells the same way as data cells', () => {
		expect(
			clipTextFromHTML(
				'<table><thead><tr><th>H1</th><th>H2</th></tr></thead>' +
					'<tbody><tr><td>1</td><td>2</td></tr></tbody></table>',
			),
		).toBe('H1 | H2\n\n1 | 2');
	});

	it('leaves a single-cell row without a leading separator', () => {
		expect(clipTextFromHTML('<table><tr><td>Only</td></tr></table>')).toBe('Only');
	});

	it('separates cells inline when their content is wrapped in a block element', () => {
		// The common real-world shape: every cell holds a <div> or <p>. The
		// cell boundary has to absorb the block break, or the separator is
		// stranded on a line of its own.
		expect(
			clipTextFromHTML(
				'<table><tr><td><div>A</div></td><td><div>B</div></td></tr>' +
					'<tr><td><p>C</p></td><td><p>D</p></td></tr></table>',
			),
		).toBe('A | B\n\nC | D');
	});

	it('separates a mix of inline and block cell content on one line', () => {
		expect(
			clipTextFromHTML('<table><tr><td>A</td><td><div>B</div></td></tr></table>'),
		).toBe('A | B');
	});

	it('drops a separator left dangling by an empty cell', () => {
		expect(clipTextFromHTML('<table><tr><td></td><td>B</td></tr></table>')).toBe('B');
		expect(clipTextFromHTML('<table><tr><td>A</td><td></td></tr></table>')).toBe('A');
		expect(clipTextFromHTML('<table><tr><td></td><td></td></tr></table>')).toBe('');
	});

	it('keeps preformatted cell content intact', () => {
		expect(
			clipTextFromHTML(
				'<table><tr><td><pre>if x:\n    y()</pre></td><td>note</td></tr></table>',
			),
		).toBe('if x:\n    y() | note');
	});
});

describe('imageSourcesFromHTML', () => {
	it('returns image srcs in document order, matching mask order', () => {
		expect(
			imageSourcesFromHTML('<p><img src="a.png"> mid <span><img src="b.jpg"></span></p>'),
		).toEqual(['a.png', 'b.jpg']);
		expect(imageSourcesFromHTML('<p>no images</p>')).toEqual([]);
	});

	it('keeps an empty src empty instead of resolving it to the page URL', () => {
		expect(imageSourcesFromHTML('<img src="">', 'https://example.com/a')).toEqual(['']);
	});

	it('resolves relative srcs against the page URL', () => {
		expect(
			imageSourcesFromHTML(
				'<img src="/media/pic.jpg"><img src="rel.png"><img src="https://cdn.example.com/abs.png">',
				'https://example.com/articles/post',
			),
		).toEqual([
			'https://example.com/media/pic.jpg',
			'https://example.com/articles/rel.png',
			'https://cdn.example.com/abs.png',
		]);
	});
});

describe('stripImagesFromHTML', () => {
	it('removes images entirely, leaving the text', () => {
		const html = '<p>Before <img src="x.png"> after</p>';
		expect(clipTextFromHTML(stripImagesFromHTML(html))).toBe('Before after');
		expect(imageSourcesFromHTML(stripImagesFromHTML(html))).toEqual([]);
	});
});
