type BeforeInstallPromptEvent = Event & {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

let _prompt = $state<BeforeInstallPromptEvent | null>(null);
let _installed = $state(false);

export const installPrompt = {
	get prompt() { return _prompt; },
	get installed() { return _installed; },
	capture(e: BeforeInstallPromptEvent) { _prompt = e; },
	async install() {
		if (!_prompt) return;
		await _prompt.prompt();
		const { outcome } = await _prompt.userChoice;
		if (outcome === 'accepted') { _installed = true; _prompt = null; }
	},
};
