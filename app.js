// ---------- Constants & State ----------
// All kits that exist anywhere in the app. Used whenever there's no
// specific event context (e.g. the Comparison tab and match simulation).
const KITS = ["Sword", "UHC", "DSMP", "Cart", "Spear", "Dia Pot", "Crystal"];

// Champs 1 predates "Dia Pot" and "Crystal", so those two are Champs 2
// exclusives — every other event (including future ones) gets the full
// kit list.
const CHAMPS1_ONLY_KITS = ["Sword", "UHC", "DSMP", "Cart", "Spear"];
function kitsForEvent(event) {
  return event === "Champs 1" ? CHAMPS1_ONLY_KITS : KITS;
}

// Every valid event a match can belong to — shown in the Add Match form's
// Event select, the Players tab's event filter, and as the Bracket tab's
// sub-tabs (one bracket per event).
const EVENTS = ["Champs 1", "Champs 2"];

// Kit values are kept as-is internally (matching stored/legacy data), but
// some kits are shown under a different name in the UI.
const KIT_DISPLAY_NAMES = { Spear: "SpearMace" };
function kitDisplayName(kit) {
  return KIT_DISPLAY_NAMES[kit] || kit;
}

// Single source of truth for every valid match round: matches may only use
// one of these round values (enforced by the round <select> in the Add
// Match form), and each one maps directly to its bracket slots. "section"
// is which part of the bracket it belongs to (upper/lower/grand final),
// used to build the on-screen bracket columns in the right order.
const ROUND_DEFINITIONS = [
  { value: "1", label: "Round 1", section: "upper", slots: ["WB1-1", "WB1-2", "WB1-3", "WB1-4", "WB1-5", "WB1-6", "WB1-7", "WB1-8"] },
  { value: "LB1", label: "Lower Round 1", section: "lower", slots: ["LB1-1", "LB1-2", "LB1-3", "LB1-4"] },
  { value: "2", label: "Round 2", section: "upper", slots: ["WB2-1", "WB2-2", "WB2-3", "WB2-4"] },
  { value: "LB2", label: "Lower Round 2", section: "lower", slots: ["LB2-1", "LB2-2", "LB2-3", "LB2-4"] },
  { value: "3", label: "Upper Semi Final", section: "upper", slots: ["WB3-1", "WB3-2"] },
  { value: "LB3", label: "Lower Round 3", section: "lower", slots: ["LB3-1", "LB3-2"] },
  { value: "LB4", label: "Lower Round 4", section: "lower", slots: ["LB4-1", "LB4-2"] },
  { value: "LB5", label: "Lower Round 5", section: "lower", slots: ["LB5"] },
  { value: "Upper Final", label: "Upper Final", section: "upper", slots: ["WBF"] },
  { value: "Lower Final", label: "Lower Final", section: "lower", slots: ["LBF"] },
  { value: "Grand Final", label: "Grand Final", section: "grandFinal", slots: ["GF"] },
];

const ROUND_LABELS = Object.fromEntries(
  ROUND_DEFINITIONS.map((r) => [r.value, r.label]),
);
function roundLabel(round) {
  return ROUND_LABELS[round] || String(round);
}

// Reverse lookup from a bracket slot id (e.g. "WB1-3") back to the round
// value that slot belongs to — used when clicking an empty bracket slot to
// pre-fill the Add Match form's round.
const SLOT_TO_ROUND = {};
ROUND_DEFINITIONS.forEach((r) => {
  r.slots.forEach((slotId) => {
    SLOT_TO_ROUND[slotId] = r.value;
  });
});

// Chronological order of the double-elimination bracket's rounds, matching
// the "round" value stored on each match. Anything not in this list (e.g. a
// custom/typo'd round name on older data) is sorted after all known rounds.
const ROUND_ORDER = ROUND_DEFINITIONS.map((r) => r.value);

function roundSortIndex(round) {
  const normalized = String(round).trim().toLowerCase();
  const idx = ROUND_ORDER.findIndex((r) => r.toLowerCase() === normalized);
  return idx === -1 ? ROUND_ORDER.length : idx;
}

// Orders matches the way they played out: by round (see ROUND_ORDER), then
// chronologically (oldest first) within a round. Shared by the Match
// History list and the Comparison tab's head-to-head history.
function sortMatchesChronologically(matchList) {
  return [...matchList].sort((a, b) => {
    const ra = roundSortIndex(a.round);
    const rb = roundSortIndex(b.round);
    if (ra !== rb) return ra - rb;
    if (ra === ROUND_ORDER.length) {
      // Unrecognized round labels: group together and sort naturally.
      const cmp = String(a.round).localeCompare(String(b.round), undefined, {
        numeric: true,
        sensitivity: "base",
      });
      if (cmp !== 0) return cmp;
    }
    return a.id < b.id ? -1 : 1;
  });
}

let matches = [];
let pendingGames = null; // games array built by "Set Up Games" before save
let currentEvaluation = null; // { finalGames, winner } once the match has been clinched
let currentPicks = null; // { player1: [kits], player2: [kits], decider } for the in-progress form
let editingMatchId = null; // set while editing an existing match instead of creating a new one

async function fetchMatches() {
  return DataStore.loadMatches();
}

async function createMatchOnServer(payload) {
  const match = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ...payload,
  };
  await DataStore.saveMatches([...matches, match]);
  return match;
}

async function deleteMatchOnServer(id) {
  await DataStore.saveMatches(matches.filter((m) => m.id !== id));
}

async function updateMatchOnServer(id, payload) {
  const updated = { id, ...payload };
  await DataStore.saveMatches(matches.map((m) => (m.id === id ? updated : m)));
  return updated;
}

// ---------- Tab Navigation ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll(".tab-btn")
      .forEach((b) => b.classList.remove("active"));
    document
      .querySelectorAll(".tab-panel")
      .forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "bracket") {
      requestAnimationFrame(drawBracketLines);
    }
  });
});

// ---------- Form Elements ----------
const eventSelect = document.getElementById("match-event");
const roundInput = document.getElementById("match-round");
const formatSelect = document.getElementById("match-format");
const player1Input = document.getElementById("player1-name");
const player2Input = document.getElementById("player2-name");
const pickSection = document.getElementById("pick-section");
const gamesSection = document.getElementById("games-section");
const buildGamesBtn = document.getElementById("build-games-btn");
const saveMatchBtn = document.getElementById("save-match-btn");
const cancelEditBtn = document.getElementById("cancel-edit-btn");
const formHeading = document.getElementById("match-form-heading");
const formError = document.getElementById("form-error");
const matchForm = document.getElementById("match-form");

[eventSelect, formatSelect, player1Input, player2Input].forEach((el) => {
  el.addEventListener("input", () => {
    resetGamesSection();
    renderPickSection();
  });
});

function picksForFormat(format) {
  if (format === "bo5") return { p1: 2, p2: 2 };
  if (format === "grandfinal") return { p1: 3, p2: 1 };
  return { p1: 1, p2: 1 }; // bo3
}

function formatLabel(format) {
  if (format === "bo5") return "Best of 5";
  if (format === "grandfinal") return "Grand Final";
  return "Best of 3";
}

function formatShortLabel(format) {
  if (format === "bo5") return "Bo5";
  if (format === "grandfinal") return "GF";
  return "Bo3";
}

function resetGamesSection() {
  pendingGames = null;
  currentEvaluation = null;
  gamesSection.innerHTML = "";
  saveMatchBtn.disabled = true;
  formError.textContent = "";
}

// ---------- Pick Section ----------
function renderPickSection() {
  const p1 = player1Input.value.trim();
  const p2 = player2Input.value.trim();

  if (!p1 || !p2) {
    pickSection.innerHTML = `<p class="hint">Enter both player names, then choose kit picks below.</p>`;
    return;
  }
  if (p1.toLowerCase() === p2.toLowerCase()) {
    pickSection.innerHTML = `<p class="hint">Player names must be different.</p>`;
    return;
  }

  const picks = picksForFormat(formatSelect.value);

  let html = "";
  html += buildPickGroup("p1", p1, picks.p1);
  html += buildPickGroup("p2", p2, picks.p2);
  html += `<div class="pick-group" id="decider-group">
    <h4>Decider</h4>
    <div class="pick-row" id="decider-row"></div>
  </div>`;

  pickSection.innerHTML = html;

  // attach listeners
  pickSection.querySelectorAll("select.pick-kit").forEach((sel) => {
    sel.addEventListener("change", () => {
      updatePickOptions();
      resetGamesSection();
    });
  });

  updatePickOptions();
}

function buildPickGroup(prefix, playerName, picksEach) {
  const availableKits = kitsForEvent(eventSelect.value);
  let rows = "";
  for (let i = 0; i < picksEach; i++) {
    rows += `<label>Kit pick ${picksEach > 1 ? i + 1 : ""}
      <select class="pick-kit" data-role="${prefix}" id="${prefix}-pick-${i}">
        <option value="">-- choose --</option>
        ${availableKits.map((k) => `<option value="${k}">${kitDisplayName(k)}</option>`).join("")}
      </select>
    </label>`;
  }
  return `<div class="pick-group">
    <h4>${escapeHtml(playerName)}'s picks</h4>
    <div class="pick-row">${rows}</div>
  </div>`;
}

