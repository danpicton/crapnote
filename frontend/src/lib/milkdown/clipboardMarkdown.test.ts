import { describe, it, expect, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, AllSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { createMarkdownClipboardPlugin } from './clipboardMarkdown';

const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { content: 'inline*', group: 'block' },
		text: { group: 'inline' },
	},
	marks: {},
});

describe('markdown clipboard plugin', () => {
	it.each([true, false])('serializes copied content when editor editable is %s', (editable) => {
		const doc = schema.node('doc', null, [
			schema.node('paragraph', null, [schema.text('selected')]),
		]);
		const state = EditorState.create({ doc, selection: new AllSelection(doc) });
		const serialize = vi.fn(() => 'selected markdown\n');
		const plugin = createMarkdownClipboardPlugin(serialize);
		const clipboardSerializer = plugin.props.clipboardTextSerializer!;
		const view = { state, editable } as unknown as EditorView;

		const text = clipboardSerializer.call(plugin, state.selection.content(), view);

		expect(text).toBe('selected markdown\n');
		expect(serialize).toHaveBeenCalledOnce();
	});
});
