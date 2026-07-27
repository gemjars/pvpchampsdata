// ---------- Constants & State ----------
const KITS = ["Sword", "UHC", "MSMP", "Cart", "Spear"];
const API_URL = "/api/matches";

let matches = [];
let pendingGames = null; // games array built by "Set Up Games" before save
let currentEvaluation = null; // { finalGames, winner } once the match has been clinched

async function fetchMatches() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error("Failed to load matches from server");
  return res.json();
}

async function createMatchOnServer(match) {
  const res = await fetch(API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(match),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || "Failed to save match to server");
  }
  return res.json();
}

async function deleteMatchOnServer(id) {
  const res = await fetch(`${API_URL}/${id}`, { method: "DELETE" });
  if (!res.ok && res.status !== 404) {
    throw new Error("Failed to delete match on server");
  }
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
  });
});

// ---------- Form Elements ----------
const dateInput = document.getElementById("match-date");
const formatSelect = document.getElementById("match-format");
const player1Input = document.getElementById("player1-name");
const player2Input = document.getElementById("player2-name");
const pickSection = document.getElementById("pick-section");
const gamesSection = document.getElementById("games-section");
const buildGamesBtn = document.getElementById("build-games-btn");
const saveMatchBtn = document.getElementById("save-match-btn");
const formError = document.getElementById("form-error");
const matchForm = document.getElementById("match-form");

dateInput.value = new Date().toISOString().slice(0, 10);

[formatSelect, player1Input, player2Input].forEach((el) => {
  el.addEventListener("input", () => {
    resetGamesSection();
    renderPickSection();
  });
});

