// -----------------------------------------------------------
//  [*] Entry point — mounts the React app
//
//  Renders <App /> (providers + Navbar/Footer shell + every
//  route, see App.jsx) into the #root div of index.html,
//  wrapped in StrictMode. Global styles (Tailwind) are pulled
//  in here.
// -----------------------------------------------------------

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
