<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { Editor, rootCtx, defaultValueCtx, commandsCtx, editorViewCtx, type CmdKey } from '@milkdown/kit/core';
	import {
		commonmark,
	} from '@milkdown/kit/preset/commonmark';
	import { gfm } from '@milkdown/kit/preset/gfm';
	import { history } from '@milkdown/kit/plugin/history';
	import { listener, listenerCtx } from '@milkdown/kit/plugin/listener';
	import { TextSelection, Plugin } from '@milkdown/kit/prose/state';
	import { $prose as prosePlugin } from '@milkdown/kit/utils';
	import { underlinePlugin } from '$lib/milkdown/underline';
	import { computeActiveFormats, type ActiveFormats } from '$lib/milkdown/formatState';
	import { imagePlugin } from '$lib/milkdown/image';
	import { linkPlugin } from '$lib/milkdown/link';
	import { taskListPlugin } from '$lib/milkdown/tasklist';
	import { listMovePlugin } from '$lib/milkdown/listmove';
	import { listEditPlugin } from '$lib/milkdown/listedit';
	import {
		shouldPlaceCaretAtEnd,
		pointerTravel,
		hasLiveSelectionIn,
	} from '$lib/milkdown/editorclick';

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
		onformatchange?: (formats: ActiveFormats) => void;
		readonly?: boolean;
	}

	let { value = '', onchange, ref = $bindable<EditorRef | null>(null), oninsertlink, onformatchange, readonly = false }: Props = $props();

	let container: HTMLDivElement;
	let _editor = $state<Editor | null>(null);

	// Lock/unlock can flip `readonly` on a mounted editor, so editability is
	// applied reactively rather than only at creation time.
	$effect(() => {
		const editable = !readonly;
		_editor?.action((ctx) => {
			ctx.get(editorViewCtx).setProps({ editable: () => editable });
		});
	});

	// Reports which formats are active at the selection (drives the format-bar
	// button highlight). Recomputes only when selection/doc/stored marks change.
	const formatListener = prosePlugin(
		() =>
			new Plugin({
				view: (view) => {
					onformatchange?.(computeActiveFormats(view.state));
					return {
						update: (v, prevState) => {
							if (
								v.state.selection.eq(prevState.selection) &&
								v.state.doc.eq(prevState.doc) &&
								v.state.storedMarks === prevState.storedMarks
							) {
								return;
							}
							onformatchange?.(computeActiveFormats(v.state));
						},
					};
				},
			})
	);

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
			.use(listMovePlugin as Parameters<typeof Editor.prototype.use>[0])
			.use(listEditPlugin as Parameters<typeof Editor.prototype.use>[0])
			.use(underlinePlugin as Parameters<typeof Editor.prototype.use>[0])
			.use(imagePlugin as Parameters<typeof Editor.prototype.use>[0])
			.use(linkPlugin as Parameters<typeof Editor.prototype.use>[0])
			.use(formatListener as Parameters<typeof Editor.prototype.use>[0])
			.use(history)
			.use(listener)
			.create();

		container.addEventListener('crapnote:insert-link', () => oninsertlink?.());

		// Click in empty space below (or beside) the content → place cursor at
		// end. Where the pointer went down is tracked so a selection dragged
		// out into that empty space isn't mistaken for such a click.
		let pressedAt: { x: number; y: number } | null = null;
		container.addEventListener('pointerdown', (e) => {
			pressedAt = { x: e.clientX, y: e.clientY };
		});
		container.addEventListener('click', (e) => {
			if (!_editor) return;
			const travel = pointerTravel(pressedAt, { x: e.clientX, y: e.clientY });
			pressedAt = null;
			if (
				!shouldPlaceCaretAtEnd({
					insideProse: !!(e.target as Element).closest('.ProseMirror'),
					// Scoped to this editor: a selection elsewhere on the page
					// is not this click's business.
					selectionCollapsed: !hasLiveSelectionIn(document.getSelection(), container),
					pointerTravelPx: travel,
				})
			) {
				return;
			}
			_editor.action((ctx) => {
				const view = ctx.get(editorViewCtx);
				view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
				view.focus();
			});
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

<div bind:this={container} class="editor-container" class:readonly></div>

<style>
	.editor-container {
		flex: 1;
		overflow-y: auto;
		padding: 1rem 2rem;
		min-height: 0;
		cursor: text;
	}
	.editor-container.readonly { cursor: default; }
	.editor-container.readonly :global(.ProseMirror) { cursor: default; caret-color: transparent; }

	.editor-container :global(.milkdown) {
		/* 720px wrapped far too early on a desktop pane. Wider, but still
		   capped — an uncapped column is hard to read. Left-aligned, as it
		   has always been: the toolbar above it starts at the left edge. */
		max-width: min(1100px, 100%);
		min-height: 100%;
	}

	.editor-container :global(.ProseMirror) {
		outline: none;
		min-height: 200px;
		font-family: var(--sans);
		font-size: 1rem;
		text-align: left;
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
		/* Wider than the 1.5em the markers need: the extra space is the gutter
		   the drag handles occupy, so showing one never shifts the text. */
		padding-left: 2.1em;
		line-height: 1.5;
	}

	/* ── Drag-to-reorder ── */
	.editor-container :global(.ProseMirror li) {
		position: relative;
	}

	.editor-container :global(.ProseMirror .list-drag-handle) {
		position: absolute;
		left: -1.9em;
		top: 0;
		/* Font size is deliberately left inherited so this height is exactly one
		   line of the list's line-height — that is what centres the grip against
		   the first line of its item. Shrinking the font here would shrink the
		   em box too and float the grip above the text. */
		height: 1.5em;
		width: 0.85em;
		display: flex;
		align-items: center;
		justify-content: center;
		color: var(--text-3);
		opacity: 0;
		cursor: grab;
		/* Deliberately NOT user-select: none — the grip sits in the gutter a
		   backwards selection drags through, and an unselectable island there
		   fragments the selection. The handle holds no text anyway. */
		/* Claim the gesture so a touch-drag reorders instead of scrolling. */
		touch-action: none;
		transition: opacity 0.12s;
	}
	.editor-container :global(.ProseMirror .list-drag-handle svg) {
		display: block;
		width: 0.4em;
		height: 0.68em;
	}
	/* Widen the hit area without moving the grip — it stays clear of the text,
	   which begins to the right of the gutter. */
	.editor-container :global(.ProseMirror .list-drag-handle::after) {
		content: '';
		position: absolute;
		inset: -6px -7px;
	}
	/* Task items are pulled 1.25em left so their text lines up with plain
	   items; shift the handle back by the same amount to keep the gutter
	   column straight. */
	.editor-container :global(.ProseMirror li[data-item-type='task'] .list-drag-handle) {
		left: -0.65em;
	}
	/* Touch devices never hover, so a hover-only grip would be undraggable. */
	@media (hover: none) {
		.editor-container :global(.ProseMirror .list-drag-handle) {
			opacity: 0.4;
		}
	}

	.editor-container :global(.ProseMirror li:hover > .list-drag-handle),
	.editor-container :global(.ProseMirror li.list-item-dragging > .list-drag-handle) {
		opacity: 0.55;
	}
	.editor-container :global(.ProseMirror .list-drag-handle:active) {
		cursor: grabbing;
		opacity: 0.9;
	}
	/* No handles when the note is locked or otherwise read-only. */
	.editor-container.readonly :global(.ProseMirror .list-drag-handle) {
		display: none;
	}

	.editor-container :global(.ProseMirror li.list-item-dragging) {
		opacity: 0.45;
	}

	.editor-container :global(.ProseMirror li.list-drop-before)::before,
	.editor-container :global(.ProseMirror li.list-drop-after)::after {
		content: '';
		position: absolute;
		left: -0.5em;
		right: 0;
		height: 2px;
		background: var(--accent);
		border-radius: 1px;
		pointer-events: none;
	}
	.editor-container :global(.ProseMirror li.list-drop-before)::before {
		top: -1px;
	}
	.editor-container :global(.ProseMirror li.list-drop-after)::after {
		bottom: -1px;
	}

	/* Task list items — text aligned with regular list item text, checkbox in margin */
	.editor-container :global(.ProseMirror li[data-item-type="task"]) {
		list-style: none;
		display: flex;
		align-items: center;
		gap: 0.375em;
		margin-left: -1.25em; /* pull into ul padding so text aligns with regular <li> text */
	}
	/* The tap target, not the box. Padding grows the hit area and the equal
	   negative margin pulls the layout back, so the checkbox sits exactly
	   where it did before. */
	.editor-container :global(.ProseMirror li[data-item-type="task"] .task-check-hit) {
		flex-shrink: 0;
		display: flex;
		align-items: center;
		justify-content: center;
		padding: 0.45em 0.4em;
		margin: -0.45em -0.4em;
		cursor: pointer;
		-webkit-tap-highlight-color: transparent;
	}
	.editor-container :global(.ProseMirror li[data-item-type="task"] .task-checkbox) {
		flex-shrink: 0;
		width: 1.05em;
		height: 1.05em;
		margin: 0;
		accent-color: var(--accent);
		cursor: pointer;
	}
	/* A locked note must not toggle. The click handler already refuses, but
	   killing pointer events stops the native input flicking first. Left
	   visible (rather than `disabled`) so the checked state still reads. */
	.editor-container.readonly :global(.ProseMirror .task-check-hit),
	.editor-container.readonly :global(.ProseMirror .task-checkbox) {
		pointer-events: none;
		cursor: default;
	}
	/* Phones: the box grows and the hit area goes to ~40px square. Vertical
	   padding stops short of a full 44px on purpose — any taller and
	   neighbouring rows' targets would overlap enough to swallow each
	   other's taps. */
	@media (max-width: 640px) {
		.editor-container :global(.ProseMirror li[data-item-type="task"] .task-check-hit) {
			padding: 10px 9px;
			margin: -10px -9px;
		}
		.editor-container :global(.ProseMirror li[data-item-type="task"] .task-checkbox) {
			width: 20px;
			height: 20px;
		}
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
		border-left: 3px solid var(--border-md);
		color: var(--text-3);
	}

	.editor-container :global(.ProseMirror hr) {
		border: none;
		border-top: 1px solid var(--border);
		margin: 0.75em 0;
	}

	.editor-container :global(.ProseMirror code) {
		background: var(--bg-alt);
		padding: 0.1em 0.3em;
		border-radius: 0.2em;
		font-size: 0.875em;
		font-family: var(--mono);
	}

	.editor-container :global(.ProseMirror pre) {
		background: var(--bg-alt);
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
		color: var(--accent);
		text-decoration: underline;
		cursor: pointer;
	}

	.editor-container :global(.ProseMirror a:hover) {
		color: var(--accent-dk);
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
		background: var(--accent);
		border-radius: 4px;
		cursor: ew-resize;
		opacity: 0;
		transition: opacity 0.15s;
	}

	.editor-container :global(span.crapnote-img-view:hover .crapnote-img-handle) {
		opacity: 1;
	}
</style>
