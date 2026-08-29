import { ApiError } from './crapnote';

export interface ImageDeps {
	fetchBlob(url: string): Promise<Blob>;
	upload(blob: Blob): Promise<string>;
	// Injected so tests drive the rate-limit waits without real time passing.
	sleep?(ms: number): Promise<void>;
	// Called as each source settles, so a slow clip can show progress.
	onProgress?(done: number, total: number): void;
}

// `transient` failures are worth another attempt (429, 5xx, a dropped
// connection); the rest are the server's settled answer for this image and
// more uploads won't change it — it will never accept an SVG
// (`isAllowedImage` permits only jpeg/png/gif/webp), a full quota stays
// full for as long as the popup is open, and `rejected` covers the other
// 4xx (an oversized image is a 400, a bad token a 401).
export type ImageFailureKind = 'transient' | 'unsupported' | 'quota' | 'rejected';

export interface ImageFailure {
	source: string;
	kind: ImageFailureKind;
	message: string;
}

// A resolved source: the URL to embed, plus the reason it isn't a stored
// copy when the upload failed permanently and hot-linking is all that's left.
export interface ClipImage {
	url: string;
	failure?: ImageFailure;
}

export type ClipImageCache = Map<string, ClipImage>;

export interface InlinedClip {
	content: string;
	// Distinct sources the content referenced, however they resolved.
	total: number;
	// Sources that ended up hot-linking the origin site, this attempt.
	failures: ImageFailure[];
}

// Matches both the plain single-image mask and the numbered multi-image
// variant (`<image content 2>`, 1-based).
const MASK_RE = /<image content(?: (\d+))?>/g;

// Four at a time: enough to hide per-upload latency, comfortably under the
// server's burst of 10 (`UploadsPerMinute: 10` → burst 10, one token per
// 6s) so a large clip doesn't 429 itself on the first pass.
const CONCURRENCY = 4;

// Retries for the 429s a >10-image clip still earns once the burst is
// spent. The server asks for 60s in Retry-After; we honour it up to a cap,
// because a token frees every 6s and the popup has to stay open throughout.
const MAX_ATTEMPTS = 5;
const DEFAULT_RETRY_MS = 6_000;
// A proxy in front of the server can answer 0 (or a date already past); a
// floor keeps that from burning the whole budget in a millisecond.
const MIN_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function classify(err: unknown): ImageFailureKind {
	// No status at all: a transport failure, worth retrying.
	if (!(err instanceof ApiError)) return 'transient';
	if (err.status === 415) return 'unsupported';
	if (err.status === 507) return 'quota';
	if (err.status === 429 || err.status >= 500) return 'transient';
	return 'rejected';
}

function retryDelay(err: unknown): number {
	const asked = err instanceof ApiError ? err.retryAfterMs : undefined;
	return Math.min(Math.max(asked ?? DEFAULT_RETRY_MS, MIN_RETRY_MS), MAX_RETRY_MS);
}

function describe(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

// Downloads and re-uploads one source, retrying only failures that another
// attempt could plausibly fix: the retries exist to ride out the server's
// upload rate limit, so a failure to download the original isn't one of
// them — it is reported instead, and the user's next save tries again.
async function resolveSource(source: string, deps: ImageDeps): Promise<ClipImage> {
	const sleep = deps.sleep ?? wait;
	let blob: Blob;
	try {
		blob = await deps.fetchBlob(source);
	} catch (err) {
		return { url: source, failure: { source, kind: 'transient', message: describe(err) } };
	}
	let last: unknown;
	for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
		try {
			return { url: await deps.upload(blob) };
		} catch (err) {
			last = err;
			const kind = classify(err);
			if (kind !== 'transient') {
				return { url: source, failure: { source, kind, message: describe(err) } };
			}
			if (attempt < MAX_ATTEMPTS) await sleep(retryDelay(err));
		}
	}
	return { url: source, failure: { source, kind: 'transient', message: describe(last) } };
}

