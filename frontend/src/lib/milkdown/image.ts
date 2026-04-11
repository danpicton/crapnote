/**
 * Image plugin for crapnote.
 *
 * Rather than a custom ProseMirror node, we piggyback on the existing
 * commonmark `image` node (which already parses/serialises `![alt](url)`
 * correctly) and attach a custom NodeView that:
 *
 *   • Renders images from /api/images/… with a drag-to-resize handle.
 *   • Encodes the chosen width in the URL as a ?w=NNN query parameter,
 *     so it survives round-trips through the markdown: ![alt](/api/images/UUID?w=333)
 *   • Falls back to plain <img> rendering for all other image URLs.
 *
 * Paste from clipboard and the Insert Image toolbar button both upload the
 * blob to /api/images, receive back the URL, and insert a standard image node.
 */

import { $view, $prose, $command } from '@milkdown/kit/utils';
import { imageSchema } from '@milkdown/preset-commonmark';
import { Plugin, PluginKey } from '@milkdown/kit/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { EditorView } from '@milkdown/kit/prose/view';

// ─── URL helpers ──────────────────────────────────────────────────────────────

function isApiImage(src: string): boolean {
	return typeof src === 'string' && src.startsWith('/api/images/');
}

function extractWidth(src: string): number | null {
	const m = src.match(/[?&]w=(\d+)/);
	return m ? parseInt(m[1], 10) : null;
}

function baseSrc(src: string): string {
	// Strip any existing ?w= param, leaving other query params intact.
	return src.replace(/([?&])w=\d+(&?)/, (_, p, trail) => (trail ? p : '')).replace(/[?&]$/, '');
}

function withWidth(src: string, width: number): string {
	const base = baseSrc(src);
	const sep = base.includes('?') ? '&' : '?';
	return `${base}${sep}w=${width}`;
}

// ─── Upload helper ────────────────────────────────────────────────────────────

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
	const imageType = state.schema.nodes['image'];
	if (!imageType) return;
	const node = imageType.create({ src, alt: '', title: '' });
	view.dispatch(state.tr.replaceSelectionWith(node));
}

// ─── NodeView ─────────────────────────────────────────────────────────────────

export const imageView = $view(
	imageSchema.node,
	() =>
		(initialNode: ProseMirrorNode, view: EditorView, getPos: (() => number | undefined) | boolean) => {
			let currentNode = initialNode;

			const wrapper = document.createElement('span');
			wrapper.className = 'crapnote-img-view';
			wrapper.contentEditable = 'false';

			const img = document.createElement('img');
			img.draggable = false;

			function syncImg(node: ProseMirrorNode) {
				const src = node.attrs.src as string;
				img.src = baseSrc(src);
				img.alt = (node.attrs.alt as string) ?? '';
				const w = extractWidth(src);
				img.style.width = w ? `${w}px` : '';
			}

			syncImg(initialNode);
			wrapper.appendChild(img);

			// Only add the resize handle for images we serve.
			if (isApiImage(initialNode.attrs.src as string)) {
				const handle = document.createElement('div');
				handle.className = 'crapnote-img-handle';
				handle.setAttribute('aria-label', 'Drag to resize');
				wrapper.appendChild(handle);

				handle.addEventListener('mousedown', (e: MouseEvent) => {
					e.preventDefault();
					e.stopPropagation();
					const startX = e.clientX;
					const startWidth = img.offsetWidth;

					const onMove = (ev: MouseEvent) => {
						img.style.width = `${Math.max(48, startWidth + ev.clientX - startX)}px`;
					};
					const onUp = (ev: MouseEvent) => {
						document.removeEventListener('mousemove', onMove);
						document.removeEventListener('mouseup', onUp);
						const newWidth = Math.max(48, Math.round(startWidth + ev.clientX - startX));
						const pos = typeof getPos === 'function' ? getPos() : undefined;
						if (pos !== undefined) {
							const newSrc = withWidth(baseSrc(currentNode.attrs.src as string), newWidth);
							view.dispatch(
								view.state.tr.setNodeMarkup(pos, undefined, {
									...currentNode.attrs,
									src: newSrc,
								})
							);
						}
					};
					document.addEventListener('mousemove', onMove);
					document.addEventListener('mouseup', onUp);
				});
			}

			return {
				dom: wrapper as unknown as HTMLElement,
				update(updatedNode: ProseMirrorNode) {
					if (updatedNode.type !== currentNode.type) return false;
					currentNode = updatedNode;
					syncImg(updatedNode);
					return true;
				},
				destroy() {},
			};
		}
);

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

// ─── Insert-image command (file picker) ───────────────────────────────────────

export const insertImageCommand = $command(
	'CrapnoteInsertImage',
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

export const imagePlugin = [imageView, imagePastePlugin, insertImageCommand].flat();
