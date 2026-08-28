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
// `cache` maps source URL → embedded URL and is kept by the caller across
// retries, so a save that fails after uploading doesn't upload the same
// images again (orphaning the first batch).
export async function inlineClipImages(
	content: string,
	sources: string[],
	deps: ImageDeps,
	cache: Map<string, string> = new Map(),
): Promise<string> {
	let result = content;
	let searchFrom = 0;
	for (const source of sources) {
		const at = result.indexOf(IMAGE_MASK, searchFrom);
		if (at === -1) break;
		if (!source) {
			// Nothing fetchable (e.g. a lazy-loaded img with src="") —
			// leave the mask and move on.
			searchFrom = at + IMAGE_MASK.length;
			continue;
		}
		let url = cache.get(source);
		if (url === undefined) {
			url = source;
			try {
				url = await deps.upload(await deps.fetchBlob(source));
			} catch {
				// keep the original URL
			}
			cache.set(source, url);
		}
		const markdown = `![](${url})`;
		result = result.slice(0, at) + markdown + result.slice(at + IMAGE_MASK.length);
		searchFrom = at + markdown.length;
	}
	return result;
}
