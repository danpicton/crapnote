import { describe, expect, it } from 'vitest';
import { parseSidebarPreferences } from './sidebarPreferences';

describe('sidebar preferences', () => {
	it('restores a valid hidden state and expanded width', () => {
		expect(parseSidebarPreferences('{"hidden":true,"width":376}')).toEqual({
			hidden: true,
			width: 376,
		});
	});

	it('falls back when saved preferences are malformed or invalid', () => {
		for (const raw of ['not json', '{"hidden":"yes","width":376}', '{"hidden":true,"width":"wide"}', '{"hidden":true,"width":1e999}']) {
			expect(parseSidebarPreferences(raw)).toEqual({ hidden: false, width: 300 });
		}
	});
});
