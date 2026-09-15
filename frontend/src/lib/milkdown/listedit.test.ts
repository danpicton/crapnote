import { describe, it, expect, vi } from 'vitest';
import { Schema, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection, type Transaction } from '@milkdown/kit/prose/state';
import { history, undo } from '@milkdown/kit/prose/history';
import { deleteEmptyBlockBeforeList, wrapSelectedBlocksInList } from './listedit';

// Same minimal schema the other editor tests use — no Milkdown boot needed.
const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { content: 'inline*', group: 'block' },
		heading: { attrs: { level: { default: 1 } }, content: 'inline*', group: 'block' },
		bullet_list: { content: 'list_item+', group: 'block' },
		ordered_list: { content: 'list_item+', group: 'block' },
		list_item: { attrs: { checked: { default: null } }, content: 'paragraph block*' },
		hard_break: { inline: true, group: 'inline' },
		text: { group: 'inline' },
	},
	marks: {
		strong: {},
	},
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

describe('wrapSelectedBlocksInList', () => {
	it('turns each selected paragraph into a separate list item', () => {
		const paragraphs = ['Alpha', 'Beta', 'Gamma'].map((text) =>
			schema.node('paragraph', null, [schema.text(text)])
		);
		const doc = schema.node('doc', null, paragraphs);
		const state = EditorState.create({
			doc,
			selection: TextSelection.create(doc, 1, doc.content.size - 1),
		});
		let tr: Transaction | null = null;

		expect(wrapSelectedBlocksInList(state, (next) => (tr = next), schema.nodes.bullet_list)).toBe(true);

		const bulletList = tr!.doc.firstChild!;
		expect(bulletList.type.name).toBe('bullet_list');
		expect(bulletList.childCount).toBe(3);
		expect(Array.from({ length: 3 }, (_, index) => bulletList.child(index).textContent)).toEqual([
			'Alpha',
			'Beta',
			'Gamma',
		]);
	});

	it('keeps hard-break-separated lines in one list item', () => {
		const paragraph = schema.node('paragraph', null, [
			schema.text('Alpha'),
			schema.node('hard_break'),
			schema.text('Beta'),
			schema.node('hard_break'),
			schema.text('Gamma'),
		]);
		const doc = schema.node('doc', null, [paragraph]);
		const state = EditorState.create({
			doc,
			selection: TextSelection.create(doc, 1, doc.content.size - 1),
		});
		let tr: Transaction | null = null;

		expect(wrapSelectedBlocksInList(state, (next) => (tr = next), schema.nodes.bullet_list)).toBe(true);

		const bulletList = tr!.doc.firstChild!;
		expect(bulletList.childCount).toBe(1);
		const wrappedParagraph = bulletList.firstChild!.firstChild!;
		expect(wrappedParagraph.childCount).toBe(5);
		expect(wrappedParagraph.child(1).type.name).toBe('hard_break');
		expect(wrappedParagraph.child(3).type.name).toBe('hard_break');
		expect(wrappedParagraph.textContent).toBe('AlphaBetaGamma');
	});

	it('wraps only touched paragraphs and preserves text, order, and inline marks', () => {
		const strong = schema.marks.strong.create();
		const blocks = [
			schema.node('paragraph', null, [schema.text('Intro')]),
			schema.node('paragraph', null, [schema.text('Alpha')]),
			schema.node('paragraph', null, [schema.text('Beta', [strong])]),
			schema.node('paragraph', null, [schema.text('Gamma')]),
			schema.node('paragraph', null, [schema.text('Outro')]),
		];
		const doc = schema.node('doc', null, blocks);
		// Start and end partway through Alpha and Gamma: list wrapping acts on
		// the touched paragraphs without pulling in their neighbours.
		const state = EditorState.create({
			doc,
			selection: TextSelection.create(doc, 10, 23),
		});
		let tr: Transaction | null = null;

		wrapSelectedBlocksInList(state, (next) => (tr = next), schema.nodes.bullet_list);

		const result = tr!.doc;
		expect(result.childCount).toBe(3);
		expect(result.child(0).textContent).toBe('Intro');
		expect(result.child(2).textContent).toBe('Outro');
		const bulletList = result.child(1);
		expect(Array.from({ length: 3 }, (_, index) => bulletList.child(index).textContent)).toEqual([
			'Alpha',
			'Beta',
			'Gamma',
		]);
		expect(bulletList.child(1).firstChild!.firstChild!.marks[0].type.name).toBe('strong');
	});

	it('undo restores the original paragraphs and selection', () => {
		const originalDoc = schema.node(
			'doc',
			null,
			['Alpha', 'Beta', 'Gamma'].map((text) =>
				schema.node('paragraph', null, [schema.text(text)])
			)
		);
		const originalSelection = TextSelection.create(originalDoc, 1, originalDoc.content.size - 1);
		let state = EditorState.create({
			doc: originalDoc,
			selection: originalSelection,
			plugins: [history()],
		});

		wrapSelectedBlocksInList(
			state,
			(transaction) => (state = state.apply(transaction)),
			schema.nodes.bullet_list
		);
		expect(state.doc.firstChild!.type.name).toBe('bullet_list');

		expect(undo(state, (transaction) => (state = state.apply(transaction)))).toBe(true);
		expect(state.doc.eq(originalDoc)).toBe(true);
		expect(state.selection.eq(originalSelection)).toBe(true);
	});
});

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
