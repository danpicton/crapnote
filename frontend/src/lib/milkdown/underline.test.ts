import { describe, expect, it } from 'vitest';
import { Editor, defaultValueCtx, editorViewCtx, rootCtx, serializerCtx } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { linkPlugin } from './link';
import { underlinePlugin } from './underline';

async function withMarkdown(
	markdown: string,
	run: (
		doc: ProseMirrorNode,
		serialize: (doc: ProseMirrorNode) => string,
		root: HTMLElement,
	) => void,
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
		.use(linkPlugin)
		.create();

	try {
		editor.action((ctx) => run(ctx.get(editorViewCtx).state.doc, ctx.get(serializerCtx), root));
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

	it('retains adjacent spans, Unicode, and special characters', async () => {
		const source = '<u>café &amp; tea \\* \\[brackets]</u> plain <u>雪 &lt; 3</u><u>!</u>';
		let saved = '';

		await withMarkdown(source, (doc, serialize) => {
			expect(doc.textContent).toBe('café & tea * [brackets] plain 雪 < 3!');
			saved = serialize(doc);
		});
		await withMarkdown(saved, (doc) => {
			expect(doc.textContent).toBe('café & tea * [brackets] plain 雪 < 3!');
			const underlined = textNodes(doc)
				.filter((node) => node.marks.some((mark) => mark.type.name === 'underline'))
				.map((node) => node.text)
				.join('');
			expect(underlined).toBe('café & tea * [brackets]雪 < 3!');
		});
	});

	it('round trips underline combined with bold, italic, and links', async () => {
		const source = '<u>**bold** and *italic* and [link](https://example.com/path?q=1)</u>';
		let saved = '';

		await withMarkdown(source, (doc, serialize) => {
			saved = serialize(doc);
		});
		await withMarkdown(saved, (doc) => {
			const byText = Object.fromEntries(textNodes(doc).map((node) => [
				node.text,
				node.marks.map((mark) => mark.type.name),
			]));
			expect(byText.bold).toEqual(expect.arrayContaining(['underline', 'strong']));
			expect(byText.italic).toEqual(expect.arrayContaining(['underline', 'emphasis']));
			expect(byText.link).toEqual(expect.arrayContaining(['underline', 'link']));
		});
	});

	it('persists removing underline without formatting surrounding text', async () => {
		let saved = '';
		await withMarkdown('before <u>under</u> after', (doc, serialize) => {
			const paragraph = doc.firstChild!;
			const children: ProseMirrorNode[] = [];
			paragraph.forEach((child) => {
				children.push(child.mark(child.marks.filter((mark) => mark.type.name !== 'underline')));
			});
			const withoutUnderline = doc.type.create(
				doc.attrs,
				paragraph.type.create(paragraph.attrs, children),
			);
			saved = serialize(withoutUnderline);
		});

		await withMarkdown(saved, (doc) => {
			expect(doc.textContent).toBe('before under after');
			expect(textNodes(doc).flatMap((node) => node.marks)).toHaveLength(0);
		});
	});

	it('does not render arbitrary HTML or unsafe link schemes', async () => {
		const source = '<script>alert(1)</script>\n\n<u>[bad](javascript:alert(1))</u>';
		await withMarkdown(source, (_doc, _serialize, root) => {
			expect(root.querySelector('script')).toBeNull();
			expect(root.querySelector('a')).not.toHaveAttribute('href');
			expect(root.querySelector('u')).toHaveTextContent('bad');
			expect(root).toHaveTextContent('<script>alert(1)</script>');
		});
	});
});
