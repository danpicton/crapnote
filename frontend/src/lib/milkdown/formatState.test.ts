import { describe, it, expect } from 'vitest';
import { Schema, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import { computeActiveFormats } from './formatState';

// Minimal schema mirroring the names Milkdown commonmark/gfm + our underline
// plugin register, so the pure function is exercised against realistic docs.
const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { content: 'inline*', group: 'block' },
		heading: { attrs: { level: { default: 1 } }, content: 'inline*', group: 'block' },
		blockquote: { content: 'block+', group: 'block' },
		bullet_list: { content: 'list_item+', group: 'block' },
		ordered_list: { content: 'list_item+', group: 'block' },
		list_item: { attrs: { checked: { default: null } }, content: 'paragraph block*' },
		text: { group: 'inline' },
	},
	marks: {
		strong: {},
		emphasis: {},
		underline: {},
		inlineCode: {},
	},
});

/** Build an EditorState with a text cursor at `cursor`. */
function stateAt(doc: ProseMirrorNode, cursor: number): EditorState {
	return EditorState.create({ schema, doc, selection: TextSelection.create(doc, cursor) });
}

describe('computeActiveFormats', () => {
	it('reports strong active when the cursor sits inside bold text', () => {
		// <p>hello <strong>bold</strong> world</p> — cursor inside "bold"
		const doc = schema.node('doc', null, [
			schema.node('paragraph', null, [
				schema.text('hello '),
				schema.text('bold', [schema.marks.strong.create()]),
				schema.text(' world'),
			]),
		]);

		const formats = computeActiveFormats(stateAt(doc, 9));

		expect(formats.strong).toBe(true);
		expect(formats.emphasis).toBe(false);
		expect(formats.underline).toBe(false);
		expect(formats.inlineCode).toBe(false);
	});

	it('honours stored marks when bold is toggled at a collapsed cursor', () => {
		// Cursor in plain text, user just tapped Bold: storedMarks carries strong
		const doc = schema.node('doc', null, [
			schema.node('paragraph', null, [schema.text('plain text')]),
		]);
		const base = stateAt(doc, 4);
		const state = base.apply(base.tr.setStoredMarks([schema.marks.strong.create()]));

		expect(computeActiveFormats(state).strong).toBe(true);
	});

	it('reports a mark active when the whole selected range carries it', () => {
		// <p>hello <strong>bold</strong> world</p> — select exactly "bold"
		const doc = schema.node('doc', null, [
			schema.node('paragraph', null, [
				schema.text('hello '),
				schema.text('bold', [schema.marks.strong.create()]),
				schema.text(' world'),
			]),
		]);
		const state = EditorState.create({
			schema,
			doc,
			selection: TextSelection.create(doc, 7, 11),
		});

		expect(computeActiveFormats(state).strong).toBe(true);
	});

	it('reports a mark inactive when only part of the selection carries it', () => {
		const doc = schema.node('doc', null, [
			schema.node('paragraph', null, [
				schema.text('hello '),
				schema.text('bold', [schema.marks.strong.create()]),
				schema.text(' world'),
			]),
		]);
		// Selection spans "hello bold" — mixed formatting
		const state = EditorState.create({
			schema,
			doc,
			selection: TextSelection.create(doc, 1, 11),
		});

		expect(computeActiveFormats(state).strong).toBe(false);
	});

	it('reports the heading level when the cursor is in a heading', () => {
		const doc = schema.node('doc', null, [
			schema.node('heading', { level: 2 }, [schema.text('Title')]),
		]);

		const formats = computeActiveFormats(stateAt(doc, 3));

		expect(formats.heading).toBe(2);
		expect(formats.blockquote).toBe(false);
	});

	it('reports blockquote when the cursor is inside one', () => {
		const doc = schema.node('doc', null, [
			schema.node('blockquote', null, [
				schema.node('paragraph', null, [schema.text('quoted')]),
			]),
		]);

		expect(computeActiveFormats(stateAt(doc, 4)).blockquote).toBe(true);
	});

	it('reports bullet list when the cursor is in a plain bullet item', () => {
		const doc = schema.node('doc', null, [
			schema.node('bullet_list', null, [
				schema.node('list_item', null, [
					schema.node('paragraph', null, [schema.text('item')]),
				]),
			]),
		]);

		const formats = computeActiveFormats(stateAt(doc, 4));

		expect(formats.bulletList).toBe(true);
		expect(formats.orderedList).toBe(false);
		expect(formats.taskList).toBe(false);
	});

	it('reports ordered list when the cursor is in a numbered item', () => {
		const doc = schema.node('doc', null, [
			schema.node('ordered_list', null, [
				schema.node('list_item', null, [
					schema.node('paragraph', null, [schema.text('item')]),
				]),
			]),
		]);

		const formats = computeActiveFormats(stateAt(doc, 4));

		expect(formats.orderedList).toBe(true);
		expect(formats.bulletList).toBe(false);
	});

	it('reports task list (not bullet list) for checked-attr list items', () => {
		// Task items are bullet_list items whose checked attr is non-null
		const doc = schema.node('doc', null, [
			schema.node('bullet_list', null, [
				schema.node('list_item', { checked: false }, [
					schema.node('paragraph', null, [schema.text('todo')]),
				]),
			]),
		]);

		const formats = computeActiveFormats(stateAt(doc, 4));

		expect(formats.taskList).toBe(true);
		expect(formats.bulletList).toBe(false);
	});
});
