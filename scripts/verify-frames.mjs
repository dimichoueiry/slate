// Verify: frame moves objects added AFTER its creation; rename; navigator jump; Ungroup state.
import { chromium } from 'playwright';
import fs from 'node:fs';

const SHOTS = 'scripts/shots';
fs.mkdirSync(SHOTS, { recursive: true });

const browser = await chromium.launch({
  executablePath: `${process.env.HOME}/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell`,
});
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => m.type() === 'error' && errors.push(`console: ${m.text()}`));

await page.goto('http://localhost:5180/');
await page.waitForSelector('text=New board');
await page.click('text=New board');
await page.waitForSelector('.overlay-canvas');
await page.waitForTimeout(400);

// frame FIRST, then content inside (the broken case)
await page.keyboard.press('f');
await page.mouse.move(300, 250);
await page.mouse.down();
await page.mouse.move(750, 600, { steps: 4 });
await page.mouse.up();
// rename via style bar input
await page.fill('.frame-name-input', 'Section A');
await page.keyboard.press('Enter'); // blurs the name input
await page.keyboard.press('Escape');

// add a shape + stroke INSIDE the existing frame
await page.keyboard.press('r');
await page.mouse.move(380, 330);
await page.mouse.down();
await page.mouse.move(530, 430);
await page.mouse.up();
await page.keyboard.press('Escape');
await page.keyboard.press('p');
await page.mouse.move(400, 500);
await page.mouse.down();
for (let i = 0; i <= 15; i++) await page.mouse.move(400 + i * 14, 500 + 10 * Math.sin(i / 1.5));
await page.mouse.up();
await page.keyboard.press('v');

// drag the frame by its border — contents must come along
await page.mouse.move(525, 252); // top border
await page.mouse.down();
await page.mouse.move(900, 400, { steps: 8 });
await page.mouse.up();
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOTS}/frames-1-moved.png` });

// group state: select two objects, group, click one → should show Ungroup
await page.keyboard.press('r');
await page.mouse.move(200, 650);
await page.mouse.down();
await page.mouse.move(300, 720);
await page.mouse.up();
await page.keyboard.press('r');
await page.mouse.move(350, 650);
await page.mouse.down();
await page.mouse.move(450, 720);
await page.mouse.up();
await page.keyboard.press('v');
await page.mouse.move(150, 620);
await page.mouse.down();
await page.mouse.move(480, 750, { steps: 4 });
await page.mouse.up();
await page.click('.stylebar button:has-text("Group")');
await page.waitForTimeout(150);
// click empty, then click one member — group selects both, button must say Ungroup
await page.mouse.click(1200, 750);
await page.mouse.click(250, 685);
await page.waitForTimeout(150);
const hasUngroup = await page.locator('.stylebar button:has-text("Ungroup")').count();
console.log(hasUngroup ? 'UNGROUP SHOWN' : 'UNGROUP MISSING');

// navigator: pan far away, then jump back via frames menu
await page.keyboard.press('Escape');
await page.mouse.move(700, 450);
await page.keyboard.down('Space');
await page.mouse.down();
await page.mouse.move(100, 100, { steps: 5 });
await page.mouse.up();
await page.keyboard.up('Space');
await page.click('.topbar button[title="Jump to a frame"]');
await page.click('.menu button:has-text("Section A")');
await page.waitForTimeout(400);
await page.screenshot({ path: `${SHOTS}/frames-2-jumped.png` });

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO CONSOLE ERRORS');
await browser.close();
