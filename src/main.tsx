import '@fontsource-variable/unbounded';
import '@fontsource-variable/manrope';
import './styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { makeConfig } from './game/config';
import { App } from './ui/App';

// Optional URL parameters (documented in the README):
//   ?grid=8    play on an 8×8 board (6–24), handy for practising the full-board finish
//   ?seed=42   reproducible orb placement
//   ?debug=1   expose window.__SNAKE3__ for automated tests and diagnostics
const params = new URLSearchParams(location.search);
const gridParam = Number(params.get('grid'));
const config = makeConfig(Number.isFinite(gridParam) && gridParam > 0 ? { cols: gridParam, rows: gridParam } : {});
const seedParam = params.get('seed');
const seed = seedParam !== null && /^\d{1,10}$/.test(seedParam) ? Number(seedParam) >>> 0 : null;
const debug = params.get('debug') === '1';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <App config={config} seed={seed} debug={debug} />
  </StrictMode>,
);
