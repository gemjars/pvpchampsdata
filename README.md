KIT TOURNAMENT TRACKER - SETUP GUIDE
=====================================

1. INSTALL NODE.JS (if not already installed)
-----------------------------------------------
Check first by opening a terminal and running:
  node -v

If that fails, install Node.js LTS from https://nodejs.org
Any Node.js version 18 or newer works.

2. INSTALL DEPENDENCIES
-------------------------
Open a terminal in the extracted folder and run:
  npm install

3. START THE SERVER
---------------------
In the same terminal, run:
  npm start

You should see:
  Kit Tournament Tracker running at http://localhost:3000

Leave this terminal window open - the server must keep running while you use the app.

4. OPEN THE APP
-----------------
Go to this address in your browser:
  http://localhost:3000

5. USE THE APP
-----------------
Match History tab: 
- Add new matches by inputting round name, format, player1 name, player 2 name
- Grand Final format will give player1 three kit picks
- Enter selected kits, press set up games, and enter results on each kit. Then save match
- You can view all recorded matches on the right side of the screen. You can edit or delete previous matches.
  
Players tab: 
- Pick a player from the dropdown to see their win/loss record, kit-pick stats, and full match history.

Kits tab: 
- See how often each kit was picked, by whom, how often it was used as the decider, and win rates.

Comparison:
- Select two players to view their stats side by side
- Simulate a match between the two chosen players in the different available formats
- Match simulator is not always accurate, but it is fun!

Bracket: 
- View and edit each match in the bracket

NOTES
-------
- All match data is stored in data/matches.json. Back up or copy this file
  to preserve or transfer your match history between machines.
- To stop the server, press Ctrl+C in its terminal. To restart later, run
  "npm start" again from this folder.
- If port 3000 is already in use on the new machine, start on a different
  port, for example:
    $env:PORT=3001; npm start
  then browse to http://localhost:3001 instead.

- You can freely edit existing matches or add new ones. If you'd like to revert to the matches stored after PvP Champs 1, simply revert the files at https://github.com/gemjars/pvpchampsdata/tree/main/data 
