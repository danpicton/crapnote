import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
	shortcuts,
	matchShortcut,
	formatCombo,
	parseCombo,
	type ShortcutId,
} from './shortcuts.svelte';

function ev(
	key: string,
	mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>> = {}
) {
	return new KeyboardEvent('keydown', {
		key,
		ctrlKey: !!mods.ctrlKey,
		metaKey: !!mods.metaKey,
		shiftKey: !!mods.shiftKey,
		altKey: !!mods.altKey,
	});
}

beforeEach(() => {
	localStorage.clear();
	shortcuts.reset();
	shortcuts.load(1);
});

describe('shortcuts store', () => {
	it('exposes a list of actions with default combos', () => {
		const list = shortcuts.list;
		const ids = list.map((a) => a.id);
		expect(ids).toContain('new-note');
		expect(ids).toContain('search-focus');
		expect(ids).toContain('help-modal');
		for (const a of list) {
			expect(a.description).toBeTruthy();
			expect(a.defaultCombo).toBeTruthy();
			expect(a.combo).toBeTruthy();
		}
	});

	it('matches the default new-note shortcut (Ctrl+N)', () => {
		expect(matchShortcut(ev('n', { ctrlKey: true }))).toBe('new-note');
	});

	it('matches Meta (Cmd) equivalently to Ctrl', () => {
		expect(matchShortcut(ev('n', { metaKey: true }))).toBe('new-note');
	});

	it("matches '?' as the help-modal shortcut without requiring Shift", () => {
		// Browsers deliver '?' already as `key = '?'`. The shortcut should fire
		// regardless of whether shiftKey is reported.
		expect(matchShortcut(ev('?'))).toBe('help-modal');
		expect(matchShortcut(ev('?', { shiftKey: true }))).toBe('help-modal');
	});

	it('matches search-focus on Ctrl+K', () => {
		expect(matchShortcut(ev('k', { ctrlKey: true }))).toBe('search-focus');
	});

	it('returns null for unbound keys', () => {
		expect(matchShortcut(ev('q'))).toBeNull();
		expect(matchShortcut(ev('n'))).toBeNull();
	});

	it('honours a user override stored in localStorage', () => {
		shortcuts.setBinding('new-note' as ShortcutId, 'Alt+M');
		// Old default should no longer match.
		expect(matchShortcut(ev('n', { ctrlKey: true }))).toBeNull();
		expect(matchShortcut(ev('m', { altKey: true }))).toBe('new-note');
	});

	it('persists overrides per-user in localStorage', () => {
		shortcuts.setBinding('new-note' as ShortcutId, 'Alt+M');
		// Simulate another user logging in — their bindings should be defaults.
		shortcuts.load(2);
		expect(matchShortcut(ev('n', { ctrlKey: true }))).toBe('new-note');
		// Back to user 1 — override restored.
		shortcuts.load(1);
		expect(matchShortcut(ev('m', { altKey: true }))).toBe('new-note');
	});

	it('reset() restores all defaults', () => {
		shortcuts.setBinding('new-note' as ShortcutId, 'Alt+M');
		shortcuts.resetAll();
		expect(matchShortcut(ev('n', { ctrlKey: true }))).toBe('new-note');
	});
});

describe('parseCombo / formatCombo', () => {
	it('parses "Ctrl+N" case-insensitively', () => {
		expect(parseCombo('Ctrl+N')).toEqual({ key: 'n', ctrl: true, shift: false, alt: false });
		expect(parseCombo('ctrl+n')).toEqual({ key: 'n', ctrl: true, shift: false, alt: false });
	});

	it('treats Cmd and Meta as Ctrl for matching purposes', () => {
		expect(parseCombo('Cmd+K')).toEqual({ key: 'k', ctrl: true, shift: false, alt: false });
		expect(parseCombo('Meta+K')).toEqual({ key: 'k', ctrl: true, shift: false, alt: false });
	});

	it('handles Shift and Alt modifiers', () => {
		expect(parseCombo('Ctrl+Shift+K')).toEqual({
			key: 'k',
			ctrl: true,
			shift: true,
			alt: false,
		});
		expect(parseCombo('Alt+M')).toEqual({ key: 'm', ctrl: false, shift: false, alt: true });
	});

	it('round-trips standalone keys', () => {
		expect(parseCombo('?')).toEqual({ key: '?', ctrl: false, shift: false, alt: false });
		expect(formatCombo({ key: '?', ctrl: false, shift: false, alt: false })).toBe('?');
	});

	it('formats a combo with modifiers in a stable order', () => {
		expect(formatCombo({ key: 'k', ctrl: true, shift: true, alt: false })).toBe('Ctrl+Shift+K');
	});
});

describe('shortcut display label', () => {
	it('uses "⌘" for Ctrl on macOS and "Ctrl" elsewhere', () => {
		// Force mac
		const mac = shortcuts.displayCombo('Ctrl+K', 'mac');
		expect(mac).toMatch(/⌘/);
		const pc = shortcuts.displayCombo('Ctrl+K', 'other');
		expect(pc).toMatch(/Ctrl/);
	});
});

describe('shortcuts ignore events inside text inputs', () => {
	it('skips a bare-key shortcut when focus is in an input and skipInInputs is set', () => {
		// 'n' on its own is not a registered shortcut, but '?' is. Use that.
		const input = document.createElement('input');
		document.body.appendChild(input);
		input.focus();

		const event = new KeyboardEvent('keydown', { key: '?' });
		Object.defineProperty(event, 'target', { value: input });

		expect(matchShortcut(event, { skipInInputs: true })).toBeNull();
		// Without the flag, the shortcut matches.
		expect(matchShortcut(event)).toBe('help-modal');
		document.body.removeChild(input);
	});

	it('still fires in an input when the combo includes Ctrl or Meta', () => {
		// Users typing into a field expect Ctrl+K to still focus search — it's
		// not a typing shortcut. The "skip in inputs" rule only suppresses bare
		// keys like "?" or "n".
		const input = document.createElement('input');
		document.body.appendChild(input);
		input.focus();

		const event = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
		Object.defineProperty(event, 'target', { value: input });

		expect(matchShortcut(event, { skipInInputs: true })).toBe('search-focus');
		document.body.removeChild(input);
	});

	it('does not match a bare "?" typed into an input', () => {
		const input = document.createElement('input');
		document.body.appendChild(input);
		input.focus();

		const event = new KeyboardEvent('keydown', { key: '?' });
		Object.defineProperty(event, 'target', { value: input });

		expect(matchShortcut(event, { skipInInputs: true })).toBeNull();
		document.body.removeChild(input);
	});
});

// Prevent vitest environment leaks.
vi.useRealTimers();
