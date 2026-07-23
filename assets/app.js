// ============================================================================
// CONFIG — edit these two lines to match where this repo actually lives.
// ============================================================================
const CONFIG = {
  owner: "MohShahin",
  repo: "lab-platform",
  branch: "main",
};

const GH_API = "https://api.github.com";

// ============================================================================
// Tiny state container
// ============================================================================
const state = {
  token: localStorage.getItem("lab_gh_token") || null,
  ghUser: null,        // { login, avatar_url, name }
  role: null,          // "admin" | "member" | "unregistered"
  displayName: null,
  users: [],           // data/users.json members[]
  papers: [],          // data/papers.json papers[]
  meetings: [],
  attendance: [],
};

// ============================================================================
// Toasts
// ============================================================================
function toast(msg, isError = false) {
  const root = document.getElementById("toast-root");
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " is-error" : "");
  el.textContent = msg;
  root.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

// ============================================================================
// Signature element: animated pulse trace in the header.
// Redraws a random-ish ECG-like waveform every few seconds. Purely decorative.
// ============================================================================
function pulsePath() {
  const w = 1200, midY = 30;
  let d = `M0,${midY} `;
  let x = 0;
  while (x < w) {
    const seg = 40 + Math.random() * 60;
    d += `L${x + seg * 0.5},${midY} `;
    if (Math.random() > 0.55) {
      const spike = 14 + Math.random() * 12;
      d += `L${x + seg * 0.55},${midY - spike} L${x + seg * 0.62},${midY + spike * 0.6} L${x + seg * 0.7},${midY} `;
    }
    x += seg;
    d += `L${x},${midY} `;
  }
  return d;
}
function animatePulse() {
  const path = document.getElementById("pulse-path");
  if (!path) return;
  path.setAttribute("d", pulsePath());
}
animatePulse();
if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  setInterval(animatePulse, 4000);
}