function getAllPickSelects() {
  return Array.from(pickSection.querySelectorAll("select.pick-kit"));
}

function updatePickOptions() {
  const selects = getAllPickSelects();
  const chosenValues = selects.map((s) => s.value).filter(Boolean);

  selects.forEach((sel) => {
    const current = sel.value;
    Array.from(sel.options).forEach((opt) => {
      if (opt.value === "") return;
      const chosenElsewhere =
        chosenValues.includes(opt.value) && opt.value !== current;
      opt.disabled = chosenElsewhere;
    });
  });

  renderDeciderRow(chosenValues);
}

function renderDeciderRow(chosenValues) {
  const remaining = kitsForEvent(eventSelect.value).filter(
    (k) => !chosenValues.includes(k),
  );
  const row = document.getElementById("decider-row");
  if (!row) return;

  if (chosenValues.length === 0 || chosenValues.some((v) => !v)) {
    row.innerHTML = `<span class="hint">Finish selecting kit picks first.</span>`;
    return;
  }

  if (remaining.length === 1) {
    row.innerHTML = `<input type="hidden" id="decider-select" value="${remaining[0]}" />
      <span class="badge decider">${kitDisplayName(remaining[0])}</span>`;
  } else if (remaining.length > 1) {
    row.innerHTML = `<label>Choose decider kit
      <select id="decider-select">
        <option value="">-- choose --</option>
        ${remaining.map((k) => `<option value="${k}">${kitDisplayName(k)}</option>`).join("")}
      </select>
    </label>`;
    document
      .getElementById("decider-select")
      .addEventListener("change", resetGamesSection);
  } else {
    row.innerHTML = `<span class="hint">No kits remaining.</span>`;
  }
}

// Builds the ordered list of games as they are actually played.
// Grand Final is not simply "all of player1's picks, then player2's pick":
// the real play order interleaves player2's single pick between player1's
// second and third picks: P1 pick1, P1 pick2, P2 pick1, P1 pick3, Decider.
function buildPlayOrder(format, p1Picks, p2Picks, decider) {
  let picks;
  if (format === "grandfinal") {
    picks = [
      { kit: p1Picks[0], pickedBy: "player1" },
      { kit: p1Picks[1], pickedBy: "player1" },
      { kit: p2Picks[0], pickedBy: "player2" },
      { kit: p1Picks[2], pickedBy: "player1" },
    ];
  } else {
    picks = [
      ...p1Picks.map((kit) => ({ kit, pickedBy: "player1" })),
      ...p2Picks.map((kit) => ({ kit, pickedBy: "player2" })),
    ];
  }
  picks.push({ kit: decider, pickedBy: "decider" });
  return picks;
}

// ---------- Build Games ----------
buildGamesBtn.addEventListener("click", () => {
  formError.textContent = "";
  const p1 = player1Input.value.trim();
  const p2 = player2Input.value.trim();

  if (!p1 || !p2 || p1.toLowerCase() === p2.toLowerCase()) {
    formError.textContent = "Enter two different player names.";
    return;
  }

  const p1Picks = Array.from(
    pickSection.querySelectorAll('select[data-role="p1"]'),
  ).map((s) => s.value);
  const p2Picks = Array.from(
    pickSection.querySelectorAll('select[data-role="p2"]'),
  ).map((s) => s.value);
  const deciderEl = document.getElementById("decider-select");
  const decider = deciderEl ? deciderEl.value : "";

  if (p1Picks.some((v) => !v) || p2Picks.some((v) => !v) || !decider) {
    formError.textContent =
      "Please complete all kit pick selections and the decider.";
    return;
  }

  const games = buildPlayOrder(formatSelect.value, p1Picks, p2Picks, decider);

  currentPicks = { player1: p1Picks, player2: p2Picks, decider };
  pendingGames = games;
  renderGamesSection(games, p1, p2);
});

function renderGamesSection(games, p1, p2) {
  const rows = games
    .map((g, idx) => {
      const label =
        g.pickedBy === "player1"
          ? `Picked by ${escapeHtml(p1)}`
          : g.pickedBy === "player2"
            ? `Picked by ${escapeHtml(p2)}`
            : "Decider";
      const badgeClass = g.pickedBy === "decider" ? "badge decider" : "badge";
      return `<div class="game-container" data-idx="${idx}">
        <div class="game-row">
          <div class="kit-name">${kitDisplayName(g.kit)}</div>
          <div class="picked-by"><span class="${badgeClass}">${label}</span></div>
          <input type="number" min="0" class="score-input" data-idx="${idx}" data-player="1" placeholder="${escapeHtml(p1)} score" />
          <input type="number" min="0" class="score-input" data-idx="${idx}" data-player="2" placeholder="${escapeHtml(p2)} score" />
        </div>
        <div class="game-note" data-note-idx="${idx}"></div>
      </div>`;
    })
    .join("");

  gamesSection.innerHTML = `<h4>Enter scores for each kit, in order played</h4>${rows}<div id="match-progress" class="match-progress"></div>`;

  gamesSection.querySelectorAll(".score-input").forEach((input) => {
    input.addEventListener("input", updateGameProgress);
  });

  updateGameProgress();
}

// Walks the games in play order, locking games that haven't been reached yet
// and marking any games after the match has been clinched (majority of kit
// wins reached) as not needed — e.g. the decider in a Bo5 that ends 3-0 or 3-1.
function updateGameProgress() {
  if (!pendingGames) return;
  const totalGames = pendingGames.length;
  const threshold = Math.ceil(totalGames / 2);
  const p1Name = player1Input.value.trim() || "Player 1";
  const p2Name = player2Input.value.trim() || "Player 2";

  let p1Wins = 0;
  let p2Wins = 0;
  let decided = false;
  const finalGames = [];

  for (let idx = 0; idx < totalGames; idx++) {
    const gameRow = gamesSection.querySelector(
      `.game-container[data-idx="${idx}"] .game-row`,
    );
    const note = gamesSection.querySelector(
      `.game-note[data-note-idx="${idx}"]`,
    );
    const s1El = gamesSection.querySelector(
      `.score-input[data-idx="${idx}"][data-player="1"]`,
    );
    const s2El = gamesSection.querySelector(
      `.score-input[data-idx="${idx}"][data-player="2"]`,
    );

    if (decided) {
      gameRow.classList.remove("pending");
      gameRow.classList.add("skipped");
      s1El.disabled = true;
      s2El.disabled = true;
      s1El.value = "";
      s2El.value = "";
      note.textContent = "Not needed — match already decided.";
      continue;
    }

    gameRow.classList.remove("skipped", "pending");
    s1El.disabled = false;
    s2El.disabled = false;

    const v1 = s1El.value;
    const v2 = s2El.value;
    const bothFilled =
      v1 !== "" && v2 !== "" && !isNaN(Number(v1)) && !isNaN(Number(v2));

    if (!bothFilled) {
      note.textContent = "";
      lockRemaining(idx + 1, totalGames);
      break;
    }

    if (Number(v1) < 0 || Number(v2) < 0) {
      note.textContent = "Scores cannot be negative.";
      lockRemaining(idx + 1, totalGames);
      break;
    }

    if (Number(v1) === Number(v2)) {
      note.textContent = "Scores cannot be tied — one player must win the kit.";
      lockRemaining(idx + 1, totalGames);
      break;
    }

    note.textContent = "";
    const winner = Number(v1) > Number(v2) ? "player1" : "player2";
    finalGames.push({
      kit: pendingGames[idx].kit,
      pickedBy: pendingGames[idx].pickedBy,
      score1: Number(v1),
      score2: Number(v2),
      winner,
    });
    winner === "player1" ? p1Wins++ : p2Wins++;

    if (p1Wins === threshold || p2Wins === threshold) {
      decided = true;
    }
  }

  renderMatchProgress(p1Name, p2Name, p1Wins, p2Wins, decided);

  if (decided) {
    currentEvaluation = {
      finalGames,
      winner: p1Wins > p2Wins ? "player1" : "player2",
    };
    saveMatchBtn.disabled = false;
  } else {
    currentEvaluation = null;
    saveMatchBtn.disabled = true;
  }
}

function lockRemaining(fromIdx, totalGames) {
  for (let j = fromIdx; j < totalGames; j++) {
    const gameRow = gamesSection.querySelector(
      `.game-container[data-idx="${j}"] .game-row`,
    );
    const note = gamesSection.querySelector(`.game-note[data-note-idx="${j}"]`);
    const s1El = gamesSection.querySelector(
      `.score-input[data-idx="${j}"][data-player="1"]`,
    );
    const s2El = gamesSection.querySelector(
      `.score-input[data-idx="${j}"][data-player="2"]`,
    );
    gameRow.classList.remove("skipped");
    gameRow.classList.add("pending");
    s1El.disabled = true;
    s2El.disabled = true;
    note.textContent = "Enter the previous kit's score first.";
  }
}

function renderMatchProgress(p1Name, p2Name, p1Wins, p2Wins, decided) {
  const el = document.getElementById("match-progress");
  if (!el) return;
  const clinchText = decided
    ? ` — ${p1Wins > p2Wins ? escapeHtml(p1Name) : escapeHtml(p2Name)} has clinched the match!`
    : "";
  el.innerHTML = `Current score: <strong>${escapeHtml(p1Name)} ${p1Wins} - ${p2Wins} ${escapeHtml(p2Name)}</strong>${clinchText}`;
}

