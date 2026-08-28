export interface ImageDeps {
	fetchBlob(url: string): Promise<Blob>;
	upload(blob: Blob): Promise<string>;
}

// Matches both the plain single-image mask and the numbered multi-image
// variant (`<image content 2>`, 1-based).
const MASK_RE = /<image content(?: (\d+))?>/g;

// The `<image content>` masks are display-only, for the clip popup. On
// save, each mask is substituted with the real image: downloaded and
// re-uploaded to CrapNote so the note is self-contained, falling back to
// hot-linking the original URL if that fails. A numbered mask maps to its
// source by index (so user edits can't mispair them); plain masks map
// positionally. `cache` maps source URL → embedded URL and is kept by the
// caller across retries, so a save that fails after uploading doesn't
// upload the same images again (orphaning the first batch).
export async function inlineClipImages(
	content: string,
	sources: string[],
	deps: ImageDeps,
	cache: Map<string, string> = new Map(),
): Promise<string> {
	const sourceAt = (numbered: string | undefined, positional: number): string | undefined => {
		const index = numbered !== undefined ? Number(numbered) - 1 : positional;
		return sources[index];
	};

	// Resolve every referenced source concurrently before substituting;
	// only the substitution needs mask order.
	let positional = 0;
	const needed = new Set<string>();
	for (const match of content.matchAll(MASK_RE)) {
		const source = sourceAt(match[1], match[1] === undefined ? positional++ : 0);
		if (source && !cache.has(source)) needed.add(source);
	}
	await Promise.all(
		Array.from(needed, async (source) => {
			let url = source;
			try {
				url = await deps.upload(await deps.fetchBlob(source));
			} catch {
				// keep the original URL
			}
			cache.set(source, url);
		}),
	);

	positional = 0;
	return content.replace(MASK_RE, (mask, numbered: string | undefined) => {
		const source = sourceAt(numbered, numbered === undefined ? positional++ : 0);
		// No fetchable source (empty src, or the mask has no matching
		// image) — leave the mask as-is.
		if (!source) return mask;
		return `![](${cache.get(source) ?? source})`;
	});
}
