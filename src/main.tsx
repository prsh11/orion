import { applyTheme, loadTheme } from './theme';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

applyTheme(loadTheme());

const root = document.getElementById('root');
if (!root) throw new Error('Missing root element');

createRoot(root).render(
    <StrictMode>
        <App />
    </StrictMode>,
);
