import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/ui/theme.css';
import { App } from './App';
import { isFramed, isSidePanel } from './embed';

// In-page card: fill the iframe. Sidebar: fill the panel. Opened any other way: 400px wide.
document.documentElement.classList.add(isFramed() ? 'bk-framed' : isSidePanel() ? 'bk-sidepanel' : 'bk-toolbar');

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
