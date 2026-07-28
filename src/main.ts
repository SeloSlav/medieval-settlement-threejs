import './style.css';
import './ui/iconography.css';
import { App } from './app/App.ts';
import { installVisualPerformanceHooksIfRequested } from './e2e/visualPerformanceHooks.ts';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app root.');
}

const app = new App(root);
app.start().then(() => {
  installVisualPerformanceHooksIfRequested(app);
}).catch((error) => {
  console.error(error);
  const loading = document.getElementById('app-loading');
  if (loading) {
    const label = loading.querySelector('[data-loading-label]');
    const detail = loading.querySelector('[data-loading-detail]');
    if (label) label.textContent = 'Failed to start';
    if (detail) detail.textContent = error instanceof Error ? error.message : 'Unknown startup error';
    loading.classList.remove('is-dismissed');
    return;
  }
  document.getElementById('app-loading')?.remove();
  root.innerHTML = '<div class="fatal">Unable to start the road sandbox.</div>';
});

if (import.meta.hot) {
  import.meta.hot.dispose(() => app.dispose());
}
