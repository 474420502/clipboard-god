const fs = require('fs');
const { nativeImage } = require('electron');
const jsQR = require('jsqr');


const normalizeImagePath = (input) => {
    if (!input) return null;
    let p = String(input);
    if (p.startsWith('file://')) p = p.replace(/^file:\/\//, '');
    return p;
};

const loadImageBuffer = async (input) => {
    if (!input) return null;
    if (Buffer.isBuffer(input)) return input;
    if (typeof input !== 'string') return null;

    if (input.startsWith('data:image/')) {
        const parts = input.split(',');
        if (parts.length < 2) return null;
        return Buffer.from(parts[1], 'base64');
    }

    const imagePath = normalizeImagePath(input);
    if (!imagePath) return null;
    try {
        const stat = await fs.promises.stat(imagePath);
        if (!stat.isFile()) return null;
    } catch (err) {
        return null;
    }
    return fs.promises.readFile(imagePath);
};

const decodeWithSharp = async (buffer) => {
    let sharp = null;
    try {
        sharp = require('sharp');
    } catch (err) {
        return null;
    }

    let pipeline = sharp(buffer, { failOnError: false });
    let metadata = null;
    try {
        metadata = await pipeline.metadata();
    } catch (err) {
        metadata = null;
    }

    if (!metadata || !metadata.width || !metadata.height) return null;

    const { data, info } = await pipeline.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const clamped = new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength);
    return { pixels: clamped, width: info.width, height: info.height };
};

const decodeWithNativeImage = async (buffer) => {
    try {
        let image = nativeImage.createFromBuffer(buffer);
        if (!image || image.isEmpty()) return null;

        const size = image.getSize();
        if (!size || !size.width || !size.height) return null;

        const outSize = image.getSize();
        const bitmap = image.toBitmap(); // BGRA
        if (!bitmap || !bitmap.length) return null;

        const clamped = new Uint8ClampedArray(bitmap.buffer, bitmap.byteOffset, bitmap.byteLength);
        // Convert BGRA -> RGBA in-place
        for (let i = 0; i < clamped.length; i += 4) {
            const b = clamped[i];
            clamped[i] = clamped[i + 2];
            clamped[i + 2] = b;
        }

        return { pixels: clamped, width: outSize.width, height: outSize.height };
    } catch (err) {
        return null;
    }
};

const decodeQrFromBuffer = async (buffer) => {
    let decoded = await decodeWithSharp(buffer);
    if (!decoded) {
        decoded = await decodeWithNativeImage(buffer);
    }
    if (!decoded || !decoded.pixels || !decoded.width || !decoded.height) return [];

    const code = jsQR(decoded.pixels, decoded.width, decoded.height, { inversionAttempts: 'attemptBoth' });
    if (!code || !code.data) return [];

    return [{
        id: `qr-${Date.now()}-0`,
        content: String(code.data)
    }];
};

const extractQRCodes = async (imageInput) => {
    const buffer = await loadImageBuffer(imageInput);
    if (!buffer) return [];
    return decodeQrFromBuffer(buffer);
};

module.exports = {
    extractQRCodes
};
