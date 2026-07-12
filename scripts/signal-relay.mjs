import http from "node:http";

const DEFAULT_PORT = 8787;
const ROOM_TTL_MS = 60 * 60 * 1000;
const MESSAGE_TTL_MS = 30 * 60 * 1000;
const MAX_MESSAGES_PER_ROOM = 1000;
const POLL_STEP_MS = 250;

const port = Number(process.env.PORT || process.env.EXCALIBUR_RELAY_PORT || DEFAULT_PORT);
const rooms = new Map();

function getRoom(roomId) {
  const now = Date.now();
  let room = rooms.get(roomId);
  if (!room) {
    room = {
      messages: [],
      nextId: 1,
      touchedAt: now,
    };
    rooms.set(roomId, room);
  }

  room.touchedAt = now;
  room.messages = room.messages.filter((message) => now - message.createdAt < MESSAGE_TTL_MS);
  return room;
}

function cleanupRooms() {
  const now = Date.now();
  for (const [roomId, room] of rooms.entries()) {
    if (now - room.touchedAt > ROOM_TTL_MS) {
      rooms.delete(roomId);
    }
  }
}

function sendJson(response, status, data) {
  response.writeHead(status, {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(data));
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("request too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

function matchingMessages(room, peerId, after) {
  return room.messages.filter((message) => {
    if (message.id <= after || message.from === peerId) {
      return false;
    }
    return !message.to || message.to === peerId || (peerId === "host" && message.to === "host");
  });
}

async function waitForMessages(room, peerId, after, timeoutMs) {
  const startedAt = Date.now();
  let messages = matchingMessages(room, peerId, after);

  while (!messages.length && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, POLL_STEP_MS));
    messages = matchingMessages(room, peerId, after);
  }

  return messages;
}

const server = http.createServer(async (request, response) => {
  if (request.method === "OPTIONS") {
    sendJson(response, 204, {});
    return;
  }

  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "GET" && url.pathname === "/health") {
    cleanupRooms();
    sendJson(response, 200, {
      ok: true,
      rooms: rooms.size,
    });
    return;
  }

  const match = url.pathname.match(/^\/rooms\/([^/]+)\/messages$/);
  if (!match) {
    sendJson(response, 404, { error: "not found" });
    return;
  }

  const roomId = decodeURIComponent(match[1]);
  const room = getRoom(roomId);

  try {
    if (request.method === "POST") {
      const message = await readJson(request);
      if (!message || typeof message.from !== "string" || typeof message.type !== "string") {
        sendJson(response, 400, { error: "invalid message" });
        return;
      }

      const storedMessage = {
        id: room.nextId++,
        from: message.from,
        to: typeof message.to === "string" ? message.to : null,
        type: message.type,
        payload: message.payload ?? null,
        createdAt: Date.now(),
      };
      room.messages.push(storedMessage);
      if (room.messages.length > MAX_MESSAGES_PER_ROOM) {
        room.messages.splice(0, room.messages.length - MAX_MESSAGES_PER_ROOM);
      }
      sendJson(response, 200, { ok: true, id: storedMessage.id });
      return;
    }

    if (request.method === "GET") {
      const peerId = url.searchParams.get("peerId");
      const after = Number(url.searchParams.get("after") || "0");
      const timeoutMs = Math.max(
        0,
        Math.min(30_000, Number(url.searchParams.get("timeout") || "0")),
      );

      if (!peerId) {
        sendJson(response, 400, { error: "missing peerId" });
        return;
      }

      const messages = await waitForMessages(room, peerId, Number.isFinite(after) ? after : 0, timeoutMs);
      sendJson(response, 200, { messages });
      return;
    }

    sendJson(response, 405, { error: "method not allowed" });
  } catch (error) {
    sendJson(response, 500, {
      error: error instanceof Error ? error.message : "internal error",
    });
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Excalibur signaling relay listening on http://0.0.0.0:${port}`);
});
