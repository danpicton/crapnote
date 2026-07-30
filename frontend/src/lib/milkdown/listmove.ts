import { $prose as prosePlugin } from '@milkdown/kit/utils';
import { Fragment, type Node as ProseMirrorNode, type ResolvedPos } from '@milkdown/kit/prose/model';
import { Plugin, Selection, type EditorState, type Transaction } from '@milkdown/kit/prose/state';
import { matchShortcut, type ShortcutId } from '$lib/stores/shortcuts.svelte';

/**
 * Reordering list items — used by both the Alt+Arrow keyboard shortcuts and the
 * drag handles in the list item NodeView.
 *
 * The logic is deliberately kept as pure functions over an EditorState so it can
 * be tested against a plain ProseMirror schema without booting a Milkdown
 * editor. The Milkdown `$command` wrappers at the bottom are thin.
 */

/** Node names the reorder logic recognises. Matches commonmark/gfm. */
const LIST_ITEM = 'list_item';
const LIST_TYPES = new Set(['bullet_list', 'ordered_list']);

export interface ListItemContext {
	/** The list item node itself, including any nested sub-lists. */
	node: ProseMirrorNode;
	/** Absolute position immediately before the item. */
	pos: number;
	/** The enclosing bullet_list / ordered_list. */
	parent: ProseMirrorNode;
	/** Absolute position of the first child inside the parent list. */
	parentStart: number;
	/** Index of this item among its siblings. */
	index: number;
}

/**
 * Walk up from a resolved position to the innermost enclosing list item.
 * Returns null when the position is not inside a list.
 */
export function findListItem($pos: ResolvedPos): ListItemContext | null {
	for (let depth = $pos.depth; depth > 0; depth--) {
		const node = $pos.node(depth);
		if (node.type.name !== LIST_ITEM) continue;

		const parent = $pos.node(depth - 1);
		if (!LIST_TYPES.has(parent.type.name)) return null;

		return {
			node,
			pos: $pos.before(depth),
			parent,
			parentStart: $pos.start(depth - 1),
			index: $pos.index(depth - 1),
		};
	}
	return null;
}

/** Where to move an item: a relative direction, or an absolute sibling index. */
export type MoveTarget = 'up' | 'down' | 'top' | 'bottom' | number;

function resolveTargetIndex(target: MoveTarget, index: number, count: number): number {
	switch (target) {
		case 'up':
			return index - 1;
		case 'down':
			return index + 1;
		case 'top':
			return 0;
		case 'bottom':
			return count - 1;
		default:
			return target;
	}
}

/**
 * Move the list item containing the selection to a new position among its
 * siblings. Nested sub-lists travel with their parent item because the whole
 * list_item node is relocated.
 *
 * Returns false (without dispatching) when there is no list item at the
 * selection or the move would be a no-op, so callers can fall through to the
 * next keybinding.
 */
export function moveListItem(
	state: EditorState,
	dispatch: ((tr: Transaction) => void) | undefined,
	target: MoveTarget
): boolean {
	const ctx = findListItem(state.selection.$from);
	if (!ctx) return false;
	return moveListItemAt(state, dispatch, ctx, target);
}

/**
 * As moveListItem, but for an item located by something other than the
 * selection — the drag handles resolve their own item via getPos().
 */
export function moveListItemAt(
	state: EditorState,
	dispatch: ((tr: Transaction) => void) | undefined,
	ctx: ListItemContext,
	target: MoveTarget
): boolean {
	const count = ctx.parent.childCount;
	const to = resolveTargetIndex(target, ctx.index, count);

	if (to === ctx.index) return false;
	if (to < 0 || to >= count) return false;

	if (!dispatch) return true;

	const children: ProseMirrorNode[] = [];
	ctx.parent.forEach((child) => children.push(child));
	const [moved] = children.splice(ctx.index, 1);
	children.splice(to, 0, moved);

	const tr = state.tr.replaceWith(
		ctx.parentStart,
		ctx.parentStart + ctx.parent.content.size,
		Fragment.fromArray(children)
	);

	// Keep the caret where the user left it, relative to the item that moved.
	// Positions can't be mapped through a wholesale content replace, so the new
	// item start is recomputed from the reordered sibling sizes.
	let newItemStart = ctx.parentStart;
	for (let i = 0; i < to; i++) newItemStart += children[i].nodeSize;

	const caretOffset = state.selection.from - ctx.pos;
	if (caretOffset >= 0 && caretOffset <= ctx.node.nodeSize) {
		const target = Math.min(newItemStart + caretOffset, tr.doc.content.size);
		tr.setSelection(Selection.near(tr.doc.resolve(target)));
	}

	dispatch(tr.scrollIntoView());
	return true;
}

// ── Keyboard bindings ────────────────────────────────────────────────────────

const SHORTCUT_TARGETS: Partial<Record<ShortcutId, MoveTarget>> = {
	'list-move-up': 'up',
	'list-move-down': 'down',
	'list-move-top': 'top',
	'list-move-bottom': 'bottom',
};

/**
 * Handle the list-move shortcuts inside the editor rather than at the window
 * level, so they work on every route that mounts an Editor and only while the
 * editor actually has focus. Bindings are read from the shortcut store, so user
 * rebindings apply here too.
 */
export const listMoveKeymap = prosePlugin(
	() =>
		new Plugin({
			props: {
				handleKeyDown(view, event) {
					if (!view.editable) return false;

					const id = matchShortcut(event);
					const target = id ? SHORTCUT_TARGETS[id] : undefined;
					if (target === undefined) return false;

					const handled = moveListItem(view.state, view.dispatch.bind(view), target);
					if (handled) {
						// Stop the window-level shortcut handler on the notes list
						// route from seeing an event the editor has consumed.
						event.stopPropagation();
					}
					return handled;
				},
			},
		})
);

export const listMovePlugin = [listMoveKeymap];
