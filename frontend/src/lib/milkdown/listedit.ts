import { $prose as prosePlugin } from '@milkdown/kit/utils';
import { Plugin, Selection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';

/**
 * Deleting an empty line that sits directly above a list.
 *
 * The stock commonmark behaviour here is wrong for a note app: with the caret
 * on an empty first line and a bullet list below, Delete lifts the list's first
 * item out of the list and merges it into the empty paragraph — the bullet
 * vanishes and the blank line stays. What people expect is the opposite: the
 * blank line goes and the list moves up intact.
 */

const LIST_TYPES = new Set(['bullet_list', 'ordered_list']);

/**
 * Removes the empty textblock the caret is in when the next sibling is a list.
 *
 * Returns false without dispatching whenever that isn't the situation, so the
 * default Backspace/Delete handling still runs everywhere else.
 */
export function deleteEmptyBlockBeforeList(
	state: EditorState,
	dispatch?: (tr: Transaction) => void
): boolean {
	const { selection } = state;
	if (!selection.empty) return false;

	const $from = selection.$from;
	// Only a top-level-ish empty textblock: depth 1 keeps this away from
	// blocks nested inside lists, blockquotes and the like, where the default
	// join behaviour is the right one.
	if ($from.depth !== 1) return false;

	const block = $from.parent;
	if (!block.isTextblock || block.content.size !== 0) return false;

	const index = $from.index(0);
	const parent = $from.node(0);
	const next = index + 1 < parent.childCount ? parent.child(index + 1) : null;
	if (!next || !LIST_TYPES.has(next.type.name)) return false;

	if (!dispatch) return true;

	const start = $from.before(1);
	const tr = state.tr.delete(start, $from.after(1));
	// The list has slid up into the deleted block's place; put the caret at the
	// start of its first item so typing continues where the user is looking.
	tr.setSelection(Selection.near(tr.doc.resolve(start), 1));
	dispatch(tr.scrollIntoView());
	return true;
}

/**
 * Bound to both Backspace and Delete. Backspace only acts when the empty line
 * is the document's first child — anywhere else there is a block above to join
 * with, and the default behaviour is what the user wants.
 */
export const listEditKeymap = prosePlugin(
	() =>
		new Plugin({
			props: {
				handleKeyDown(view, event) {
					if (!view.editable) return false;
					if (event.key !== 'Delete' && event.key !== 'Backspace') return false;
					if (event.ctrlKey || event.metaKey || event.altKey) return false;

					if (event.key === 'Backspace' && view.state.selection.$from.index(0) !== 0) {
						return false;
					}

					const handled = deleteEmptyBlockBeforeList(
						view.state,
						view.dispatch.bind(view)
					);
					if (handled) event.preventDefault();
					return handled;
				},
			},
		})
);

export const listEditPlugin = [listEditKeymap];
