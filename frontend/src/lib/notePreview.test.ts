import { describe, it, expect } from 'vitest';
import { notePreview, notePreviewSegments } from './notePreview';

describe('notePreviewSegments', () => {
	it('returns nothing for an empty body', () => {
		expect(notePreviewSegments('')).toEqual([]);
		expect(notePreviewSegments('   \n ')).toEqual([]);
	});

	it('strips angle brackets from an autolink and marks it as a link', () => {
		const body = '<https://www.databricks.com/exam-guide.pdf>\n';
		expect(notePreviewSegments(body)).toEqual([
			{ text: 'https://www.databricks.com/exam-guide.pdf', link: true },
		]);
	});

	it('marks a bare url as a link', () => {
		const body = 'https://www.linkedin.com/posts/someone_knowledge-graphs-activity-7490331259274002432-PeWI';
		expect(notePreviewSegments(body)).toEqual([
			{
				text: 'https://www.linkedin.com/posts/someone_knowledge-graphs-activity-7490331259274002432-PeWI',
				link: true,
			},
		]);
	});

	it('shows only the label of an inline markdown link, as a link', () => {
		expect(notePreviewSegments('see [the docs](https://example.com/a_b_c) now')).toEqual([
			{ text: 'see ' },
			{ text: 'the docs', link: true },
			{ text: ' now' },
		]);
	});

	it('keeps surrounding text around a bare url', () => {
		expect(notePreviewSegments('read https://example.com today')).toEqual([
			{ text: 'read ' },
			{ text: 'https://example.com', link: true },
			{ text: ' today' },
		]);
	});

	it('does not let emphasis stripping mangle a url containing underscores', () => {
		expect(notePreviewSegments('https://example.com/a_b_c_d')).toEqual([
			{ text: 'https://example.com/a_b_c_d', link: true },
		]);
	});

	it('strips trailing punctuation that is not part of the url', () => {
		expect(notePreviewSegments('go to https://example.com.')).toEqual([
			{ text: 'go to ' },
			{ text: 'https://example.com', link: true },
			{ text: '.' },
		]);
	});

	it('still strips other markdown around links', () => {
		const segs = notePreviewSegments('> **Bold** and <https://example.com>');
		expect(segs).toEqual([
			{ text: 'Bold and ' },
			{ text: 'https://example.com', link: true },
		]);
	});

	it('leaves a non-url angle-bracket span alone', () => {
		expect(notePreviewSegments('a <thing> here')).toEqual([{ text: 'a <thing> here' }]);
	});

	it('keeps emphasis markers out of the link when a bare url is wrapped in them', () => {
		expect(notePreviewSegments('**https://example.com/a_b**')).toEqual([
			{ text: 'https://example.com/a_b', link: true },
		]);
		expect(notePreviewSegments('_https://example.com/a_b_')).toEqual([
			{ text: 'https://example.com/a_b', link: true },
		]);
	});

	it('survives a body containing the private-use placeholder character', () => {
		expect(notePreviewSegments('a \uE0000\uE000 b')).toEqual([{ text: 'a 0 b' }]);
		expect(notePreviewSegments('\uE00099\uE000 https://example.com')).toEqual([
			{ text: '99 ' },
			{ text: 'https://example.com', link: true },
		]);
	});

	it('replaces images with a placeholder', () => {
		expect(notePreviewSegments('![alt](/api/images/1)text')).toEqual([
			{ text: '<image content>\ntext' },
		]);
	});

	it('truncates to 300 characters across segments', () => {
		const body = `${'a'.repeat(290)} https://example.com/${'b'.repeat(50)}`;
		const segs = notePreviewSegments(body);
		expect(segs.map((s) => s.text).join('').length).toBe(300);
		expect(segs[segs.length - 1].link).toBe(true);
	});

	it('drops links entirely once the truncation limit is reached', () => {
		const body = `${'a'.repeat(300)} https://example.com`;
		expect(notePreviewSegments(body)).toEqual([{ text: 'a'.repeat(300) }]);
	});
});

describe('notePreview', () => {
	it('flattens segments to plain text', () => {
		expect(notePreview('see [the docs](https://example.com) now')).toBe('see the docs now');
	});

	it('collapses blank lines and trims', () => {
		expect(notePreview('one\n\n\ntwo\n')).toBe('one\ntwo');
	});
});
