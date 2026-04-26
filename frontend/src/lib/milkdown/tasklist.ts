import { $command } from '@milkdown/kit/utils';
import { wrapIn } from '@milkdown/kit/prose/commands';
import { bulletListSchema } from '@milkdown/kit/preset/commonmark';
import { extendListItemSchemaForTask } from '@milkdown/kit/preset/gfm';
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

			// Walk up from the post-wrap selection to find and mark the new list item
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

export const taskListPlugin = [wrapInTaskListCommand];
