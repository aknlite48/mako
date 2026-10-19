// Generates a simple 1024x1024 RGBA PNG (app-icon.png) for `tauri icon`.
// Dark background with a minimal "graph" motif of circles and lines.
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 1024;
const px = new Uint8Array(SIZE * SIZE * 4);

function set(x, y, r, g, b, a) {
	if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
	const i = (y * SIZE + x) * 4;
	px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = a;
}

// Background: rounded dark square
const R = 180;
for (let y = 0; y < SIZE; y++) {
	for (let x = 0; x < SIZE; x++) {
		const cx = Math.max(R - x, x - (SIZE - 1 - R), 0);
		const cy = Math.max(R - y, y - (SIZE - 1 - R), 0);
		if (cx * cx + cy * cy <= R * R) set(x, y, 30, 30, 30, 255);
	}
}

function disc(cx, cy, rad, col) {
	for (let y = cy - rad; y <= cy + rad; y++) {
		for (let x = cx - rad; x <= cx + rad; x++) {
			const dx = x - cx, dy = y - cy;
			if (dx * dx + dy * dy <= rad * rad) set(x, y, col[0], col[1], col[2], 255);
		}
	}
}

function line(x0, y0, x1, y1, w, col) {
	const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
	for (let s = 0; s <= steps; s++) {
		const x = Math.round(x0 + ((x1 - x0) * s) / steps);
		const y = Math.round(y0 + ((y1 - y0) * s) / steps);
		disc(x, y, Math.floor(w / 2), col);
	}
}

const blue = [0, 133, 217];
const green = [125, 185, 0];
const orange = [241, 100, 62];

line(360, 250, 360, 780, 36, blue);
line(360, 420, 640, 560, 36, green);
line(640, 560, 640, 780, 36, green);
line(360, 640, 640, 780, 36, orange);

disc(360, 250, 74, blue);
disc(360, 500, 74, blue);
disc(360, 780, 74, blue);
disc(640, 560, 74, green);
disc(640, 780, 74, orange);

// PNG encode
const table = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	table[n] = c >>> 0;
}
function crc(buf) {
	let c = 0xffffffff;
	for (let n = 0; n < buf.length; n++) c = table[(c ^ buf[n]) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const cb = Buffer.alloc(4);
	cb.writeUInt32BE(crc(td));
	return Buffer.concat([len, td, cb]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 6; // RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
	raw[y * (SIZE * 4 + 1)] = 0; // filter none
	Buffer.from(px.buffer, y * SIZE * 4, SIZE * 4).copy(raw, y * (SIZE * 4 + 1) + 1);
}
const png = Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk('IHDR', ihdr),
	chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
	chunk('IEND', Buffer.alloc(0))
]);
fs.writeFileSync(path.join(__dirname, '..', 'app-icon.png'), png);
console.log('Wrote app-icon.png');
