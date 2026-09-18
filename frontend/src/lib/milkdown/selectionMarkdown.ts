import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { Selection } from '@milkdown/kit/prose/state';

export type MarkdownSerializer = (doc: ProseMirrorNode) => string;

/** Serialize only the document content covered by a ProseMirror selection. */
export function selectionToMarkdown(
	selection: Selection,
	serialize: MarkdownSerializer,
): string {
	if (selection.empty) return '';

	const selectedDoc = selection.$from.doc.type.create(null, selection.content().content);
	return serialize(selectedDoc);
}