function picksEachForFormat(format) {
  return format === "bo5" ? 2 : 1;
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

  const picksEach = picksEachForFormat(formatSelect.value);

  let html = "";
  html += buildPickGroup("p1", p1, picksEach);
  html += buildPickGroup("p2", p2, picksEach);
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
  let rows = "";
  for (let i = 0; i < picksEach; i++) {
    rows += `<label>Kit pick ${picksEach > 1 ? i + 1 : ""}
      <select class="pick-kit" data-role="${prefix}" id="${prefix}-pick-${i}">
        <option value="">-- choose --</option>
        ${KITS.map((k) => `<option value="${k}">${k}</option>`).join("")}
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
  const remaining = KITS.filter((k) => !chosenValues.includes(k));
  const row = document.getElementById("decider-row");
  if (!row) return;

  if (chosenValues.length === 0 || chosenValues.some((v) => !v)) {
    row.innerHTML = `<span class="hint">Finish selecting kit picks first.</span>`;
    return;
  }

  if (remaining.length === 1) {
    row.innerHTML = `<input type="hidden" id="decider-select" value="${remaining[0]}" />
      <span class="badge decider">${remaining[0]}</span>`;
  } else if (remaining.length > 1) {
    row.innerHTML = `<label>Choose decider kit
      <select id="decider-select">
        <option value="">-- choose --</option>
        ${remaining.map((k) => `<option value="${k}">${k}</option>`).join("")}
      </select>
    </label>`;
    document
      .getElementById("decider-select")
      .addEventListener("change", resetGamesSection);
  } else {
    row.innerHTML = `<span class="hint">No kits remaining.</span>`;
  }
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

  const games = [
    ...p1Picks.map((kit) => ({ kit, pickedBy: "player1" })),
    ...p2Picks.map((kit) => ({ kit, pickedBy: "player2" })),
    { kit: decider, pickedBy: "decider" },
  ];

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
          <div class="kit-name">${g.kit}</div>
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

  const p1 = player1Input.value.trim();
  const p2 = player2Input.value.trim();
  const date = dateInput.value;
  const format = formatSelect.value;

  const matchPayload = {
    date,
    format,
    player1: p1,
    player2: p2,
    games: currentEvaluation.finalGames,
    winner: currentEvaluation.winner,
  };

  saveMatchBtn.disabled = true;
  try {
    const savedMatch = await createMatchOnServer(matchPayload);
    matches.push(savedMatch);

    matchForm.reset();
    dateInput.value = new Date().toISOString().slice(0, 10);
    resetGamesSection();
    renderPickSection();
    renderAll();
  } catch (err) {
    console.error(err);
    formError.textContent = err.message || "Failed to save match.";
    saveMatchBtn.disabled = false;
  }
});

// ---------- Match List ----------
function renderMatchList() {
  const container = document.getElementById("match-list");
  if (matches.length === 0) {
    container.innerHTML = `<p class="empty-state">No matches recorded yet.</p>`;
    return;
  }

  const sorted = [...matches].sort((a, b) => (a.date < b.date ? 1 : -1));

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
            <span>${g.kit} <span class="${badgeClass}">${escapeHtml(pickerLabel)}</span></span>
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
            <div class="match-sub">${m.date} • ${m.format === "bo5" ? "Best of 5" : "Best of 3"} • Winner: ${escapeHtml(winnerName)}</div>
          </div>
          <button class="delete-btn" data-delete="${m.id}">Delete</button>
        </div>
        <div class="match-card-body">${gamesHtml}</div>
      </div>`;
    })
    .join("");

  container.querySelectorAll(".match-card-header").forEach((header) => {
    header.addEventListener("click", (e) => {
      if (e.target.closest(".delete-btn")) return;
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
}

// ---------- Players Tab ----------
const playerSelect = document.getElementById("player-select");

function getAllPlayerNames() {
  const names = new Set();
  matches.forEach((m) => {
    names.add(m.player1);
    names.add(m.player2);
  });
  return Array.from(names).sort((a, b) => a.localeCompare(b));
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

  const playerMatches = matches.filter(
    (m) => m.player1 === name || m.player2 === name,
  );

  if (playerMatches.length === 0) {
    container.innerHTML = `<p class="empty-state">No matches found for this player.</p>`;
    return;
  }

  let wins = 0;
  let losses = 0;
  const kitPickStats = {}; // kit -> { picked: n, won: n }
  KITS.forEach((k) => (kitPickStats[k] = { picked: 0, won: 0 }));

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
        if (g.pickedBy === myRole) {
          kitPickStats[g.kit].picked++;
          if (g.winner === myRole) kitPickStats[g.kit].won++;
        }
      });

      return `<tr>
        <td>${m.date}</td>
        <td>${escapeHtml(opponent)}</td>
        <td>${m.format === "bo5" ? "Bo5" : "Bo3"}</td>
        <td><span class="result-pill ${won ? "win" : "loss"}">${won ? "WIN" : "LOSS"}</span></td>
        <td>${myKitWins} - ${oppKitWins}</td>
      </tr>`;
    })
    .join("");

  const winRate = playerMatches.length
    ? Math.round((wins / playerMatches.length) * 100)
    : 0;

  const kitRows = KITS.map((k) => {
    const stat = kitPickStats[k];
    const rate = stat.picked ? Math.round((stat.won / stat.picked) * 100) : 0;
    return `<tr>
      <td>${k}</td>
      <td>${stat.picked}</td>
      <td>${stat.won}</td>
      <td>${stat.picked ? rate + "%" : "—"}</td>
    </tr>`;
  }).join("");

  container.innerHTML = `
    <div class="stat-cards">
      <div class="stat-box"><div class="value">${playerMatches.length}</div><div class="label">Matches</div></div>
      <div class="stat-box"><div class="value">${wins}</div><div class="label">Wins</div></div>
      <div class="stat-box"><div class="value">${losses}</div><div class="label">Losses</div></div>
      <div class="stat-box"><div class="value">${winRate}%</div><div class="label">Win Rate</div></div>
    </div>

    <h3>Kit Picks by ${escapeHtml(name)}</h3>
    <table>
      <thead><tr><th>Kit</th><th>Times Picked</th><th>Times Won</th><th>Win Rate</th></tr></thead>
      <tbody>${kitRows}</tbody>
    </table>

    <h3>Match History</h3>
    <table>
      <thead><tr><th>Date</th><th>Opponent</th><th>Format</th><th>Result</th><th>Kit Score</th></tr></thead>
      <tbody>${matchRows}</tbody>
    </table>
  `;
}

// ---------- Kits Tab ----------
function renderKitStats() {
  const container = document.getElementById("kit-stats");

  if (matches.length === 0) {
    container.innerHTML = `<p class="empty-state">No matches recorded yet.</p>`;
    return;
  }

  const stats = {};
  KITS.forEach(
    (k) =>
      (stats[k] = {
        totalGames: 0,
        deciderCount: 0,
        pickerWins: 0,
        pickerGames: 0,
        pickers: {},
      }),
  );

  matches.forEach((m) => {
    m.games.forEach((g) => {
      const s = stats[g.kit];
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
    KITS.map((k) => {
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
        <h3>${k}</h3>
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
}

async function init() {
  renderPickSection();
  try {
    matches = await fetchMatches();
  } catch (err) {
    console.error(err);
    document.getElementById("match-list").innerHTML =
      `<p class="empty-state">Could not load matches from the server. Make sure the app is running via "npm start" and reload the page.</p>`;
  }
  renderAll();
}

init();
