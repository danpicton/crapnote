import { Fragment, type Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import type { Selection } from '@milkdown/kit/prose/state';

export type MarkdownSerializer = (doc: ProseMirrorNode) => string;

const markdownMarks = new Set(['strong', 'emphasis', 'strike_through', 'link', 'inlineCode']);

function flattenUnsupportedMarks(content: Fragment): Fragment {
	const children: ProseMirrorNode[] = [];
	content.forEach((node) => {
		const marks = node.marks.filter((mark) => markdownMarks.has(mark.type.name));
		const flattened = node.isLeaf ? node.mark(marks) : node.copy(flattenUnsupportedMarks(node.content)).mark(marks);
		children.push(flattened);
	});
	return Fragment.fromArray(children);
}

/** Serialize only the document content covered by a ProseMirror selection. */
export function selectionToMarkdown(
	selection: Selection,
	serialize: MarkdownSerializer,
): string {
	if (selection.empty) return '';

	const content = flattenUnsupportedMarks(selection.content().content);
	const selectedDoc = selection.$from.doc.type.create(null, content);
	return serialize(selectedDoc);
}