// ---------- Save Match ----------
matchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";

  if (!pendingGames || !currentEvaluation) {
    formError.textContent =
      "Enter scores until one player has clinched the match before saving.";
    return;
  }

  const round = roundInput.value.trim();
  if (!round) {
    formError.textContent = "Choose a round.";
    return;
  }

  const p1 = player1Input.value.trim();
  const p2 = player2Input.value.trim();
  const format = formatSelect.value;
  const event = eventSelect.value;

  const matchPayload = {
    event,
    round,
    format,
    player1: p1,
    player2: p2,
    picks: currentPicks,
    games: currentEvaluation.finalGames,
    winner: currentEvaluation.winner,
  };

  saveMatchBtn.disabled = true;
  try {
    let savedMatch;
    if (editingMatchId) {
      savedMatch = await updateMatchOnServer(editingMatchId, matchPayload);
      matches = matches.map((m) => (m.id === savedMatch.id ? savedMatch : m));
    } else {
      savedMatch = await createMatchOnServer(matchPayload);
      matches.push(savedMatch);
    }

    exitEditMode();
    matchForm.reset();
    resetGamesSection();
    renderPickSection();
    renderAll();
    document.querySelector('.tab-btn[data-tab="history"]')?.click();
  } catch (err) {
    console.error(err);
    formError.textContent = err.message || "Failed to save match.";
    saveMatchBtn.disabled = false;
  }
});

function exitEditMode() {
  editingMatchId = null;
  currentPicks = null;
  formHeading.textContent = "Add New Match";
  saveMatchBtn.textContent = "Save Match";
  cancelEditBtn.hidden = true;
}

cancelEditBtn.addEventListener("click", () => {
  exitEditMode();
  matchForm.reset();
  resetGamesSection();
  renderPickSection();
  document.querySelector('.tab-btn[data-tab="history"]')?.click();
});

function startEditMatch(id) {
  const match = matches.find((m) => m.id === id);
  if (!match) return;

  editingMatchId = id;

  eventSelect.value = match.event || "Champs 1";
  roundInput.value = match.round;
  formatSelect.value = match.format;
  player1Input.value = match.player1;
  player2Input.value = match.player2;

  renderPickSection();

  const p1Kits = match.picks
    ? match.picks.player1
    : match.games.filter((g) => g.pickedBy === "player1").map((g) => g.kit);
  const p2Kits = match.picks
    ? match.picks.player2
    : match.games.filter((g) => g.pickedBy === "player2").map((g) => g.kit);
  const deciderKit = match.picks
    ? match.picks.decider
    : (match.games.find((g) => g.pickedBy === "decider") || {}).kit;

  p1Kits.forEach((kit, i) => {
    const sel = document.getElementById(`p1-pick-${i}`);
    if (sel) sel.value = kit;
  });
  p2Kits.forEach((kit, i) => {
    const sel = document.getElementById(`p2-pick-${i}`);
    if (sel) sel.value = kit;
  });

  updatePickOptions();

  const deciderEl = document.getElementById("decider-select");
  if (deciderEl && deciderKit) deciderEl.value = deciderKit;

  currentPicks = { player1: p1Kits, player2: p2Kits, decider: deciderKit };
  pendingGames = buildPlayOrder(match.format, p1Kits, p2Kits, deciderKit);

  renderGamesSection(pendingGames, match.player1, match.player2);

  pendingGames.forEach((pg, idx) => {
    const playedGame = match.games.find((g) => g.kit === pg.kit);
    if (!playedGame) return;
    const s1 = gamesSection.querySelector(
      `.score-input[data-idx="${idx}"][data-player="1"]`,
    );
    const s2 = gamesSection.querySelector(
      `.score-input[data-idx="${idx}"][data-player="2"]`,
    );
    if (s1) s1.value = playedGame.score1;
    if (s2) s2.value = playedGame.score2;
  });

  updateGameProgress();

  formHeading.textContent = "Edit Match";
  saveMatchBtn.textContent = "Update Match";
  cancelEditBtn.hidden = false;

  document.querySelector('.tab-btn[data-tab="add-match"]')?.click();
  matchForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Match List ----------
const historyEventFilter = document.getElementById("history-event-filter");

// Populates the event filter with "All Events" plus every known event.
// Called once from init() — the event list is static, so this never
// needs to re-run.
function renderHistoryEventFilterOptions() {
  if (!historyEventFilter) return;
  historyEventFilter.innerHTML =
    `<option value="all">All Events</option>` +
    EVENTS.map(
      (ev) => `<option value="${escapeHtml(ev)}">${escapeHtml(ev)}</option>`,
    ).join("");
}

historyEventFilter.addEventListener("change", renderMatchList);

function renderMatchList() {
  const container = document.getElementById("match-list");

  const eventFilter = historyEventFilter ? historyEventFilter.value : "all";
  const filteredMatches =
    eventFilter === "all"
      ? matches
      : matches.filter((m) => (m.event || "Champs 1") === eventFilter);

  if (filteredMatches.length === 0) {
    const eventNote =
      eventFilter === "all" ? "" : ` for ${escapeHtml(eventFilter)}`;
    container.innerHTML = `<p class="empty-state">No matches recorded yet${eventNote}.</p>`;
    return;
  }

  const sorted = sortMatchesChronologically(filteredMatches);

  container.innerHTML = sorted
    .map((m) => {
      const p1Wins = m.games.filter((g) => g.winner === "player1").length;
      const p2Wins = m.games.filter((g) => g.winner === "player2").length;
      const winnerName = m.winner === "player1" ? m.player1 : m.player2;

      const gamesHtml = m.games
        .map((g) => {
          const pickerLabel =
            g.pickedBy === "player1"
              ? m.player1
              : g.pickedBy === "player2"
                ? m.player2
                : "Decider";
          const badgeClass =
            g.pickedBy === "decider" ? "badge decider" : "badge";
          const gameWinnerName = g.winner === "player1" ? m.player1 : m.player2;
          return `<div class="game-line">
            <span>${kitDisplayName(g.kit)} <span class="${badgeClass}">${escapeHtml(pickerLabel)}</span></span>
            <span>${g.score1} - ${g.score2} <strong>(${escapeHtml(gameWinnerName)})</strong></span>
          </div>`;
        })
        .join("");

      return `<div class="match-card" data-id="${m.id}">
        <div class="match-card-header">
          <div>
            <div class="match-title">
              <span class="${m.winner === "player1" ? "win" : ""}">${escapeHtml(m.player1)}</span>
              vs
              <span class="${m.winner === "player2" ? "win" : ""}">${escapeHtml(m.player2)}</span>
              &nbsp;(${p1Wins}-${p2Wins})
            </div>
            <div class="match-sub">${escapeHtml(m.event || "Champs 1")} • ${escapeHtml(roundLabel(m.round))} • ${formatLabel(m.format)} • Winner: ${escapeHtml(winnerName)}</div>
          </div>
          <div class="match-card-actions">
            <button class="secondary edit-btn" data-edit="${m.id}">Edit</button>
            <button class="delete-btn" data-delete="${m.id}">Delete</button>
          </div>
        </div>
        <div class="match-card-body">${gamesHtml}</div>
      </div>`;
    })
    .join("");

  container.querySelectorAll(".match-card-header").forEach((header) => {
    header.addEventListener("click", (e) => {
      if (e.target.closest(".delete-btn") || e.target.closest(".edit-btn"))
        return;
      header.parentElement
        .querySelector(".match-card-body")
        .classList.toggle("open");
    });
  });

  container.querySelectorAll("[data-delete]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.delete;
      if (!confirm("Delete this match? This cannot be undone.")) return;
      try {
        await deleteMatchOnServer(id);
        matches = matches.filter((m) => m.id !== id);
        renderAll();
      } catch (err) {
        console.error(err);
        alert(err.message || "Failed to delete match.");
      }
    });
  });

  container.querySelectorAll("[data-edit]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      startEditMatch(btn.dataset.edit);
    });
  });
}

// ---------- Players Tab ----------
const playerSelect = document.getElementById("player-select");
const playerEventFilter = document.getElementById("player-event-filter");

// Populates the event filter with "All Events" plus every known event
// (EVENTS, defined later alongside the Bracket tab). Called once from
// init() — the event list is static, so this never needs to re-run.
function renderPlayerEventFilterOptions() {
  if (!playerEventFilter) return;
  playerEventFilter.innerHTML =
    `<option value="all">All Events</option>` +
    EVENTS.map(
      (ev) => `<option value="${escapeHtml(ev)}">${escapeHtml(ev)}</option>`,
    ).join("");
}

playerEventFilter.addEventListener("change", () => {
  renderPlayerDetails(playerSelect.value);
});

