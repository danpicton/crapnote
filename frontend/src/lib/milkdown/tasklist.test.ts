import { describe, it, expect, vi } from 'vitest';
import { Schema, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { createTaskListItemView } from './tasklist';

// Mirrors the node names Milkdown's commonmark/gfm presets register — same
// minimal schema listmove.test.ts uses, so no editor boot is needed.
const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { content: 'inline*', group: 'block' },
		bullet_list: { content: 'list_item+', group: 'block' },
		list_item: { attrs: { checked: { default: null } }, content: 'paragraph block*' },
		text: { group: 'inline' },
	},
	marks: {},
});

function taskDoc(checked: boolean): ProseMirrorNode {
	return schema.node('doc', null, [
		schema.node('bullet_list', null, [
			schema.node('list_item', { checked }, [
				schema.node('paragraph', null, [schema.text('milk')]),
			]),
		]),
	]);
}

/** The first list_item sits one position inside the bullet_list at 0. */
const ITEM_POS = 1;

function mountItem(opts: { checked?: boolean | null; editable?: boolean } = {}) {
	const checked = opts.checked === undefined ? false : opts.checked;
	const doc = taskDoc(checked === null ? false : checked);
	const state = EditorState.create({ doc, schema });
	const dispatch = vi.fn();
	const view = {
		editable: opts.editable !== false,
		state,
		dispatch,
		focus: vi.fn(),
	} as unknown as Parameters<typeof createTaskListItemView>[1];

	const node = checked === null
		? schema.node('list_item', { checked: null }, [
				schema.node('paragraph', null, [schema.text('milk')]),
			])
		: doc.nodeAt(ITEM_POS)!;

	const nodeView = createTaskListItemView(node, view, () => ITEM_POS);
	return { nodeView, dispatch, view, dom: nodeView.dom as HTMLElement };
}

describe('task list item view', () => {
	it('wraps the checkbox in a hit area big enough to tap', () => {
		const { dom } = mountItem();
		const hit = dom.querySelector('.task-check-hit');
		expect(hit).not.toBeNull();
		expect(hit!.querySelector('input.task-checkbox')).not.toBeNull();
	});

	it('toggles when the padding around the checkbox is clicked', () => {
		const { dom, dispatch } = mountItem({ checked: false });
		const hit = dom.querySelector('.task-check-hit') as HTMLElement;

		hit.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(dispatch).toHaveBeenCalledTimes(1);
	});

	it('does not toggle when the note is read-only', () => {
		const { dom, dispatch } = mountItem({ checked: false, editable: false });
		const box = dom.querySelector('input.task-checkbox') as HTMLInputElement;

		box.dispatchEvent(new MouseEvent('click', { bubbles: true }));

		expect(dispatch).not.toHaveBeenCalled();
	});

	it('renders no checkbox for a plain (non-task) list item', () => {
		const { dom } = mountItem({ checked: null });
		expect(dom.querySelector('.task-check-hit')).toBeNull();
		expect(dom.querySelector('.list-drag-handle')).not.toBeNull();
	});
});

describe('locked checkbox revert', () => {
	it('reverts to the current checked state, not the one from mount', () => {
		const { nodeView, dom, dispatch, view } = mountItem({ checked: false });
		const box = dom.querySelector('input.task-checkbox') as HTMLInputElement;

		// The item is ticked while editable. Task-ness is unchanged, so
		// ProseMirror reuses this NodeView and only calls update().
		const ticked = schema.node('list_item', { checked: true }, [
			schema.node('paragraph', null, [schema.text('milk')]),
		]);
		nodeView.update!(ticked);
		expect(box.checked).toBe(true);

		// The note is then locked. setProps({ editable }) does not rebuild
		// NodeViews, so this same instance handles the click.
		(view as unknown as { editable: boolean }).editable = false;

		box.checked = false; // the browser toggles before our handler runs
		(dom.querySelector('.task-check-hit') as HTMLElement).dispatchEvent(
			new MouseEvent('click', { bubbles: true })
		);

		expect(dispatch).not.toHaveBeenCalled();
		expect(box.checked).toBe(true);
		expect(dom.getAttribute('data-checked')).toBe('true');
	});
});
