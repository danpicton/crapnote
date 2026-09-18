import { serializerCtx } from '@milkdown/kit/core';
import { Plugin } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { sliceToMarkdown, type MarkdownSerializer } from './selectionMarkdown';

export function createMarkdownClipboardPlugin(serialize: MarkdownSerializer): Plugin {
	return new Plugin({
		props: {
			clipboardTextSerializer: (slice, view) =>
				sliceToMarkdown(slice, view.state.doc.type, serialize),
		},
	});
}

export const markdownClipboardPlugin = $prose((ctx) =>
	createMarkdownClipboardPlugin(ctx.get(serializerCtx)),
);
