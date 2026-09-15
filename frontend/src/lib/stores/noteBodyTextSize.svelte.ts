export type NoteBodyTextSizeId = 'small' | 'medium' | 'large' | 'x-large';

export interface NoteBodyTextSizeOption {
	id: NoteBodyTextSizeId;
	label: string;
}

const STORAGE_KEY = 'crapnote-note-body-text-size';

const SIZES: NoteBodyTextSizeOption[] = [
	{ id: 'small', label: 'Small' },
	{ id: 'medium', label: 'Medium' },
	{ id: 'large', label: 'Large' },
	{ id: 'x-large', label: 'X-large' },
];

function isNoteBodyTextSizeId(value: unknown): value is NoteBodyTextSizeId {
	return SIZES.some((size) => size.id === value);
}

function createNoteBodyTextSizeStore() {
	let current = $state<NoteBodyTextSizeId>('medium');

	function apply(id: NoteBodyTextSizeId) {
		current = id;
		document.documentElement.setAttribute('data-note-body-size', id);
	}

	function init() {
		let stored: string | null = null;
		try {
			stored = window.localStorage.getItem(STORAGE_KEY);
		} catch {
			// Unavailable storage is the same as no stored preference.
		}
		apply(isNoteBodyTextSizeId(stored) ? stored : 'medium');
	}

	function set(id: NoteBodyTextSizeId) {
		if (!isNoteBodyTextSizeId(id)) return;
		apply(id);
		try {
			window.localStorage.setItem(STORAGE_KEY, id);
		} catch {
			// The display preference still applies for this session.
		}
	}

	return {
		get current() { return current; },
		get sizes() { return SIZES; },
		init,
		set,
	};
}

export const noteBodyTextSize = createNoteBodyTextSizeStore();
