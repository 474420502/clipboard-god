import { DEFAULT_RECOGNITION_OPTIONS } from "./constants";
import { Image } from "./image";

export class RecognitionService {
    constructor(ortModule, session, options = {}) {
        this.session = session;
        this.ortModule = ortModule;
        this.textlineOrientationSession = options.textlineOrientationSession || null;
        this.textlineOrientationEnabled = options.textlineOrientationEnabled !== false;
        this.textlineOrientationSize = options.textlineOrientationSize || null;
        this.options = {
            ...DEFAULT_RECOGNITION_OPTIONS,
            ...options
        };
        this._inputSpec = null;
    }

    async run(image, detection, options) {
        const validBoxes = detection.filter((box) => box.width > 0 && box.height > 0);
        const results = [];
        const charWhiteListSet = options?.charWhiteList?.length ? new Set(options.charWhiteList) : undefined;
        const splitByGap = options?.splitByGap !== false;

        for (const [i, box] of validBoxes.entries()) {
            const boxes = splitByGap ? this.splitBoxByGap(image, box, options) : [box];
            for (const [subIndex, subBox] of boxes.entries()) {
                const result = await this.processBox({
                    image,
                    index: i * 1000 + subIndex,
                    box: subBox,
                    charWhiteSet: charWhiteListSet
                });
                if (result) {
                    results.push(result);
                }
            }
        }
        return this.sortResultsByReadingOrder(results);
    }

    splitBoxByGap(image, box, options) {
        const crop = image.crop(box);
        const width = crop.width;
        const height = crop.height;
        const channels = crop.channels;
        const data = crop.data;

        const inkThreshold = typeof options?.splitInkThreshold === "number" ? options.splitInkThreshold : 180;
        const minInkRatio = typeof options?.splitMinInkRatio === "number" ? options.splitMinInkRatio : 0.04;
        const gapRatio = typeof options?.splitGapRatio === "number" ? options.splitGapRatio : 0.15;
        const minGap = Math.max(
            typeof options?.splitMinGap === "number" ? options.splitMinGap : 2,
            Math.round(height * gapRatio)
        );

        const minInk = Math.max(1, Math.round(height * minInkRatio));
        const blankColumns = new Array(width).fill(false);

        for (let x = 0; x < width; x++) {
            let inkCount = 0;
            for (let y = 0; y < height; y++) {
                const idx = (y * width + x) * channels;
                const r = data[idx] || 0;
                const g = data[idx + 1] || 0;
                const b = data[idx + 2] || 0;
                const gray = channels === 1 ? r : 0.299 * r + 0.587 * g + 0.114 * b;
                if (gray < inkThreshold) {
                    inkCount++;
                    if (inkCount > minInk) break;
                }
            }
            blankColumns[x] = inkCount <= minInk;
        }

        const splitRanges = [];
        let runStart = -1;
        for (let x = 0; x < width; x++) {
            if (blankColumns[x]) {
                if (runStart === -1) runStart = x;
            } else if (runStart !== -1) {
                const runEnd = x - 1;
                if (runEnd - runStart + 1 >= minGap) {
                    splitRanges.push([runStart, runEnd]);
                }
                runStart = -1;
            }
        }
        if (runStart !== -1) {
            const runEnd = width - 1;
            if (runEnd - runStart + 1 >= minGap) {
                splitRanges.push([runStart, runEnd]);
            }
        }

        if (!splitRanges.length) {
            return [box];
        }

        const segments = [];
        let segStart = 0;
        for (const [gapStart, gapEnd] of splitRanges) {
            if (gapStart > segStart) {
                segments.push([segStart, gapStart - 1]);
            }
            segStart = gapEnd + 1;
        }
        if (segStart < width) {
            segments.push([segStart, width - 1]);
        }

        const filtered = segments.filter(([start, end]) => end - start + 1 >= 2);
        if (filtered.length <= 1) {
            return [box];
        }

        return filtered.map(([start, end]) => ({
            x: box.x + start,
            y: box.y,
            width: end - start + 1,
            height: box.height
        }));
    }

