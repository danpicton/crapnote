type TitledNote = { id: number; title: string };

/** Protect only title fields, not list membership or the lifetime of a list request.
 * A read overlapping a commit can contain its old title even after the PUT finishes.
 * A read begun after that PUT is free to accept changes from another device.
 */
export class TitleCommits {
	private revision = 0;
	private latest = new Map<number, { title: string; revision: number }>();
	private pending = new Map<number, string>();

	set(id: number, title: string) {
		this.latest.set(id, { title, revision: ++this.revision });
		this.pending.set(id, title);
	}

	settled(id: number, title: string) {
		if (this.pending.get(id) === title) this.pending.delete(id);
	}

	preserve<T extends TitledNote>(note: T): T {
		const title = this.pending.get(note.id);
		return title === undefined ? note : { ...note, title };
	}

	guardRead(): <T extends TitledNote>(notes: T[]) => T[] {
		const revision = this.revision;
		const pendingAtStart = new Map(this.pending);
		return (notes) => notes.map((note) => {
			const latest = this.latest.get(note.id);
			const title = latest && latest.revision > revision
				? latest.title : pendingAtStart.get(note.id);
			return this.preserve(title === undefined ? note : { ...note, title });
		});
	}

	remap(tempId: number, serverId: number) {
		const latest = this.latest.get(tempId);
		if (latest) {
			this.latest.delete(tempId);
			this.latest.set(serverId, { ...latest, revision: ++this.revision });
		}
		const pending = this.pending.get(tempId);
		if (pending !== undefined) {
			this.pending.delete(tempId);
			this.pending.set(serverId, pending);
		}
	}
}
