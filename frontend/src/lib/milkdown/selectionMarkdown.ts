import {
	Fragment,
	type Node as ProseMirrorNode,
	type NodeType,
	type Slice,
} from '@milkdown/kit/prose/model';
import type { Selection } from '@milkdown/kit/prose/state';

export type MarkdownSerializer = (doc: ProseMirrorNode) => string;

const markdownMarks = new Set(['strong', 'emphasis', 'strike_through', 'link', 'inlineCode']);

function isUnderlineTag(node: ProseMirrorNode): boolean {
	return node.type.name === 'html'
		&& typeof node.attrs.value === 'string'
		&& /^<\/?u(?:\s[^>]*)?>$/i.test(node.attrs.value.trim());
}

function selectedOrderedListStarts(selection?: Selection): number[] {
	if (!selection) return [];

	const starts: number[] = [];
	for (let depth = 0; depth <= selection.$from.depth; depth++) {
		const node = selection.$from.node(depth);
		if (node.type.name !== 'ordered_list') continue;
		const order = typeof node.attrs.order === 'number' ? node.attrs.order : 1;
		starts.push(order + selection.$from.index(depth));
	}
	return starts;
}

function flattenUnsupportedMarks(
	content: Fragment,
	orderedListStarts: readonly number[],
	nextOrderedList: { value: number },
): Fragment {
	const children: ProseMirrorNode[] = [];
	content.forEach((node) => {
		if (isUnderlineTag(node)) return;
		const marks = node.marks.filter((mark) => markdownMarks.has(mark.type.name));
		const order = node.type.name === 'ordered_list'
			&& nextOrderedList.value < orderedListStarts.length
			? orderedListStarts[nextOrderedList.value++]
			: undefined;
		const childContent = node.isLeaf
			? node.content
			: flattenUnsupportedMarks(node.content, orderedListStarts, nextOrderedList);
		const attrs = order == null ? node.attrs : { ...node.attrs, order };
		children.push(node.isText ? node.mark(marks) : node.type.create(attrs, childContent, marks));
	});
	return Fragment.fromArray(children);
}

export function sliceToMarkdown(
	slice: Slice,
	documentType: NodeType,
	serialize: MarkdownSerializer,
	selection?: Selection,
): string {
	const orderedListStarts = selectedOrderedListStarts(selection);
	const content = flattenUnsupportedMarks(slice.content, orderedListStarts, { value: 0 });
	return serialize(documentType.create(null, content));
}

/** Serialize only the document content covered by a ProseMirror selection. */
export function selectionToMarkdown(
	selection: Selection,
	serialize: MarkdownSerializer,
): string {
	if (selection.empty) return '';
	return sliceToMarkdown(selection.content(), selection.$from.doc.type, serialize, selection);
}
