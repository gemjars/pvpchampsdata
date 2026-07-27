const express = require("express");
const fs = require("fs/promises");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, "data", "matches.json");

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
    typeof m.date === "string" &&
    (m.format === "bo3" || m.format === "bo5") &&
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
    ["player1", "player2"].includes(m.winner)
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
      date: body.date,
      format: body.format,
      player1: body.player1.trim(),
      player2: body.player2.trim(),
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

app.listen(PORT, () => {
  console.log(`Kit Tournament Tracker running at http://localhost:${PORT}`);
});
