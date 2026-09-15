import { describe, expect, it } from 'vitest';
import {
	clampSidebarWidth,
	loadSidebarPreferences,
	parseSidebarPreferences,
	saveSidebarPreferences,
} from './sidebarPreferences';

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

	it('bounds the sidebar while reserving a usable note pane', () => {
		expect(clampSidebarWidth(100, 1200)).toBe(220);
		expect(clampSidebarWidth(900, 1200)).toBe(480);
		expect(clampSidebarWidth(480, 700)).toBe(380);
	});

	it('falls back safely when browser storage is unavailable', () => {
		const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
		const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });

		expect(loadSidebarPreferences()).toEqual({ hidden: false, width: 300 });
		expect(() => saveSidebarPreferences({ hidden: true, width: 350 })).not.toThrow();

		read.mockRestore();
		write.mockRestore();
	});
});
