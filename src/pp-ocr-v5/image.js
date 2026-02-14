export class Image {
    constructor(width, height, channels, data) {
        this.width = width;
        this.height = height;
        this.channels = channels;
        this.depth = 8;
        if (data) {
            this.data = data;
        } else {
            const length = width * height * 4;
            this.data = new Uint8Array(length);
        }
    }

    crop(options) {
        const { x, y, width, height } = options;
        if (x < 0 || y < 0 || x + width > this.width || y + height > this.height) {
            throw new Error("Crop area is out of bounds");
        }
        const croppedData = new Uint8Array(width * height * this.channels);
        for (let j = 0; j < height; j++) {
            for (let i = 0; i < width; i++) {
                const srcIndex = ((y + j) * this.width + (x + i)) * this.channels;
                const dstIndex = (j * width + i) * this.channels;
                croppedData.set(this.data.subarray(srcIndex, srcIndex + this.channels), dstIndex);
            }
        }
        return new Image(width, height, this.channels, croppedData);
    }

    resize(options) {
        let { width, height } = options;
        if (!width && !height) {
            throw new Error("At least one of width or height must be specified");
        }
        if (!width) width = Math.round(this.width * (height / this.height));
        if (!height) height = Math.round(this.height * (width / this.width));

        const srcW = this.width;
        const srcH = this.height;
        const dstW = width;
        const dstH = height;
        const channels = this.channels;
        const srcData = this.data;

        function triangleKernel(x) {
            x = Math.abs(x);
            return x < 1 ? 1 - x : 0;
        }

        function clamp(v, min, max) {
            return Math.max(min, Math.min(max, v));
        }

        const tmpData = new Float32Array(srcW * dstH * channels);
        const ratioY = srcH / dstH;
        const sratioY = ratioY < 1 ? 1 : ratioY;
        const supportY = 1.0 * sratioY;

        for (let outy = 0; outy < dstH; outy++) {
            const inputy = (outy + 0.5) * ratioY - 0.5;
            const left = Math.max(0, Math.floor(inputy - supportY));
            const right = Math.min(srcH, Math.ceil(inputy + supportY));

            const ws = [];
            let sum = 0;
            for (let i = left; i < right; i++) {
                const w = triangleKernel((i - inputy) / sratioY);
                ws.push(w);
                sum += w;
            }
            for (let i = 0; i < ws.length; i++) ws[i] /= sum;

            for (let x = 0; x < srcW; x++) {
                for (let c = 0; c < channels; c++) {
                    let t = 0;
                    for (let i = 0; i < ws.length; i++) {
                        const srcIdx = ((left + i) * srcW + x) * channels + c;
                        t += srcData[srcIdx] * ws[i];
                    }
                    tmpData[(outy * srcW + x) * channels + c] = t;
                }
            }
        }

        const dstData = new Uint8Array(dstW * dstH * channels);
        const ratioX = srcW / dstW;
        const sratioX = ratioX < 1 ? 1 : ratioX;
        const supportX = 1.0 * sratioX;

        for (let outx = 0; outx < dstW; outx++) {
            const inputx = (outx + 0.5) * ratioX - 0.5;
            const left = Math.max(0, Math.floor(inputx - supportX));
            const right = Math.min(srcW, Math.ceil(inputx + supportX));

            const ws = [];
            let sum = 0;
            for (let i = left; i < right; i++) {
                const w = triangleKernel((i - inputx) / sratioX);
                ws.push(w);
                sum += w;
            }
            for (let i = 0; i < ws.length; i++) ws[i] /= sum;

            for (let y = 0; y < dstH; y++) {
                for (let c = 0; c < channels; c++) {
                    let t = 0;
                    for (let i = 0; i < ws.length; i++) {
                        const srcIdx = (y * srcW + (left + i)) * channels + c;
                        t += tmpData[srcIdx] * ws[i];
                    }
                    dstData[(y * dstW + outx) * channels + c] = Math.round(clamp(t, 0, 255));
                }
            }
        }

        return new Image(dstW, dstH, channels, dstData);
    }

    padding(options) {
        let { padding, vertical, horizontal, top, bottom, left, right, color } = options;
        if (typeof padding === "number") {
            top = bottom = left = right = padding;
        } else {
            if (typeof vertical === "number") {
                top = bottom = vertical;
            }
            if (typeof horizontal === "number") {
                left = right = horizontal;
            }
        }
        top = top ?? 0;
        bottom = bottom ?? 0;
        left = left ?? 0;
        right = right ?? 0;
        color = color ?? [0, 0, 0, 0];
        const newW = this.width + left + right;
        const newH = this.height + top + bottom;
        const newData = new Uint8Array(newW * newH * 4);
        for (let y = 0; y < newH; y++) {
            for (let x = 0; x < newW; x++) {
                const idx = (y * newW + x) * 4;
                newData[idx] = color[0];
                newData[idx + 1] = color[1];
                newData[idx + 2] = color[2];
                newData[idx + 3] = color[3];
            }
        }
        for (let y = 0; y < this.height; y++) {
            for (let x = 0; x < this.width; x++) {
                const srcIdx = (y * this.width + x) * 4;
                const dstIdx = ((y + top) * newW + (x + left)) * 4;
                newData.set(this.data.subarray(srcIdx, srcIdx + 4), dstIdx);
            }
        }
        return new Image(newW, newH, this.channels, newData);
    }

    tensor(options) {
        const mean = options.mean_values;
        const norm = options.norm_values;
        const width = this.width;
        const height = this.height;
        const numChannels = 3;
        const rgbaData = this.data;
        const tensor = new Float32Array(width * height * numChannels);
        for (let h = 0; h < height; h++) {
            for (let w = 0; w < width; w++) {
                const pixelIndex = (h * width + w) * this.channels;
                const tensorIndex = h * width + w;
                for (let c = 0; c < numChannels; c++) {
                    const pixelValue = rgbaData[pixelIndex + c];
                    const normalizedValue = pixelValue * norm[c] - mean[c] * norm[c];
                    tensor[c * height * width + tensorIndex] = normalizedValue;
                }
            }
        }
        return tensor;
    }

    threshold(options) {
        const threshold = options.threshold ?? 128;
        const width = this.width;
        const height = this.height;
        const binData = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            binData[i] = this.data[i * this.channels] > threshold ? 255 : 0;
        }
        return new Image(width, height, 1, binData);
    }

    dilate(options = {}) {
        const { norm = "LInf", k = 1 } = options;
        if (norm !== "LInf") {
            throw new Error("Only LInf norm is supported");
        }
        if (this.channels !== 1) {
            throw new Error("Dilate only supports single channel images");
        }
        const width = this.width;
        const height = this.height;
        const src = this.data;
        const INF = 999999;
        const dist = new Uint16Array(width * height);
        for (let i = 0; i < width * height; i++) {
            dist[i] = src[i] > 0 ? 0 : INF;
        }
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = y * width + x;
                if (dist[idx] === 0) continue;
                let minDist = INF;
                for (let dy = -1; dy <= 0; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nidx = ny * width + nx;
                            minDist = Math.min(minDist, dist[nidx] + 1);
                        }
                    }
                }
                dist[idx] = Math.min(dist[idx], minDist);
            }
        }
        for (let y = height - 1; y >= 0; y--) {
            for (let x = width - 1; x >= 0; x--) {
                const idx = y * width + x;
                if (dist[idx] === 0) continue;
                let minDist = INF;
                for (let dy = 0; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        if (dx === 0 && dy === 0) continue;
                        const nx = x + dx;
                        const ny = y + dy;
                        if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                            const nidx = ny * width + nx;
                            minDist = Math.min(minDist, dist[nidx] + 1);
                        }
                    }
                }
                dist[idx] = Math.min(dist[idx], minDist);
            }
        }
        const out = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            out[i] = dist[i] <= k ? 255 : 0;
        }
        return new Image(width, height, 1, out);
    }

    contours(options = {}) {
        const minArea = options.minArea ?? 1;
        const width = this.width;
        const height = this.height;
        const bin = new Uint8Array(width * height);
        for (let i = 0; i < width * height; i++) {
            bin[i] = this.data[i] > 0 ? 1 : 0;
        }
        const visited = new Uint8Array(width * height);
        const boxes = [];
        const at = (x, y) => y * width + x;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                if (bin[at(x, y)] && !visited[at(x, y)]) {
                    let minX = x;
                    let minY = y;
                    let maxX = x;
                    let maxY = y;
                    let area = 0;
                    const queue = [[x, y]];
                    visited[at(x, y)] = 1;
                    while (queue.length) {
                        const [cx, cy] = queue.shift();
                        area++;
                        minX = Math.min(minX, cx);
                        minY = Math.min(minY, cy);
                        maxX = Math.max(maxX, cx);
                        maxY = Math.max(maxY, cy);
                        for (const [dx, dy] of [
                            [-1, 0],
                            [1, 0],
                            [0, -1],
                            [0, 1],
                            [-1, -1],
                            [1, -1],
                            [-1, 1],
                            [1, 1]
                        ]) {
                            const nx = cx + dx;
                            const ny = cy + dy;
                            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
                                const idx = at(nx, ny);
                                if (bin[idx] && !visited[idx]) {
                                    visited[idx] = 1;
                                    queue.push([nx, ny]);
                                }
                            }
                        }
                    }
                    if (area >= minArea) {
                        boxes.push({
                            x: minX,
                            y: minY,
                            width: maxX - minX + 1,
                            height: maxY - minY + 1
                        });
                    }
                }
            }
        }
        return boxes;
    }

    rotate90() {
        const newWidth = this.height;
        const newHeight = this.width;
        const channels = this.channels;
        const out = new Uint8Array(newWidth * newHeight * channels);
        for (let y = 0; y < newHeight; y++) {
            for (let x = 0; x < newWidth; x++) {
                const srcX = y;
                const srcY = this.height - 1 - x;
                const srcIdx = (srcY * this.width + srcX) * channels;
                const dstIdx = (y * newWidth + x) * channels;
                out.set(this.data.subarray(srcIdx, srcIdx + channels), dstIdx);
            }
        }
        return new Image(newWidth, newHeight, channels, out);
    }

    rotate180() {
        const newWidth = this.width;
        const newHeight = this.height;
        const channels = this.channels;
        const out = new Uint8Array(newWidth * newHeight * channels);
        for (let y = 0; y < newHeight; y++) {
            for (let x = 0; x < newWidth; x++) {
                const srcX = this.width - 1 - x;
                const srcY = this.height - 1 - y;
                const srcIdx = (srcY * this.width + srcX) * channels;
                const dstIdx = (y * newWidth + x) * channels;
                out.set(this.data.subarray(srcIdx, srcIdx + channels), dstIdx);
            }
        }
        return new Image(newWidth, newHeight, channels, out);
    }

    rotate270() {
        const newWidth = this.height;
        const newHeight = this.width;
        const channels = this.channels;
        const out = new Uint8Array(newWidth * newHeight * channels);
        for (let y = 0; y < newHeight; y++) {
            for (let x = 0; x < newWidth; x++) {
                const srcX = this.width - 1 - y;
                const srcY = x;
                const srcIdx = (srcY * this.width + srcX) * channels;
                const dstIdx = (y * newWidth + x) * channels;
                out.set(this.data.subarray(srcIdx, srcIdx + channels), dstIdx);
            }
        }
        return new Image(newWidth, newHeight, channels, out);
    }
}