    async processBox(task) {
        const { image, box } = task;
        let crop = image.crop(box);
        if (this.textlineOrientationSession && this.textlineOrientationEnabled) {
            const shouldRotate = await this.runTextlineOrientation(crop);
            if (shouldRotate) {
                crop = crop.rotate180();
            }
        }
        const inputSpec = this.getInputSpec();
        const resizeOptions = {
            height: inputSpec.height || this.options.imageHeight
        };
        if (inputSpec.width) {
            resizeOptions.width = inputSpec.width;
        }
        const resizedCrop = crop.resize(resizeOptions);
        const tensor = resizedCrop.tensor({
            mean_values: this.options.mean,
            norm_values: this.options.stdDeviation
        });

        const { inputData, inputDims } = this.buildInputTensor(tensor, resizedCrop, inputSpec.layout);
        const inputTensor = new this.ortModule.Tensor("float32", inputData, inputDims);
        const { data: outputData, dims: shape } = await this.runInference(inputTensor, inputSpec.name);

        const [, sequenceLength, numClasses] = shape;
        const { text: recognizedText, confidence } = this.ctcLabelDecode(
            outputData,
            sequenceLength,
            numClasses,
            task.charWhiteSet
        );

        return { text: recognizedText, box, confidence };
    }

    async runTextlineOrientation(crop) {
        const target = this.textlineOrientationSize || { width: 160, height: 80 };
        const resized = crop.resize({ width: target.width, height: target.height });
        const tensor = resized.tensor({
            mean_values: [0, 0, 0],
            norm_values: [1 / 255, 1 / 255, 1 / 255]
        });
        const inputName = this.getSessionInputName(this.textlineOrientationSession, "x");
        const inputTensor = new this.ortModule.Tensor("float32", tensor, [1, 3, resized.height, resized.width]);
        const results = await this.textlineOrientationSession.run({ [inputName]: inputTensor });
        const outputName = Object.keys(results)[0];
        const outputTensor = results[outputName];
        if (!outputTensor) return false;
        const data = outputTensor.data;
        let maxIndex = 0;
        let maxValue = data[0];
        for (let i = 1; i < data.length; i++) {
            if (data[i] > maxValue) {
                maxValue = data[i];
                maxIndex = i;
            }
        }
        return maxIndex === 1;
    }

    sortResultsByReadingOrder(results) {
        return [...results].sort((a, b) => {
            const boxA = a.box;
            const boxB = b.box;
            if (Math.abs(boxA.y - boxB.y) < (boxA.height + boxB.height) / 4) {
                return boxA.x - boxB.x;
            }
            return boxA.y - boxB.y;
        });
    }

    async runInference(inputTensor, inputName = "x") {
        const feeds = { [inputName]: inputTensor };
        const results = await this.session.run(feeds);
        const outputNodeName = Object.keys(results)[0];
        const outputTensor = results[outputNodeName];
        if (!outputTensor) {
            throw new Error(
                `Recognition output tensor '${outputNodeName}' not found. Available keys: ${Object.keys(results)}`
            );
        }
        return outputTensor;
    }

