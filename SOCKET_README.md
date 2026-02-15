# Socket Chat Integration (Frontend)

This document explains how to integrate the Socket.IO chat system in the frontend.

## 1) Backend expectations

The server uses Socket.IO with JWT auth.

Token lookup order (server):
1. `socket.handshake.auth.token`
2. `socket.handshake.query.token`
3. `Authorization: Bearer <token>`

If the token is missing or invalid, the socket connection is rejected.

## 2) Required REST endpoints

Use these endpoints for data and state:

- `GET /api/chats`
  - Returns mutual follow chat list with `conversationId`, `lastMessage`, `unreadCount`.
- `GET /api/chats/:userId/messages?page=1&limit=20`
  - Loads conversation with the user (mutual check enforced).
- `POST /api/chats/:userId/messages`
  - Sends a message (text or file). Creates conversation if missing.
- `POST /api/chats/:userId/read`
  - Marks messages from that user as read.

## 3) Socket events

Client → Server:

```
event: "message:send"
payload: { recipientId, text }
ack: { ok, message, conversationId } | { ok: false, error }
```

Server → Client:

```
event: "message:new"
payload: { conversationId, message }
```

## 4) Connect the socket

Use the existing helper:

`frontend/src/lib/socketClient.js`

```js
import { io } from "socket.io-client";
import { getAuth } from "./authStore";
import { getBaseUrl } from "./apiClient";

export function connectSocket() {
  const auth = getAuth();
  if (!auth.token) return null;
  return io(getBaseUrl(), {
    auth: { token: auth.token },
  });
}
```

## 5) Step-by-step integration (page flow)

1. Ensure user is authenticated (JWT in local storage).
2. Fetch chat list:
   - `GET /api/chats`
3. Open a chat thread:
   - `GET /api/chats/:userId/messages`
4. Connect socket and listen:
   - `message:new` updates the current thread.
5. Mark read after receiving messages:
   - `POST /api/chats/:userId/read`
6. Send messages:
   - Use socket for real-time text
   - Use REST for file uploads

## 6) Example: socket send (text)

```js
socket.emit("message:send", { recipientId, text }, (ack) => {
  if (!ack.ok) {
    console.error(ack.error);
    return;
  }
  // add ack.message to UI
});
```

## 7) Example: socket receive

```js
socket.on("message:new", (payload) => {
  const { message, conversationId } = payload;
  // append to UI if conversation matches
});
```

## 8) Reference implementation

See the existing chat thread page:

`frontend/src/app/chat/[userId]/page.js`

This file already:
- Connects the socket
- Handles `message:new`
- Loads messages via REST
- Marks read receipts

## 9) Common errors



- `Authorization token required`
  - User not logged in or token missing.
- `Invalid or expired token`
  - Token is expired; refresh login.
- `Chat available only for mutual follows`
  - Follow relationship missing on either side.
