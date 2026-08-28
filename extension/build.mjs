// Builds the extension for one or both browsers from the shared source.
// Usage: node build.mjs [chrome|firefox]
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { generateIcons } from './gen-icons.mjs';

const targets = process.argv[2] ? [process.argv[2]] : ['chrome', 'firefox'];
const base = JSON.parse(readFileSync('manifest.base.json', 'utf8'));

const browserManifest = {
	chrome: {
		...base,
		background: { service_worker: 'background.js' },
	},
	firefox: {
		...base,
		background: { scripts: ['background.js'] },
		browser_specific_settings: {
			gecko: {
				id: 'crapnote-clipper@danpicton.github.io',
				strict_min_version: '121.0',
			},
		},
	},
};

for (const target of targets) {
	if (!browserManifest[target]) {
		console.error(`unknown target: ${target}`);
		process.exit(1);
	}
	const out = join('dist', target);
	rmSync(out, { recursive: true, force: true });
	mkdirSync(out, { recursive: true });

	await build({
		entryPoints: {
			background: 'src/background.ts',
			popup: 'src/popup/main.ts',
			options: 'src/options/main.ts',
		},
		bundle: true,
		format: 'iife',
		outdir: out,
		target: 'es2022',
	});

	cpSync('src/popup/popup.html', join(out, 'popup.html'));
	cpSync('src/popup/popup.css', join(out, 'popup.css'));
	cpSync('src/options/options.html', join(out, 'options.html'));
	cpSync('src/options/options.css', join(out, 'options.css'));
	generateIcons(join(out, 'icons'));
	writeFileSync(join(out, 'manifest.json'), JSON.stringify(browserManifest[target], null, '\t'));

	try {
		const zip = join('dist', `crapnote-${target}.zip`);
		rmSync(zip, { force: true });
		execFileSync('zip', ['-qr', join('..', `crapnote-${target}.zip`), '.'], { cwd: out });
		console.log(`built ${out} and ${zip}`);
	} catch {
		console.log(`built ${out} (zip tool unavailable, skipped archive)`);
	}
}
