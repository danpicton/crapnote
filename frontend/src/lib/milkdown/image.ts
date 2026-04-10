/**
 * Milkdown plugin for resizable images.
 *
 * Images are stored in markdown as a <figure> HTML block (CommonMark type-6,
 * so definitely parsed as a block-level HTML node by remark):
 *
 *   <figure><img src="URL" alt="ALT" width="400"></figure>
 *
 * Images without an explicit width omit the width attribute.
 * A drag handle on the right edge of each image lets the user resize it
 * by clicking and dragging; the new width is written back to the document.
 */

import { $node, $view, $prose, $command } from '@milkdown/kit/utils';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';
import type { MarkdownNode, ParserState } from '@milkdown/transformer';

// ─── Markdown helpers ─────────────────────────────────────────────────────────

function parseImgAttrs(html: string): { src: string; alt: string; width: number | null } | null {
	const srcMatch = html.match(/src="([^"]*)"/);
	if (!srcMatch) return null;
	const altMatch = html.match(/alt="([^"]*)"/);
	const widthMatch = html.match(/width="(\d+)"/);
	return {
		src: srcMatch[1],
		alt: altMatch?.[1] ?? '',
		width: widthMatch ? parseInt(widthMatch[1], 10) : null,
	};
}

function buildFigureHtml(src: string, alt: string, width: number | null): string {
	const esc = (s: string) => s.replace(/"/g, '&quot;');
	const widthAttr = width ? ` width="${width}"` : '';
	return `<figure><img src="${esc(src)}" alt="${esc(alt)}"${widthAttr}></figure>`;
}

// ─── Shared upload helper ─────────────────────────────────────────────────────

async function uploadImage(blob: Blob): Promise<string> {
	const form = new FormData();
	form.append('image', blob);
	const res = await fetch('/api/images', { method: 'POST', body: form, credentials: 'include' });
	if (!res.ok) throw new Error(`Image upload failed: ${res.status}`);
	const data = (await res.json()) as { url: string };
	return data.url;
}

function insertImageAt(view: EditorView, src: string): void {
	const { state } = view;
	const nodeType = state.schema.nodes['crapnote_image'];
	if (!nodeType) return;
	const node = nodeType.create({ src, alt: '', width: null });
	view.dispatch(state.tr.replaceSelectionWith(node));
}

// ─── ProseMirror node ─────────────────────────────────────────────────────────

export const imageNode = $node('crapnote_image', () => ({
	group: 'block',
	atom: true,
	attrs: {
		src: { default: '' },
		alt: { default: '' },
		width: { default: null },
	},
	// toDOM is used as a fallback (the NodeView below takes over in the editor).
	toDOM(node: ProseMirrorNode) {
		const { src, alt, width } = node.attrs as { src: string; alt: string; width: number | null };
		return [
			'figure',
			{ class: 'crapnote-img-block' },
			['img', { src, alt, ...(width ? { width: String(width) } : {}) }],
		] as unknown as ReturnType<NonNullable<import('@milkdown/kit/prose/model').NodeSpec['toDOM']>>;
	},
	parseDOM: [
		{
			tag: 'figure.crapnote-img-block',
			getAttrs(dom) {
				const el = dom as HTMLElement;
				const img = el.querySelector('img');
				return {
					src: img?.getAttribute('src') ?? '',
					alt: img?.getAttribute('alt') ?? '',
					width: img?.getAttribute('width') ? parseInt(img.getAttribute('width')!, 10) : null,
				};
			},
		},
	],
	parseMarkdown: {
		match: (node) =>
			node.type === 'html' &&
			typeof node.value === 'string' &&
			(node.value as string).includes('<figure>') &&
			(node.value as string).includes('<img'),
		runner: (state: ParserState, node: MarkdownNode, nodeType) => {
			const attrs = parseImgAttrs(node.value as string);
			if (attrs) {
				(state as unknown as { addNode: (t: unknown, a: unknown) => void }).addNode(nodeType, attrs);
			}
		},
	},
	toMarkdown: {
		match: (node: ProseMirrorNode) => node.type.name === 'crapnote_image',
		runner: (state: { addNode: (type: string, children: undefined, value: string) => void }, node: ProseMirrorNode) => {
			const { src, alt, width } = node.attrs as { src: string; alt: string; width: number | null };
			state.addNode('html', undefined, buildFigureHtml(src, alt, width));
		},
	},
}));

// ─── NodeView — interactive resize handle ─────────────────────────────────────

export const imageView = $view(imageNode, () => (initialNode, view, getPos) => {
	let currentNode = initialNode;

	const wrapper = document.createElement('figure');
	wrapper.className = 'crapnote-img-view';
	wrapper.contentEditable = 'false';

	const img = document.createElement('img');
	img.src = currentNode.attrs.src as string;
	img.alt = currentNode.attrs.alt as string;
	img.draggable = false;
	if (currentNode.attrs.width) img.style.width = `${currentNode.attrs.width}px`;

	const handle = document.createElement('div');
	handle.className = 'crapnote-img-handle';
	handle.setAttribute('aria-label', 'Drag to resize image');

	wrapper.appendChild(img);
	wrapper.appendChild(handle);

	// Drag-to-resize
	handle.addEventListener('mousedown', (e: MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const startX = e.clientX;
		const startWidth = img.offsetWidth;

		const onMove = (e: MouseEvent) => {
			const w = Math.max(48, startWidth + e.clientX - startX);
			img.style.width = `${w}px`;
		};

		const onUp = (e: MouseEvent) => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);

			const newWidth = Math.max(48, Math.round(startWidth + e.clientX - startX));
			const pos = typeof getPos === 'function' ? getPos() : undefined;
			if (pos !== undefined) {
				view.dispatch(
					view.state.tr.setNodeMarkup(pos, undefined, { ...currentNode.attrs, width: newWidth })
				);
			}
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});

	return {
		dom: wrapper as unknown as HTMLElement,
		update(updatedNode: ProseMirrorNode) {
			if (updatedNode.type.name !== 'crapnote_image') return false;
			currentNode = updatedNode;
			img.src = updatedNode.attrs.src as string;
			img.alt = updatedNode.attrs.alt as string;
			img.style.width = updatedNode.attrs.width ? `${updatedNode.attrs.width}px` : '';
			return true;
		},
		destroy() {},
	};
});

