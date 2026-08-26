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
const MAX_PLAYERS = 6;
const MIN_PLAYERS = 2;

// Your GitHub/Railway project has index.html and the player PNGs at the root.
const publicPath = __dirname;

app.use(express.static(publicPath));

app.get("/", (req, res) => {
  res.sendFile(path.join(publicPath, "index.html"));
});

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

function sanitizeName(value) {
  return String(value || "")
    .replace(/[^a-zA-Z0-9 _-]/g, "")
    .trim()
    .slice(0, 16);
}

function roomModeTeam(slot, mode) {
  if (mode === 1) return slot === 0 ? 0 : 1;
  if (mode === 2) return slot < 2 ? 0 : 1;
  return slot < 3 ? 0 : 1;
}

function createPlayer(id, slot, skin, name, mode = 1) {
  const spawnsByMode = {
    1: [
      { x: 120, y: 345 },
      { x: 820, y: 345 }
    ],
    2: [
      { x: 120, y: 345 },
      { x: 230, y: 345 },
      { x: 710, y: 345 },
      { x: 820, y: 345 }
    ],
    3: [
      { x: 100, y: 345 },
      { x: 220, y: 345 },
      { x: 340, y: 345 },
      { x: 660, y: 345 },
      { x: 780, y: 345 },
      { x: 900, y: 345 }
    ]
  };

  const spawn = spawnsByMode[mode][slot];

  return {
    id,
    slot,
    skin,
    name: name || `Player ${slot + 1}`,
    // Team layout by match size: 1v1 = 1/1, 2v2 = 2/2, 3v3 = 3/3.
    team: roomModeTeam(slot, mode),

    x: spawn.x,
    y: spawn.y,

    vx: 0,
    vy: 0,

    facing: roomModeTeam(slot, mode) === 0 ? 1 : -1,

    health: 100,

    state: "idle",

    attack: null,
    attackTime: 0,

    blocking: false,

    lastHit: 0
  };
}

function newRoom(mode) {
  const code = makeRoomCode();
  const maxPlayers = mode * 2;

  rooms.set(code, {
    players: new Map(),
    mode,
    maxPlayers,
    started: false,
    gameOver: false,
    created: Date.now()
  });

  return code;
}

