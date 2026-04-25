const STORAGE_KEY_PREFIX = 'crapnote.shortcuts.v1.';

export type ShortcutId =
	| 'new-note'
	| 'search-focus'
	| 'help-modal'
	| 'save'
	| 'bold'
	| 'italic'
	| 'underline'
	| 'insert-link'
	| 'open-tags';

export interface ShortcutAction {
	id: ShortcutId;
	description: string;
	defaultCombo: string;
	/**
	 * True when the binding should apply even while the user is typing in a
	 * normal text input. Combo-modified (Ctrl/Cmd) bindings always apply in
	 * inputs; this flag exists for bare-key bindings the user might actually
	 * need inside a field.
	 */
	allowInInputs?: boolean;
}

interface ParsedCombo {
	key: string;
	ctrl: boolean;
	shift: boolean;
	alt: boolean;
}

const actions: ShortcutAction[] = [
	{ id: 'new-note', description: 'Create a new note', defaultCombo: 'Ctrl+N' },
	{ id: 'search-focus', description: 'Focus the search box', defaultCombo: 'Ctrl+K' },
	{ id: 'save', description: 'Save / commit edit', defaultCombo: 'Ctrl+Enter', allowInInputs: true },
	{ id: 'bold', description: 'Bold (in editor)', defaultCombo: 'Ctrl+B', allowInInputs: true },
	{ id: 'italic', description: 'Italic (in editor)', defaultCombo: 'Ctrl+I', allowInInputs: true },
	{ id: 'underline', description: 'Underline (in editor)', defaultCombo: 'Ctrl+U', allowInInputs: true },
	{
		id: 'insert-link',
		description: 'Insert a link (in editor)',
		defaultCombo: 'Ctrl+Shift+K',
		allowInInputs: true,
	},
	{ id: 'help-modal', description: 'Show keyboard shortcuts', defaultCombo: '?' },
	{ id: 'open-tags', description: 'Open tag popover', defaultCombo: 'Ctrl+.' },
];

// ── Parsing / formatting ─────────────────────────────────────────────────────

export function parseCombo(combo: string): ParsedCombo {
	const parts = combo.split('+').map((p) => p.trim());
	const result: ParsedCombo = { key: '', ctrl: false, shift: false, alt: false };
	for (const p of parts) {
		const lower = p.toLowerCase();
		if (lower === 'ctrl' || lower === 'cmd' || lower === 'meta' || lower === 'control') {
			result.ctrl = true;
		} else if (lower === 'shift') {
			result.shift = true;
		} else if (lower === 'alt' || lower === 'option') {
			result.alt = true;
		} else {
			result.key = p.length === 1 ? p.toLowerCase() : p;
		}
	}
	return result;
}

export function formatCombo(c: ParsedCombo): string {
	const out: string[] = [];
	if (c.ctrl) out.push('Ctrl');
	if (c.shift) out.push('Shift');
	if (c.alt) out.push('Alt');
	out.push(c.key.length === 1 ? c.key.toUpperCase() : c.key);
	return out.join('+');
}

function isMac(platform: 'mac' | 'other' | 'auto' = 'auto'): boolean {
	if (platform === 'mac') return true;
	if (platform === 'other') return false;
	if (typeof navigator === 'undefined') return false;
	return /Mac|iPhone|iPad|iPod/.test(navigator.platform);
}

function displayCombo(combo: string, platform: 'mac' | 'other' | 'auto' = 'auto'): string {
	const p = parseCombo(combo);
	const out: string[] = [];
	const mac = isMac(platform);
	if (p.ctrl) out.push(mac ? '⌘' : 'Ctrl');
	if (p.shift) out.push(mac ? '⇧' : 'Shift');
	if (p.alt) out.push(mac ? '⌥' : 'Alt');
	out.push(p.key.length === 1 ? p.key.toUpperCase() : p.key);
	return out.join(mac ? '' : '+');
}

// ── Reactive state ───────────────────────────────────────────────────────────

interface Binding {
	id: ShortcutId;
	combo: string; // effective combo (override or default)
}

const bindings: Record<ShortcutId, Binding> = Object.fromEntries(
	actions.map((a) => [a.id, { id: a.id, combo: a.defaultCombo }])
) as Record<ShortcutId, Binding>;

let currentUserId: number | null = null;

function storageKey(userId: number): string {
	return STORAGE_KEY_PREFIX + userId;
}

