import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
// bundled open-source fonts (latin, regular weight) — keeps the font picker offline-safe
import '@fontsource/inter';
import '@fontsource/poppins';
import '@fontsource/montserrat';
import '@fontsource/space-grotesk';
import '@fontsource/playfair-display';
import '@fontsource/lora';
import '@fontsource/merriweather';
import '@fontsource/bebas-neue';
import '@fontsource/oswald';
import '@fontsource/abril-fatface';
import '@fontsource/pacifico';
import '@fontsource/caveat';
import '@fontsource/dancing-script';
import '@fontsource/permanent-marker';
import '@fontsource/jetbrains-mono';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
