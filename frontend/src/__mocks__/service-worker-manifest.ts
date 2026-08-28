// Stand-in for SvelteKit's virtual `$service-worker` module, which only exists
// inside a real build. vitest.config.ts aliases `$service-worker` here so
// src/service-worker.ts can be imported by unit tests.
export const build: string[] = [];
export const files: string[] = [];
export const prerendered: string[] = [];
export const version = 'test';
