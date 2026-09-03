// Keep controls unavailable until their event handlers are registered, and make
// module/network/startup failures visible instead of leaving a silently inert UI.
export async function startScorer(doc, load = () => import('./app.js?v=1.1.1')) {
  const status = doc.getElementById('startupStatus');
  const message = doc.getElementById('startupMessage');
  const main = doc.getElementById('main');
  const theme = doc.getElementById('themeToggle');
  try {
    await load();
    main.removeAttribute('inert');
    theme.disabled = false;
    status.hidden = true;
    doc.documentElement.dataset.appState = 'ready';
    doc.documentElement.dataset.release = '1.1.1';
    return true;
  } catch {
    // Never reflect an exception body: it could include private request details.
    status.hidden = false;
    status.setAttribute('role', 'alert');
    message.textContent = 'The app could not start. Reload the page, or open the published website below. Local files must be served over HTTP.';
    doc.documentElement.dataset.appState = 'failed';
    return false;
  }
}

if (typeof document !== 'undefined' && document.getElementById('startupStatus')) startScorer(document);
