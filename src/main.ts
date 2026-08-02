import './style.css';
import './ui/iconography.css';
import { App } from './app/App.ts';

const root = document.querySelector<HTMLDivElement>('#app');

if (!root) {
  throw new Error('Missing #app root.');
}

const visualPerformanceHooksPromise =
  new URLSearchParams(window.location.search).get('visualProfile') === '1'
    ? import('./e2e/visualPerformanceHooks.ts')
    : null;
const app = new App(root);
app.start().then(async () => {
  if (visualPerformanceHooksPromise) {
    const { installVisualPerformanceHooksIfRequested } =
      await visualPerformanceHooksPromise;
    installVisualPerformanceHooksIfRequested(app, {
      deferPeriodicReportsUntilReady: true,
    });
  }
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
