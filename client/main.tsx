import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/login.css';
import './styles/features.css';
import './styles/features/dreamer-home.css';
import './styles/features/dreamer-dreams.css';
import './styles/features/dreamer-actions.css';
import './styles/features/dreamer-care.css';
import './styles/features/dreamer-journal.css';
import './styles/features/coach-session.css';
import './styles/features/coach-views.css';
import './styles/features/director.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
