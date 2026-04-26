<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor, rootCtx, defaultValueCtx, commandsCtx, editorViewCtx, type CmdKey } from '@milkdown/kit/core';
	import {
		commonmark,
	} from '@milkdown/kit/preset/commonmark';
	import { gfm } from '@milkdown/kit/preset/gfm';
	import { history } from '@milkdown/kit/plugin/history';
	import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
	import { TextSelection } from '@milkdown/kit/prose/state';
	import { underlinePlugin } from '$lib/milkdown/underline';
	import { imagePlugin } from '$lib/milkdown/image';
	import { linkPlugin } from '$lib/milkdown/link';
	import { taskListPlugin } from '$lib/milkdown/tasklist';

	export interface EditorRef {
		call: (key: string | CmdKey<unknown>, payload?: unknown) => void;
		focusEnd: () => void;
		blur: () => void;
	}

	interface Props {
		value?: string;
		onchange?: (markdown: string) => void;
		ref?: EditorRef | null;
		oninsertlink?: () => void;
	}

	let { value = '', onchange, ref = $bindable<EditorRef | null>(null), oninsertlink }: Props = $props();

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
			.use(gfm)
			.use(taskListPlugin as Parameters<typeof Editor.prototype.use>[0])
			.use(underlinePlugin as Parameters<typeof Editor.prototype.use>[0])
			.use(imagePlugin as Parameters<typeof Editor.prototype.use>[0])
			.use(linkPlugin as Parameters<typeof Editor.prototype.use>[0])
			.use(history)
			.use(listener)
			.create();

		container.addEventListener('crapnote:insert-link', () => oninsertlink?.());

		// Click in empty space below content → place cursor at end
		container.addEventListener('click', (e) => {
			if (!_editor) return;
			if (!(e.target as Element).closest('.ProseMirror')) {
				_editor.action((ctx) => {
					const view = ctx.get(editorViewCtx);
					view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
					view.focus();
				});
			}
		});

		ref = {
			call: (key, payload) => {
				_editor?.action((ctx) => ctx.get(commandsCtx).call(key, payload));
			},
			focusEnd: () => {
				_editor?.action((ctx) => {
					const view = ctx.get(editorViewCtx);
					view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
					view.focus();
				});
			},
			blur: () => {
				_editor?.action((ctx) => {
					ctx.get(editorViewCtx).dom.blur();
				});
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
		cursor: text;
	}

	.editor-container :global(.milkdown) {
		max-width: 720px;
		min-height: 100%;
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

	/* Task list items — checkbox vertically centred with text, at content edge */
	.editor-container :global(.ProseMirror li[data-item-type="task"]) {
		list-style: none;
		display: flex;
		align-items: center;
		gap: 0.5em;
	}
	.editor-container :global(.ProseMirror li[data-item-type="task"] .task-checkbox) {
		flex-shrink: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}
	.editor-container :global(.ProseMirror li[data-item-type="task"] .task-content) {
		flex: 1;
		min-width: 0;
	}
	.editor-container :global(.ProseMirror li[data-item-type="task"][data-checked="true"] .task-content p) {
		opacity: 0.5;
		text-decoration: line-through;
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

	.editor-container :global(.ProseMirror a) {
		color: #4f46e5;
		text-decoration: underline;
		cursor: pointer;
	}

	.editor-container :global(.ProseMirror a:hover) {
		color: #3730a3;
	}

	/* ── Image blocks ── */
	.editor-container :global(span.crapnote-img-view) {
		position: relative;
		display: inline-block;
		margin: 0.5em 0;
		line-height: 0;
		max-width: 100%;
		user-select: none;
	}

	.editor-container :global(span.crapnote-img-view img) {
		display: block;
		max-width: 100%;
		height: auto;
		border-radius: 0.25em;
	}

	.editor-container :global(.crapnote-img-handle) {
		position: absolute;
		right: -5px;
		top: 50%;
		transform: translateY(-50%);
		width: 10px;
		height: 36px;
		background: #6366f1;
		border-radius: 4px;
		cursor: ew-resize;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.editor-container :global(span.crapnote-img-view:hover .crapnote-img-handle) {
		opacity: 1;
	}
</style>
