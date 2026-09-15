import { describe, expect, it } from 'vitest';
import type { Note } from './api';
import type { CachedNote } from './offlineDB';
import { mergeCachedNote } from './noteMerge';

const server: Note = { id: 1, title: 'Remote', body: 'Remote body', private: true,
	starred: false, pinned: true, pin_order: -5, locked: true, archived: false,
	created_at: '2024-01-01T00:00:00Z', updated_at: '2024-01-03T00:00:00Z' };
const cached: CachedNote = { id: 1, title: 'Local', body: 'Local body', private: false,
	starred: true, pinned: false, locked: false, pin_order: 0, tags: [],
	server_updated_at: '2024-01-01T00:00:00Z', local_updated_at: '2024-01-02T00:00:00Z',
	is_dirty: false, is_new: false, flags_dirty: true, flags_toggled: { starred: true } };

describe('pending note merge', () => {
	it('overlays only explicitly queued flags, never cached privacy', () => {
		expect(mergeCachedNote(server, cached)).toEqual({ ...server, starred: true });
	});
	it('retains legacy queued flag and pin position behavior without overriding privacy', () => {
		expect(mergeCachedNote(server, { ...cached, flags_toggled: undefined })).toEqual({
			...server, starred: true, pinned: false, locked: false, pin_order: 0,
		});
	});
	for (const remotePrivate of [true, false]) {
		for (const localPrivate of [true, false]) {
			for (const dirty of [true, false]) {
				it(`server=${remotePrivate}, cache=${localPrivate}, dirty=${dirty}: protects the content actually displayed`, () => {
					const merged = mergeCachedNote({ ...server, private: remotePrivate },
						{ ...cached, private: localPrivate, is_dirty: dirty });
					expect(merged.private).toBe(remotePrivate || (dirty && localPrivate));
					expect(merged.body).toBe(dirty ? cached.body : server.body);
					expect(merged.title).toBe(dirty ? cached.title : server.title);
				});
			}
		}
	}
	it('also protects dirty private content when no flag toggle was queued', () => {
		expect(mergeCachedNote({ ...server, private: false }, { ...cached, private: true,
			is_dirty: true, flags_dirty: false }).private).toBe(true);
	});
	it('leaves clean server content authoritative', () => {
		expect(mergeCachedNote(server, { ...cached, flags_dirty: false })).toBe(server);
		expect(mergeCachedNote(server, null)).toBe(server);
	});
});