function getAllPlayerNames() {
  const names = new Set();
  matches.forEach((m) => {
    names.add(m.player1);
    names.add(m.player2);
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
}

// Shared stat computation used by the Players tab and the Comparison tab.
function computePlayerStats(name) {
  const kitOverallStats = {}; // kit -> { played, won } — every game this player played on that kit
  const kitPickStats = {}; // kit -> { picked, won } — only games this player personally picked
  KITS.forEach((k) => {
    kitOverallStats[k] = { played: 0, won: 0 };
    kitPickStats[k] = { picked: 0, won: 0 };
  });

  let wins = 0;
  let losses = 0;
  const playerMatches = matches.filter(
    (m) => m.player1 === name || m.player2 === name,
  );

  playerMatches.forEach((m) => {
    const isP1 = m.player1 === name;
    const myRole = isP1 ? "player1" : "player2";
    if (m.winner === myRole) wins++;
    else losses++;

    m.games.forEach((g) => {
      if (!kitOverallStats[g.kit]) return; // skip unrecognized/legacy kit values
      kitOverallStats[g.kit].played++;
      if (g.winner === myRole) kitOverallStats[g.kit].won++;
      if (g.pickedBy === myRole) {
        kitPickStats[g.kit].picked++;
        if (g.winner === myRole) kitPickStats[g.kit].won++;
      }
    });
  });

  const matchesPlayed = playerMatches.length;
  const winRate = matchesPlayed ? Math.round((wins / matchesPlayed) * 100) : 0;

  return {
    name,
    matchesPlayed,
    wins,
    losses,
    winRate,
    kitOverallStats,
    kitPickStats,
  };
}

function renderPlayerDropdowns() {
  const names = getAllPlayerNames();
  const previousValue = playerSelect.value;

  playerSelect.innerHTML =
    `<option value="">-- Choose a player --</option>` +
    names
      .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
      .join("");

  if (names.includes(previousValue)) {
    playerSelect.value = previousValue;
  }

  // datalist for match form
  const datalist = document.getElementById("player-names");
  datalist.innerHTML = names
    .map((n) => `<option value="${escapeHtml(n)}"></option>`)
    .join("");
}

playerSelect.addEventListener("change", () => {
  renderPlayerDetails(playerSelect.value);
});

function renderPlayerDetails(name) {
  const container = document.getElementById("player-details");
  if (!name) {
    container.innerHTML = "";
    return;
  }

  const eventFilter = playerEventFilter ? playerEventFilter.value : "all";
  const playerMatches = matches.filter(
    (m) =>
      (m.player1 === name || m.player2 === name) &&
      (eventFilter === "all" || (m.event || "Champs 1") === eventFilter),
  );

  if (playerMatches.length === 0) {
    const eventNote =
      eventFilter === "all" ? "" : ` in ${escapeHtml(eventFilter)}`;
    container.innerHTML = `<p class="empty-state">No matches found for this player${eventNote}.</p>`;
    return;
  }

  let wins = 0;
  let losses = 0;
  const kitsInScope = kitsForEvent(eventFilter);
  const kitPickStats = {}; // kit -> { picked: n, won: n } — only games this player personally picked
  const kitOverallStats = {}; // kit -> { played: n, won: n } — every game this player played on that kit
  kitsInScope.forEach((k) => {
    kitPickStats[k] = { picked: 0, won: 0 };
    kitOverallStats[k] = { played: 0, won: 0 };
  });

  const matchRows = playerMatches
    .map((m) => {
      const isP1 = m.player1 === name;
      const opponent = isP1 ? m.player2 : m.player1;
      const myRole = isP1 ? "player1" : "player2";
      const won = m.winner === myRole;
      won ? wins++ : losses++;

      const myKitWins = m.games.filter((g) => g.winner === myRole).length;
      const oppKitWins = m.games.length - myKitWins;

      m.games.forEach((g) => {
        if (!kitOverallStats[g.kit]) return; // skip unrecognized/legacy kit values
        kitOverallStats[g.kit].played++;
        if (g.winner === myRole) kitOverallStats[g.kit].won++;

        if (g.pickedBy === myRole) {
          kitPickStats[g.kit].picked++;
          if (g.winner === myRole) kitPickStats[g.kit].won++;
        }
      });

      const gameLines = m.games
        .map((g) => {
          const pickerLabel =
            g.pickedBy === "decider"
              ? "Decider"
              : g.pickedBy === myRole
                ? escapeHtml(name)
                : escapeHtml(opponent);
          const badgeClass =
            g.pickedBy === "decider" ? "badge decider" : "badge";
          const myScore = isP1 ? g.score1 : g.score2;
          const oppScore = isP1 ? g.score2 : g.score1;
          const gameWon = g.winner === myRole;
          return `<div class="game-line">
            <span>${kitDisplayName(g.kit)} <span class="${badgeClass}">${pickerLabel}</span></span>
            <span>${myScore} - ${oppScore} <strong class="${gameWon ? "win" : "loss"}">(${gameWon ? "WIN" : "LOSS"})</strong></span>
          </div>`;
        })
        .join("");

      return `<tr class="match-history-row" data-history-id="${m.id}">
        ${eventFilter === "all" ? `<td>${escapeHtml(m.event || "Champs 1")}</td>` : ""}
        <td>${escapeHtml(roundLabel(m.round))}</td>
        <td>${escapeHtml(opponent)}</td>
        <td>${formatShortLabel(m.format)}</td>
        <td><span class="result-pill ${won ? "win" : "loss"}">${won ? "WIN" : "LOSS"}</span></td>
        <td>${myKitWins} - ${oppKitWins}</td>
      </tr>
      <tr class="match-history-detail" data-detail-for="${m.id}">
        <td colspan="${eventFilter === "all" ? 6 : 5}">${gameLines}</td>
      </tr>`;
    })
    .join("");

  const winRate = playerMatches.length
    ? Math.round((wins / playerMatches.length) * 100)
    : 0;

  const kitRows = kitsInScope.map((k) => {
    const stat = kitPickStats[k];
    const rate = stat.picked ? Math.round((stat.won / stat.picked) * 100) : 0;
    return `<tr>
      <td>${kitDisplayName(k)}</td>
      <td>${stat.picked}</td>
      <td>${stat.won}</td>
      <td>${stat.picked ? rate + "%" : "—"}</td>
    </tr>`;
  }).join("");

  const kitOverallRows = kitsInScope.map((k) => {
    const stat = kitOverallStats[k];
    const rate = stat.played ? Math.round((stat.won / stat.played) * 100) : 0;
    return `<tr>
      <td>${kitDisplayName(k)}</td>
      <td>${stat.played}</td>
      <td>${stat.won}</td>
      <td>${stat.played ? rate + "%" : "—"}</td>
    </tr>`;
  }).join("");

  container.innerHTML = `
    <div class="stat-cards">
      <div class="stat-box"><div class="value">${playerMatches.length}</div><div class="label">Matches</div></div>
      <div class="stat-box"><div class="value">${wins}</div><div class="label">Wins</div></div>
      <div class="stat-box"><div class="value">${losses}</div><div class="label">Losses</div></div>
      <div class="stat-box"><div class="value">${winRate}%</div><div class="label">Win Rate</div></div>
    </div>

    <h3>Overall Win Rate by Kit</h3>
    <table>
      <thead><tr><th>Kit</th><th>Games Played</th><th>Games Won</th><th>Win Rate</th></tr></thead>
      <tbody>${kitOverallRows}</tbody>
    </table>

    <h3>Kit Picks by ${escapeHtml(name)}</h3>
    <table>
      <thead><tr><th>Kit</th><th>Times Picked</th><th>Times Won</th><th>Win Rate</th></tr></thead>
      <tbody>${kitRows}</tbody>
    </table>

    <h3>Match History</h3>
    <table>
      <thead><tr>${eventFilter === "all" ? "<th>Event</th>" : ""}<th>Round</th><th>Opponent</th><th>Format</th><th>Result</th><th>Kit Score</th></tr></thead>
      <tbody>${matchRows}</tbody>
    </table>
  `;

  container.querySelectorAll(".match-history-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.historyId;
      const detail = container.querySelector(
        `.match-history-detail[data-detail-for="${id}"]`,
      );
      if (detail) detail.classList.toggle("open");
    });
  });
}

// ---------- Kits Tab ----------
const kitEventFilter = document.getElementById("kit-event-filter");

// Populates the event filter with "All Events" plus every known event.
// Called once from init() — the event list is static, so this never
// needs to re-run.
function renderKitEventFilterOptions() {
  if (!kitEventFilter) return;
  kitEventFilter.innerHTML =
    `<option value="all">All Events</option>` +
    EVENTS.map(
      (ev) => `<option value="${escapeHtml(ev)}">${escapeHtml(ev)}</option>`,
    ).join("");
}

kitEventFilter.addEventListener("change", renderKitStats);

