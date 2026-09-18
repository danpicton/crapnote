import { describe, it, expect } from 'vitest';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { AllSelection, TextSelection } from '@milkdown/kit/prose/state';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { underlinePlugin } from './underline';
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
		.use(underlinePlugin)
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

	it('retains the starting number of an ordered list', async () => {
		await withDocument('3. Third\n4. Fourth', (doc, serialize) => {
			const markdown = selectionToMarkdown(new AllSelection(doc), serialize);

			expect(markdown).toBe('3. Third\n4. Fourth\n');
		});
	});

	it('retains nesting and task states', async () => {
		await withDocument('- Parent\n  - [ ] Child\n  - [x] Done', (doc, serialize) => {
			const markdown = selectionToMarkdown(new AllSelection(doc), serialize);

			expect(markdown).toBe('* Parent\n\n  * [ ] Child\n\n  * [x] Done\n');
		});
	});

	it('closes formatting delimiters around a partial text selection', async () => {
		await withDocument('Before **bold** after', (doc, serialize) => {
			const markdown = selectionToMarkdown(TextSelection.create(doc, 9, 12), serialize);

			expect(markdown).toBe('**old**\n');
		});
	});

	it('keeps list structure while omitting text outside a partial selection', async () => {
		await withDocument('- First item\n- Second item', (doc, serialize) => {
			const textPositions: number[] = [];
			doc.descendants((node, pos) => {
				if (node.isText) textPositions.push(pos);
			});
			const markdown = selectionToMarkdown(
				TextSelection.create(doc, textPositions[0] + 1, textPositions[1] + 6),
				serialize,
			);

			expect(markdown).toBe('* irst item\n\n* Second\n');
		});
	});

	it('flattens stored underline HTML while retaining nested Markdown marks', async () => {
		await withDocument('<u>**hello**</u>', (doc, serialize) => {
			const markdown = selectionToMarkdown(new AllSelection(doc), serialize);

			expect(markdown).toBe('**hello**\n');
		});
	});

	it('flattens underline while retaining supported marks on the same text', async () => {
		await withDocument('hello', (doc, serialize) => {
			const text = doc.type.schema.text('hello', [
				doc.type.schema.marks.strong.create(),
				doc.type.schema.marks.underline.create(),
			]);
			const markedDoc = doc.type.create(null, doc.type.schema.nodes.paragraph.create(null, text));

			const markdown = selectionToMarkdown(new AllSelection(markedDoc), serialize);

			expect(markdown).toBe('**hello**\n');
		});
	});

	it('retains supported block and inline formatting', async () => {
		const source = [
			'## **Bold and _italic_** ~~gone~~ [site](https://example.com)',
			'',
			'> `inline`',
			'',
			'```ts',
			'const value = 1;',
			'```',
		].join('\n');

		await withDocument(source, (doc, serialize) => {
			const markdown = selectionToMarkdown(new AllSelection(doc), serialize);

			expect(markdown).toBe([
				'## **Bold and** _**italic**_ ~~gone~~ [site](https://example.com)',
				'',
				'> `inline`',
				'',
				'```ts',
				'const value = 1;',
				'```',
				'',
			].join('\n'));
		});
	});
});
