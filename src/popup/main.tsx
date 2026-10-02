import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/ui/theme.css';
import { App } from './App';
import { isFramed } from './embed';

// Toolbar popup: Chrome sizes the window to the body (max 800×600). In-page card: fill the iframe.
document.documentElement.classList.add(isFramed() ? 'bk-framed' : 'bk-toolbar');

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
