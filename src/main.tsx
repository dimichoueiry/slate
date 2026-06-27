import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { applyTheme, loadTheme } from './store/theme';
// file-persistence sync (no-ops gracefully when the dev /__slate endpoints are absent)
import './store/fsync';

// apply the saved (or default dark) theme before first paint
applyTheme(loadTheme());
// bundled open-source fonts (latin, regular weight) — keeps the font picker offline-safe
import '@fontsource/inter';
import '@fontsource/roboto';
import '@fontsource/open-sans';
import '@fontsource/lato';
import '@fontsource/poppins';
import '@fontsource/montserrat';
import '@fontsource/raleway';
import '@fontsource/work-sans';
import '@fontsource/dm-sans';
import '@fontsource/rubik';
import '@fontsource/nunito';
import '@fontsource/quicksand';
import '@fontsource/josefin-sans';
import '@fontsource/space-grotesk';
import '@fontsource/eb-garamond';
import '@fontsource/libre-baskerville';
import '@fontsource/cormorant-garamond';
import '@fontsource/bitter';
import '@fontsource/roboto-slab';
import '@fontsource/anton';
import '@fontsource/archivo-black';
import '@fontsource/righteous';
import '@fontsource/lobster';
import '@fontsource/comfortaa';
import '@fontsource/barlow-condensed';
import '@fontsource/great-vibes';
import '@fontsource/shadows-into-light';
import '@fontsource/indie-flower';
import '@fontsource/kalam';
import '@fontsource/patrick-hand';
import '@fontsource/bangers';
import '@fontsource/fira-code';
import '@fontsource/space-mono';
import '@fontsource/courier-prime';
import '@fontsource/press-start-2p';
import '@fontsource/vt323';
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
