import { describe, expect, it } from 'vitest';
import { parseSidebarPreferences } from './sidebarPreferences';

describe('sidebar preferences', () => {
	it('restores a valid hidden state and expanded width', () => {
		expect(parseSidebarPreferences('{"hidden":true,"width":376}')).toEqual({
			hidden: true,
			width: 376,
		});
	});
});
