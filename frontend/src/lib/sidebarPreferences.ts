export interface SidebarPreferences {
	hidden: boolean;
	width: number;
}

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences = {
	hidden: false,
	width: 300,
};

export function parseSidebarPreferences(raw: string | null): SidebarPreferences {
	if (raw === null) return { ...DEFAULT_SIDEBAR_PREFERENCES };
	try {
		const value: unknown = JSON.parse(raw);
		if (
			typeof value === 'object' && value !== null
			&& typeof (value as Record<string, unknown>).hidden === 'boolean'
			&& typeof (value as Record<string, unknown>).width === 'number'
		) {
			return value as SidebarPreferences;
		}
	} catch {
		// Invalid storage is equivalent to no saved preference.
	}
	return { ...DEFAULT_SIDEBAR_PREFERENCES };
}
