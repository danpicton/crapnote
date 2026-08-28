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
