import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // One .env at the repository root serves both the API and the web app.
  envDir: '../..',
});
