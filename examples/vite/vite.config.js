import { resolveConfigSync } from "@povio/resolve-config";
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [
    {
      name: 'transform-index-html',
      transformIndexHtml(html) {
        return html.replace('%APP_PUBLIC_ENV%', JSON.stringify(resolveConfigSync({ module: "spa" }).html));
      },
    },
  ],
});

