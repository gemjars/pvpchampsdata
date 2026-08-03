const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;

// When bundled into a standalone executable (pkg), __dirname points inside a
// read-only virtual snapshot. Store the data file next to the real .exe
// instead so match history persists and survives updates.
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : __dirname;
const DATA_FILE = path.join(BASE_DIR, "data", "matches.json");
const BRACKET_FILE = path.join(BASE_DIR, "data", "bracket.json");

app.use(express.json());
app.use(express.static(__dirname));

async function readMatches() {
  try {
    const raw = await fs.readFile(DATA_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function writeMatches(matches) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(matches, null, 2), "utf-8");
}

function isValidMatch(m) {
  return (
    m &&
    ((typeof m.round === "string" && m.round.trim().length > 0) ||
      (typeof m.round === "number" && Number.isFinite(m.round))) &&
    (m.format === "bo3" || m.format === "bo5" || m.format === "grandfinal") &&
    typeof m.player1 === "string" &&
    m.player1.trim() &&
    typeof m.player2 === "string" &&
    m.player2.trim() &&
    Array.isArray(m.games) &&
    m.games.length > 0 &&
    m.games.every(
      (g) =>
        typeof g.kit === "string" &&
        ["player1", "player2", "decider"].includes(g.pickedBy) &&
        Number.isFinite(g.score1) &&
        Number.isFinite(g.score2) &&
        ["player1", "player2"].includes(g.winner),
    ) &&
    ["player1", "player2"].includes(m.winner) &&
    (m.picks === undefined ||
      (m.picks &&
        Array.isArray(m.picks.player1) &&
        Array.isArray(m.picks.player2) &&
        typeof m.picks.decider === "string"))
  );
}

// GET all matches
app.get("/api/matches", async (req, res) => {
  try {
    const matches = await readMatches();
    res.json(matches);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read matches" });
  }
});

// POST a new match
app.post("/api/matches", async (req, res) => {
  try {
    const body = req.body;
    if (!isValidMatch(body)) {
      return res.status(400).json({ error: "Invalid match data" });
    }
    const matches = await readMatches();
    const match = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      round: typeof body.round === "string" ? body.round.trim() : body.round,
      format: body.format,
      player1: body.player1.trim(),
      player2: body.player2.trim(),
      picks: body.picks,
      games: body.games.map((g) => ({
        kit: g.kit,
        pickedBy: g.pickedBy,
        score1: g.score1,
        score2: g.score2,
        winner: g.winner,
      })),
      winner: body.winner,
    };
    matches.push(match);
    await writeMatches(matches);
    res.status(201).json(match);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save match" });
  }
});

// PUT (update) an existing match by id
app.put("/api/matches/:id", async (req, res) => {
  try {
    const body = req.body;
    if (!isValidMatch(body)) {
      return res.status(400).json({ error: "Invalid match data" });
    }
    const matches = await readMatches();
    const idx = matches.findIndex((m) => m.id === req.params.id);
    if (idx === -1) {
      return res.status(404).json({ error: "Match not found" });
    }
    const updated = {
      id: req.params.id,
      round: typeof body.round === "string" ? body.round.trim() : body.round,
      format: body.format,
      player1: body.player1.trim(),
      player2: body.player2.trim(),
      picks: body.picks,
      games: body.games.map((g) => ({
        kit: g.kit,
        pickedBy: g.pickedBy,
        score1: g.score1,
        score2: g.score2,
        winner: g.winner,
      })),
      winner: body.winner,
    };
    matches[idx] = updated;
    await writeMatches(matches);
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to update match" });
  }
});

// DELETE a match by id
app.delete("/api/matches/:id", async (req, res) => {
  try {
    const matches = await readMatches();
    const filtered = matches.filter((m) => m.id !== req.params.id);
    if (filtered.length === matches.length) {
      return res.status(404).json({ error: "Match not found" });
    }
    await writeMatches(filtered);
    res.status(204).end();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to delete match" });
  }
});

// ---------- Bracket assignments ----------
// The bracket is a fixed 16-player double-elimination layout defined on the
// client. This just persists a map of { slotId: matchId } describing which
// recorded match (if any) has been assigned to each bracket slot.

async function readBracket() {
  try {
    const raw = await fs.readFile(BRACKET_FILE, "utf-8");
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

async function writeBracket(assignments) {
  await fs.mkdir(path.dirname(BRACKET_FILE), { recursive: true });
  await fs.writeFile(
    BRACKET_FILE,
    JSON.stringify(assignments, null, 2),
    "utf-8",
  );
}

function isValidBracket(body) {
  return (
    body &&
    typeof body === "object" &&
    !Array.isArray(body) &&
    Object.entries(body).every(
      ([slotId, matchId]) =>
        typeof slotId === "string" && typeof matchId === "string",
    )
  );
}

// GET current bracket assignments
app.get("/api/bracket", async (req, res) => {
  try {
    const assignments = await readBracket();
    res.json(assignments);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to read bracket" });
  }
});

// PUT (replace) bracket assignments
app.put("/api/bracket", async (req, res) => {
  try {
    if (!isValidBracket(req.body)) {
      return res.status(400).json({ error: "Invalid bracket data" });
    }
    await writeBracket(req.body);
    res.json(req.body);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to save bracket" });
  }
});

app.listen(PORT, () => {
  console.log(`Kit Tournament Tracker running at http://localhost:${PORT}`);
});
