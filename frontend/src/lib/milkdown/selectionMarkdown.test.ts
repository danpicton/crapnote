import { describe, it, expect } from 'vitest';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { AllSelection } from '@milkdown/kit/prose/state';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { selectionToMarkdown } from './selectionMarkdown';

async function withDocument(
	markdown: string,
	run: (doc: ProseMirrorNode, serialize: (doc: ProseMirrorNode) => string) => void,
) {
	const root = document.createElement('div');
	const editor = await Editor.make()
		.config((ctx) => {
			ctx.set(rootCtx, root);
			ctx.set(defaultValueCtx, markdown);
		})
		.use(commonmark)
		.use(gfm)
		.create();

	try {
		editor.action((ctx) => {
			const doc = ctx.get(editorViewCtx).state.doc;
			run(doc, ctx.get(serializerCtx));
		});
	} finally {
		editor.destroy();
	}
}

describe('selectionToMarkdown', () => {
	it('serializes selected bullet items with list markers', async () => {
		await withDocument('- First item\n- Second item', (doc, serialize) => {
			const markdown = selectionToMarkdown(new AllSelection(doc), serialize);

			expect(markdown).toMatch(/^\* First item\n\n\* Second item\n$/);
		});
	});
});
