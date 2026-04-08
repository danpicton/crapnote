/**
 * Minimal Milkdown underline mark plugin.
 *
 * Markdown has no underline syntax, so we serialise/parse as `<u>text</u>`
 * (raw HTML), which is valid in CommonMark.
 */
import { $mark, $command } from '@milkdown/kit/utils';
import { toggleMark } from '@milkdown/kit/prose/commands';

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
		match: (node) => node.type === 'html' && typeof node.value === 'string' && (node.value as string).startsWith('<u>'),
		runner: (state, _node, markType) => {
			state.openMark(markType);
			state.closeMark(markType);
		},
	},
	toMarkdown: {
		match: (mark) => mark.type.name === 'underline',
		runner: (state, _mark, node) => {
			state.addNode('html', undefined, `<u>${node.text ?? ''}</u>`);
			return true;
		},
	},
}));

export const toggleUnderlineCommand = $command(
	'ToggleUnderline',
	(ctx) => () => toggleMark(underlineMark.type(ctx))
);

export const underlinePlugin = [underlineMark, toggleUnderlineCommand].flat();
