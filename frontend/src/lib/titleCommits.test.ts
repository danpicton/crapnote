import { describe, expect, it } from 'vitest';
import { TitleCommits } from './titleCommits';

const note = (title: string, id = 1) => ({ id, title });

describe('title commit response guards', () => {
	it('protects titles committed during a read even after the write finishes', () => {
		const commits = new TitleCommits();
		const apply = commits.guardRead();
		commits.set(1, 'New');
		commits.settled(1, 'New');
		expect(apply([note('Old'), note('Other', 2)])).toEqual([note('New'), note('Other', 2)]);
		// Subsequent reads may accept edits from another device.
		expect(commits.guardRead()([note('Remote')])).toEqual([note('Remote')]);
	});

	it('protects commits already pending at read start, without adding filtered-out notes', () => {
		const commits = new TitleCommits();
		commits.set(1, 'New');
		const apply = commits.guardRead();
		commits.settled(1, 'New');
		expect(apply([note('Old')])).toEqual([note('New')]);
		expect(apply([])).toEqual([]);
	});

	it('older completions cannot clear a newer pending title', () => {
		const commits = new TitleCommits();
		commits.set(1, 'First');
		commits.set(1, 'Second');
		commits.settled(1, 'First');
		expect(commits.preserve(note('First'))).toEqual(note('Second'));
	});

	it('moves pending and read protection to the server ID regardless of selection', () => {
		const commits = new TitleCommits();
		commits.set(-1, 'New');
		const apply = commits.guardRead();
		commits.remap(-1, 7);
		commits.settled(7, 'New');
		expect(apply([note('Old', 7)])).toEqual([note('New', 7)]);
	});
});