async function forEachWithLimit<T>(
	items: T[],
	limit: number,
	fn: (item: T) => Promise<void>,
): Promise<void> {
	let next = 0;
	const worker = async (): Promise<void> => {
		for (let i = next++; i < items.length; i = next++) {
			const item = items[i];
			if (item !== undefined) await fn(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

// The `<image content>` masks are display-only, for the clip popup. On
// save, each mask is substituted with the real image: downloaded and
// re-uploaded to CrapNote so the note is self-contained, falling back to
// hot-linking the original URL if that fails. A numbered mask maps to its
// source by index (so user edits can't mispair them); plain masks map
// positionally. `cache` maps source URL → resolved image and is kept by the
// caller across retries, so a save that fails after uploading doesn't
// upload the same images again (orphaning the first batch). Only successes
// and permanent failures are cached: a transient failure is left out so the
// next attempt tries that source again instead of memoising a hot-link.
export async function inlineClipImages(
	content: string,
	sources: string[],
	deps: ImageDeps,
	cache: ClipImageCache = new Map(),
): Promise<InlinedClip> {
	const sourceAt = (numbered: string | undefined, positional: number): string | undefined => {
		const index = numbered !== undefined ? Number(numbered) - 1 : positional;
		return sources[index];
	};

	// Resolve every referenced source concurrently before substituting;
	// only the substitution needs mask order.
	let positional = 0;
	const referenced = new Set<string>();
	for (const match of content.matchAll(MASK_RE)) {
		const source = sourceAt(match[1], match[1] === undefined ? positional++ : 0);
		if (source) referenced.add(source);
	}
	const needed = Array.from(referenced).filter((source) => !cache.has(source));

	const failures: ImageFailure[] = [];
	let done = referenced.size - needed.length;
	deps.onProgress?.(done, referenced.size);
	await forEachWithLimit(needed, CONCURRENCY, async (source) => {
		const image = await resolveSource(source, deps);
		// A transient failure stays out of the cache so the next save
		// attempt retries it; anything settled is remembered.
		if (image.failure?.kind !== 'transient') cache.set(source, image);
		else failures.push(image.failure);
		deps.onProgress?.(++done, referenced.size);
	});
	// Cached permanent failures — this attempt's and any earlier one's —
	// are still hot-links in this note, so keep reporting them.
	for (const source of referenced) {
		const cached = cache.get(source);
		if (cached?.failure) failures.push(cached.failure);
	}

	positional = 0;
	const inlined = content.replace(MASK_RE, (mask, numbered: string | undefined) => {
		const source = sourceAt(numbered, numbered === undefined ? positional++ : 0);
		// No fetchable source (empty src, or the mask has no matching
		// image) — leave the mask as-is.
		if (!source) return mask;
		return `![](${cache.get(source)?.url ?? source})`;
	});

	return { content: inlined, total: referenced.size, failures };
}

// One line for the popup: how many images ended up hot-linking, and
// whether trying again could help.
export function summarizeImageFailures(clip: InlinedClip): string {
	const permanent = clip.failures.filter((f) => f.kind !== 'transient');
	const transient = clip.failures.length - permanent.length;
	const reasons: string[] = [];
	if (transient > 0) reasons.push(`${transient} could not be uploaded`);
	const unsupported = permanent.filter((f) => f.kind === 'unsupported').length;
	if (unsupported > 0) reasons.push(`${unsupported} in a format CrapNote cannot store`);
	const quota = permanent.filter((f) => f.kind === 'quota').length;
	if (quota > 0) reasons.push(`${quota} over your image quota`);
	const rejected = permanent.length - unsupported - quota;
	if (rejected > 0) reasons.push(`${rejected} refused by the server`);
	return (
		`Saved, but ${clip.failures.length} of ${clip.total} images still link to the ` +
		`original site: ${reasons.join(', ')}.` +
		(transient > 0 ? ' Save again to retry them.' : '')
	);
}