function roomState(room) {
  return {
    started: room.started,
    gameOver: room.gameOver,
    maxPlayers: room.maxPlayers,
    mode: room.mode,

    players: [...room.players.values()].map(p => ({
      id: p.id,
      slot: p.slot,
      skin: p.skin,
      name: p.name,
      team: p.team,

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

function getFreeSlot(room) {
  const usedSlots = [...room.players.values()].map(p => p.slot);

  for (let slot = 0; slot < MAX_PLAYERS; slot++) {
    if (!usedSlots.includes(slot)) return slot;
  }

  return -1;
}

function skinIsTaken(room, skin, exceptSocketId = null) {
  return [...room.players.values()].some(
    p => p.id !== exceptSocketId && p.skin === skin
  );
}

io.on("connection", socket => {
  console.log("Player connected:", socket.id);

  socket.on("createRoom", ({ maxPlayers, skin, name }, callback) => {
    const targetPlayers = [1, 2, 3].includes(Number(maxPlayers)) ? Number(maxPlayers) : 1;
    const selectedSkin = Number(skin);
    const selectedName = sanitizeName(name);

    if (!selectedName) {
      return callback?.({
        ok: false,
        error: "Please choose a username."
      });
    }

    if (![1, 2, 3, 4, 5, 6].includes(selectedSkin)) {
      return callback?.({
        ok: false,
        error: "Please choose a valid skin."
      });
    }

    const code = newRoom(targetPlayers);

    joinRoom(socket, code, selectedSkin, selectedName, callback);
  });

  socket.on("joinRoom", ({ code, skin, name }, callback) => {
    const normalized = String(code || "")
      .trim()
      .toUpperCase();

    const selectedSkin = Number(skin);
    const selectedName = sanitizeName(name);

    joinRoom(socket, normalized, selectedSkin, selectedName, callback);
  });

  function joinRoom(socket, code, skin, name, callback) {
    const room = rooms.get(code);

    if (!room) {
      return callback?.({
        ok: false,
        error: "Room not found."
      });
    }

    if (!name) {
      return callback?.({
        ok: false,
        error: "Please choose a username."
      });
    }

    if (room.started) {
      return callback?.({
        ok: false,
        error: "The match has already started."
      });
    }

    if (room.players.size >= room.maxPlayers) {
      return callback?.({
        ok: false,
        error: `This is a ${room.maxPlayers}-player room and it is full.`
      });
    }

    if (![1, 2, 3, 4, 5, 6].includes(Number(skin))) {
      return callback?.({
        ok: false,
        error: "Please choose a valid skin."
      });
    }

    if (skinIsTaken(room, Number(skin))) {
      return callback?.({
        ok: false,
        error: "That skin is already being used in this room. Choose another one."
      });
    }

    const freeSlot = getFreeSlot(room);

    if (freeSlot < 0) {
      return callback?.({
        ok: false,
        error: "No player slots are available."
      });
    }

    const player = createPlayer(
      socket.id,
      freeSlot,
      Number(skin),
      name,
      room.mode
    );

    room.players.set(socket.id, player);

    socket.join(code);
    socket.data.room = code;

    if (room.players.size >= room.maxPlayers) {
      room.started = true;
      room.gameOver = false;
    }

    callback?.({
      ok: true,
      code,
      slot: freeSlot,
      skin: Number(skin),
      maxPlayers: room.maxPlayers,
      mode: room.mode
    });

    broadcastRoom(code);

    console.log(
      `Player ${socket.id} joined ${code} as P${freeSlot + 1}, skin ${skin} (${room.players.size}/${room.maxPlayers})`
    );
  }

  socket.on("input", input => {
    const code = socket.data.room;
    const room = rooms.get(code);
    const p = room?.players.get(socket.id);

    if (!p || !room.started || room.gameOver || p.health <= 0) {
      return;
    }

    p.vx = Number(input?.vx) || 0;

    p.facing = input?.facing === -1 ? -1 : 1;

    // Jump is handled by the server so the client cannot overwrite
    // vertical velocity every frame. The client sends a one-frame jump request.
    const ground = 345;
    const onGround = p.y >= ground - 1 && Math.abs(p.vy) < 1.5;

    if (input?.jump && onGround && !p.blocking && !p.attack) {
      p.vy = -15;
    }

    p.blocking = Boolean(input?.blocking);

    if (input?.attack && !p.attack) {
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

    room.players.forEach((p, id) => {
      const fresh = createPlayer(
        p.id,
        p.slot,
        p.skin,
        p.name,
        room.mode
      );

      room.players.set(id, fresh);
    });

    room.started = room.players.size >= room.maxPlayers;
    room.gameOver = false;

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
      return;
    }

    // If someone leaves before the match starts, the remaining players
    // can still wait for another player.
    if (!room.started) {
      room.gameOver = false;
    }

    broadcastRoom(code);
  });
});

// ======================================================
// GAME LOOP
// ======================================================

setInterval(() => {
  for (const [code, room] of rooms) {
    const players = [...room.players.values()];

    if (!room.started || room.gameOver) {
      broadcastRoom(code);
      continue;
    }

    for (const p of players) {
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
      p.x = Math.max(20, Math.min(925, p.x));

      // Enemy body collision: opponents cannot walk through each other.
      // Teammates intentionally do not collide, so same-team players can pass through.
      const PLAYER_WIDTH = 55;
      const PLAYER_GAP = 2;

      for (const other of players) {
        if (other.id === p.id || other.health <= 0 || other.team === p.team) {
          continue;
        }

        const minDistance = PLAYER_WIDTH + PLAYER_GAP;
        const dx = other.x - p.x;

        if (Math.abs(dx) < minDistance) {
          // Pick a stable direction if both players are exactly on top of each other.
          const direction = dx === 0
            ? (p.slot < other.slot ? -1 : 1)
            : Math.sign(dx);

          const overlap = minDistance - Math.abs(dx);

          // Split the correction between both players.
          p.x -= direction * (overlap / 2);
          other.x += direction * (overlap / 2);

          // Stop movement into the opponent while allowing them to move apart.
          if (direction > 0) {
            if (p.vx > 0) p.vx = 0;
            if (other.vx < 0) other.vx = 0;
          } else {
            if (p.vx < 0) p.vx = 0;
            if (other.vx > 0) other.vx = 0;
          }
        }
      }

      // Re-apply arena bounds after collision correction.
      p.x = Math.max(20, Math.min(925, p.x));

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
              Math.min(ax, ax + range);

            const attackRight =
              Math.max(ax, ax + range);

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

    // Match ends when one team has no living fighters.
    const aliveTeams = new Set(
      players
        .filter(p => p.health > 0)
        .map(p => p.team)
    );

    if (aliveTeams.size <= 1) {
      room.gameOver = true;

      for (const p of players) {
        p.vx = 0;
        p.vy = 0;

        if (p.health <= 0) {
          p.state = "dead";
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Online Fighter server running on port ${PORT}`
  );

  console.log(
    `Serving game from: ${publicPath}`
  );
});