// ============================================================================
// GitHub REST helpers
// ============================================================================
function ghHeaders() {
  return {
    Authorization: `Bearer ${state.token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function ghGetUser() {
  const res = await fetch(`${GH_API}/user`, { headers: ghHeaders() });
  if (!res.ok) throw new Error("Could not verify that token with GitHub.");
  return res.json();
}

async function ghGetFile(path, ref = CONFIG.branch) {
  const res = await fetch(
    `${GH_API}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}?ref=${ref}`,
    { headers: ghHeaders() }
  );
  if (!res.ok) throw new Error(`Could not read ${path} (${res.status}).`);
  const json = await res.json();
  const content = decodeURIComponent(escape(atob(json.content)));
  return { content, sha: json.sha, json: JSON.parse(content) };
}

async function ghPutFile(path, newObj, sha, branch, message) {
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(newObj, null, 2) + "\n")));
  const res = await fetch(
    `${GH_API}/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${path}`,
    {
      method: "PUT",
      headers: ghHeaders(),
      body: JSON.stringify({ message, content, sha, branch }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || `Could not write ${path} (${res.status}).`);
  }
  return res.json();
}

async function ghGetBranchSha(branch) {
  const res = await fetch(
    `${GH_API}/repos/${CONFIG.owner}/${CONFIG.repo}/git/ref/heads/${branch}`,
    { headers: ghHeaders() }
  );
  if (!res.ok) throw new Error(`Could not read branch ${branch}.`);
  return (await res.json()).object.sha;
}

async function ghCreateBranch(newBranch, fromSha) {
  const res = await fetch(
    `${GH_API}/repos/${CONFIG.owner}/${CONFIG.repo}/git/refs`,
    {
      method: "POST",
      headers: ghHeaders(),
      body: JSON.stringify({ ref: `refs/heads/${newBranch}`, sha: fromSha }),
    }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message || "Could not create branch.");
  }
}

async function ghOpenPR(branch, title, body) {
  const res = await fetch(
    `${GH_API}/repos/${CONFIG.owner}/${CONFIG.repo}/pulls`,
    {
      method: "POST",
      headers: ghHeaders(),
      body: JSON.stringify({ title, head: branch, base: CONFIG.branch, body }),
    }
  );
  if (!res.ok) {
    const body2 = await res.json().catch(() => ({}));
    throw new Error(body2.message || "Could not open pull request.");
  }
  return res.json();
}

// Reads for display use plain fetch of the static files GitHub Pages already
// serves alongside this app — no auth needed, always reflects the last
// successful merge to main.
async function fetchStatic(path) {
  const res = await fetch(`${path}?_=${Date.now()}`);
  if (!res.ok) throw new Error(`Could not load ${path}`);
  return res.json();
}

// ============================================================================
// Auth flow
// ============================================================================
function showSignInModal() {
  const tpl = document.getElementById("tpl-signin-modal");
  const node = tpl.content.cloneNode(true);
  document.body.appendChild(node);
  const backdrop = document.body.querySelector(".modal-backdrop");
  backdrop.querySelector("#pat-cancel").onclick = () => backdrop.remove();
  backdrop.querySelector("#pat-submit").onclick = async () => {
    const token = backdrop.querySelector("#pat-input").value.trim();
    if (!token) return;
    backdrop.remove();
    await signIn(token);
  };
}

async function signIn(token) {
  try {
    state.token = token;
    const ghUser = await ghGetUser();
    state.ghUser = ghUser;
    localStorage.setItem("lab_gh_token", token);
    toast(`Signed in as ${ghUser.login}`);
    await afterSignIn();
  } catch (e) {
    state.token = null;
    localStorage.removeItem("lab_gh_token");
    toast(e.message, true);
  }
}

function signOut() {
  localStorage.removeItem("lab_gh_token");
  location.reload();
}

async function afterSignIn() {
  await loadAllData();
  const me = state.users.find(u => u.githubUsername === state.ghUser.login);
  state.role = me ? me.role : "unregistered";
  state.displayName = me ? me.displayName : state.ghUser.login;

  document.getElementById("gate").style.display = "none";
  document.getElementById("tabs").style.display = "flex";
  document.querySelectorAll(".view")[0].classList.add("is-active");
  renderUserBadge();

  if (state.role === "unregistered") {
    toast("You're signed in, but not yet on the lab roster — ask an admin to add you to data/users.json.", true);
  }
  if (state.role === "admin") {
    document.getElementById("tab-admin").style.display = "inline-block";
  }

  renderDashboard();
  renderMine();
  renderMeetings();
  if (state.role === "admin") renderAdmin();
}

function renderUserBadge() {
  const el = document.getElementById("user-badge");
  el.innerHTML = "";
  const pill = document.createElement("div");
  pill.className = "user-badge__pill";
  pill.innerHTML = `
    <img src="${state.ghUser.avatar_url}" alt="">
    <span>${state.displayName}</span>
    <span class="user-badge__role">${state.role}</span>
  `;
  const signOutBtn = document.createElement("button");
  signOutBtn.className = "btn btn--ghost-on-dark btn--small";
  signOutBtn.textContent = "Sign out";
  signOutBtn.onclick = signOut;
  el.appendChild(pill);
  el.appendChild(signOutBtn);
}

// ============================================================================
// Data loading
// ============================================================================
async function loadAllData() {
  const [usersDoc, papersDoc, meetingsDoc, attendanceDoc] = await Promise.all([
    fetchStatic("data/users.json"),
    fetchStatic("data/papers.json"),
    fetchStatic("data/meetings.json"),
    fetchStatic("data/attendance.json"),
  ]);
  state.users = usersDoc.members;
  state.papers = papersDoc.papers;
  state.meetings = meetingsDoc.meetings;
  state.attendance = attendanceDoc.checkIns;
}

// ============================================================================
// Deadline helpers
// ============================================================================
function daysUntil(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  const now = new Date();
  return Math.ceil((d - now) / (1000 * 60 * 60 * 24));
}

function nearestDeadlineInfo(paper) {
  const closed = ["Published", "Accepted", "Rejected"].includes(paper.finalStatus);
  const upcoming = (paper.venues || [])
    .map(v => v.deadline)
    .filter(Boolean)
    .map(d => ({ date: d, days: daysUntil(d) }))
    .sort((a, b) => a.days - b.days);
  if (!upcoming.length) return null;
  const next = upcoming[0];
  if (closed) return { ...next, tone: "none" };
  if (next.days < 0) return { ...next, tone: "overdue" };
  if (next.days <= 14) return { ...next, tone: "soon" };
  return { ...next, tone: "none" };
}

// ============================================================================
// Rendering: paper card
// ============================================================================
function priorityClass(p) {
  return { High: "high", Medium: "medium", Low: "low" }[p] || "medium";
}

function paperCard(paper, { showClaim } = { showClaim: false }) {
  const dl = nearestDeadlineInfo(paper);
  const card = document.createElement("div");
  card.className = "paper-card" + (dl?.tone === "overdue" ? " is-overdue" : dl?.tone === "soon" ? " is-due-soon" : "");

  const venueText = (paper.venues || [])
    .map(v => `${v.venue || "Additional deadline"}${v.deadline ? ` — due ${v.deadline}` : ""}`)
    .join(" · ") || "No venue set yet";

  const authorsText = paper.authors && paper.authors.length ? paper.authors.join(", ") : "Unassigned";

  const iAmEligibleNotYetAuthor =
    state.ghUser &&
    (paper.eligibleAuthors || []).includes(state.ghUser.login) &&
    !(paper.authors || []).includes(state.displayName);

  card.innerHTML = `
    <h3 class="paper-card__title">${escapeHtml(paper.title)}</h3>
    <div class="paper-card__meta-row">
      <span class="chip chip--status">${escapeHtml(paper.finalStatus)}</span>
      <span class="chip chip--priority-${priorityClass(paper.priority)}">
        <span class="blip blip--${priorityClass(paper.priority)}"></span> ${escapeHtml(paper.priority)}
      </span>
      ${dl && dl.tone !== "none" ? `<span class="chip chip--deadline-${dl.tone === "overdue" ? "overdue" : "soon"}">${dl.tone === "overdue" ? "Overdue" : "Due soon"}: ${dl.date}</span>` : ""}
    </div>
    <div class="paper-card__venues">${escapeHtml(venueText)}</div>
    <div class="paper-card__authors"><strong>Authors:</strong> ${escapeHtml(authorsText)}</div>
    ${paper.notes ? `<div class="paper-card__notes">${escapeHtml(paper.notes)}</div>` : ""}
    <div class="paper-card__footer">
      <span class="eligibility-note"></span>
    </div>
  `;

  const footer = card.querySelector(".paper-card__footer");
  if (showClaim && iAmEligibleNotYetAuthor) {
    const btn = document.createElement("button");
    btn.className = "btn btn--primary btn--small";
    btn.textContent = "Add myself as author";
    btn.onclick = () => claimAuthorship(paper);
    footer.appendChild(btn);
  } else if (showClaim && state.ghUser && !(paper.authors || []).includes(state.displayName)) {
    footer.querySelector(".eligibility-note").textContent =
      "Not on the eligible list for this project yet — ask an admin.";
  }

  return card;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// ============================================================================
// Dashboard view
// ============================================================================
function populateStatusFilter() {
  const sel = document.getElementById("filter-status");
  const statuses = [...new Set(state.papers.map(p => p.finalStatus))].sort();
  statuses.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s; opt.textContent = s;
    sel.appendChild(opt);
  });
}

function renderDashboard() {
  populateStatusFilter();
  const grid = document.getElementById("papers-grid");
  const search = document.getElementById("search");
  const statusSel = document.getElementById("filter-status");
  const prioritySel = document.getElementById("filter-priority");

  function draw() {
    grid.innerHTML = "";
    const q = search.value.toLowerCase();
    const status = statusSel.value;
    const priority = prioritySel.value;
    state.papers
      .filter(p => !status || p.finalStatus === status)
      .filter(p => !priority || p.priority === priority)
      .filter(p => !q || JSON.stringify(p).toLowerCase().includes(q))
      .forEach(p => grid.appendChild(paperCard(p, { showClaim: true })));
    if (!grid.children.length) {
      grid.innerHTML = `<p style="color:var(--ink-soft)">No projects match those filters.</p>`;
    }
  }
  search.oninput = draw;
  statusSel.onchange = draw;
  prioritySel.onchange = draw;
  draw();
}

// ============================================================================
// My Projects view
// ============================================================================
function renderMine() {
  const grid = document.getElementById("mine-grid");
  grid.innerHTML = "";
  const mine = state.papers.filter(
    p => (p.authors || []).includes(state.displayName) || (p.eligibleAuthors || []).includes(state.ghUser.login)
  );
  if (!mine.length) {
    grid.innerHTML = `<p style="color:var(--ink-soft)">No projects yet. An admin adds you to a paper's eligible-authors list before it shows up here.</p>`;
  }
  mine.forEach(p => grid.appendChild(paperCard(p, { showClaim: true })));
}

