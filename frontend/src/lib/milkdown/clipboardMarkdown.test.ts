import { describe, it, expect, vi } from 'vitest';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, AllSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { createMarkdownClipboardPlugin, markdownClipboardPlugin } from './clipboardMarkdown';

const schema = new Schema({
	nodes: {
		doc: { content: 'block+' },
		paragraph: { content: 'inline*', group: 'block' },
		text: { group: 'inline' },
	},
	marks: {},
});

describe('markdown clipboard plugin', () => {
	it('registers its serializer on the Milkdown editor view', async () => {
		const root = document.createElement('div');
		const editor = await Editor.make()
			.config((ctx) => {
				ctx.set(rootCtx, root);
				ctx.set(defaultValueCtx, '- First\n- Second');
			})
			.use(commonmark)
			.use(markdownClipboardPlugin)
			.create();

		try {
			editor.action((ctx) => {
				const view = ctx.get(editorViewCtx);
				view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
				const text = view.someProp('clipboardTextSerializer', (serialize) =>
					serialize(view.state.selection.content(), view),
				);
				expect(text).toBe('* First\n\n* Second\n');
			});
		} finally {
			editor.destroy();
		}
	});

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
