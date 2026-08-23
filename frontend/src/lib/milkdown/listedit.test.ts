import { describe, it, expect, vi } from 'vitest';
import { Schema, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection, type Transaction } from '@milkdown/kit/prose/state';
import { deleteEmptyBlockBeforeList } from './listedit';

// Same minimal schema the other editor tests use — no Milkdown boot needed.
const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { content: 'inline*', group: 'block' },
		heading: { attrs: { level: { default: 1 } }, content: 'inline*', group: 'block' },
		bullet_list: { content: 'list_item+', group: 'block' },
		ordered_list: { content: 'list_item+', group: 'block' },
		list_item: { attrs: { checked: { default: null } }, content: 'paragraph block*' },
		text: { group: 'inline' },
	},
	marks: {},
});

function list(labels: string[], type = 'bullet_list'): ProseMirrorNode {
	return schema.node(
		type,
		null,
		labels.map((l) =>
			schema.node('list_item', null, [schema.node('paragraph', null, [schema.text(l)])])
		)
	);
}

/** Build a doc and put the caret inside the block at `blockIndex`. */
function stateWith(blocks: ProseMirrorNode[], blockIndex: number): EditorState {
	const doc = schema.node('doc', null, blocks);
	let pos = 0;
	for (let i = 0; i < blockIndex; i++) pos += blocks[i].nodeSize;
	return EditorState.create({
		doc,
		selection: TextSelection.create(doc, pos + 1),
	});
}

const empty = () => schema.node('paragraph');

describe('deleteEmptyBlockBeforeList', () => {
	it('removes an empty first line and leaves the list intact', () => {
		const state = stateWith([empty(), list(['milk', 'eggs'])], 0);
		let tr: Transaction | null = null;

		expect(deleteEmptyBlockBeforeList(state, (t) => (tr = t))).toBe(true);

		const doc = tr!.doc;
		expect(doc.childCount).toBe(1);
		expect(doc.child(0).type.name).toBe('bullet_list');
		expect(doc.child(0).childCount).toBe(2);
		expect(doc.textContent).toBe('milkeggs');
	});

	it('works for an empty line above an ordered list', () => {
		const state = stateWith([empty(), list(['one'], 'ordered_list')], 0);
		let tr: Transaction | null = null;

		expect(deleteEmptyBlockBeforeList(state, (t) => (tr = t))).toBe(true);
		expect(tr!.doc.child(0).type.name).toBe('ordered_list');
	});

	it('leaves the caret at the start of the list that moved up', () => {
		const state = stateWith([empty(), list(['milk'])], 0);
		let tr: Transaction | null = null;
		deleteEmptyBlockBeforeList(state, (t) => (tr = t));

		// Inside the first list item's paragraph: doc > list(0) > item(1) > para(2).
		expect(tr!.selection.from).toBe(3);
	});

	it('handles an empty line mid-document above a list', () => {
		const state = stateWith(
			[schema.node('paragraph', null, [schema.text('intro')]), empty(), list(['milk'])],
			1
		);
		let tr: Transaction | null = null;

		expect(deleteEmptyBlockBeforeList(state, (t) => (tr = t))).toBe(true);
		expect(tr!.doc.childCount).toBe(2);
		expect(tr!.doc.child(1).type.name).toBe('bullet_list');
	});

	it('declines when the empty line is not followed by a list', () => {
		const state = stateWith([empty(), schema.node('paragraph', null, [schema.text('x')])], 0);
		const dispatch = vi.fn();

		expect(deleteEmptyBlockBeforeList(state, dispatch)).toBe(false);
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('declines when the line has content', () => {
		const state = stateWith(
			[schema.node('paragraph', null, [schema.text('hi')]), list(['milk'])],
			0
		);
		const dispatch = vi.fn();

		expect(deleteEmptyBlockBeforeList(state, dispatch)).toBe(false);
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('declines when the empty line is the last block', () => {
		const state = stateWith([list(['milk']), empty()], 1);
		const dispatch = vi.fn();

		expect(deleteEmptyBlockBeforeList(state, dispatch)).toBe(false);
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('declines inside a list item, where the default join is correct', () => {
		const doc = schema.node('doc', null, [
			schema.node('bullet_list', null, [
				schema.node('list_item', null, [schema.node('paragraph')]),
			]),
			list(['milk']),
		]);
		const state = EditorState.create({ doc, selection: TextSelection.create(doc, 3) });
		const dispatch = vi.fn();

		expect(deleteEmptyBlockBeforeList(state, dispatch)).toBe(false);
		expect(dispatch).not.toHaveBeenCalled();
	});

	it('reports true without dispatching in dry-run mode', () => {
		const state = stateWith([empty(), list(['milk'])], 0);
		expect(deleteEmptyBlockBeforeList(state)).toBe(true);
	});
});
