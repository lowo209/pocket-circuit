import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { attachMultiplayerServer } from './server/multiplayer';

function multiplayerDev(redisUrl?: string): Plugin {
  return {
    name: 'pocket-circuit-multiplayer',
    configureServer(server) {
      if (!server.httpServer) return;
      const multiplayer = attachMultiplayerServer(server.httpServer, {
        redisUrl,
        allowInMemory: !redisUrl,
      });
      server.httpServer.on('close', () => {
        void multiplayer.close();
      });
    },
  };
}
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    multiplayerDev(loadEnv(mode, process.cwd(), '').REDIS_URL || process.env.REDIS_URL),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks: { three: ['three'], react: ['react', 'react-dom'] },
      },
    },
  },
}));
