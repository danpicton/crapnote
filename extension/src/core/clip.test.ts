import { describe, it, expect } from 'vitest';
import { clipTextFromHTML } from './clip';

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

	it('keeps paragraphs on separate lines', () => {
		expect(clipTextFromHTML('<p>One</p><p>Two</p>')).toBe('One\n\nTwo');
	});
});
