import { IMAGE_MASK } from './clip';

export interface ImageDeps {
	fetchBlob(url: string): Promise<Blob>;
	upload(blob: Blob): Promise<string>;
}

// The `<image content>` mask is display-only, for the clip popup. On save,
// each mask is substituted with the real image: downloaded and re-uploaded
// to CrapNote so the note is self-contained, falling back to hot-linking
// the original URL if that fails. Mask N maps to source N (both are in
// document order).
export async function inlineClipImages(
	content: string,
	sources: string[],
	deps: ImageDeps,
): Promise<string> {
	let result = content;
	let searchFrom = 0;
	for (const source of sources) {
		const at = result.indexOf(IMAGE_MASK, searchFrom);
		if (at === -1) break;
		let url = source;
		try {
			url = await deps.upload(await deps.fetchBlob(source));
		} catch {
			// keep the original URL
		}
		const markdown = `![](${url})`;
		result = result.slice(0, at) + markdown + result.slice(at + IMAGE_MASK.length);
		searchFrom = at + markdown.length;
	}
	return result;
}
