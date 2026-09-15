export interface SidebarPreferences {
	hidden: boolean;
	width: number;
}

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
	hidden: false,
	width: 300,
};

const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 480;
const MIN_NOTE_PANE_WIDTH = 320;

export function clampSidebarWidth(width: number, viewportWidth: number): number {
	const maxForViewport = Math.max(MIN_SIDEBAR_WIDTH, viewportWidth - MIN_NOTE_PANE_WIDTH);
	return Math.min(Math.max(width, MIN_SIDEBAR_WIDTH), MAX_SIDEBAR_WIDTH, maxForViewport);
}

export function parseSidebarPreferences(raw: string | null): SidebarPreferences {
	if (raw === null) return { ...DEFAULT_SIDEBAR_PREFERENCES };
	try {
		const value: unknown = JSON.parse(raw);
		if (
			typeof value === 'object' && value !== null
			&& typeof (value as Record<string, unknown>).hidden === 'boolean'
			&& typeof (value as Record<string, unknown>).width === 'number'
			&& Number.isFinite((value as Record<string, unknown>).width)
		) {
			return value as SidebarPreferences;
		}
	} catch {
		// Invalid storage is equivalent to no saved preference.
	}
	return { ...DEFAULT_SIDEBAR_PREFERENCES };
}
