export interface TitleDraftResult {
	title: string;
	commit: boolean;
}

/** Decide whether a title draft should replace the last saved title. */
export function finishTitleDraft(savedTitle: string, draft: string): TitleDraftResult {
	if (!draft.trim()) return { title: savedTitle, commit: false };
	return { title: draft, commit: draft !== savedTitle };
}
