/**
 * Minimal Milkdown underline mark plugin.
 *
 * Markdown has no underline syntax, so we serialise/parse as `<u>text</u>`
 * (raw HTML), which is valid in CommonMark.
 */
import { $mark, $command, $remark } from '@milkdown/kit/utils';
import { toggleMark } from '@milkdown/kit/prose/commands';
import type { MarkdownNode } from '@milkdown/kit/transformer';

const isOpenUnderline = (node: MarkdownNode) => node.type === 'html' && node.value === '<u>';
const isCloseUnderline = (node: MarkdownNode) => node.type === 'html' && node.value === '</u>';

/** Convert only exact <u> pairs into a Markdown AST node the mark parser owns. */
function parseUnderlineHtml(node: MarkdownNode): void {
	if (!node.children) return;

	const output: MarkdownNode[] = [];
	const stack: Array<{ opening: MarkdownNode; children: MarkdownNode[] }> = [];
	const append = (child: MarkdownNode) => {
		const frame = stack.at(-1);
		(frame ? frame.children : output).push(child);
	};

	for (const child of node.children) {
		parseUnderlineHtml(child);
		if (isOpenUnderline(child)) {
			stack.push({ opening: child, children: [] });
		} else if (isCloseUnderline(child) && stack.length > 0) {
			const frame = stack.pop()!;
			append({ type: 'underline', children: frame.children });
		} else {
			append(child);
		}
	}

	// Preserve malformed/unmatched HTML literally instead of broadening what
	// the editor interprets as formatting.
	while (stack.length > 0) {
		const frame = stack.pop()!;
		const unclosed = [frame.opening, ...frame.children];
		const parent = stack.at(-1);
		(parent ? parent.children : output).push(...unclosed);
	}
	node.children = output;
}

type UnderlineSerializerState = {
	containerPhrasing: (node: MarkdownNode, info: UnderlineSerializerInfo) => string;
};
type UnderlineSerializerInfo = { before: string; after: string; [key: string]: unknown };

const remarkUnderline = $remark('remarkUnderline', () => function () {
	const data = this.data();
	const extensions = data.toMarkdownExtensions ?? (data.toMarkdownExtensions = []);
	const extension = {
		handlers: {
			underline: (
				node: MarkdownNode,
				_parent: unknown,
				state: UnderlineSerializerState,
				info: UnderlineSerializerInfo,
			) => `<u>${state.containerPhrasing(node, { ...info, before: '>', after: '<' })}</u>`,
		},
	};
	// Milkdown's MarkdownNode is intentionally open-ended, while mdast's
	// serializer handler keys are a closed union of standard Markdown nodes.
	extensions.push(extension as unknown as (typeof extensions)[number]);

	return (tree) => parseUnderlineHtml(tree as MarkdownNode);
});

export const underlineMark = $mark('underline', () => ({
	attrs: {},
	parseDOM: [
		{ tag: 'u' },
		{
			style: 'text-decoration',
			getAttrs: (v: string) => (v.includes('underline') ? {} : false),
		},
	],
	toDOM: () => ['u', { style: 'text-decoration: underline' }, 0] as const,
	parseMarkdown: {
		match: (node) => node.type === 'underline',
		runner: (state, node, markType) => {
			state.openMark(markType);
			state.next(node.children);
			state.closeMark(markType);
		},
	},
	toMarkdown: {
		match: (mark) => mark.type.name === 'underline',
		runner: (state, mark) => {
			state.withMark(mark, 'underline');
		},
	},
}));

export const toggleUnderlineCommand = $command(
	'ToggleUnderline',
	(ctx) => () => toggleMark(underlineMark.type(ctx))
);

export const underlinePlugin = [remarkUnderline, underlineMark, toggleUnderlineCommand].flat();
