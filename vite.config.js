import { defineConfig } from 'vite';
// base './' hace que funcione igual en GitHub Pages (subcarpeta) y en un dominio propio.
export default defineConfig({ base: './', build: { sourcemap: false } });
