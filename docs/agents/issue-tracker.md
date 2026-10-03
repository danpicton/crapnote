# Issue tracker: GitHub

Issues and specs for this repo live in GitHub Issues. Use `gh` from this
checkout; its remote is `danpicton/crapnote`.

Follow `docs/issue-pr-guidelines.md` and the templates in `.github/` when
creating issues or PRs.

## Issue operations

- Create: `gh issue create --title "..." --body-file <draft-file>`
- Read: `gh issue view <number> --json title,body,labels,comments,state`
- List: `gh issue list --state open --json number,title,body,labels,comments`
- Comment: `gh issue comment <number> --body-file <draft-file>`
- Label: `gh issue edit <number> --add-label "..."` or `--remove-label "..."`
- Close: `gh issue close <number>`

When a skill says "publish to the issue tracker", create a GitHub issue.
When it says "fetch the relevant ticket", read that issue and its comments.

## Pull requests as a triage surface

PRs as a request surface: no.

## Wayfinding operations

Use these operations only when the user explicitly requests wayfinding or
invokes `$wayfinder`. Wayfinder decision tickets are separate from
`ready-for-agent` implementation issues; the sequential issue workflow must
not pick them up.

A wayfinder map is one issue labelled `wayfinder:map`. Decision tickets are
child issues linked as GitHub sub-issues. If sub-issues are unavailable, put
them in a task list on the map and add `Part of #<map>` to each child.

Use GitHub issue dependencies for blockers. The API requires the blocker's
numeric database ID, not its issue number. If dependencies are unavailable,
put `Blocked by: #<number>` near the top of the child issue.

The ready frontier contains open, unassigned child issues whose blockers
are closed. Claim one by assigning it to yourself. Resolve it by posting
the answer, closing the child, and linking a short decision summary from
the map's Decisions-so-far section.
