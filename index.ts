import { mkdir, exists } from "node:fs/promises";
import { join } from "node:path";
import html from "./test.html" with { type: "text" };

// Configuration
const CACHE_DIR = process.env.CACHE_DIR || ".cache";

// Logging helper with timestamps
function log(...args: any[]) {
  const timestamp = new Date().toLocaleTimeString();
  console.log(`[${timestamp}]`, ...args);
}

// In-memory object store
const store = new Map<string, any>();

// Initialize cache directory and load persisted data
async function initializeStore() {
  // Create cache directory if it doesn't exist
  if (!(await exists(CACHE_DIR))) {
    await mkdir(CACHE_DIR, { recursive: true });
    log(`Created cache directory: ${CACHE_DIR}`);
  }

  // Load existing persisted data
  const files = await Array.fromAsync(
    new Bun.Glob("*.json").scan({ cwd: CACHE_DIR })
  );

  for (const file of files) {
    const key = file.replace(".json", "");
    const filePath = join(CACHE_DIR, file);

    try {
      const content = await Bun.file(filePath).json();
      store.set(key, content);
      log(`Loaded persisted data for key: ${key}`);
    } catch (error) {
      console.error(`Failed to load ${file}:`, error);
    }
  }

  log(`Loaded ${files.length} persisted keys from ${CACHE_DIR}`);
}

// Save a key-value pair to disk
async function persistKey(key: string, value: any) {
  const filePath = join(CACHE_DIR, `${key}.json`);
  try {
    await Bun.write(filePath, JSON.stringify(value, null, 2));
  } catch (error) {
    console.error(`Failed to persist key ${key}:`, error);
  }
}

log("=== STARTING LIVE-GFX-DATA-SERVER ===");

// Initialize store before starting server
await initializeStore();

const server = Bun.serve({
  async fetch(req, server) {
    const url = new URL(req.url);

    // Test page endpoint
    if (url.pathname === "/test") {
      return new Response(html.toString(), {
        headers: { "Content-Type": "text/html" },
      });
    }

    // WebSocket endpoint
    if (url.pathname === "/ws") {
      const success = server.upgrade(req);
      return success ? undefined : new Response("WebSocket upgrade error", { status: 400 });
    }

    // HTTP GET endpoint - get value by key
    if (req.method === "GET" && url.pathname.startsWith("/get/")) {
      const key = url.pathname.slice(5); // Remove "/get/" prefix
      const value = store.get(key) ?? null;
      return new Response(JSON.stringify({ key, value }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    // HTTP POST endpoint - set value
    if (req.method === "POST" && url.pathname === "/set") {
      return req.json().then(async (data: any) => {
        const { key, value } = data;
        if (!key) {
          return new Response(JSON.stringify({ error: "Missing key" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          });
        }

        store.set(key, value);
        await persistKey(key, value);

        // Publish update to WebSocket subscribers
        server.publish(key, JSON.stringify({ key, value }));

        return new Response(JSON.stringify({ key, value }), {
          headers: { "Content-Type": "application/json" },
        });
      });
    }

    return new Response("Not found", { status: 404 });
  },
  websocket: {
    open(ws) {
      const ip = ws.remoteAddress;
      log(`[${ip}] Client connected`);
    },
    async message(ws, message) {
      const ip = ws.remoteAddress;
      try {
        const data = JSON.parse(message as string);

        if (data.action === "subscribe") {
          // Subscribe to a key
          const key = data.key;
          ws.subscribe(key);
          log(`[${ip}] Client subscribed to: ${key}`);

          // Send current value if it exists
          if (store.has(key)) {
            ws.send(JSON.stringify({
              key,
              value: store.get(key),
            }));
          }
        } else if (data.action === "unsubscribe") {
          // Unsubscribe from a key
          const key = data.key;
          ws.unsubscribe(key);
          log(`[${ip}] Client unsubscribed from: ${key}`);
        } else if (data.action === "set") {
          // Set a value and publish to subscribers
          const key = data.key;
          const value = data.value;

          store.set(key, value);
          await persistKey(key, value);
          log(`[${ip}] Set ${key}:`, value);

          // Publish update to all subscribers of this key
          server.publish(key, JSON.stringify({
            key,
            value,
          }));
        } else if (data.action === "get") {
          // Get current value
          const key = data.key;
          ws.send(JSON.stringify({
            key,
            value: store.get(key) ?? null,
          }));
        }
      } catch (error) {
        console.error(`[${ip}] Error processing message:`, error);
        ws.send(JSON.stringify({
          error: "Invalid message format",
        }));
      }
    },
    close(ws) {
      const ip = ws.remoteAddress;
      log(`[${ip}] Client disconnected`);
    },
  },
});

log(`Object store server listening on ${server.hostname}:${server.port}`);