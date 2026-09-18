import { describe, expect, it } from 'vitest';
import { canArchiveOrDelete, isLockRejection, LOCKED_ACTION_MESSAGE } from './noteActions';

describe('canArchiveOrDelete', () => {
	it('hides removal actions while locked and restores them after unlock', () => {
		expect(canArchiveOrDelete({ locked: true })).toBe(false);
		expect(canArchiveOrDelete({ locked: false })).toBe(true);
	});

	it('recognises a 423 and provides unlock guidance', () => {
		expect(isLockRejection({ status: 423 })).toBe(true);
		expect(isLockRejection({ status: 409 })).toBe(false);
		expect(LOCKED_ACTION_MESSAGE).toMatch(/unlock/i);
	});
});
