import { describe, it, expect, beforeEach } from 'vitest';
import {
	buildSharedNote,
	hasShareContent,
	hasStashedShare,
	readSharePayload,
	stashShare,
	takeStashedShare,
} from './share';

describe('readSharePayload', () => {
	it('pulls the three share fields off the query string', () => {
		const params = new URLSearchParams('title=Hi&text=Some+words&url=https%3A%2F%2Fexample.com');
		expect(readSharePayload(params)).toEqual({
			title: 'Hi',
			text: 'Some words',
			url: 'https://example.com',
		});
	});

	it('reports missing fields as null', () => {
		expect(readSharePayload(new URLSearchParams('text=only'))).toEqual({
			title: null,
			text: 'only',
			url: null,
		});
	});
});

describe('hasShareContent', () => {
	it('is false for an empty share', () => {
		expect(hasShareContent({})).toBe(false);
		expect(hasShareContent({ title: '', text: '', url: '' })).toBe(false);
		expect(hasShareContent({ title: '   ' })).toBe(false);
	});

	it('is true when any field carries content', () => {
		expect(hasShareContent({ title: 'x' })).toBe(true);
		expect(hasShareContent({ text: 'x' })).toBe(true);
		expect(hasShareContent({ url: 'https://example.com' })).toBe(true);
	});
});

describe('buildSharedNote', () => {
	it('uses the shared title and puts text above the url', () => {
		expect(buildSharedNote({ title: 'Post', text: 'A quote', url: 'https://example.com' })).toEqual(
			{ title: 'Post', body: 'A quote\n\nhttps://example.com' }
		);
	});

	it('leaves the title empty so the server applies its own default', () => {
		expect(buildSharedNote({ text: 'just some text' })).toEqual({
			title: '',
			body: 'just some text',
		});
	});

	it('handles a bare url share', () => {
		expect(buildSharedNote({ title: 'Example', url: 'https://example.com' })).toEqual({
			title: 'Example',
			body: 'https://example.com',
		});
	});

	// Apps without url support repeat the link in the text field.
	it('does not write the url twice when text duplicates it', () => {
		expect(
			buildSharedNote({ text: 'https://example.com', url: 'https://example.com' })
		).toEqual({ title: '', body: 'https://example.com' });
	});

	it('trims surrounding whitespace', () => {
		expect(buildSharedNote({ title: '  Spaced  ', text: '  body  ' })).toEqual({
			title: 'Spaced',
			body: 'body',
		});
	});

	it('produces an empty body when nothing but a title was shared', () => {
		expect(buildSharedNote({ title: 'Only a title' })).toEqual({
			title: 'Only a title',
			body: '',
		});
	});
});

describe('stashing a share across login', () => {
	beforeEach(() => sessionStorage.clear());

	it('round-trips a payload', () => {
		const payload = { title: 'T', text: 'B', url: 'https://example.com' };
		stashShare(payload);

		expect(hasStashedShare()).toBe(true);
		expect(takeStashedShare()).toEqual(payload);
	});

	it('clears the stash once taken, so a share is never applied twice', () => {
		stashShare({ text: 'once' });

		expect(takeStashedShare()).toEqual({ text: 'once' });
		expect(takeStashedShare()).toBeNull();
		expect(hasStashedShare()).toBe(false);
	});

	it('returns null when nothing is stashed', () => {
		expect(takeStashedShare()).toBeNull();
		expect(hasStashedShare()).toBe(false);
	});

	it('survives corrupt storage without throwing', () => {
		sessionStorage.setItem('crapnote.pendingShare', 'not json');
		expect(takeStashedShare()).toBeNull();
	});
});