function renderKitStats() {
  const container = document.getElementById("kit-stats");

  const eventFilter = kitEventFilter ? kitEventFilter.value : "all";
  const filteredMatches =
    eventFilter === "all"
      ? matches
      : matches.filter((m) => (m.event || "Champs 1") === eventFilter);

  if (filteredMatches.length === 0) {
    const eventNote =
      eventFilter === "all" ? "" : ` for ${escapeHtml(eventFilter)}`;
    container.innerHTML = `<p class="empty-state">No matches recorded yet${eventNote}.</p>`;
    return;
  }

  const kitsInScope = kitsForEvent(eventFilter);
  const stats = {};
  kitsInScope.forEach(
    (k) =>
      (stats[k] = {
        totalGames: 0,
        deciderCount: 0,
        pickerWins: 0,
        pickerGames: 0,
        pickers: {},
      }),
  );

  filteredMatches.forEach((m) => {
    m.games.forEach((g) => {
      const s = stats[g.kit];
      if (!s) return; // skip unrecognized/legacy kit values
      s.totalGames++;
      if (g.pickedBy === "decider") {
        s.deciderCount++;
      } else {
        const pickerName = g.pickedBy === "player1" ? m.player1 : m.player2;
        s.pickers[pickerName] = (s.pickers[pickerName] || 0) + 1;
        s.pickerGames++;
        if (g.winner === g.pickedBy) s.pickerWins++;
      }
    });
  });

  container.innerHTML =
    `<div class="kit-grid">` +
    kitsInScope.map((k) => {
      const s = stats[k];
      const pickerWinRate = s.pickerGames
        ? Math.round((s.pickerWins / s.pickerGames) * 100)
        : 0;
      const pickersSorted = Object.entries(s.pickers).sort(
        (a, b) => b[1] - a[1],
      );
      const pickersHtml = pickersSorted.length
        ? pickersSorted
            .map(
              ([name, count]) =>
                `<div class="picker-row"><span>${escapeHtml(name)}</span><span>${count}x</span></div>`,
            )
            .join("")
        : `<div class="picker-row"><span class="empty-state">Never picked</span></div>`;

      return `<div class="kit-card">
        <h3>${kitDisplayName(k)}</h3>
        <div class="row"><span>Total games played</span><span>${s.totalGames}</span></div>
        <div class="row"><span>Times picked (by a player)</span><span>${s.pickerGames}</span></div>
        <div class="row"><span>Times used as decider</span><span>${s.deciderCount}</span></div>
        <div class="row"><span>Picker win rate</span><span>${s.pickerGames ? pickerWinRate + "%" : "—"}</span></div>
        <div class="picker-list">
          <strong>Picked by:</strong>
          ${pickersHtml}
        </div>
      </div>`;
    }).join("") +
    `</div>`;
}

// ---------- Comparison Tab ----------
const comparePlayer1Select = document.getElementById("compare-player1-select");
const comparePlayer2Select = document.getElementById("compare-player2-select");
const simulateFormatSelect = document.getElementById("simulate-format");
const simulateMatchBtn = document.getElementById("simulate-match-btn");

function renderComparisonDropdowns() {
  const names = getAllPlayerNames();
  const options =
    `<option value="">-- Choose a player --</option>` +
    names
      .map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`)
      .join("");

  [comparePlayer1Select, comparePlayer2Select].forEach((sel) => {
    const previousValue = sel.value;
    sel.innerHTML = options;
    if (names.includes(previousValue)) sel.value = previousValue;
  });
}

comparePlayer1Select.addEventListener("change", renderComparisonStats);
comparePlayer2Select.addEventListener("change", renderComparisonStats);

// Win-rate estimate with Bayesian smoothing towards 50%, so kits/players with
// little or no data aren't treated as guaranteed wins or losses.
function smoothedRate(won, total, priorWeight = 2) {
  return (won + priorWeight * 0.5) / (total + priorWeight);
}

function statBlockHtml(stats) {
  const kitRows = KITS.map((k) => {
    const overall = stats.kitOverallStats[k];
    const rate = overall.played
      ? Math.round((overall.won / overall.played) * 100)
      : 0;
    return `<tr>
      <td>${kitDisplayName(k)}</td>
      <td>${overall.played}</td>
      <td>${overall.played ? rate + "%" : "—"}</td>
    </tr>`;
  }).join("");

  return `
    <div class="stat-cards">
      <div class="stat-box"><div class="value">${stats.matchesPlayed}</div><div class="label">Matches</div></div>
      <div class="stat-box"><div class="value">${stats.wins}</div><div class="label">Wins</div></div>
      <div class="stat-box"><div class="value">${stats.losses}</div><div class="label">Losses</div></div>
      <div class="stat-box"><div class="value">${stats.winRate}%</div><div class="label">Win Rate</div></div>
    </div>
    <table>
      <thead><tr><th>Kit</th><th>Played</th><th>Win Rate</th></tr></thead>
      <tbody>${kitRows}</tbody>
    </table>
  `;
}

// Builds the head-to-head record + match history between two players,
// shown first on the Comparison tab. Returns a friendly empty state if
// they've never played each other.
// Finds every match directly between two players, in chronological order,
// along with each one's win count. Shared by the head-to-head display and
// the match simulation (which factors this record into its prediction).
function computeHeadToHead(nameA, nameB) {
  const headToHeadMatches = matches.filter(
    (m) =>
      (m.player1 === nameA && m.player2 === nameB) ||
      (m.player1 === nameB && m.player2 === nameA),
  );
  const sorted = sortMatchesChronologically(headToHeadMatches);

  let winsA = 0;
  let winsB = 0;
  sorted.forEach((m) => {
    const winnerName = m.winner === "player1" ? m.player1 : m.player2;
    winnerName === nameA ? winsA++ : winsB++;
  });

  return { matches: sorted, winsA, winsB };
}

function headToHeadHtml(nameA, nameB) {
  const { matches: sorted, winsA, winsB } = computeHeadToHead(nameA, nameB);

  if (sorted.length === 0) {
    return `<div class="head-to-head">
      <h3>Head-to-Head</h3>
      <p class="empty-state">${escapeHtml(nameA)} and ${escapeHtml(nameB)} haven't played each other yet.</p>
    </div>`;
  }

  const rows = sorted
    .map((m) => {
      const isAP1 = m.player1 === nameA;
      const myRole = isAP1 ? "player1" : "player2";
      const winnerName = m.winner === "player1" ? m.player1 : m.player2;

      const aKitWins = m.games.filter((g) => g.winner === myRole).length;
      const bKitWins = m.games.length - aKitWins;

      const gameLines = m.games
        .map((g) => {
          const pickerLabel =
            g.pickedBy === "decider"
              ? "Decider"
              : g.pickedBy === myRole
                ? nameA
                : nameB;
          const badgeClass =
            g.pickedBy === "decider" ? "badge decider" : "badge";
          const gameWinnerName =
            g.winner === "player1" ? m.player1 : m.player2;
          return `<div class="game-line">
            <span>${kitDisplayName(g.kit)} <span class="${badgeClass}">${escapeHtml(pickerLabel)}</span></span>
            <span>${g.score1} - ${g.score2} <strong>(${escapeHtml(gameWinnerName)})</strong></span>
          </div>`;
        })
        .join("");

      return `<tr class="match-history-row" data-history-id="${m.id}">
        <td>${escapeHtml(m.event || "Champs 1")}</td>
        <td>${escapeHtml(roundLabel(m.round))}</td>
        <td>${formatShortLabel(m.format)}</td>
        <td><strong class="${winnerName === nameA ? "win" : ""}">${escapeHtml(winnerName)}</strong></td>
        <td>${aKitWins} - ${bKitWins}</td>
      </tr>
      <tr class="match-history-detail" data-detail-for="${m.id}">
        <td colspan="5">${gameLines}</td>
      </tr>`;
    })
    .join("");

  return `<div class="head-to-head">
    <h3>Head-to-Head</h3>
    <div class="stat-cards">
      <div class="stat-box"><div class="value">${sorted.length}</div><div class="label">Matches</div></div>
      <div class="stat-box"><div class="value">${winsA}</div><div class="label">${escapeHtml(nameA)} Wins</div></div>
      <div class="stat-box"><div class="value">${winsB}</div><div class="label">${escapeHtml(nameB)} Wins</div></div>
    </div>
    <table>
      <thead><tr><th>Event</th><th>Round</th><th>Format</th><th>Winner</th><th>Kit Score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

function renderComparisonStats() {
  const container = document.getElementById("comparison-stats");
  const nameA = comparePlayer1Select.value;
  const nameB = comparePlayer2Select.value;

  if (!nameA || !nameB) {
    container.innerHTML = `<p class="empty-state">Choose two players to compare their stats.</p>`;
    return;
  }
  if (nameA === nameB) {
    container.innerHTML = `<p class="empty-state">Choose two different players.</p>`;
    return;
  }

  const statsA = computePlayerStats(nameA);
  const statsB = computePlayerStats(nameB);

  container.innerHTML = `
    ${headToHeadHtml(nameA, nameB)}
    <div class="comparison-columns">
      <div>
        <h3>${escapeHtml(nameA)}</h3>
        ${statBlockHtml(statsA)}
      </div>
      <div>
        <h3>${escapeHtml(nameB)}</h3>
        ${statBlockHtml(statsB)}
      </div>
    </div>
  `;

  container.querySelectorAll(".match-history-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.historyId;
      const detail = container.querySelector(
        `.match-history-detail[data-detail-for="${id}"]`,
      );
      if (detail) detail.classList.toggle("open");
    });
  });
}

// Weights a round by how far into the bracket it is — Round 1 counts
// least, Grand Final counts most — so later-round results carry more
// signal for how reliable a player is "when it matters".
function roundStageWeight(round) {
  return 1 + roundSortIndex(round);
}

