import {
	Fragment,
	type Node as ProseMirrorNode,
	type NodeType,
	type Slice,
} from '@milkdown/kit/prose/model';
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

export function sliceToMarkdown(
	slice: Slice,
	documentType: NodeType,
	serialize: MarkdownSerializer,
): string {
	const content = flattenUnsupportedMarks(slice.content);
	return serialize(documentType.create(null, content));
}

/** Serialize only the document content covered by a ProseMirror selection. */
export function selectionToMarkdown(
	selection: Selection,
	serialize: MarkdownSerializer,
): string {
	if (selection.empty) return '';
	return sliceToMarkdown(selection.content(), selection.$from.doc.type, serialize);
}