function writeOverrides() {
	if (currentUserId == null) return;
	const overrides: Record<string, string> = {};
	for (const a of actions) {
		if (bindings[a.id].combo !== a.defaultCombo) {
			overrides[a.id] = bindings[a.id].combo;
		}
	}
	try {
		if (Object.keys(overrides).length === 0) {
			window.localStorage.removeItem(storageKey(currentUserId));
		} else {
			window.localStorage.setItem(storageKey(currentUserId), JSON.stringify(overrides));
		}
	} catch {
		// localStorage unavailable — shortcuts still work in-memory.
	}
}

function readOverrides(userId: number): Record<string, string> {
	try {
		const raw = window.localStorage.getItem(storageKey(userId));
		if (!raw) return {};
		const parsed = JSON.parse(raw);
		return typeof parsed === 'object' && parsed !== null ? parsed : {};
	} catch {
		return {};
	}
}

function resetBindings() {
	for (const a of actions) {
		bindings[a.id] = { id: a.id, combo: a.defaultCombo };
	}
}

// ── Public API ───────────────────────────────────────────────────────────────

export const shortcuts = {
	get list(): Array<ShortcutAction & { combo: string }> {
		return actions.map((a) => ({ ...a, combo: bindings[a.id].combo }));
	},

	/**
	 * Load bindings for a given user id from localStorage. Call on login and
	 * when the user changes. Safe to call repeatedly.
	 */
	load(userId: number) {
		currentUserId = userId;
		resetBindings();
		const overrides = readOverrides(userId);
		for (const a of actions) {
			const override = overrides[a.id];
			if (typeof override === 'string' && override) {
				bindings[a.id].combo = override;
			}
		}
	},

	/** Replace a binding and persist the override. */
	setBinding(id: ShortcutId, combo: string) {
		if (!bindings[id]) return;
		bindings[id].combo = combo;
		writeOverrides();
	},

	/** Restore a single action to its default. */
	resetBinding(id: ShortcutId) {
		const a = actions.find((x) => x.id === id);
		if (!a) return;
		bindings[id].combo = a.defaultCombo;
		writeOverrides();
	},

	/** Reset every binding to its default (for the current user). */
	resetAll() {
		resetBindings();
		writeOverrides();
	},

	/**
	 * Internal / test hook: clear in-memory state without touching storage.
	 * Used by tests to start from a clean slate.
	 */
	reset() {
		currentUserId = null;
		resetBindings();
	},

	get(id: ShortcutId): string {
		return bindings[id]?.combo ?? '';
	},

	displayCombo,
};

// ── Matching ─────────────────────────────────────────────────────────────────

function eventCombo(e: KeyboardEvent): ParsedCombo {
	const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
	return {
		key,
		ctrl: e.ctrlKey || e.metaKey,
		shift: e.shiftKey,
		alt: e.altKey,
	};
}

function sameCombo(a: ParsedCombo, b: ParsedCombo): boolean {
	// Key match must be loose enough to handle shifted characters like '?'. When
	// the bound key is a punctuation character we don't insist on exact shift
	// state — the key itself is the signal.
	const keyMatches = a.key === b.key;
	if (!keyMatches) return false;
	if (a.ctrl !== b.ctrl) return false;
	if (a.alt !== b.alt) return false;
	// Only enforce shift when the bound combo is alphanumeric.
	const isAlphaNum = /^[a-z0-9]$/.test(a.key) || a.key.length > 1;
	if (isAlphaNum && a.shift !== b.shift) return false;
	return true;
}

interface MatchOptions {
	skipInInputs?: boolean;
}

function targetIsTextInput(target: EventTarget | null): boolean {
	if (!(target instanceof HTMLElement)) return false;
	if (target.isContentEditable) return true;
	const tag = target.tagName;
	if (tag === 'TEXTAREA') return true;
	if (tag === 'INPUT') {
		const type = (target as HTMLInputElement).type;
		// button/submit/checkbox etc. are not text entry fields.
		return type !== 'button' && type !== 'submit' && type !== 'checkbox' && type !== 'radio';
	}
	return false;
}

/**
 * Given a KeyboardEvent, return the ShortcutId it matches (or null).
 *
 * When `skipInInputs` is true and the event target is a text-entry element,
 * bare-key shortcuts (no Ctrl/Cmd) are ignored so the user can type freely.
 * Bindings marked `allowInInputs` always pass through.
 */
export function matchShortcut(
	event: KeyboardEvent,
	opts: MatchOptions = {}
): ShortcutId | null {
	const ec = eventCombo(event);
	for (const a of actions) {
		const bound = parseCombo(bindings[a.id].combo);
		if (!sameCombo(bound, ec)) continue;
		if (opts.skipInInputs && targetIsTextInput(event.target)) {
			const hasModifier = bound.ctrl || bound.alt;
			if (!hasModifier && !a.allowInInputs) continue;
		}
		return a.id;
	}
	return null;
}
