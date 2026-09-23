import { createServer } from 'node:http';
import { attachMultiplayerServer } from '../server/multiplayer.js';

const server = createServer((_request, response) => {
  response.writeHead(426, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(
    JSON.stringify({
      service: 'Pocket Circuit multiplayer',
      protocol: 2,
      error: 'WebSocket upgrade required',
    }),
  );
});

attachMultiplayerServer(server);

// Vercel's native WebSocket Functions accept a Node HTTP server as the default export.
export default server;
