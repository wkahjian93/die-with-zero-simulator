// Builds the installable phone/tablet app into docs/ (served by GitHub Pages): node build.js
// index.html stays the single source of the game; this wraps it in a full page with app settings.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = __dirname;
const out = process.env.BUILD_OUT ? path.resolve(process.env.BUILD_OUT) : path.join(root, 'docs');
const app = path.join(root, 'app');
fs.mkdirSync(path.join(out, 'icons'), { recursive: true });

const game = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const head = `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#FFFFFF">
<meta name="description" content="Digital game table for the Die With Zero board game, for up to 5 players.">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Die With Zero">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" href="icons/icon-192.png">
<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
</head><body>
`;
// Workshop rooms: on when app/rooms-config.json has the server address (or ROOMS_API is set for testing).
const roomsApi = process.env.ROOMS_API || JSON.parse(fs.readFileSync(path.join(app, 'rooms-config.json'), 'utf8')).api;
const rooms = roomsApi ? `\n<script>\n${fs.readFileSync(path.join(app, 'rooms.js'), 'utf8').replace('__ROOMS_API__', roomsApi)}</script>` : '';
const tail = `${rooms}
<script>if('serviceWorker' in navigator)addEventListener('load',()=>navigator.serviceWorker.register('sw.js').catch(()=>{}));</script>
</body></html>
`;
fs.writeFileSync(path.join(out, 'index.html'), head + game + tail);

// A new version name makes installed phones pick up the update.
const version = crypto.createHash('sha1').update(head + game + tail).digest('hex').slice(0, 10);
fs.writeFileSync(path.join(out, 'sw.js'), fs.readFileSync(path.join(app, 'sw.js'), 'utf8').replace('__VERSION__', version));
fs.copyFileSync(path.join(app, 'manifest.webmanifest'), path.join(out, 'manifest.webmanifest'));
fs.writeFileSync(path.join(out, '.nojekyll'), '');

// Icons: render app/icon.html with headless Edge or Chrome, only when icon.html changed.
const browsers = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'];
const browser = browsers.find(b => fs.existsSync(b));
const iconSrc = path.join(app, 'icon.html');
const icon512 = path.join(out, 'icons', 'icon-512.png');
if (!fs.existsSync(icon512) || fs.statSync(iconSrc).mtimeMs > fs.statSync(icon512).mtimeMs) {
  if (!browser) throw new Error('Edge or Chrome is needed to draw the icons');
  const url = 'file:///' + iconSrc.replace(/\\/g, '/');
  for (const [name, size] of [['icon-512.png', 512], ['icon-192.png', 192], ['apple-touch-icon.png', 180]]) {
    const zoom = size / 512;
    execFileSync(browser, ['--headless', '--disable-gpu', '--hide-scrollbars', `--force-device-scale-factor=${zoom}`,
      `--window-size=512,512`, `--screenshot=${path.join(out, 'icons', name)}`, url], { stdio: 'ignore' });
  }
}
console.log('Built docs/ (version ' + version + ', rooms ' + (roomsApi ? 'ON' : 'off') + ')');
