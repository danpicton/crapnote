import { $command, $view } from '@milkdown/kit/utils';
import { wrapIn } from '@milkdown/kit/prose/commands';
import { bulletListSchema } from '@milkdown/kit/preset/commonmark';
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { Transaction } from '@milkdown/kit/prose/state';

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
			let innerTr: Transaction | null = null;
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

export const taskListItemView = $view(
	extendListItemSchemaForTask.node,
	() =>
		(
			initialNode: ProseMirrorNode,
			view: EditorView,
			getPos: (() => number | undefined) | boolean,
		) => {
			const isTaskItem = initialNode.attrs.checked != null;
			const dom = document.createElement('li');
			const contentDOM = document.createElement('div');
			contentDOM.className = 'task-content';

			let checkbox: HTMLInputElement | null = null;

			if (isTaskItem) {
				dom.setAttribute('data-item-type', 'task');
				dom.setAttribute('data-checked', String(initialNode.attrs.checked));

				checkbox = document.createElement('input');
				checkbox.type = 'checkbox';
				checkbox.checked = initialNode.attrs.checked === true;
				checkbox.className = 'task-checkbox';

				checkbox.addEventListener('mousedown', (e) => {
					e.preventDefault(); // keep ProseMirror focused
				});
				checkbox.addEventListener('click', () => {
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

				dom.appendChild(checkbox);
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
						checkbox.checked = updatedNode.attrs.checked === true;
						dom.setAttribute('data-checked', String(updatedNode.attrs.checked));
					}
					return true;
				},
				destroy() {},
			};
		},
);

export const taskListPlugin = [wrapInTaskListCommand, taskListItemView];
