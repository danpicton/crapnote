import { describe, expect, it } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { underlinePlugin } from './underline';

async function withMarkdown(
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
		.use(underlinePlugin)
		.create();

	try {
		editor.action((ctx) => run(ctx.get(editorViewCtx).state.doc, ctx.get(serializerCtx)));
	} finally {
		editor.destroy();
	}
}

function textNodes(doc: ProseMirrorNode): ProseMirrorNode[] {
	const nodes: ProseMirrorNode[] = [];
	doc.descendants((node) => {
		if (node.isText) nodes.push(node);
	});
	return nodes;
}

describe('underline Markdown round trip', () => {
	it('loads existing stored underline HTML as an underline mark', async () => {
		await withMarkdown('<u>blah</u>', (doc, serialize) => {
			const [text] = textNodes(doc);
			expect(text.text).toBe('blah');
			expect(text.marks.map((mark) => mark.type.name)).toContain('underline');
			expect(serialize(doc)).toBe('<u>blah</u>\n');
		});
	});
});
