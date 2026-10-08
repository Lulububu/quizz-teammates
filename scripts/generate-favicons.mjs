import { readFile, writeFile } from 'node:fs/promises';
import { chromium } from '../performance/node_modules/playwright/index.mjs';

const publicDir = new URL('../client/public/', import.meta.url);
const source = await readFile(new URL('../output/branding/buzzer/logo-source.png', import.meta.url));
const browser = await chromium.launch({ channel: 'chrome', headless: true });
try {
  const page = await browser.newPage();
  const images = await page.evaluate(async source => {
    const image = new Image();
    image.src = source;
    await image.decode();
    return [16, 32, 48, 128, 180].map(size => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d');
      context.imageSmoothingQuality = 'high';
      // Mobile launchers apply their own mask to a fully opaque touch icon.
      if (size === 180) {
        context.fillStyle = '#f6f7f6';
        context.fillRect(0, 0, size, size);
      }
      context.drawImage(image, 0, 0, size, size);
      return { size, png: canvas.toDataURL('image/png').split(',')[1] };
    });
  }, 'data:image/png;base64,' + source.toString('base64'));
  const buffers = images.map(({ size, png }) => ({ size, png: Buffer.from(png, 'base64') }));
  await writeFile(new URL('favicon-32x32.png', publicDir), buffers.find(image => image.size === 32).png);
  await writeFile(new URL('apple-touch-icon.png', publicDir), buffers.find(image => image.size === 180).png);
  await writeFile(new URL('logo-buzzer.png', publicDir), buffers.find(image => image.size === 128).png);

  // ICO directory entries point to the embedded PNG at each browser icon size.
  const icons = buffers.filter(image => image.size <= 48);
  const directory = Buffer.alloc(6 + icons.length * 16);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(icons.length, 4);
  let offset = directory.length;
  icons.forEach(({ size, png }, index) => {
    const entry = 6 + index * 16;
    directory[entry] = directory[entry + 1] = size;
    directory.writeUInt16LE(1, entry + 4);
    directory.writeUInt16LE(32, entry + 6);
    directory.writeUInt32LE(png.length, entry + 8);
    directory.writeUInt32LE(offset, entry + 12);
    offset += png.length;
  });
  await writeFile(new URL('favicon.ico', publicDir), Buffer.concat([directory, ...icons.map(image => image.png)]));
  console.log('Generated buzzer logo (128 px), favicon.ico (16/32/48 px), favicon-32x32.png and apple-touch-icon.png (180 px).');
} finally {
  await browser.close();
}
