// Generates the extension icons: an amber rounded square with a white "C".
// Pure-node PNG writer (no canvas dependency) so the icons are reproducible
// from source instead of committed binaries.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const crcTable = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});

function crc32(buf) {
	let c = 0xffffffff;
	for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
}

function png(size, pixelAt) {
	const raw = Buffer.alloc(size * (size * 4 + 1));
	for (let y = 0; y < size; y++) {
		const row = y * (size * 4 + 1);
		raw[row] = 0; // no filter
		for (let x = 0; x < size; x++) {
			const [r, g, b, a] = pixelAt(x, y);
			raw.writeUInt32BE(((r << 24) | (g << 16) | (b << 8) | a) >>> 0, row + 1 + x * 4);
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 6; // RGBA
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

function iconPixel(size) {
	const amber = [217, 119, 6, 255];
	const white = [255, 255, 255, 255];
	const clear = [0, 0, 0, 0];
	const c = (size - 1) / 2;
	const corner = size * 0.2;
	const rOuter = size * 0.34;
	const rInner = size * 0.18;
	return (x, y) => {
		// rounded-square mask
		const dx = Math.max(0, Math.abs(x - c) - (c - corner));
		const dy = Math.max(0, Math.abs(y - c) - (c - corner));
		if (Math.hypot(dx, dy) > corner) return clear;
		// white "C": a ring with the right-side wedge cut out
		const rx = x - c;
		const ry = y - c;
		const dist = Math.hypot(rx, ry);
		const inRing = dist <= rOuter && dist >= rInner;
		const inMouth = rx > 0 && Math.abs(ry) < rx * 0.6;
		return inRing && !inMouth ? white : amber;
	};
}

export function generateIcons(outDir) {
	mkdirSync(outDir, { recursive: true });
	for (const size of [16, 32, 48, 128]) {
		writeFileSync(join(outDir, `icon-${size}.png`), png(size, iconPixel(size)));
	}
}
