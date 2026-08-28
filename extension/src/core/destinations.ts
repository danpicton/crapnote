import type { Fetch } from './crapnote';
import type { Settings } from './settings';

// A full-page save target beyond CrapNote itself (read-later services etc).
// Only Readeck is implemented today; new services plug in by adding a
// Destination to the DESTINATIONS list.
export interface PageSave {
	url: string;
	title: string;
	labels: string[];
}

export interface Destination {
	id: string;
	label: string;
	configured(settings: Settings): boolean;
	save(page: PageSave, settings: Settings, fetch?: Fetch): Promise<void>;
}

export const readeckDestination: Destination = {
	id: 'readeck',
	label: 'Readeck',
	configured(settings) {
		return settings.readeckUrl !== '' && settings.readeckToken !== '';
	},
	async save(page, settings, fetch = globalThis.fetch.bind(globalThis)) {
		const res = await fetch(`${settings.readeckUrl}/api/bookmarks`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${settings.readeckToken}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ url: page.url, title: page.title, labels: page.labels }),
		});
		if (!res.ok) {
			throw new Error(`Readeck save failed: ${res.status}`);
		}
	},
};

const DESTINATIONS: Destination[] = [readeckDestination];

export function availableDestinations(settings: Settings): Destination[] {
	return DESTINATIONS.filter((d) => d.configured(settings));
}
