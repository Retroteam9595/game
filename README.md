# Four Fighter Online — Custom Skins

This version uses the four uploaded character images as the in-game skins:

1. `player1.png` = first uploaded skin
2. `player2.png` = second uploaded skin
3. `player3.png` = third uploaded skin
4. `player4.png` = fourth uploaded skin

## Same controls for every online player

Every player uses the same keys on their own computer:

- A = move left
- D = move right
- W = jump
- S = block
- J = punch
- K = kick

Because the game is online, there is no keyboard conflict: each browser controls its own assigned player slot.

## Run

```bash
npm install
npm start
```

Open `http://localhost:3000` for testing.

## Deploy

Use a Node.js web service such as Render.

Build command:
`npm install`

Start command:
`npm start`

After deployment, share the public HTTPS URL. One player creates a room and sends the 5-character room code to the others.

## Project

- `server.js` — multiplayer server and room system
- `public/index.html` — game client
- `public/assets/player1.png` through `player4.png` — uploaded skins
