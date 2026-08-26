const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = process.env.PORT || 8080;
const MAX_PLAYERS = 4;

// Serve the game files from the project root
const publicPath = __dirname;

app.use(express.static(publicPath));

// Main game page
app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

// Health check
app.get("/health", (req, res) => {
  res.status(200).send("Online Fighter server is running!");
});

const rooms = new Map();

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code;

  do {
    code = "";

    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
  } while (rooms.has(code));

  return code;
}

function createPlayer(id, slot) {
  const spawns = [
    { x: 120, y: 345 },
    { x: 820, y: 345 },
    { x: 350, y: 300 },
    { x: 600, y: 300 }
  ];

  const spawn = spawns[slot];

  return {
    id,
    slot,
    name: `Player ${slot + 1}`,

    x: spawn.x,
    y: spawn.y,

    vx: 0,
    vy: 0,

    facing: slot % 2 === 0 ? 1 : -1,

    health: 100,

    state: "idle",

    attack: null,
    attackTime: 0,

    blocking: false,

    lastHit: 0
  };
}

function newRoom() {
  const code = makeRoomCode();

  rooms.set(code, {
    players: new Map(),
    started: false,
    created: Date.now()
  });

  return code;
}

function roomState(room) {
  return {
    started: room.started,

    players: [...room.players.values()].map(p => ({
      id: p.id,
      slot: p.slot,
      name: p.name,

      x: p.x,
      y: p.y,

      vx: p.vx,
      vy: p.vy,

      facing: p.facing,

      health: p.health,

      state: p.state,

      attack: p.attack,
      attackTime: p.attackTime,

      blocking: p.blocking
    }))
  };
}

function broadcastRoom(code) {
  const room = rooms.get(code);

  if (room) {
    io.to(code).emit("state", roomState(room));
  }
}

io.on("connection", socket => {
  console.log("Player connected:", socket.id);

  socket.on("createRoom", callback => {
    const code = newRoom();

    joinRoom(socket, code, callback);
  });

  socket.on("joinRoom", ({ code }, callback) => {
    const normalized = String(code || "")
      .trim()
      .toUpperCase();

    joinRoom(socket, normalized, callback);
  });

  function joinRoom(socket, code, callback) {
    const room = rooms.get(code);

    if (!room) {
      return callback?.({
        ok: false,
        error: "Room not found."
      });
    }

    if (room.players.size >= MAX_PLAYERS) {
      return callback?.({
        ok: false,
        error: "Room is full."
      });
    }

    const usedSlots = [...room.players.values()].map(p => p.slot);

    let freeSlot = 0;

    while (usedSlots.includes(freeSlot)) {
      freeSlot++;
    }

    const player = createPlayer(socket.id, freeSlot);

    room.players.set(socket.id, player);

    socket.join(code);

    socket.data.room = code;

    if (room.players.size >= 2) {
      room.started = true;
    }

    callback?.({
      ok: true,
      code,
      slot: freeSlot
    });

    broadcastRoom(code);

    console.log(
      `Player ${socket.id} joined room ${code} (${room.players.size}/${MAX_PLAYERS})`
    );
  }

  socket.on("input", input => {
    const code = socket.data.room;
    const room = rooms.get(code);

    const p = room?.players.get(socket.id);

    if (!p) return;

    p.vx = Number(input?.vx) || 0;
    p.vy = Number(input?.vy) || 0;

    p.facing = input?.facing === -1 ? -1 : 1;

    p.blocking = Boolean(input?.blocking);

    if (input?.attack && !p.attack && p.health > 0) {
      p.attack =
        input.attack === "kick"
          ? "kick"
          : "punch";

      p.attackTime = 0;
      p.state = p.attack;
    }

    if (!p.attack && !p.blocking) {
      p.state = "move";
    }

    if (p.blocking) {
      p.state = "block";
    }
  });

  socket.on("restart", () => {
    const code = socket.data.room;
    const room = rooms.get(code);

    if (!room) return;

    room.players.forEach((p, slotId) => {
      const fresh = createPlayer(p.id, p.slot);

      room.players.set(slotId, fresh);
    });

    room.started = room.players.size >= 2;

    broadcastRoom(code);
  });

  socket.on("disconnect", () => {
    console.log("Player disconnected:", socket.id);

    const code = socket.data.room;
    const room = rooms.get(code);

    if (!room) return;

    room.players.delete(socket.id);

    if (room.players.size === 0) {
      rooms.delete(code);

      console.log(`Room ${code} deleted`);
    } else {
      room.started = room.players.size >= 2;

      broadcastRoom(code);
    }
  });
});

// ======================================================
// GAME LOOP
// ======================================================

setInterval(() => {
  for (const [code, room] of rooms) {
    const players = [...room.players.values()];

    for (const p of players) {

      // Don't move dead players
      if (p.health <= 0) {
        p.vx = 0;
        p.vy = 0;
        p.state = "dead";
        continue;
      }

      // Movement
      p.x += p.vx;
      p.y += p.vy;

      // Gravity
      p.vy += 0.8;

      // Ground
      const ground = 345;

      if (p.y >= ground) {
        p.y = ground;
        p.vy = 0;
      }

      // Keep players inside arena
      p.x = Math.max(
        20,
        Math.min(925, p.x)
      );

      // Attack processing
      if (p.attack) {

        p.attackTime++;

        if (p.attackTime === 8) {

          const range =
            p.attack === "kick"
              ? 75
              : 55;

          const damage =
            p.attack === "kick"
              ? 12
              : 8;

          const hitHeight =
            p.attack === "kick"
              ? 70
              : 60;

          const hitY =
            p.y +
            (p.attack === "kick"
              ? 65
              : 25);

          for (const target of players) {

            if (
              target.id === p.id ||
              target.health <= 0
            ) {
              continue;
            }

            const ax =
              p.facing === 1
                ? p.x + 45
                : p.x - range;

            const attackLeft =
              Math.min(
                ax,
                ax + range
              );

            const attackRight =
              Math.max(
                ax,
                ax + range
              );

            const overlapX =
              attackLeft < target.x + 55 &&
              attackRight > target.x;

            const overlapY =
              hitY < target.y + 110 &&
              hitY + hitHeight > target.y;

            if (
              overlapX &&
              overlapY &&
              Date.now() - target.lastHit > 250
            ) {

              const actualDamage =
                target.blocking
                  ? Math.max(
                      1,
                      Math.floor(damage / 3)
                    )
                  : damage;

              target.health = Math.max(
                0,
                target.health - actualDamage
              );

              target.lastHit = Date.now();

              console.log(
                `${p.name} hit ${target.name} for ${actualDamage}`
              );
            }
          }
        }

        const attackDuration =
          p.attack === "kick"
            ? 24
            : 18;

        if (p.attackTime > attackDuration) {
          p.attack = null;
          p.attackTime = 0;

          if (p.health > 0) {
            p.state = "idle";
          }
        }
      }
    }

    broadcastRoom(code);
  }
}, 1000 / 30);

// ======================================================
// CLEANUP
// ======================================================

setInterval(() => {
  const now = Date.now();

  for (const [code, room] of rooms) {

    if (
      room.players.size === 0 ||
      now - room.created > 6 * 60 * 60 * 1000
    ) {
      rooms.delete(code);

      console.log(`Cleaned up room ${code}`);
    }
  }
}, 60_000);

// ======================================================
// START SERVER
// ======================================================

server.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Online Fighter server running on port ${PORT}`
    );

    console.log(
      `Serving game from: ${publicPath}`
    );
  }
);
