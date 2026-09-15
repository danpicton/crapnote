export const LOCKED_ACTION_MESSAGE = 'This note is locked. Unlock it before archiving or deleting.';

export function canArchiveOrDelete(note: { locked: boolean }): boolean {
	return !note.locked;
}

export function isLockRejection(error: unknown): boolean {
	return typeof error === 'object' && error !== null && 'status' in error && error.status === 423;
}