// A player's win rate across all their matches, weighted so wins (and
// losses) in later rounds count more heavily. Used as a proxy for how
// reliable a player is in high-stakes, later-round games.
function clutchScore(name) {
  const playerMatches = matches.filter(
    (m) => m.player1 === name || m.player2 === name,
  );
  let weightedWins = 0;
  let weightedTotal = 0;
  playerMatches.forEach((m) => {
    const myRole = m.player1 === name ? "player1" : "player2";
    const weight = roundStageWeight(m.round);
    weightedTotal += weight;
    if (m.winner === myRole) weightedWins += weight;
  });
  return smoothedRate(weightedWins, weightedTotal, 3);
}

// Predicts which kit a player is most likely to ban, before any picks are
// made: either their own worst-performing kit (to avoid being forced onto
// it later) or whichever remaining kit their opponent performs best on (to
// deny them their strongest option) — whichever represents the bigger
// swing away from a 50/50 kit, based on each player's win rates.
function predictBan(myStats, oppStats, bannedSet) {
  const candidates = KITS.filter((k) => !bannedSet.has(k));
  if (candidates.length === 0) return null;

  let oppBestKit = candidates[0];
  let oppBestRate = -Infinity;
  let myWorstKit = candidates[0];
  let myWorstRate = Infinity;

  candidates.forEach((k) => {
    const oppRate = smoothedRate(
      oppStats.kitOverallStats[k].won,
      oppStats.kitOverallStats[k].played,
      2,
    );
    if (oppRate > oppBestRate) {
      oppBestRate = oppRate;
      oppBestKit = k;
    }
    const myRate = smoothedRate(
      myStats.kitOverallStats[k].won,
      myStats.kitOverallStats[k].played,
      2,
    );
    if (myRate < myWorstRate) {
      myWorstRate = myRate;
      myWorstKit = k;
    }
  });

  const oppThreat = oppBestRate - 0.5; // how dangerous the opponent's best kit is
  const ownWeakness = 0.5 - myWorstRate; // how costly this player's worst kit is

  if (oppThreat >= ownWeakness) {
    return {
      kit: oppBestKit,
      reason: "opponent's strongest kit",
      rate: oppBestRate,
    };
  }
  return { kit: myWorstKit, reason: "their own weakest kit", rate: myWorstRate };
}

// Ranks a player's kits from most to least likely to be picked, based on
// their personal pick history (win rate when they picked it), falling back
// to their overall performance on kits they haven't picked before.
function predictPicks(stats, count, excludeSet) {
  const candidates = KITS.filter((k) => !excludeSet.has(k));
  const ranked = candidates
    .map((k) => {
      const pick = stats.kitPickStats[k];
      const overall = stats.kitOverallStats[k];
      const score = pick.picked
        ? smoothedRate(pick.won, pick.picked, 1) +
          Math.min(pick.picked, 5) * 0.01
        : smoothedRate(overall.won, overall.played, 2) - 0.02;
      return { kit: k, score };
    })
    .sort((a, b) => b.score - a.score);
  return ranked.slice(0, count).map((r) => r.kit);
}

// Among the leftover kits, pick the one whose outcome is most balanced
// between the two players — the fairest possible decider kit.
function pickDeciderKit(remaining, statsA, statsB) {
  if (remaining.length <= 1) return remaining[0] || null;
  let best = remaining[0];
  let bestDiff = Infinity;
  remaining.forEach((k) => {
    const rA = smoothedRate(
      statsA.kitOverallStats[k].won,
      statsA.kitOverallStats[k].played,
      2,
    );
    const rB = smoothedRate(
      statsB.kitOverallStats[k].won,
      statsB.kitOverallStats[k].played,
      2,
    );
    const diff = Math.abs(rA - rB);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = k;
    }
  });
  return best;
}

// Probability that a player wins a majority of a set of independent games,
// given each game's individual win probability (Poisson binomial distribution).
// Equivalent to the standard way best-of-N series win probabilities are computed.
function majorityWinProbability(gameProbs) {
  let dist = [1];
  gameProbs.forEach((p) => {
    const next = new Array(dist.length + 1).fill(0);
    dist.forEach((prob, k) => {
      next[k] += prob * (1 - p);
      next[k + 1] += prob * p;
    });
    dist = next;
  });
  const majority = Math.floor(gameProbs.length / 2) + 1;
  let total = 0;
  for (let k = majority; k < dist.length; k++) total += dist[k];
  return total;
}

function simulateMatch(nameA, nameB, format) {
  const statsA = computePlayerStats(nameA);
  const statsB = computePlayerStats(nameB);
  const picks = picksForFormat(format);

  // ---- Ban phase: each player bans one kit before any picks are made.
  // nameA bans first, then nameB bans from whatever's left. ----
  const bannedSet = new Set();
  const banA = predictBan(statsA, statsB, bannedSet);
  if (banA) bannedSet.add(banA.kit);
  const banB = predictBan(statsB, statsA, bannedSet);
  if (banB) bannedSet.add(banB.kit);

  // ---- Pick phase: picks are made from whatever survived the bans. ----
  const excludeSet = new Set(bannedSet);
  const picksA = predictPicks(statsA, picks.p1, excludeSet);
  picksA.forEach((k) => excludeSet.add(k));
  const picksB = predictPicks(statsB, picks.p2, excludeSet);
  picksB.forEach((k) => excludeSet.add(k));

  const remaining = KITS.filter((k) => !excludeSet.has(k));
  const decider = pickDeciderKit(remaining, statsA, statsB);

  const games = buildPlayOrder(format, picksA, picksB, decider);

  // "Big game" reliability: each player's win rate weighted toward
  // later-round results, compared head-to-head against each other.
  const clutchA = clutchScore(nameA);
  const clutchB = clutchScore(nameB);
  const clutchProbA = clutchA / (clutchA + clutchB);

  const gameResults = games.map((g) => {
    const oA = statsA.kitOverallStats[g.kit];
    const oB = statsB.kitOverallStats[g.kit];
    const rA = smoothedRate(oA.won, oA.played, 2);
    const rB = smoothedRate(oB.won, oB.played, 2);
    let pA = rA / (rA + rB);
    if (g.pickedBy === "decider") {
      // The decider is the match-defining "big game" — nudge its odds
      // toward whichever player has historically been more reliable in
      // later bracket rounds, on top of their raw kit win rate.
      pA = (pA * 2 + clutchProbA) / 3;
    }
    return { kit: g.kit, pickedBy: g.pickedBy, pA };
  });

  const kitBasedProbA = majorityWinProbability(gameResults.map((g) => g.pA));

  // Blend in head-to-head history between these two players, if any —
  // weighted by how many times they've actually played (more meetings,
  // more trust in that record).
  const headToHead = computeHeadToHead(nameA, nameB);
  const h2hTotal = headToHead.matches.length;
  const h2hProbA = h2hTotal
    ? smoothedRate(headToHead.winsA, h2hTotal, 1)
    : null;
  const h2hWeight = Math.min(h2hTotal, 5);

  const kitWeight = 4;
  let weightedProb = kitBasedProbA * kitWeight;
  let weightSum = kitWeight;
  if (h2hProbA !== null) {
    weightedProb += h2hProbA * h2hWeight;
    weightSum += h2hWeight;
  }
  const probAWins = weightedProb / weightSum;

  const winnerName = probAWins >= 0.5 ? nameA : nameB;
  const confidence = Math.round(Math.max(probAWins, 1 - probAWins) * 100);

  return {
    statsA,
    statsB,
    nameA,
    nameB,
    banA,
    banB,
    gameResults,
    winnerName,
    confidence,
    headToHead,
    clutchA,
    clutchB,
  };
}

function simulateResultHtml(result) {
  const {
    nameA,
    nameB,
    gameResults,
    winnerName,
    confidence,
    banA,
    banB,
    headToHead,
  } = result;

  const banLines = [
    { name: nameA, ban: banA },
    { name: nameB, ban: banB },
  ]
    .filter((entry) => entry.ban)
    .map(
      ({ name, ban }) => `<div class="game-line">
        <span>${escapeHtml(name)} bans <strong>${kitDisplayName(ban.kit)}</strong></span>
        <span class="hint">likely picking ${escapeHtml(ban.reason)}</span>
      </div>`,
    )
    .join("");

  const gameLines = gameResults
    .map((g) => {
      const pickerLabel =
        g.pickedBy === "decider"
          ? "Decider"
          : g.pickedBy === "player1"
            ? escapeHtml(nameA)
            : escapeHtml(nameB);
      const badgeClass = g.pickedBy === "decider" ? "badge decider" : "badge";
      const pctA = Math.round(g.pA * 100);
      const pctB = 100 - pctA;
      return `<div class="game-line">
        <span>${kitDisplayName(g.kit)} <span class="${badgeClass}">${pickerLabel}</span></span>
        <span>${escapeHtml(nameA)} ${pctA}% - ${pctB}% ${escapeHtml(nameB)}</span>
      </div>`;
    })
    .join("");

  const h2hNote = headToHead.matches.length
    ? `${escapeHtml(nameA)} ${headToHead.winsA} - ${headToHead.winsB} ${escapeHtml(nameB)} head-to-head across ${headToHead.matches.length} previous meeting${headToHead.matches.length === 1 ? "" : "s"} was factored into this prediction.`
    : `${escapeHtml(nameA)} and ${escapeHtml(nameB)} haven't played each other before, so this prediction is based on general form only.`;

  return `
    <div class="stat-cards">
      <div class="stat-box"><div class="value">${escapeHtml(winnerName)}</div><div class="label">Predicted Winner</div></div>
      <div class="stat-box"><div class="value">${confidence}%</div><div class="label">AI Confidence</div></div>
    </div>
    <h4>Predicted Bans</h4>
    ${banLines || `<p class="hint">No bans predicted.</p>`}
    <h4>Predicted Kits &amp; Per-Kit Odds</h4>
    ${gameLines}
    <p class="hint">
      Based on each player's historical pick tendencies and win rates per
      kit (after the predicted bans), each player's reliability in later
      bracket rounds for the decider game, and head-to-head history between
      them. ${h2hNote} This is a heuristic estimate, not a guarantee.
    </p>
  `;
}