// ============================================================================
// Claim authorship — opens a PR; a GitHub Action validates and auto-approves it.
// ============================================================================
async function claimAuthorship(paper) {
  try {
    toast("Opening a pull request to add you as an author…");
    const baseSha = await ghGetBranchSha(CONFIG.branch);
    const branchName = `claim/${state.ghUser.login}/${paper.id}-${Date.now()}`;
    await ghCreateBranch(branchName, baseSha);

    const { json: papersDoc, sha } = await ghGetFile("data/papers.json", CONFIG.branch);
    const target = papersDoc.papers.find(p => p.id === paper.id);
    target.authors = [...(target.authors || []), state.displayName];

    await ghPutFile(
      "data/papers.json",
      papersDoc,
      sha,
      branchName,
      `Add ${state.displayName} as author on "${paper.title}"`
    );

    const pr = await ghOpenPR(
      branchName,
      `Authorship claim: ${state.displayName} on "${paper.title}"`,
      `Requested by @${state.ghUser.login} via the lab platform UI.\n\nThis only appends one name to one paper's \`authors\` array and will be auto-validated by the \`validate-authorship-claim\` workflow.`
    );

    toast(`Pull request opened: ${pr.html_url}`);
    window.open(pr.html_url, "_blank");
  } catch (e) {
    toast(e.message, true);
  }
}

