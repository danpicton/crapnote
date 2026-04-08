<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor, rootCtx, defaultValueCtx, commandsCtx, type CmdKey } from '@milkdown/kit/core';
	import {
		commonmark,
	} from '@milkdown/kit/preset/commonmark';
	import { history } from '@milkdown/kit/plugin/history';
	import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
	import { underlinePlugin } from '$lib/milkdown/underline';

	export interface EditorRef {
		call: (key: string | CmdKey<unknown>, payload?: unknown) => void;
	}

	interface Props {
		value?: string;
		onchange?: (markdown: string) => void;
		ref?: EditorRef | null;
	}

	let { value = '', onchange, ref = $bindable<EditorRef | null>(null) }: Props = $props();

	let container: HTMLDivElement;
	let _editor: Editor | null = null;

	onMount(async () => {
		_editor = await Editor.make()
			.config((ctx) => {
				ctx.set(rootCtx, container);
				ctx.set(defaultValueCtx, value);
				ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
					onchange?.(markdown);
				});
			})
			.use(commonmark)
			.use(underlinePlugin as Parameters<typeof Editor.prototype.use>[0])
			.use(history)
			.use(listener)
			.create();

		ref = {
			call: (key, payload) => {
				_editor?.action((ctx) => ctx.get(commandsCtx).call(key, payload));
			},
		};
	});

	onDestroy(() => {
		_editor?.destroy();
		_editor = null;
		ref = null;
	});
</script>

<div bind:this={container} class="editor-container"></div>

<style>
	.editor-container {
		flex: 1;
		overflow-y: auto;
		padding: 1rem 2rem;
		min-height: 0;
	}

	.editor-container :global(.milkdown) {
		max-width: 720px;
		margin: 0 auto;
	}

	.editor-container :global(.ProseMirror) {
		outline: none;
		min-height: 200px;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
		font-size: 1rem;
	}

	/* Tight paragraph spacing */
	.editor-container :global(.ProseMirror p) {
		margin: 0.15em 0;
		line-height: 1.5;
	}

	.editor-container :global(.ProseMirror h1),
	.editor-container :global(.ProseMirror h2),
	.editor-container :global(.ProseMirror h3) {
		margin: 0.75em 0 0.2em;
		line-height: 1.3;
	}

	.editor-container :global(.ProseMirror ul),
	.editor-container :global(.ProseMirror ol) {
		margin: 0.15em 0;
		padding-left: 1.5em;
		line-height: 1.5;
	}

	.editor-container :global(.ProseMirror blockquote) {
		margin: 0.4em 0;
		padding-left: 1em;
		border-left: 3px solid #d1d5db;
		color: #6b7280;
	}

	.editor-container :global(.ProseMirror hr) {
		border: none;
		border-top: 1px solid #e5e7eb;
		margin: 0.75em 0;
	}

	.editor-container :global(.ProseMirror code) {
		background: #f3f4f6;
		padding: 0.1em 0.3em;
		border-radius: 0.2em;
		font-size: 0.875em;
	}

	.editor-container :global(.ProseMirror pre) {
		background: #f3f4f6;
		padding: 0.75em 1em;
		border-radius: 0.375em;
		overflow-x: auto;
		margin: 0.5em 0;
	}

	.editor-container :global(.ProseMirror pre code) {
		background: none;
		padding: 0;
		font-size: 0.875em;
	}

	.editor-container :global(u) {
		text-decoration: underline;
	}
</style>
