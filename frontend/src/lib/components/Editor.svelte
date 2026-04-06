<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor, rootCtx, defaultValueCtx } from '@milkdown/kit/core';
	import { commonmark } from '@milkdown/kit/preset/commonmark';
	import { history } from '@milkdown/kit/plugin/history';
	import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';

	interface Props {
		value?: string;
		onchange?: (markdown: string) => void;
		readonly?: boolean;
	}

	let { value = '', onchange, readonly = false }: Props = $props();

	let container: HTMLDivElement;
	let editor: Editor | null = null;

	onMount(async () => {
		editor = await Editor.make()
			.config((ctx) => {
				ctx.set(rootCtx, container);
				ctx.set(defaultValueCtx, value);
				ctx.get(listenerCtx).markdownUpdated((_, markdown) => {
					onchange?.(markdown);
				});
			})
			.use(commonmark)
			.use(history)
			.use(listener)
			.create();
	});

	onDestroy(() => {
		editor?.destroy();
		editor = null;
	});
</script>

<div bind:this={container} class="editor-container" class:readonly></div>

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
		font-size: 1rem;
		line-height: 1.6;
	}

	.editor-container :global(.ProseMirror) {
		outline: none;
		min-height: 200px;
	}
</style>
