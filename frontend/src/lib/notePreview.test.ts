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

	it('keeps adjacent links separate when nothing separates them', () => {
		expect(notePreviewSegments('https://a.com<https://b.com>')).toEqual([
			{ text: 'https://a.com', link: true },
			{ text: 'https://b.com', link: true },
		]);
		expect(notePreviewSegments('https://a.com[label](https://b.com)')).toEqual([
			{ text: 'https://a.com', link: true },
			{ text: 'label', link: true },
		]);
	});

	it('replaces images with a placeholder', () => {
		expect(notePreviewSegments('![alt](/api/images/1)text')).toEqual([
			{ text: '<image content>' },
			{ text: '\n' },
			{ text: 'text' },
		]);
	});

	it('shows a bullet list with bullets', () => {
		expect(notePreview('- milk\n* eggs\n+ bread')).toBe('\u2022 milk\n\u2022 eggs\n\u2022 bread');
	});

	it('keeps the authored numbers of an ordered list', () => {
		expect(notePreview('1. first\n2. second\n3) third')).toBe('1. first\n2. second\n3. third');
	});

	it('shows task items as empty and ticked boxes', () => {
		expect(notePreview('- [ ] milk\n- [x] eggs\n* [X] bread')).toBe(
			'\u2610 milk\n\u2611 eggs\n\u2611 bread',
		);
	});

	it('marks a heading bold without a marker', () => {
		expect(notePreviewSegments('## Shopping\nmilk')).toEqual([
			{ text: 'Shopping', bold: true },
			{ text: '\n' },
			{ text: 'milk' },
		]);
	});

	it('carries heading emphasis onto a link inside the heading', () => {
		expect(notePreviewSegments('# see https://example.com')).toEqual([
			{ text: 'see ', bold: true },
			{ text: 'https://example.com', link: true, bold: true },
		]);
	});

	it('does not treat a bare hash or an unspaced hash as a heading', () => {
		expect(notePreview('#tag not a heading')).toBe('#tag not a heading');
	});

	it('replaces a whole table with a placeholder', () => {
		const body = 'before\n| a | b |\n|---|---|\n| 1 | 2 |\n| 3 | 4 |\nafter';
		expect(notePreview(body)).toBe('before\n<table content>\nafter');
	});

	it('handles a table written without outer pipes or padding', () => {
		expect(notePreview('a | b\n:--- | ---:\n1 | 2')).toBe('<table content>');
	});

	it('leaves a sentence containing a pipe alone', () => {
		expect(notePreview('run a | b to pipe it')).toBe('run a | b to pipe it');
	});

	it('strips markdown inside a list item', () => {
		expect(notePreviewSegments('- see [the docs](https://example.com) **now**')).toEqual([
			{ text: '\u2022 see ' },
			{ text: 'the docs', link: true },
			{ text: ' now' },
		]);
	});

	it('drops blank lines between blocks', () => {
		expect(notePreview('# Title\n\n- one\n\n- two')).toBe('Title\n\u2022 one\n\u2022 two');
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
