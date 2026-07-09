import './style.css';
import { App } from './app/App.ts';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app root.');
}

const app = new App(root);
app.start().catch((error) => {
  console.error(error);
  root.innerHTML = '<div class="fatal">Unable to start the road sandbox.</div>';
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