    getInputSpec() {
        const debug = !!(
            this.options.debug &&
            typeof globalThis !== "undefined" &&
            globalThis.__OCR_DEBUG__ === true
        );
        if (this._inputSpec) {
            if (debug) {
                console.log("[RecognitionService] getInputSpec() returning cached:", this._inputSpec);
            }
            return this._inputSpec;
        }
        const inputName = this.getSessionInputName(this.session, "x");
        const meta = this.session?.inputMetadata?.[inputName];
        if (debug) {
            console.log("[RecognitionService] getInputSpec() raw meta:", meta);
        }
        const dims = meta?.dimensions || meta?.shape || meta?.dims;
        if (debug) {
            console.log("[RecognitionService] getInputSpec() raw dims:", dims, "type:", typeof dims);
        }
        const spec = { name: inputName, layout: "NCHW", height: null, width: null };

        if (Array.isArray(dims) && dims.length >= 4) {
            const [d0, d1, d2, d3] = dims;
            const toSize = (v) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null);
            const size1 = toSize(d1);
            const size2 = toSize(d2);
            const size3 = toSize(d3);

            if (debug) {
                console.log("[RecognitionService] parsed dims:", { d0, d1, d2, d3, size1, size2, size3 });
            }

            if (size1 === 3) {
                spec.layout = "NCHW";
                spec.height = size2;
                spec.width = size3;
            } else if (size3 === 3) {
                spec.layout = "NHWC";
                spec.height = size1;
                spec.width = size2;
            } else if (size2 === 3) {
                spec.layout = "NCHW";
                spec.height = size1;
                spec.width = size3;
            }
        }

        // 如果解析失败，使用 PP-OCRv5 识别的标准高度 48
        if (!spec.height) {
            if (debug) {
                console.warn("[RecognitionService] getInputSpec() failed to parse, using fallback height=48");
            }
            spec.height = 48;
        }
        if (!spec.width) {
            if (debug) {
                console.warn("[RecognitionService] getInputSpec() width is null, will use crop width");
            }
        }

        if (debug) {
            console.log("[RecognitionService] getInputSpec() final result:", spec);
        }
        this._inputSpec = spec;
        return spec;
    }

    buildInputTensor(chwTensor, resizedCrop, layout) {
        const height = resizedCrop.height;
        const width = resizedCrop.width;
        if (layout === "NHWC") {
            const hwc = new Float32Array(height * width * 3);
            const channelStride = height * width;
            for (let c = 0; c < 3; c++) {
                const offset = c * channelStride;
                for (let i = 0; i < channelStride; i++) {
                    hwc[i * 3 + c] = chwTensor[offset + i];
                }
            }
            return { inputData: hwc, inputDims: [1, height, width, 3] };
        }
        if (layout === "NHCW") {
            const nhcw = new Float32Array(height * width * 3);
            const channelStride = height * width;
            for (let h = 0; h < height; h++) {
                for (let w = 0; w < width; w++) {
                    const base = h * width + w;
                    for (let c = 0; c < 3; c++) {
                        nhcw[(h * 3 + c) * width + w] = chwTensor[c * channelStride + base];
                    }
                }
            }
            return { inputData: nhcw, inputDims: [1, height, 3, width] };
        }
        return { inputData: chwTensor, inputDims: [1, 3, height, width] };
    }

    getSessionInputName(session, fallback) {
        const names = session?.inputNames;
        if (Array.isArray(names) && names.length) {
            return names[0];
        }
        return fallback;
    }

    ctcLabelDecode(logits, sequenceLength, numClasses, charWhiteSet) {
        const dict = this.options.charactersDictionary || [];
        let text = "";
        const scores = [];
        let lastIndex = -1;

        for (let t = 0; t < sequenceLength; t++) {
            let maxScore = 0;
            let maxScoreIndex = 0;

            const offset = t * numClasses;
            for (let i = 0; i < numClasses; i++) {
                const val = logits[offset + i];
                if (val > maxScore) {
                    maxScore = val;
                    maxScoreIndex = i;
                }
            }

            if (maxScoreIndex === lastIndex) {
                continue;
            }

            lastIndex = maxScoreIndex;

            if (maxScoreIndex === 0) {
                continue;
            }

            const char = dict[maxScoreIndex] || "";

            if (charWhiteSet && !charWhiteSet.has(char) && char !== " ") {
                continue;
            }

            text += char;
            scores.push(maxScore);
        }

        return {
            text,
            confidence: scores.length > 0 ? scores.reduce((sum, score) => sum + score, 0) / scores.length : 0
        };
    }
}
