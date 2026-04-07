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
}));

export const toggleUnderlineCommand = $command(
	'ToggleUnderline',
	(ctx) => () => toggleMark(underlineMark.type(ctx))
);

export const underlinePlugin = [underlineMark, toggleUnderlineCommand].flat();
