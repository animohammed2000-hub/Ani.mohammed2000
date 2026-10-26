import { renderToStaticMarkup } from 'react-dom/server';
import App from './App';

const html = renderToStaticMarkup(<App />);
const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
console.log('SMOKE_HTML_LEN=' + html.length);
console.log('SMOKE_TEXT=' + text.slice(0, 200));
