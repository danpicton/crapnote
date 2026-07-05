/**
 * Pure helpers for deriving which formats are active at the current
 * selection — drives the active-button highlight on the formatting bars.
 */
import type { EditorState } from '@milkdown/kit/prose/state';

export interface ActiveFormats {
	strong: boolean;
	emphasis: boolean;
	underline: boolean;
	inlineCode: boolean;
	heading: number | null;
	blockquote: boolean;
	bulletList: boolean;
	orderedList: boolean;
	taskList: boolean;
}

export const EMPTY_FORMATS: ActiveFormats = {
	strong: false,
	emphasis: false,
	underline: false,
	inlineCode: false,
	heading: null,
	blockquote: false,
	bulletList: false,
	orderedList: false,
	taskList: false,
};

function isMarkActive(state: EditorState, name: string): boolean {
	const type = state.schema.marks[name];
	if (!type) return false;
	const { from, to, $from, empty } = state.selection;
	if (empty) {
		const marks = state.storedMarks ?? $from.marks();
		return type.isInSet(marks) != null;
	}
	// Range selection: active only when every text node in the range carries
	// the mark (mixed formatting shows as inactive).
	let sawText = false;
	let allMarked = true;
	state.doc.nodesBetween(from, to, (node) => {
		if (!node.isText) return;
		sawText = true;
		if (!type.isInSet(node.marks)) allMarked = false;
	});
	return sawText && allMarked;
}

export function computeActiveFormats(state: EditorState): ActiveFormats {
	const formats: ActiveFormats = {
		...EMPTY_FORMATS,
		strong: isMarkActive(state, 'strong'),
		emphasis: isMarkActive(state, 'emphasis'),
		underline: isMarkActive(state, 'underline'),
		inlineCode: isMarkActive(state, 'inlineCode'),
	};

	// Walk the ancestors of the selection head, innermost first. The nearest
	// list_item decides between task list and its containing list's type.
	const { $from } = state.selection;
	let listResolved = false;
	for (let depth = $from.depth; depth >= 0; depth--) {
		const node = $from.node(depth);
		switch (node.type.name) {
			case 'heading':
				formats.heading = node.attrs.level as number;
				break;
			case 'blockquote':
				formats.blockquote = true;
				break;
			case 'list_item':
				if (!listResolved && node.attrs.checked != null) {
					formats.taskList = true;
					listResolved = true;
				}
				break;
			case 'bullet_list':
				if (!listResolved) {
					formats.bulletList = true;
					listResolved = true;
				}
				break;
			case 'ordered_list':
				if (!listResolved) {
					formats.orderedList = true;
					listResolved = true;
				}
				break;
		}
	}

	return formats;
}
