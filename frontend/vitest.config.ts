import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineConfig({
	plugins: [svelte({ hot: false })],
	resolve: {
		conditions: ['browser'],
		alias: {
			$lib: path.resolve('./src/lib'),
			$app: path.resolve('./src/__mocks__/app'),
			'$service-worker': path.resolve('./src/__mocks__/service-worker-manifest.ts'),
			'lucide-svelte': path.resolve('./src/__mocks__/lucide-svelte.ts'),
		},
	},
	test: {
		environment: 'jsdom',
		globals: true,
		setupFiles: ['./src/test-setup.ts'],
		include: ['src/**/*.{test,spec}.{js,ts}'],
		coverage: {
			provider: 'v8',
			reporter: ['text', 'html'],
			include: ['src/**/*.{ts,svelte}'],
			// Mocks and the jsdom setup file are test scaffolding, not product
			// code — counting them flatters the numbers.
			exclude: ['src/**/__mocks__/**', 'src/test-setup.ts', 'src/**/*.d.ts'],
		},
	}
});