// ============================================================================
// Meetings view + check-in
// ============================================================================
function renderMeetings() {
  const list = document.getElementById("meetings-list");
  list.innerHTML = "";
  state.meetings.forEach(m => {
    const card = document.createElement("div");
    card.className = "meeting-card";
    card.innerHTML = `
      <div>
        <h3 class="meeting-card__title">${escapeHtml(m.title)}</h3>
        <div class="meeting-card__meta">${escapeHtml(m.recurring || "")}${m.time ? " · " + escapeHtml(m.time) : ""}</div>
      </div>
    `;
    const actions = document.createElement("div");
    const joinBtn = document.createElement("a");
    joinBtn.href = m.zoomLink; joinBtn.target = "_blank";
    joinBtn.className = "btn btn--ghost btn--small";
    joinBtn.textContent = "Join on Zoom";
    const checkinBtn = document.createElement("button");
    checkinBtn.className = "btn btn--primary btn--small";
    checkinBtn.textContent = "Check in";
    checkinBtn.style.marginLeft = "0.5rem";
    checkinBtn.onclick = () => checkIn(m);
    actions.appendChild(joinBtn);
    actions.appendChild(checkinBtn);
    card.appendChild(actions);
    list.appendChild(card);
  });

  const att = document.getElementById("attendance-list");
  att.innerHTML = "";
  [...state.attendance].reverse().slice(0, 25).forEach(a => {
    const row = document.createElement("div");
    row.className = "attendance-row";
    row.textContent = `${a.timestamp} — ${a.displayName} (@${a.githubUsername}) — ${a.meetingTitle}`;
    att.appendChild(row);
  });
}

