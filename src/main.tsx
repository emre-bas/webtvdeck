// Base styles first: component stylesheets build on (and override) them.
import './styles/base.css';
import './lib/install';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
