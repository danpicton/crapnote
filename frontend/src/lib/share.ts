/**
 * Web Share Target payload handling.
 *
 * Android's share sheet hands us up to three fields, and which ones are
 * populated varies a lot by source app: a browser usually sends `title` plus
 * `url`, a text selection sends only `text`, and some apps stuff the link into
 * `text` because they don't support the `url` field at all.
 */

export interface SharePayload {
	title?: string | null;
	text?: string | null;
	url?: string | null;
}

/** Key used to hold a share across a login redirect. */
export const PENDING_SHARE_KEY = 'crapnote.pendingShare';

export function readSharePayload(params: URLSearchParams): SharePayload {
	return {
		title: params.get('title'),
		text: params.get('text'),
		url: params.get('url'),
	};
}

export function hasShareContent(p: SharePayload): boolean {
	return Boolean((p.title ?? '').trim() || (p.text ?? '').trim() || (p.url ?? '').trim());
}

/**
 * Turn a share payload into the title and body of a new note.
 *
 * An empty title is left empty on purpose — the server fills in its own
 * timestamp default, which is the same thing the "new note" button produces.
 */
export function buildSharedNote(p: SharePayload): { title: string; body: string } {
	const title = (p.title ?? '').trim();
	const text = (p.text ?? '').trim();
	const url = (p.url ?? '').trim();

	const parts: string[] = [];
	if (text) parts.push(text);
	// Apps that don't support the url field repeat the link in text; don't
	// write it twice.
	if (url && url !== text) parts.push(url);

	return { title, body: parts.join('\n\n') };
}

/** Stash a share so it survives a redirect through the login page. */
export function stashShare(payload: SharePayload): void {
	try {
		sessionStorage.setItem(PENDING_SHARE_KEY, JSON.stringify(payload));
	} catch {
		// Private mode or storage disabled — the share is lost, but the app
		// still works. Better than throwing on the way to the login screen.
	}
}

/** Retrieve and clear a stashed share. */
export function takeStashedShare(): SharePayload | null {
	try {
		const raw = sessionStorage.getItem(PENDING_SHARE_KEY);
		if (!raw) return null;
		sessionStorage.removeItem(PENDING_SHARE_KEY);
		const parsed = JSON.parse(raw);
		if (typeof parsed !== 'object' || parsed === null) return null;
		return parsed as SharePayload;
	} catch {
		return null;
	}
}

/** True when a share is waiting to be completed after login. */
export function hasStashedShare(): boolean {
	try {
		return sessionStorage.getItem(PENDING_SHARE_KEY) !== null;
	} catch {
		return false;
	}
}
