KIT TOURNAMENT TRACKER - SETUP GUIDE
=====================================
# 1. OPEN THE APP
-----------------
Double-click index.html (or open it from your browser with File > Open).

# 2. CONNECT THE DATA FOLDER (Chrome or Edge)
----------------------------------------------
The first time you use the app, click "Connect Data Folder" in the bar
under the header and choose this project's "data" folder. From then on,
every match and bracket change is saved directly into:
  data/matches.json
  data/bracket.json

# 3. USE THE APP
-----------------
- Match History tab: enter both player names, choose the format (Best of 3,
  Best of 5, or Grand Final), pick each player's kits, then click "Set Up
  Games" and enter scores one kit at a time. Kits after the current one stay
  locked until you fill in the previous kit's score, and once a player has
  clinched the match, any remaining kits (including the decider) are
  automatically marked "Not needed" and skipped. Click "Save Match" once
  the match is decided.
- Players tab: pick a player from the dropdown to see their win/loss
  record, kit-pick stats, and full match history.
- Kits tab: see how often each kit was picked, by whom, how often it was
  used as the decider, and win rates.
- Comparison tab: compare two players' stats head-to-head, or simulate a
  hypothetical match between them.
- Bracket tab: assign recorded matches to a 16-player double-elimination
  bracket layout.

NOTES
-------
- All match data lives in data/matches.json and bracket assignments in
  data/bracket.json. Back up or copy these files to preserve or transfer your data between machines.
- If you ever see "using this browser's local storage" in the status bar
  and want it saved to the JSON files instead, click "Connect Data Folder".
