export type NoteBodyTextSizeId = 'small' | 'medium' | 'large' | 'x-large';

export interface NoteBodyTextSizeOption {
	id: NoteBodyTextSizeId;
	label: string;
}

const SIZES: NoteBodyTextSizeOption[] = [
	{ id: 'small', label: 'Small' },
	{ id: 'medium', label: 'Medium' },
	{ id: 'large', label: 'Large' },
	{ id: 'x-large', label: 'X-large' },
];

function createNoteBodyTextSizeStore() {
	let current = $state<NoteBodyTextSizeId>('medium');

	return {
		get current() { return current; },
		get sizes() { return SIZES; },
	};
}

export const noteBodyTextSize = createNoteBodyTextSizeStore();