async function checkIn(meeting) {
  try {
    const { json: attDoc, sha } = await ghGetFile("data/attendance.json", CONFIG.branch);
    attDoc.checkIns.push({
      meetingId: meeting.id,
      meetingTitle: meeting.title,
      githubUsername: state.ghUser.login,
      displayName: state.displayName,
      timestamp: new Date().toISOString(),
    });
    await ghPutFile(
      "data/attendance.json",
      attDoc,
      sha,
      CONFIG.branch,
      `Check-in: ${state.displayName} — ${meeting.title}`
    );
    toast("Checked in — see you there!");
    state.attendance = attDoc.checkIns;
    renderMeetings();
  } catch (e) {
    toast(e.message, true);
  }
}

// ============================================================================
// Admin view — manage eligibleAuthors per paper
// ============================================================================
function renderAdmin() {
  const grid = document.getElementById("admin-grid");
  grid.innerHTML = "";
  state.papers.forEach(paper => {
    const card = document.createElement("div");
    card.className = "paper-card admin-card";
    card.innerHTML = `<h3 class="paper-card__title">${escapeHtml(paper.title)}</h3>`;
    const editor = document.createElement("div");
    editor.className = "eligible-editor";
    renderEligibleTags(editor, paper);
    card.appendChild(editor);
    grid.appendChild(card);
  });
}

function renderEligibleTags(editor, paper) {
  editor.innerHTML = "";
  (paper.eligibleAuthors || []).forEach(username => {
    const tag = document.createElement("span");
    tag.className = "eligible-tag";
    tag.innerHTML = `@${escapeHtml(username)} `;
    const rm = document.createElement("button");
    rm.textContent = "×";
    rm.title = "Remove";
    rm.onclick = () => updateEligibility(paper, paper.eligibleAuthors.filter(u => u !== username));
    tag.appendChild(rm);
    editor.appendChild(tag);
  });
  const input = document.createElement("input");
  input.className = "eligible-add";
  input.placeholder = "add github-username + Enter";
  input.onkeydown = (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      const username = input.value.trim().replace(/^@/, "");
      updateEligibility(paper, [...(paper.eligibleAuthors || []), username]);
    }
  };
  editor.appendChild(input);
}

async function updateEligibility(paper, newList) {
  try {
    const { json: papersDoc, sha } = await ghGetFile("data/papers.json", CONFIG.branch);
    const target = papersDoc.papers.find(p => p.id === paper.id);
    target.eligibleAuthors = newList;
    await ghPutFile(
      "data/papers.json",
      papersDoc,
      sha,
      CONFIG.branch,
      `Admin: update eligibleAuthors for "${paper.title}"`
    );
    toast("Updated eligible authors.");
    paper.eligibleAuthors = newList;
    renderAdmin();
  } catch (e) {
    toast(e.message, true);
  }
}

// ============================================================================
// Tabs
// ============================================================================
document.getElementById("tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab");
  if (!btn) return;
  document.querySelectorAll(".tab").forEach(t => t.classList.remove("is-active"));
  btn.classList.add("is-active");
  document.querySelectorAll(".view").forEach(v => v.classList.remove("is-active"));
  document.getElementById(`view-${btn.dataset.tab}`).classList.add("is-active");
});

// ============================================================================
// Boot
// ============================================================================
document.getElementById("btn-signin").addEventListener("click", showSignInModal);
document.getElementById("btn-signin-2").addEventListener("click", showSignInModal);

(async function boot() {
  if (state.token) {
    try {
      state.ghUser = await ghGetUser();
      await afterSignIn();
      return;
    } catch {
      localStorage.removeItem("lab_gh_token");
      state.token = null;
    }
  }
  // Not signed in — show read-only-ish gate. (Dashboard still requires
  // sign-in because eligibility/role depends on knowing who's asking.)
})();
