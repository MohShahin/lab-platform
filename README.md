# Lab of Computational Physiology — Papers & Lab Ops

A GitHub-hosted, GitHub-Pages-served dashboard for the lab's paper tracker, built from
`Lab_Papers_Drafts_Tracker.xlsx`. It replaces the spreadsheet with something everyone can
open, filter, and update — while making sure people can only claim authorship on projects
an admin has actually assigned them to.

## What it does

- **Dashboard** — every paper, searchable/filterable by status and priority, with deadline
  highlighting (red = overdue, amber = due within 14 days), converted straight from your tracker.
- **My Projects** — each person's own papers, plus any project an admin has flagged them
  eligible to join.
- **Add myself as author** — a member can only do this on a paper where their GitHub username
  is already on that paper's `eligibleAuthors` list. Clicking it doesn't just edit a JSON file —
  it opens a real GitHub Pull Request, which a GitHub Action validates automatically (see
  "How access control actually works" below) before auto-approving it.
- **Admin** — add/remove eligible authors per paper, visible only to people marked `"role": "admin"`
  in `data/users.json`.
- **Meetings** — lists lab meetings (Zoom link), with a "Check in" button that logs the member's
  GitHub identity + a timestamp to `data/attendance.json`.

## How access control actually works (read this before launch)

A static site has no server, so nothing running in the browser can be trusted to enforce a rule
— anyone could open dev tools and skip the "Add myself as author" button, or even edit
`data/papers.json` by hand and push it, if that were the whole story. So the real enforcement
here isn't in the browser — it's in **`.github/workflows/validate-authorship-claim.yml`**, which
runs on GitHub's servers on every pull request that touches `data/papers.json`:

- If the PR isn't from a listed admin, the Action checks that the diff does exactly one thing:
  adds the requesting user's own display name to a single paper's `authors` array, and only if
  their GitHub username is already in that paper's `eligibleAuthors`.
- Anything else — editing someone else's name, touching `eligibleAuthors`, changing a deadline,
  adding a new paper — gets the PR closed automatically with an explanatory comment.
- A valid claim gets auto-approved by the Action. You'll still want **branch protection on `main`**
  requiring that check to pass (Settings → Branches → add rule → require status checks, require
  the `validate` job) so a manually-pushed change can't skip it.

Admins write directly to `main` (the app does this for `eligibleAuthors` edits) — they're trusted,
since they're the ones maintaining who's eligible for what in the first place.

**Attendance check-ins** are simpler: any signed-in member can append to `data/attendance.json`
directly. This is an honor-system self-report, just tied to the member's real GitHub identity and
a commit timestamp — it is not cryptographic proof they were on the Zoom call. If you later want
real Zoom-verified attendance (via Zoom's Reports API), that requires a small server-side piece
(Zoom's API needs a client secret, which can't live in a static site) — see "Possible upgrades" below.

## Setup

1. **Create the repo** under `github.com/criticaldata` (or wherever you want it) and push everything
   in this folder to it.
2. **Edit `assets/app.js`** — set `CONFIG.owner` and `CONFIG.repo` at the top to match the real repo.
3. **Enable GitHub Pages**: Settings → Pages → Deploy from a branch → `main` / root.
4. **Fill in `data/users.json`** — replace every `TODO-...-github-handle` with each lab member's
   real GitHub username, and set `"role": "admin"` for whoever should manage eligibility.
5. **Fill in `data/papers.json`'s `eligibleAuthors`** for each paper — this is the actual gate that
   decides who can claim authorship on what. It was seeded empty on purpose so nobody gets access
   until an admin has deliberately granted it.
6. **Set up branch protection on `main`** requiring the `validate-authorship-claim` check to pass
   before merging (Settings → Branches).
7. **Update the Zoom link** in `data/meetings.json`.
8. Each lab member creates their own **fine-grained GitHub Personal Access Token**, scoped only to
   this repository, with **Contents: read/write** and **Pull requests: read/write** permissions, and
   pastes it in when the app asks them to sign in. It's stored only in their browser's `localStorage`
   and sent only to `api.github.com`.

## File layout

```
index.html                  the app shell
assets/style.css            styling
assets/app.js                all the logic (GitHub API calls, rendering, PR flow)
data/papers.json            source of truth for the tracker (admin edits eligibleAuthors here)
data/users.json             roster + roles (admin-only)
data/meetings.json          scheduled lab meetings
data/attendance.json        append-only check-in log
.github/workflows/validate-authorship-claim.yml   the actual enforcement
scripts/validate_claim.py   the validation logic the workflow runs
```

## Possible upgrades

- **Real Zoom attendance verification**: add a small serverless function (Vercel/Netlify/Cloudflare
  Worker — all have free tiers) that calls Zoom's Reports API with a server-held client secret
  after each meeting, and reconciles it against self check-ins.
- **Slack/email digest** of upcoming deadlines via a scheduled GitHub Action.
- **CODEOWNERS** on `data/users.json` so only current admins can approve changes to the roster itself.
