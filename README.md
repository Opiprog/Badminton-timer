# Badminton Court Timer

A mobile-first, installable web app for running timed badminton games and changeovers.

## Default session

- 20 games
- 3 minutes 30 seconds per game
- 1 minute changeover
- Audible alarm at each transition
- Optional warning beeps during the final 10 seconds

## Run locally

This is a static site. Serve the folder over HTTP rather than opening `index.html` directly so installation and offline support work correctly.

```bash
python3 -m http.server 8080
```

Then open `http://localhost:8080`.

## Put it on a phone

Upload the complete folder to any static web host (GitHub Pages, Netlify, Cloudflare Pages, Azure Static Web Apps, or an ordinary HTTPS website). Open the resulting HTTPS link on the phone:

- **iPhone/iPad:** Safari → Share → Add to Home Screen
- **Android:** Chrome → Install app / Add to Home screen

The first press of **Start** enables browser audio. Keep the phone out of silent mode and turn its volume up. The app requests a screen wake lock while the timer is running when the browser supports it.

## Files

- `index.html` — interface
- `styles.css` — responsive portrait/landscape design
- `app.js` — timer, audio, fullscreen, settings and wake-lock logic
- `manifest.webmanifest` — install metadata
- `sw.js` — offline cache
- `icons/` — home-screen icons
