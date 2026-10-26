// Node smoke test: stub WebSocket (browsers always have it) so supabase-js can init.
(globalThis as any).WebSocket = (globalThis as any).WebSocket || class {};

const { renderToStaticMarkup } = await import('react-dom/server');
const { default: App } = await import('./App');

const html = renderToStaticMarkup(<App />);
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
console.log('SMOKE_HTML_LEN=' + html.length);
console.log('SMOKE_TEXT=' + text.slice(0, 300));
