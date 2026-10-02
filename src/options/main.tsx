import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '../shared/ui/theme.css';
import { Options } from './Options';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Options />
    </StrictMode>,
  );
}
