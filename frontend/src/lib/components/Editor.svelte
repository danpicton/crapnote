<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor, rootCtx, defaultValueCtx, commandsCtx } from '@milkdown/kit/core';
	import { commonmark, toggleStrongCommand, toggleEmphasisCommand,
		toggleInlineCodeCommand, wrapInHeadingCommand, insertHrCommand,
		wrapInBulletListCommand, wrapInOrderedListCommand } from '@milkdown/kit/preset/commonmark';
	import { history, undoCommand, redoCommand } from '@milkdown/kit/plugin/history';
	import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';

	interface Props {
		value?: string;
		onchange?: (markdown: string) => void;
		readonly?: boolean;
	}

	let { value = '', onchange, readonly = false }: Props = $props();

	let container: HTMLDivElement;
	let editor: Editor | null = null;

	function callCommand(key: unknown) {
		editor?.action((ctx) => {
			ctx.get(commandsCtx).call(key as string);
		});
	}

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

<div class="editor-wrap">
	<div class="toolbar" aria-label="Formatting toolbar">
		<button type="button" title="Bold (Ctrl+B)" onclick={() => callCommand(toggleStrongCommand.key)}>
			<strong>B</strong>
		</button>
		<button type="button" title="Italic (Ctrl+I)" onclick={() => callCommand(toggleEmphasisCommand.key)}>
			<em>I</em>
		</button>
		<button type="button" title="Inline code" onclick={() => callCommand(toggleInlineCodeCommand.key)}>
			<code>`</code>
		</button>
		<span class="sep"></span>
		<button type="button" title="Heading 1" onclick={() => callCommand(wrapInHeadingCommand.key)}>
			H1
		</button>
		<span class="sep"></span>
		<button type="button" title="Bullet list" onclick={() => callCommand(wrapInBulletListCommand.key)}>
			• List
		</button>
		<button type="button" title="Ordered list" onclick={() => callCommand(wrapInOrderedListCommand.key)}>
			1. List
		</button>
		<span class="sep"></span>
		<button type="button" title="Horizontal rule" onclick={() => callCommand(insertHrCommand.key)}>
			HR
		</button>
		<span class="sep"></span>
		<button type="button" title="Undo (Ctrl+Z)" onclick={() => callCommand(undoCommand.key)}>
			↩
		</button>
		<button type="button" title="Redo (Ctrl+Y)" onclick={() => callCommand(redoCommand.key)}>
			↪
		</button>
	</div>

	<div bind:this={container} class="editor-container" class:readonly></div>
</div>

<style>
	.editor-wrap {
		flex: 1;
		display: flex;
		flex-direction: column;
		min-height: 0;
		overflow: hidden;
	}

	/* ── Toolbar ─────────────────────────────────────────── */
	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.125rem;
		padding: 0.375rem 1rem;
		border-bottom: 1px solid #e5e7eb;
		background: #f9fafb;
		flex-shrink: 0;
		flex-wrap: wrap;
	}

	.toolbar button {
		padding: 0.25rem 0.5rem;
		background: none;
		border: 1px solid transparent;
		border-radius: 0.25rem;
		cursor: pointer;
		font-size: 0.8rem;
		color: #374151;
		line-height: 1.2;
	}

	.toolbar button:hover {
		background: #e5e7eb;
		border-color: #d1d5db;
	}

	.toolbar button:active {
		background: #dbeafe;
		border-color: #93c5fd;
	}

	.sep {
		width: 1px;
		height: 1rem;
		background: #d1d5db;
		margin: 0 0.25rem;
	}

	/* ── Editor content ──────────────────────────────────── */
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
	}

	.editor-container :global(.ProseMirror) {
		outline: none;
		min-height: 200px;
	}

	/* Tighter paragraph spacing */
	.editor-container :global(.ProseMirror p) {
		margin: 0.2em 0;
		line-height: 1.5;
	}

	.editor-container :global(.ProseMirror h1),
	.editor-container :global(.ProseMirror h2),
	.editor-container :global(.ProseMirror h3) {
		margin: 0.75em 0 0.25em;
		line-height: 1.3;
	}

	.editor-container :global(.ProseMirror ul),
	.editor-container :global(.ProseMirror ol) {
		margin: 0.2em 0;
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
</style>