simulateMatchBtn.addEventListener("click", () => {
  const container = document.getElementById("simulate-result");
  const nameA = comparePlayer1Select.value;
  const nameB = comparePlayer2Select.value;
  const format = simulateFormatSelect.value;

  if (!nameA || !nameB) {
    container.innerHTML = `<p class="empty-state">Choose two players first.</p>`;
    return;
  }
  if (nameA === nameB) {
    container.innerHTML = `<p class="empty-state">Choose two different players.</p>`;
    return;
  }

  const result = simulateMatch(nameA, nameB, format);
  container.innerHTML = simulateResultHtml(result);
});

// ---------- Utilities ----------
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ---------- Master Render ----------
function renderAll() {
  renderMatchList();
  renderPlayerDropdowns();
  renderPlayerDetails(playerSelect.value);
  renderKitStats();
  renderComparisonDropdowns();
  renderComparisonStats();
  renderBracket();
}

async function init() {
  if (typeof DataStore === "undefined") {
    document.getElementById("match-list").innerHTML =
      `<p class="empty-state">storage.js failed to load (missing file or blocked script). Check that storage.js sits next to index.html.</p>`;
    return;
  }
  renderPickSection();
  renderHistoryEventFilterOptions();
  renderPlayerEventFilterOptions();
  renderKitEventFilterOptions();
  try {
    matches = await fetchMatches();
  } catch (err) {
    console.error(err);
    document.getElementById("match-list").innerHTML =
      `<p class="empty-state">Could not load match data. See the browser console for details.</p>`;
  }
  await refreshStorageStatus();
  renderAll();
}

init();

// ---------- Storage Bar (matches.json connection status) ----------
const storageStatusText = document.getElementById("storage-status-text");
const connectFileBtn = document.getElementById("connect-file-btn");
const exportMatchesBtn = document.getElementById("export-matches-btn");
const importMatchesInput = document.getElementById("import-matches-input");

async function refreshStorageStatus() {
  const connected = await DataStore.isConnected();
  if (connected) {
    storageStatusText.textContent =
      "Connected — saving directly to matches.json.";
    connectFileBtn.textContent = "Change matches.json";
    connectFileBtn.hidden = false;
  } else if (DataStore.isFileSystemSupported) {
    storageStatusText.textContent =
      "Not connected — using this browser's local storage until you connect matches.json.";
    connectFileBtn.textContent = "Connect matches.json";
    connectFileBtn.hidden = false;
  } else {
    storageStatusText.textContent =
      "This browser can't save directly to files — using local storage. Use Export/Import to sync with matches.json.";
    connectFileBtn.hidden = true;
  }
}

connectFileBtn.addEventListener("click", async () => {
  try {
    await DataStore.chooseMatchesFile();
    await migrateLocalDataIntoFileIfNeeded();
    matches = await fetchMatches();
    await refreshStorageStatus();
    renderAll();
  } catch (err) {
    console.error(err);
    if (err.name !== "AbortError") {
      alert(err.message || "Failed to connect matches.json.");
    }
  }
});

// If the newly-connected file is empty but this browser already holds
// matches saved locally (from before a file was connected), copy it over
// once so nothing is lost.
async function migrateLocalDataIntoFileIfNeeded() {
  const fileMatches = await DataStore.loadMatches();
  if (fileMatches.length === 0 && matches.length > 0) {
    await DataStore.saveMatches(matches);
  }
}

function downloadJson(filename, data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

exportMatchesBtn.addEventListener("click", () => {
  downloadJson("matches.json", matches);
});

importMatchesInput.addEventListener("change", async () => {
  const file = importMatchesInput.files[0];
  importMatchesInput.value = "";
  if (!file) return;
  try {
    const parsed = JSON.parse(await file.text());
    if (!Array.isArray(parsed)) {
      throw new Error("That file is not a matches.json array.");
    }
    if (
      !confirm(
        `Replace all ${matches.length} current matches with ${parsed.length} matches from this file?`,
      )
    ) {
      return;
    }
    matches = parsed;
    await DataStore.saveMatches(matches);
    renderAll();
  } catch (err) {
    console.error(err);
    alert(err.message || "Failed to import matches.json.");
  }
});

// ---------- Bracket Tab ----------
// A standard 16-player double-elimination bracket layout (30 slots total)
// per event. There's one bracket per event — switch between them with the
// sub-tabs rendered into #bracket-event-tabs. The columns and slot shape
// are derived from ROUND_DEFINITIONS above (single source of truth shared
// with the round <select> in the Add Match form) — match assignment is
// computed automatically (see computeBracketAssignments below). EVENTS
// itself is declared at the top of the file alongside the other shared
// constants.

const BRACKET_SECTION_CONTAINERS = {
  upper: "bracket-upper-rounds",
  lower: "bracket-lower-rounds",
  grandFinal: "bracket-gf-rounds",
};

function buildBracketSections() {
  const sections = {};
  Object.entries(BRACKET_SECTION_CONTAINERS).forEach(([key, containerId]) => {
    sections[key] = { containerId, rounds: [] };
  });
  ROUND_DEFINITIONS.forEach((def) => {
    sections[def.section].rounds.push({ label: def.label, slots: def.slots });
  });
  return sections;
}

const BRACKET_SECTIONS = buildBracketSections();

// [parentSlotIds[], childSlotId] pairs used only to draw connector lines.
const BRACKET_CONNECTIONS = [
  [["WB1-1", "WB1-2"], "WB2-1"],
  [["WB1-3", "WB1-4"], "WB2-2"],
  [["WB1-5", "WB1-6"], "WB2-3"],
  [["WB1-7", "WB1-8"], "WB2-4"],
  [["WB2-1", "WB2-2"], "WB3-1"],
  [["WB2-3", "WB2-4"], "WB3-2"],
  [["WB3-1", "WB3-2"], "WBF"],

  [["LB1-1"], "LB2-1"],
  [["LB1-2"], "LB2-2"],
  [["LB1-3"], "LB2-3"],
  [["LB1-4"], "LB2-4"],
  [["LB2-1", "LB2-2"], "LB3-1"],
  [["LB2-3", "LB2-4"], "LB3-2"],
  [["LB3-1"], "LB4-1"],
  [["LB3-2"], "LB4-2"],
  [["LB4-1", "LB4-2"], "LB5"],
  [["LB5"], "LBF"],

  [["WBF", "LBF"], "GF"],
];

const BRACKET_MATCH_H = 62;
const BRACKET_GAP = 14;

// Maps a match's "round" value to the ordered list of bracket slots it can
// fill. Matches sharing a round are placed chronologically (oldest first)
// into that round's slots, e.g. the first "1" (Round 1) match recorded
// goes to WB1-1, the second to WB1-2, and so on. Every valid round value
// (see ROUND_DEFINITIONS) maps to a slot group — the round <select> only
// offers these values, so matches always have a home on the bracket.
const ROUND_TO_SLOTS = Object.fromEntries(
  ROUND_DEFINITIONS.map((r) => [r.value, r.slots]),
);

let activeBracketEvent = EVENTS[0];

// Builds the slotId -> matchId map for one event by grouping that event's
// matches by round, ordering each group chronologically (by id), and
// filling the round's slots in that order. No separate bracket data file
// is needed — this is recomputed from `matches` every render.
function computeBracketAssignments(event) {
  const byRound = {};
  matches
    .filter((m) => (m.event || "Champs 1") === event)
    .forEach((m) => {
      (byRound[m.round] = byRound[m.round] || []).push(m);
    });

  const assignments = {};
  Object.entries(byRound).forEach(([round, roundMatches]) => {
    const slots = ROUND_TO_SLOTS[round];
    if (!slots) return;
    const ordered = [...roundMatches].sort((a, b) => (a.id < b.id ? -1 : 1));
    ordered.slice(0, slots.length).forEach((m, idx) => {
      assignments[slots[idx]] = m.id;
    });
  });
  return assignments;
}

function bracketSectionHeight(rounds) {
  const maxCount = Math.max(...rounds.map((r) => r.slots.length));
  return maxCount * (BRACKET_MATCH_H + BRACKET_GAP) - BRACKET_GAP;
}

function matchScoreSummary(match) {
  const p1Wins = match.games.filter((g) => g.winner === "player1").length;
  const p2Wins = match.games.filter((g) => g.winner === "player2").length;
  return { p1Wins, p2Wins };
}

function renderBracketMatchCard(slotId, assignments) {
  const matchId = assignments[slotId];
  const match = matchId ? matches.find((m) => m.id === matchId) : null;

  if (!match) {
    return `<div class="bracket-match empty" data-slot="${slotId}">+ Add match</div>`;
  }

  const { p1Wins, p2Wins } = matchScoreSummary(match);

  return `<div class="bracket-match" data-slot="${slotId}" data-match="${match.id}">
    <div class="bracket-match-players">
      <div class="bracket-match-player ${match.winner === "player1" ? "win" : ""}">
        <span class="bracket-match-name">${escapeHtml(match.player1)}</span>
        <span class="bracket-match-score">${p1Wins}</span>
      </div>
      <div class="bracket-match-player ${match.winner === "player2" ? "win" : ""}">
        <span class="bracket-match-name">${escapeHtml(match.player2)}</span>
        <span class="bracket-match-score">${p2Wins}</span>
      </div>
    </div>
    <div class="bracket-match-meta">
      <span>${escapeHtml(roundLabel(match.round))} • ${formatShortLabel(match.format)}</span>
    </div>
  </div>`;
}

function renderBracketSection(section, assignments) {
  const container = document.getElementById(section.containerId);
  if (!container) return;
  const height = bracketSectionHeight(section.rounds);

  container.innerHTML = section.rounds
    .map((round) => {
      const matchesHtml = round.slots
        .map((slotId) => renderBracketMatchCard(slotId, assignments))
        .join("");
      return `<div class="bracket-round-col">
        <div class="bracket-round-label">${escapeHtml(round.label)}</div>
        <div class="bracket-round" style="height:${height}px">${matchesHtml}</div>
      </div>`;
    })
    .join("");
}

function renderBracketEventTabs() {
  const container = document.getElementById("bracket-event-tabs");
  if (!container) return;
  container.innerHTML = EVENTS.map(
    (ev) =>
      `<button type="button" class="bracket-event-tab${ev === activeBracketEvent ? " active" : ""}" data-event="${escapeHtml(ev)}">${escapeHtml(ev)}</button>`,
  ).join("");

  container.querySelectorAll(".bracket-event-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.event === activeBracketEvent) return;
      activeBracketEvent = btn.dataset.event;
      renderBracket();
    });
  });
}