// ─── Paste plugin ─────────────────────────────────────────────────────────────

export const imagePastePlugin = $prose(() =>
	new Plugin({
		key: new PluginKey('crapnote-image-paste'),
		props: {
			handlePaste(view: EditorView, event: ClipboardEvent) {
				const items = Array.from(event.clipboardData?.items ?? []);
				const imageItem = items.find((item) => item.type.startsWith('image/'));
				if (!imageItem) return false;

				event.preventDefault();
				const blob = imageItem.getAsFile();
				if (!blob) return false;

				uploadImage(blob)
					.then((url) => insertImageAt(view, url))
					.catch((err) => console.error('[crapnote] image paste failed:', err));

				return true;
			},
		},
	})
);

// ─── Insert-image command (opens file picker) ─────────────────────────────────

export const insertImageCommand = $command(
	'InsertImage',
	() => () => (_state, _dispatch, view) => {
		if (!view) return false;

		const input = document.createElement('input');
		input.type = 'file';
		input.accept = 'image/*';
		input.onchange = async () => {
			const file = input.files?.[0];
			if (!file) return;
			try {
				const url = await uploadImage(file);
				insertImageAt(view, url);
			} catch (err) {
				console.error('[crapnote] image insert failed:', err);
			}
		};
		input.click();
		return true;
	}
);

// ─── Composed export ──────────────────────────────────────────────────────────

export const imagePlugin = [imageNode, imageView, imagePastePlugin, insertImageCommand].flat();
