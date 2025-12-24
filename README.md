# WebSocket Object Store Protocol

A simple key-value store with pub/sub over WebSocket.

## Running the Server

### Development
```bash
bun --hot index.ts
```

### Production Build
Build standalone executables for different platforms:
```bash
bun run build                # Build all platforms
bun run build:windows        # Windows x64
bun run build:macos-intel    # macOS Intel
bun run build:macos-arm      # macOS Apple Silicon
bun run build:linux          # Linux x64
```

Executables are created in the `dist/` directory and include all dependencies (including the test page).

## Connection

```
ws://localhost:3000/ws
```

## HTTP Endpoints

- `GET /get/{key}` - Retrieve a value by key
- `POST /set` - Set a value (body: `{"key": "some-key", "value": {...}}`)
- `GET /test` - Test page for the WebSocket API

## Message Format

All messages are JSON strings.

## Client → Server

### Subscribe to a key
```json
{ "action": "subscribe", "key": "some-key" }
```
Receive updates when the key changes. Gets current value immediately if it exists.

### Unsubscribe from a key
```json
{ "action": "unsubscribe", "key": "some-key" }
```
Stop receiving updates for the key.

### Set a value
```json
{ "action": "set", "key": "some-key", "value": { "foo": "bar" } }
```
Store a value and publish to all subscribers. Value can be any JSON data.

### Get a value
```json
{ "action": "get", "key": "some-key" }
```
Retrieve current value without subscribing.

## Server → Client

### Value update
```json
{ "key": "some-key", "value": { "foo": "bar" } }
```
Sent when subscribed key is updated or in response to `get`.

### Error
```json
{ "error": "Invalid message format" }
```

## Example

```javascript
const ws = new WebSocket('ws://localhost:3000');

// Subscribe
ws.send(JSON.stringify({
  action: 'subscribe',
  key: 'player-position'
}));

// Set value (all subscribers get notified)
ws.send(JSON.stringify({
  action: 'set',
  key: 'player-position',
  value: { x: 100, y: 200 }
}));

// Receive updates
ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data.key, data.value);
};
```

## Persistence

Data is automatically persisted to disk in the `.cache` directory (configurable via `CACHE_DIR` environment variable). Each key is stored as a separate JSON file (`{key}.json`).

On startup, all persisted data is loaded from disk into memory. Changes are written to disk immediately when values are set.

## Configuration

Set the `CACHE_DIR` environment variable to customize the persistence directory:

```bash
CACHE_DIR=/path/to/cache bun --hot index.ts
```

Default: `.cache` (in the same directory as the executable)

## Notes

- Data is persisted to disk and survives restarts
- No authentication
- Keys are case-sensitive
- All subscribers receive updates when a value is set
- Each key is stored as a separate JSON file for easy inspection
