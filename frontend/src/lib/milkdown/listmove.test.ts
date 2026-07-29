import { describe, it, expect } from 'vitest';
import { Schema, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection, type Transaction } from '@milkdown/kit/prose/state';
import { findListItem, moveListItem } from './listmove';

// Same minimal schema shape as formatState.test.ts — mirrors the node names
// Milkdown's commonmark/gfm presets register.
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

/** `- a\n- b\n- c` as a doc, optionally as an ordered list. */
function listDoc(labels: string[], listType = 'bullet_list'): ProseMirrorNode {
	return schema.node('doc', null, [
		schema.node(
			listType,
			null,
			labels.map((l) =>
				schema.node('list_item', null, [schema.node('paragraph', null, [schema.text(l)])])
			)
		),
	]);
}

/** Position of the first text character inside list item `index`. */
function posInItem(doc: ProseMirrorNode, index: number): number {
	const list = doc.child(0);
	let pos = 1; // inside doc, at the list
	pos += 1; // inside the list, at the first item
	for (let i = 0; i < index; i++) pos += list.child(i).nodeSize;
	return pos + 1; // inside the item, inside its paragraph
}

function stateAtItem(doc: ProseMirrorNode, index: number): EditorState {
	return EditorState.create({
		schema,
		doc,
		selection: TextSelection.create(doc, posInItem(doc, index)),
	});
}

/** Run a move and return the resulting item labels (top level only). */
function labelsAfter(
	state: EditorState,
	target: Parameters<typeof moveListItem>[2]
): string[] | null {
	let tr: Transaction | null = null;
	const handled = moveListItem(state, (t) => (tr = t), target);
	if (!handled) return null;
	if (!tr) return null;
	const doc = (tr as Transaction).doc;
	const list = doc.child(0);
	const out: string[] = [];
	list.forEach((item) => out.push(item.textContent));
	return out;
}

describe('findListItem', () => {
	it('finds the enclosing list item and its index', () => {
		const doc = listDoc(['a', 'b', 'c']);
		const state = stateAtItem(doc, 1);

		const found = findListItem(state.selection.$from);

		expect(found).not.toBeNull();
		expect(found!.index).toBe(1);
		expect(found!.node.textContent).toBe('b');
		expect(found!.parent.type.name).toBe('bullet_list');
	});

	it('returns null when the cursor is not inside a list', () => {
		const doc = schema.node('doc', null, [
			schema.node('paragraph', null, [schema.text('just a paragraph')]),
		]);
		const state = EditorState.create({
			schema,
			doc,
			selection: TextSelection.create(doc, 2),
		});

		expect(findListItem(state.selection.$from)).toBeNull();
	});

	it('finds the innermost item when lists are nested', () => {
		// - outer
		//   - inner
		const inner = schema.node('bullet_list', null, [
			schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('inner')])]),
		]);
		const doc = schema.node('doc', null, [
			schema.node('bullet_list', null, [
				schema.node('list_item', null, [
					schema.node('paragraph', null, [schema.text('outer')]),
					inner,
				]),
			]),
		]);
		// Position inside "inner": doc(1) > list(1) > item(1) > paragraph "outer" (7) > inner list(1) > item(1) > para(1)
		const pos = 1 + 1 + 1 + schema.node('paragraph', null, [schema.text('outer')]).nodeSize + 1 + 1 + 1;
		const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, pos) });

		const found = findListItem(state.selection.$from);

		expect(found).not.toBeNull();
		expect(found!.node.textContent).toBe('inner');
		expect(found!.index).toBe(0);
	});
});

describe('moveListItem', () => {
	it('moves an item up one place', () => {
		expect(labelsAfter(stateAtItem(listDoc(['a', 'b', 'c']), 1), 'up')).toEqual(['b', 'a', 'c']);
	});

	it('moves an item down one place', () => {
		expect(labelsAfter(stateAtItem(listDoc(['a', 'b', 'c']), 1), 'down')).toEqual(['a', 'c', 'b']);
	});

	it('moves an item to the top', () => {
		expect(labelsAfter(stateAtItem(listDoc(['a', 'b', 'c', 'd']), 2), 'top')).toEqual([
			'c',
			'a',
			'b',
			'd',
		]);
	});

	it('moves an item to the bottom', () => {
		expect(labelsAfter(stateAtItem(listDoc(['a', 'b', 'c', 'd']), 1), 'bottom')).toEqual([
			'a',
			'c',
			'd',
			'b',
		]);
	});

	it('moves an item to an explicit index', () => {
		expect(labelsAfter(stateAtItem(listDoc(['a', 'b', 'c', 'd']), 0), 3)).toEqual([
			'b',
			'c',
			'd',
			'a',
		]);
	});

	it('works on ordered lists too', () => {
		const doc = listDoc(['a', 'b', 'c'], 'ordered_list');
		expect(labelsAfter(stateAtItem(doc, 2), 'up')).toEqual(['a', 'c', 'b']);
	});

	it('is a no-op at the top of the list', () => {
		expect(labelsAfter(stateAtItem(listDoc(['a', 'b']), 0), 'up')).toBeNull();
		expect(labelsAfter(stateAtItem(listDoc(['a', 'b']), 0), 'top')).toBeNull();
	});

	it('is a no-op at the bottom of the list', () => {
		expect(labelsAfter(stateAtItem(listDoc(['a', 'b']), 1), 'down')).toBeNull();
		expect(labelsAfter(stateAtItem(listDoc(['a', 'b']), 1), 'bottom')).toBeNull();
	});

	it('does nothing when the cursor is outside a list', () => {
		const doc = schema.node('doc', null, [
			schema.node('paragraph', null, [schema.text('nope')]),
		]);
		const state = EditorState.create({ schema, doc, selection: TextSelection.create(doc, 2) });
		expect(moveListItem(state, () => {}, 'up')).toBe(false);
	});

	it('carries nested children along with the item', () => {
		// - a
		// - b
		//   - b1
		// - c   → move "b" up
		const doc = schema.node('doc', null, [
			schema.node('bullet_list', null, [
				schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('a')])]),
				schema.node('list_item', null, [
					schema.node('paragraph', null, [schema.text('b')]),
					schema.node('bullet_list', null, [
						schema.node('list_item', null, [
							schema.node('paragraph', null, [schema.text('b1')]),
						]),
					]),
				]),
				schema.node('list_item', null, [schema.node('paragraph', null, [schema.text('c')])]),
			]),
		]);
		const state = stateAtItem(doc, 1);

		let tr: Transaction | null = null;
		expect(moveListItem(state, (t) => (tr = t), 'up')).toBe(true);

		const list = (tr as unknown as Transaction).doc.child(0);
		expect(list.child(0).textContent).toBe('bb1');
		expect(list.child(0).childCount).toBe(2); // paragraph + nested list survived
		expect(list.child(1).textContent).toBe('a');
		expect(list.child(2).textContent).toBe('c');
	});

	it('keeps the cursor inside the moved item', () => {
		const doc = listDoc(['alpha', 'bravo', 'charlie']);
		const state = stateAtItem(doc, 2); // cursor at start of "charlie"

		let tr: Transaction | null = null;
		expect(moveListItem(state, (t) => (tr = t), 'top')).toBe(true);

		const applied = state.apply(tr as unknown as Transaction);
		const found = findListItem(applied.selection.$from);
		expect(found!.node.textContent).toBe('charlie');
		expect(found!.index).toBe(0);
	});

	it('reports handled without dispatching when no dispatch is supplied', () => {
		const state = stateAtItem(listDoc(['a', 'b']), 1);
		expect(moveListItem(state, undefined, 'up')).toBe(true);
	});
});
