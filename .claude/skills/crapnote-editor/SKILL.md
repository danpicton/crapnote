---
name: crapnote-editor
description: >-
  Milkdown (ProseMirror-based) rich markdown editor in the CrapNote frontend.
  Use when working on the editor component, milkdown plugins, image paste, link handling,
  or any code in frontend/src/lib/milkdown/ or frontend/src/lib/components/Editor.svelte.
---

# CrapNote Editor

The editor uses Milkdown (ProseMirror-based) for live markdown rendering.

- Component: `frontend/src/lib/components/Editor.svelte`
- Custom plugins: `frontend/src/lib/milkdown/` (image paste, link, tasklist, underline)
- The first line is always the title (rendered as H1)
- Auto-save triggers on blur

## Testing

Always mock the editor in Vitest tests — it depends on browser APIs not available in jsdom:

```typescript
vi.mock('$lib/components/Editor.svelte', async () => ({
    default: (anchor: unknown, props: unknown) => { void anchor; void props; },
}));
```

The real component hangs in jsdom. E2E tests (Playwright) exercise the editor against the real browser.