function renderBracket() {
  renderBracketEventTabs();
  const assignments = computeBracketAssignments(activeBracketEvent);
  Object.values(BRACKET_SECTIONS).forEach((section) =>
    renderBracketSection(section, assignments),
  );
  attachBracketMatchListeners();
  requestAnimationFrame(drawBracketLines);
}

function attachBracketMatchListeners() {
  document.querySelectorAll(".bracket-match[data-match]").forEach((card) => {
    card.addEventListener("click", () => {
      openBracketDetailModal(card.dataset.match);
    });
  });

  document.querySelectorAll(".bracket-match.empty").forEach((card) => {
    card.addEventListener("click", () => {
      startAddMatchFromSlot(card.dataset.slot);
    });
  });
}

// Opens the Add Match form pre-filled with the event (whichever bracket
// tab is active) and round (derived from the clicked slot) so the new
// match lands in this exact slot once saved.
function startAddMatchFromSlot(slotId) {
  const round = SLOT_TO_ROUND[slotId];
  if (!round) return;

  exitEditMode();
  matchForm.reset();
  resetGamesSection();
  eventSelect.value = activeBracketEvent;
  roundInput.value = round;
  renderPickSection();

  document.querySelector('.tab-btn[data-tab="add-match"]')?.click();
  matchForm.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- Bracket connector lines ----------
// Drawn with an SVG overlay measured from actual DOM positions (rather than
// pure CSS) so lines stay correct regardless of how many matches feed into
// the next round (winners bracket rounds halve; losers bracket rounds
// sometimes pass through 1-to-1 and sometimes merge two-to-one).
function drawBracketLines() {
  const svg = document.getElementById("bracket-lines");
  const wrap = document.getElementById("bracket-wrap");
  const bracketTab = document.getElementById("tab-bracket");
  if (!svg || !wrap || !bracketTab || !bracketTab.classList.contains("active"))
    return;

  const wrapRect = wrap.getBoundingClientRect();
  svg.setAttribute("width", wrap.scrollWidth);
  svg.setAttribute("height", wrap.scrollHeight);
  svg.innerHTML = "";

  const ns = "http://www.w3.org/2000/svg";

  function slotPoint(slotId, side) {
    const el = document.querySelector(`.bracket-match[data-slot="${slotId}"]`);
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const x =
      side === "right" ? rect.right - wrapRect.left : rect.left - wrapRect.left;
    const y = rect.top + rect.height / 2 - wrapRect.top;
    return { x, y };
  }

  BRACKET_CONNECTIONS.forEach(([parents, child]) => {
    const childPoint = slotPoint(child, "left");
    if (!childPoint) return;
    const midX = childPoint.x - 22;

    parents.forEach((parentSlot) => {
      const parentPoint = slotPoint(parentSlot, "right");
      if (!parentPoint) return;
      const path = document.createElementNS(ns, "path");
      const d = `M ${parentPoint.x} ${parentPoint.y} H ${midX} V ${childPoint.y} H ${childPoint.x}`;
      path.setAttribute("d", d);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke", "#2e3a55");
      path.setAttribute("stroke-width", "2");
      svg.appendChild(path);
    });
  });
}

let bracketResizeTimer = null;
window.addEventListener("resize", () => {
  clearTimeout(bracketResizeTimer);
  bracketResizeTimer = setTimeout(drawBracketLines, 100);
});

// ---------- Bracket pan navigation (right-click drag) ----------
// Lets the user hold the right mouse button and drag to scroll around the
// bracket, instead of (or in addition to) the normal scrollbars.
const bracketScroll = document.querySelector(".bracket-scroll");
if (bracketScroll) {
  let isPanning = false;
  let panStartX = 0;
  let panStartY = 0;
  let scrollStartX = 0;
  let scrollStartY = 0;

  // Suppress the browser's right-click context menu over the bracket so
  // right-drag-to-pan doesn't pop up a menu on release.
  bracketScroll.addEventListener("contextmenu", (e) => e.preventDefault());

  bracketScroll.addEventListener("mousedown", (e) => {
    if (e.button !== 2) return; // right mouse button only
    isPanning = true;
    panStartX = e.clientX;
    panStartY = e.clientY;
    scrollStartX = bracketScroll.scrollLeft;
    scrollStartY = bracketScroll.scrollTop;
    bracketScroll.classList.add("panning");
    document.body.style.userSelect = "none";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!isPanning) return;
    bracketScroll.scrollLeft = scrollStartX - (e.clientX - panStartX);
    bracketScroll.scrollTop = scrollStartY - (e.clientY - panStartY);
  });

  function stopBracketPan() {
    if (!isPanning) return;
    isPanning = false;
    bracketScroll.classList.remove("panning");
    document.body.style.userSelect = "";
  }

  window.addEventListener("mouseup", stopBracketPan);
  window.addEventListener("blur", stopBracketPan);
}

// ---------- Bracket modal ----------
const bracketDetailModal = document.getElementById("bracket-detail-modal");
const bracketDetailContent = document.getElementById("bracket-detail-content");
const bracketDetailClose = document.getElementById("bracket-detail-close");

function closeModal(overlay) {
  overlay.hidden = true;
}

bracketDetailModal.addEventListener("click", (e) => {
  if (e.target === bracketDetailModal) closeModal(bracketDetailModal);
});
bracketDetailClose.addEventListener("click", () =>
  closeModal(bracketDetailModal),
);

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (!bracketDetailModal.hidden) closeModal(bracketDetailModal);
});

function openBracketDetailModal(matchId) {
  const match = matches.find((m) => m.id === matchId);
  if (!match) return;

  const winnerName = match.winner === "player1" ? match.player1 : match.player2;
  const gameRows = match.games
    .map((g) => {
      const pickerLabel =
        g.pickedBy === "player1"
          ? match.player1
          : g.pickedBy === "player2"
            ? match.player2
            : "Decider";
      const badgeClass = g.pickedBy === "decider" ? "badge decider" : "badge";
      const gameWinnerName =
        g.winner === "player1" ? match.player1 : match.player2;
      return `<div class="game-line">
        <span>${kitDisplayName(g.kit)} <span class="${badgeClass}">${escapeHtml(pickerLabel)}</span></span>
        <span>${g.score1} - ${g.score2} <strong>(${escapeHtml(gameWinnerName)})</strong></span>
      </div>`;
    })
    .join("");

  const { p1Wins, p2Wins } = matchScoreSummary(match);

  bracketDetailContent.innerHTML = `
    <h3>${escapeHtml(match.player1)} vs ${escapeHtml(match.player2)}</h3>
    <p class="match-sub">${escapeHtml(match.event || "Champs 1")} • ${escapeHtml(roundLabel(match.round))} • ${formatLabel(match.format)} • Winner: ${escapeHtml(winnerName)}</p>
    <div class="stat-cards">
      <div class="stat-box"><div class="value">${p1Wins} - ${p2Wins}</div><div class="label">Kit Score</div></div>
    </div>
    <div class="match-card-body open">${gameRows}</div>
  `;
  bracketDetailModal.hidden = false;
}
