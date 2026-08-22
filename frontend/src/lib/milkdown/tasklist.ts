import { $command, $view } from '@milkdown/kit/utils';
import { wrapIn } from '@milkdown/kit/prose/commands';
import { bulletListSchema } from '@milkdown/kit/preset/commonmark';
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorView, ViewMutationRecord } from '@milkdown/kit/prose/view';
import type { Transaction } from '@milkdown/kit/prose/state';
import { createDragHandle, enableListItemDrag } from './listdrag';

export const wrapInTaskListCommand = $command('WrapInTaskList', (ctx) => () => {
	return (state, dispatch) => {
		const bulletListType = bulletListSchema.type(ctx);
		const listItemType = extendListItemSchemaForTask.type(ctx);

		// If already in a regular list item, convert it to a task item
		const { $from } = state.selection;
		for (let d = $from.depth; d > 0; d--) {
			const node = $from.node(d);
			if (node.type === listItemType) {
				if (node.attrs.checked != null) return false; // already a task item
				if (dispatch) {
					const pos = $from.before(d);
					dispatch(state.tr.setNodeMarkup(pos, null, { ...node.attrs, checked: false }));
				}
				return true;
			}
		}

		// Not in a list — wrap in bullet list, then mark new items as task items
		if (!wrapIn(bulletListType)(state)) return false;

		if (dispatch) {
			// Use definite-assignment assertion — TypeScript loses narrowing through the callback
			let innerTr!: Transaction;
			wrapIn(bulletListType)(state, (tr) => { innerTr = tr; });
			if (!innerTr) return false;

			const $newFrom = innerTr.selection.$from;
			for (let d = $newFrom.depth; d > 0; d--) {
				const node = $newFrom.node(d);
				if (node.type === listItemType && node.attrs.checked == null) {
					const pos = $newFrom.before(d);
					innerTr.setNodeMarkup(pos, null, { ...node.attrs, checked: false });
					break;
				}
			}

			dispatch(innerTr);
		}
		return true;
	};
});

/**
 * NodeView for list items — plain, ordered and task alike.
 *
 * Extracted from the $view wrapper below so it can be exercised against a stub
 * view in unit tests without booting Milkdown.
 */
export function createTaskListItemView(
	initialNode: ProseMirrorNode,
	view: EditorView,
	getPos: (() => number | undefined) | boolean,
) {
	const isTaskItem = initialNode.attrs.checked != null;
	const dom = document.createElement('li');
	const contentDOM = document.createElement('div');
	contentDOM.className = 'task-content';

	// Drag-to-reorder grip, shown in the list gutter on hover. Applies to
	// plain bullets and ordered items as well as task items.
	const handle = createDragHandle();
	const teardownDrag = enableListItemDrag({
		handle,
		dom,
		view,
		getPos: () => (typeof getPos === 'function' ? getPos() : undefined),
	});
	dom.appendChild(handle);

	let checkbox: HTMLInputElement | null = null;
	// Tracks what the item is actually checked to. initialNode is the node
	// captured at construction and is never reassigned — update() reuses this
	// NodeView for a plain checked-state change, so reading it later would
	// give the value from mount rather than the current one.
	let checkedNow = initialNode.attrs.checked === true;

	if (isTaskItem) {
		dom.setAttribute('data-item-type', 'task');
		dom.setAttribute('data-checked', String(initialNode.attrs.checked));

		checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.checked = initialNode.attrs.checked === true;
		checkbox.className = 'task-checkbox';

		// The box itself is barely a finger wide. Wrapping it in a padded span
		// — negative-margined back out in CSS, so nothing shifts — gives the tap
		// a real target, and hanging the listeners on the wrapper means the
		// padding toggles too.
		const hit = document.createElement('span');
		hit.className = 'task-check-hit';
		hit.setAttribute('contenteditable', 'false');

		hit.addEventListener('mousedown', (e) => {
			e.preventDefault(); // keep ProseMirror focused
		});
		hit.addEventListener('click', () => {
			// A locked note is read-only, but `editable: () => false` only stops
			// ProseMirror's own input handling — a programmatic dispatch would
			// still land, then be dropped by the autosave lock guard and lost
			// silently on reload.
			if (!view.editable) {
				// The browser has already flipped the native input; put it back
				// to what the document says.
				if (checkbox) checkbox.checked = checkedNow;
				return;
			}
			const pos = typeof getPos === 'function' ? getPos() : undefined;
			if (pos == null) return;
			const node = view.state.doc.nodeAt(pos);
			if (!node) return;
			view.dispatch(
				view.state.tr.setNodeMarkup(pos, null, {
					...node.attrs,
					checked: !node.attrs.checked,
				}),
			);
		});

		hit.appendChild(checkbox);
		dom.appendChild(hit);
	}

	dom.appendChild(contentDOM);

	return {
		dom,
		contentDOM,
		update(updatedNode: ProseMirrorNode) {
			if (updatedNode.type !== initialNode.type) return false;
			// If task-ness changed, let ProseMirror recreate the NodeView
			if ((updatedNode.attrs.checked != null) !== isTaskItem) return false;
			if (isTaskItem && checkbox) {
				checkedNow = updatedNode.attrs.checked === true;
				checkbox.checked = checkedNow;
				dom.setAttribute('data-checked', String(updatedNode.attrs.checked));
			}
			return true;
		},
		/**
		 * The drag handle and the drag/drop-target classes live on DOM
		 * ProseMirror owns. Without this hook its DOM observer treats
		 * those mutations as the document having diverged and redraws
		 * the node — destroying this NodeView mid-gesture, which
		 * cancelled every drag on the first frame. Anything inside
		 * contentDOM is real editing and must still be handled.
		 */
		ignoreMutation(mutation: ViewMutationRecord) {
			return !contentDOM.contains(mutation.target);
		},
		destroy() {
			teardownDrag();
		},
	};
}

export const taskListItemView = $view(
	extendListItemSchemaForTask.node,
	() => createTaskListItemView,
);

export const taskListPlugin = [wrapInTaskListCommand, taskListItemView];
