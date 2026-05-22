import * as ort from "onnxruntime-web";
import ortWasmSimdThreadedUrl from "onnxruntime-web/ort-wasm-simd-threaded.wasm?url";
import ortWasmSimdThreadedJsepUrl from "onnxruntime-web/ort-wasm-simd-threaded.jsep.wasm?url";
import ortWasmSimdThreadedJspiUrl from "onnxruntime-web/ort-wasm-simd-threaded.jspi.wasm?url";
import ortWasmSimdThreadedAsyncifyUrl from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { DEFAULT_DETECTION_OPTIONS, DEFAULT_RECOGNITION_OPTIONS } from "./constants";
import { DetectionService } from "./detection";
import { RecognitionService } from "./recognition";
import { Image as OcrImage } from "./image";

let initPromise = null;
let service = null;

const ensureWasmPaths = () => {
    if (ort.env?.wasm?.wasmPaths) {
        return;
    }
    ort.env.wasm.wasmPaths = {
        "ort-wasm-simd-threaded.wasm": ortWasmSimdThreadedUrl,
        "ort-wasm-simd-threaded.jsep.wasm": ortWasmSimdThreadedJsepUrl,
        "ort-wasm-simd-threaded.jspi.wasm": ortWasmSimdThreadedJspiUrl,
        "ort-wasm-simd-threaded.asyncify.wasm": ortWasmSimdThreadedAsyncifyUrl
    };
};

const resolveExecutionProviders = (options = {}) => {
    const eps = options.executionProviders || options.ortExecutionProviders;
    if (Array.isArray(eps) && eps.length) {
        return eps.map((v) => String(v));
    }
    // Default to wasm for stability. WebGPU may be unavailable on many Linux/Electron environments.
    return ["wasm"];
};

const defaultAssets = () => ({
    detModelUrl: new URL("./assets/PP-OCRv5_mobile_det_infer.onnx", import.meta.url).toString(),
    recModelUrl: new URL("./assets/PP-OCRv5_mobile_rec_infer.onnx", import.meta.url).toString(),
    dictUrl: new URL("./assets/ppocrv5_dict.txt", import.meta.url).toString()
});

const preprocessAssets = (options = {}) => {
    if (options.preprocessAssets) return options.preprocessAssets;
    return {
        docOrientation: {
            modelUrl: new URL("./preprocessing/doc-orientation/PP-LCNet_x1_0_doc_ori.onnx", import.meta.url).toString(),
            configUrl: new URL("./preprocessing/doc-orientation/config.json", import.meta.url).toString()
        },
        docUnwarp: {
            modelUrl: new URL("./preprocessing/doc-unwarping/UVDoc.onnx", import.meta.url).toString(),
            configUrl: new URL("./preprocessing/doc-unwarping/config.json", import.meta.url).toString()
        },
        textlineOrientation: {
            modelUrl: new URL("./preprocessing/textline-orientation/PP-LCNet_x1_0_textline_ori.onnx", import.meta.url).toString(),
            configUrl: new URL("./preprocessing/textline-orientation/config.json", import.meta.url).toString()
        }
    };
};

const normalizeImageSrc = (input) => {
    if (!input || typeof input !== "string") return "";
    if (input.startsWith("data:image/")) return input;
    if (input.startsWith("file://")) return input;
    if (input.startsWith("blob:")) return input;
    return `file://${encodeURI(input)}`;
};

const loadImage = (input) => new Promise((resolve, reject) => {
    if (input instanceof HTMLImageElement) {
        if (input.complete && input.naturalWidth) {
            resolve(input);
            return;
        }
        input.onload = () => resolve(input);
        input.onerror = () => reject(new Error("image-load-failed"));
        return;
    }

    const src = normalizeImageSrc(input);
    if (!src) {
        reject(new Error("invalid-image"));
        return;
    }

    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image-load-failed"));
    img.src = src;
});

const imageToInput = (img, canvas) => {
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const workingCanvas = canvas || document.createElement("canvas");
    workingCanvas.width = width;
    workingCanvas.height = height;
    const ctx = workingCanvas.getContext("2d");
    if (!ctx) {
        throw new Error("canvas-context-failed");
    }
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    return {
        width,
        height,
        data: new Uint8Array(imageData.data.buffer)
    };
};

const fetchArrayBuffer = async (url) => {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`model-fetch-failed:${res.status}`);
    }
    return res.arrayBuffer();
};

const fetchText = async (url) => {
    const res = await fetch(url);
    if (!res.ok) {
        throw new Error(`dict-fetch-failed:${res.status}`);
    }
    return res.text();
};

const safeParseJson = (content) => {
    try {
        return JSON.parse(content);
    } catch (_) {
        return null;
    }
};

const parseInputShape = (inputShape) => {
    if (!inputShape) return null;
    if (Array.isArray(inputShape)) {
        const numbers = inputShape.filter((value) => typeof value === "number" && value > 0);
        if (numbers.length >= 2) {
            return { height: numbers[numbers.length - 2], width: numbers[numbers.length - 1] };
        }
        return null;
    }
    if (typeof inputShape === "string") {
        const matches = inputShape.match(/\d+/g);
        if (!matches || matches.length < 2) return null;
        const values = matches.map((value) => parseInt(value, 10)).filter((value) => value > 0);
        if (values.length < 2) return null;
        return { height: values[values.length - 2], width: values[values.length - 1] };
    }
    return null;
};

const getInputSizeFromSession = (session) => {
    if (!session || !session.inputNames || !session.inputNames.length) return null;
    const inputName = session.inputNames[0];
    const meta = session.inputMetadata?.[inputName];
    const dims = meta?.dimensions;
    if (!dims || !Array.isArray(dims)) return null;
    const height = dims[dims.length - 2];
    const width = dims[dims.length - 1];
    if (typeof height === "number" && typeof width === "number" && height > 0 && width > 0) {
        return { height, width };
    }
    return null;
};

const resolveInputSize = (session, config, fallback) => {
    const fromConfig = parseInputShape(config?.input_shape);
    if (fromConfig) return fromConfig;
    const fromSession = getInputSizeFromSession(session);
    if (fromSession) return fromSession;
    return fallback || null;
};

const buildDictionary = (content) => {
    const lines = content.split(/\r?\n/);
    if (!lines.length) {
        return [""];
    }
    return lines;
};

const rotateImage = (image, angle) => {
    if (!angle || angle === 0) return image;
    if (angle === 180) return image.rotate180();
    if (angle === 90) return image.rotate90();
    if (angle === 270) return image.rotate270();
    return image;
};

const tensorFromImage = (image) => {
    const normalized = image.tensor({
        mean_values: [0, 0, 0],
        norm_values: [1 / 255, 1 / 255, 1 / 255]
    });
    return new ort.Tensor("float32", normalized, [1, 3, image.height, image.width]);
};

const tensorToImage = (tensor) => {
    const dims = tensor.dims || [];
    if (dims.length !== 4) {
        throw new Error("invalid-unwarp-output");
    }
    const [, channels, height, width] = dims;
    const data = tensor.data;
    const out = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const base = (y * width + x) * 4;
            for (let c = 0; c < 3; c++) {
                const srcIdx = c * height * width + y * width + x;
                const value = data[srcIdx];
                out[base + c] = Math.max(0, Math.min(255, Math.round(value * 255)));
            }
            out[base + 3] = channels === 4
                ? Math.max(0, Math.min(255, Math.round(data[3 * height * width + y * width + x] * 255)))
                : 255;
        }
    }
    return new OcrImage(width, height, 4, out);
};

const argMax = (data) => {
    let maxIndex = 0;
    let maxValue = data[0];
    for (let i = 1; i < data.length; i++) {
        if (data[i] > maxValue) {
            maxValue = data[i];
            maxIndex = i;
        }
    }
    return maxIndex;
};

const processRecognition = (recognition, options = {}) => {
    const result = {
        text: "",
        lines: [],
        confidence: 0
    };

    if (!recognition.length) {
        return result;
    }

    const totalConfidence = recognition.reduce((sum, r) => sum + r.confidence, 0);
    result.confidence = totalConfidence / recognition.length;

    const lineGapRatio = typeof options.lineMergeThresholdRatio === "number" ? options.lineMergeThresholdRatio : 0.5;
    const lineGapMin = typeof options.lineMergeThresholdPx === "number" ? options.lineMergeThresholdPx : 0;
    const spaceGapRatio = typeof options.spaceGapRatio === "number" ? options.spaceGapRatio : 0.2;
    const spaceGapMin = typeof options.spaceGapMinPx === "number" ? options.spaceGapMinPx : 2;
    const insertSpaceByGap = options.insertSpaceByGap !== false;

    const lines = [];
    let currentLine = [recognition[0]];
    let lineAvgY = recognition[0].box.y;
    let lineAvgH = recognition[0].box.height;

    for (let i = 1; i < recognition.length; i++) {
        const current = recognition[i];
        const verticalGap = Math.abs(current.box.y - lineAvgY);
        const threshold = Math.max(lineGapMin, lineAvgH * lineGapRatio);

        if (verticalGap <= threshold) {
            currentLine.push(current);
            lineAvgY = currentLine.reduce((sum, r) => sum + r.box.y, 0) / currentLine.length;
            lineAvgH = currentLine.reduce((sum, r) => sum + r.box.height, 0) / currentLine.length;
        } else {
            lines.push([...currentLine]);
            currentLine = [current];
            lineAvgY = current.box.y;
            lineAvgH = current.box.height;
        }
    }

    if (currentLine.length > 0) {
        lines.push([...currentLine]);
    }

    const fullText = lines
        .map((line) => {
            const sorted = [...line].sort((a, b) => a.box.x - b.box.x);
            if (!insertSpaceByGap) {
                return sorted.map((item) => item.text).join("");
            }
            const avgHeight = sorted.reduce((sum, item) => sum + item.box.height, 0) / sorted.length;
            const gapThreshold = Math.max(spaceGapMin, avgHeight * spaceGapRatio);
            let lineText = "";
            for (let i = 0; i < sorted.length; i++) {
                const item = sorted[i];
                if (i === 0) {
                    lineText += item.text;
                    continue;
                }
                const prev = sorted[i - 1];
                const gap = item.box.x - (prev.box.x + prev.box.width);
                if (gap >= gapThreshold) {
                    lineText += " ";
                }
                lineText += item.text;
            }
            return lineText;
        })
        .join("\n");

    result.lines = lines;
    result.text = fullText;
    return result;
};

const applyDocOrientation = async (image, session, inputSize) => {
    if (!session || !inputSize) return image;
    const resized = image.resize({ width: inputSize.width, height: inputSize.height });
    const inputTensor = tensorFromImage(resized);
    const results = await session.run({ x: inputTensor });
    const outputName = Object.keys(results)[0];
    const output = results[outputName];
    if (!output) return image;
    const index = argMax(output.data);
    const angleMap = [0, 90, 180, 270];
    const angle = angleMap[index] || 0;
    return rotateImage(image, angle);
};

const applyDocUnwarp = async (image, session, inputSize) => {
    if (!session || !inputSize) return image;
    const resized = image.resize({ width: inputSize.width, height: inputSize.height });
    const inputTensor = tensorFromImage(resized);
    const results = await session.run({ x: inputTensor });
    const outputName = Object.keys(results)[0];
    const output = results[outputName];
    if (!output) return image;
    return tensorToImage(output);
};

const ensureService = async (options = {}) => {
    const modelSource = "builtin";
    const modelLanguage = options.modelLanguage || "chinese";
    const preprocessModels = {
        docOrientation: true,
        docUnwarp: true,
        textlineOrientation: true,
        ...(options.preprocessModels || {})
    };

    if (
        service &&
        service.modelSource === modelSource &&
        service.modelLanguage === modelLanguage &&
        JSON.stringify(service.preprocessModels || {}) === JSON.stringify(preprocessModels)
    ) {
        return service;
    }

    if (service && typeof service.destroy === "function") {
        await service.destroy();
    }
    if (initPromise) return initPromise;

    initPromise = (async () => {
        ensureWasmPaths();
        const executionProviders = resolveExecutionProviders(options);
        const assets = defaultAssets();
        const preprocess = preprocessAssets(options);

        const detModelUrl = options.detModelUrl || assets.detModelUrl;
        const recModelUrl = options.recModelUrl || assets.recModelUrl;
        const dictUrl = options.dictUrl || assets.dictUrl;

        const [detBuffer, recBuffer, dictText] = await Promise.all([
            fetchArrayBuffer(detModelUrl),
            fetchArrayBuffer(recModelUrl),
            fetchText(dictUrl)
        ]);

        const preprocessPromises = [];
        if (preprocessModels.docOrientation && preprocess.docOrientation?.modelUrl) {
            preprocessPromises.push(fetchArrayBuffer(preprocess.docOrientation.modelUrl));
        } else {
            preprocessPromises.push(Promise.resolve(null));
        }
        if (preprocessModels.docUnwarp && preprocess.docUnwarp?.modelUrl) {
            preprocessPromises.push(fetchArrayBuffer(preprocess.docUnwarp.modelUrl));
        } else {
            preprocessPromises.push(Promise.resolve(null));
        }
        if (preprocessModels.textlineOrientation && preprocess.textlineOrientation?.modelUrl) {
            preprocessPromises.push(fetchArrayBuffer(preprocess.textlineOrientation.modelUrl));
        } else {
            preprocessPromises.push(Promise.resolve(null));
        }

        const configPromises = [
            Promise.resolve(""),
            preprocess.docOrientation?.configUrl ? fetchText(preprocess.docOrientation.configUrl) : Promise.resolve(""),
            preprocess.docUnwarp?.configUrl ? fetchText(preprocess.docUnwarp.configUrl) : Promise.resolve(""),
            preprocess.textlineOrientation?.configUrl ? fetchText(preprocess.textlineOrientation.configUrl) : Promise.resolve("")
        ];

        const [docOrientationBuffer, docUnwarpBuffer, textlineOrientationBuffer] = await Promise.all(preprocessPromises);
        const [languageConfigText, docOrientationConfigText, docUnwarpConfigText, textlineConfigText] = await Promise.all(configPromises);
        const languageConfig = safeParseJson(languageConfigText);
        const docOrientationConfig = safeParseJson(docOrientationConfigText);
        const docUnwarpConfig = safeParseJson(docUnwarpConfigText);
        const textlineConfig = safeParseJson(textlineConfigText);

        const sessionOptions = { executionProviders };
        const detectionSession = await ort.InferenceSession.create(detBuffer, sessionOptions);
        const recognitionSession = await ort.InferenceSession.create(recBuffer, sessionOptions);

        const fallbackDictionary = buildDictionary(dictText);
        const charactersDictionary = options.recognition?.charactersDictionary?.length
            ? options.recognition.charactersDictionary
            : fallbackDictionary;

        const recInputSize = resolveInputSize(null, languageConfig, { height: 32, width: 320 });
        const detection = new DetectionService(ort, detectionSession, {
            ...DEFAULT_DETECTION_OPTIONS,
            ...(options.detection || {}),
            ...(typeof options.nmsThreshold === "number" ? { nmsThreshold: options.nmsThreshold } : {})
        });
        const recognition = new RecognitionService(ort, recognitionSession, {
            ...DEFAULT_RECOGNITION_OPTIONS,
            ...(options.recognition || {}),
            charactersDictionary,
            textlineOrientationSession: textlineOrientationBuffer
                ? await ort.InferenceSession.create(textlineOrientationBuffer, sessionOptions)
                : null,
            textlineOrientationEnabled: !!textlineOrientationBuffer
        });

        const docOrientationSession = docOrientationBuffer
            ? await ort.InferenceSession.create(docOrientationBuffer, sessionOptions)
            : null;
        const docUnwarpSession = docUnwarpBuffer ? await ort.InferenceSession.create(docUnwarpBuffer, sessionOptions) : null;

        const docOrientationSize = resolveInputSize(docOrientationSession, docOrientationConfig, { width: 224, height: 224 });
        const docUnwarpSize = resolveInputSize(docUnwarpSession, docUnwarpConfig, { width: 640, height: 640 });
        const textlineOrientationSize = resolveInputSize(
            recognition.textlineOrientationSession,
            textlineConfig,
            { width: 160, height: 80 }
        );
        recognition.textlineOrientationSize = textlineOrientationSize;

        service = {
            detection,
            recognition,
            detModelUrl,
            recModelUrl,
            dictUrl,
            modelSource,
            modelLanguage,
            preprocessModels,
            docOrientationSession,
            docUnwarpSession,
            docOrientationSize,
            docUnwarpSize,
            destroy: async () => {
                await detectionSession.release();
                await recognitionSession.release();
                await docOrientationSession?.release();
                await docUnwarpSession?.release();
                await recognition?.textlineOrientationSession?.release?.();
                service = null;
                initPromise = null;
            }
        };

        return service;
    })().catch((err) => {
        initPromise = null;
        throw err;
    });

    return initPromise;
};

const toBlockPoints = (box) => {
    const x = box.x;
    const y = box.y;
    const right = x + box.width;
    const bottom = y + box.height;
    return [
        { x, y },
        { x: right, y },
        { x: right, y: bottom },
        { x, y: bottom }
    ];
};

const averageBoxHeight = (recognition) => {
    if (!recognition || !recognition.length) return 0;
    const total = recognition.reduce((sum, item) => sum + item.box.height, 0);
    return total / recognition.length;
};

const resolveUpscaleOptions = (options = {}) => {
    const raw = options.upscaleOnLowConfidence || options.upscale || {};
    const fixedScale = typeof raw.scale === "number" && raw.scale > 1 ? raw.scale : null;
    const baseScale = typeof raw.baseScale === "number" && raw.baseScale > 1
        ? raw.baseScale
        : (fixedScale ?? 2);
    const maxScale = typeof raw.maxScale === "number" && raw.maxScale > 1
        ? raw.maxScale
        : Math.max(baseScale, 4);
    const attempts = typeof raw.attempts === "number" && raw.attempts > 0
        ? Math.min(3, Math.floor(raw.attempts))
        : 1;
    return {
        enabled: raw.enabled === true,
        minConfidence: typeof raw.minConfidence === "number" ? raw.minConfidence : 0.6,
        minAvgBoxHeight: typeof raw.minAvgBoxHeight === "number" ? raw.minAvgBoxHeight : 12,
        adaptive: raw.adaptive === true || fixedScale === null,
        scale: fixedScale ?? baseScale,
        baseScale,
        maxScale,
        attempts,
        debug: raw.debug === true,
        maxSide: typeof raw.maxSide === "number" && raw.maxSide > 0 ? raw.maxSide : 3000
    };
};

const computeAdaptiveUpscaleScale = (avgHeight, confidence, options) => {
    const baseScale = options.baseScale;
    const maxScale = options.maxScale;

    if (!avgHeight || avgHeight <= 0) {
        return Math.min(baseScale, maxScale);
    }

    let scale;
    if (avgHeight < 8) scale = 3.0;
    else if (avgHeight < 10) scale = 2.5;
    else if (avgHeight < 12) scale = 2.0;
    else if (avgHeight < 14) scale = 1.6;
    else if (avgHeight < 16) scale = 1.35;
    else scale = 1.2;

    if (confidence < 0.45) scale = Math.max(scale, 2.5);
    else if (confidence < 0.55) scale = Math.max(scale, 2.0);
    else if (confidence < 0.6) scale = Math.max(scale, 1.6);

    if (avgHeight < options.minAvgBoxHeight) {
        scale = Math.max(scale, baseScale);
    }

    scale = Math.min(scale, maxScale);
    return scale;
};

const runOcrPass = async (ocr, image, options) => {
    const detectionResult = await runDetectionSmart(ocr, image, options);
    const detection = detectionResult.boxes;
    const recognition = await ocr.recognition.run(image, detection, options);
    const processed = processRecognition(recognition, options);
    return { detection, recognition, processed, detectionMeta: detectionResult.meta };
};

const computeIoU = (a, b) => {
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const x2 = Math.min(a.x + a.width, b.x + b.width);
    const y2 = Math.min(a.y + a.height, b.y + b.height);
    const interW = Math.max(0, x2 - x1);
    const interH = Math.max(0, y2 - y1);
    const inter = interW * interH;
    if (inter <= 0) return 0;
    const areaA = a.width * a.height;
    const areaB = b.width * b.height;
    return inter / (areaA + areaB - inter);
};

const nmsBoxes = (boxes, threshold) => {
    if (!threshold || threshold <= 0) return boxes;
    const sorted = [...boxes].sort((a, b) => (b.width * b.height) - (a.width * a.height));
    const keep = [];
    while (sorted.length) {
        const current = sorted.shift();
        keep.push(current);
        for (let i = sorted.length - 1; i >= 0; i--) {
            if (computeIoU(current, sorted[i]) >= threshold) {
                sorted.splice(i, 1);
            }
        }
    }
    return keep;
};

const clampBox = (box, width, height) => {
    const x = Math.max(0, Math.min(width - 1, Math.round(box.x)));
    const y = Math.max(0, Math.min(height - 1, Math.round(box.y)));
    const right = Math.max(x + 1, Math.min(width, Math.round(box.x + box.width)));
    const bottom = Math.max(y + 1, Math.min(height, Math.round(box.y + box.height)));
    return { x, y, width: right - x, height: bottom - y };
};

const shouldUseTiledDetection = (image, boxes, options = {}) => {
    if (boxes && boxes.length) return false;
    const w = image.width;
    const h = image.height;
    const ratio = Math.max(w / Math.max(1, h), h / Math.max(1, w));
    const minRatio = typeof options.detection?.tileMinAspectRatio === "number" ? options.detection.tileMinAspectRatio : 3;
    const minLongSide = typeof options.detection?.tileMinLongSide === "number" ? options.detection.tileMinLongSide : 1800;
    return ratio >= minRatio && Math.max(w, h) >= minLongSide;
};

const tiledDetect = async (ocr, image, options = {}) => {
    const w = image.width;
    const h = image.height;
    const vertical = h >= w;
    const shortSide = vertical ? w : h;
    const longSide = vertical ? h : w;

    const tileLongSide = typeof options.detection?.tileLongSide === "number"
        ? Math.max(256, Math.floor(options.detection.tileLongSide))
        : Math.max(512, Math.floor(shortSide * 2.8));
    const overlapRatio = typeof options.detection?.tileOverlapRatio === "number" ? options.detection.tileOverlapRatio : 0.25;
    const overlap = Math.floor(tileLongSide * overlapRatio);
    const step = Math.max(64, tileLongSide - overlap);

    const boxes = [];
    let tiles = 0;
    for (let start = 0; start < longSide; start += step) {
        const end = Math.min(longSide, start + tileLongSide);
        const size = end - start;
        if (size < Math.min(256, tileLongSide * 0.5)) {
            break;
        }

        const crop = vertical
            ? image.crop({ x: 0, y: start, width: w, height: size })
            : image.crop({ x: start, y: 0, width: size, height: h });

        const tileBoxes = await ocr.detection.run(crop);
        for (const b of tileBoxes) {
            const shifted = vertical
                ? { ...b, y: b.y + start }
                : { ...b, x: b.x + start };
            boxes.push(clampBox(shifted, w, h));
        }
        tiles += 1;
        if (end >= longSide) break;
    }

    const nmsThreshold = typeof options.detection?.tileNmsThreshold === "number" ? options.detection.tileNmsThreshold : 0.3;
    return { boxes: nmsBoxes(boxes, nmsThreshold), tiles };
};

const runDetectionSmart = async (ocr, image, options = {}) => {
    const first = await ocr.detection.run(image);
    if (!shouldUseTiledDetection(image, first, options)) {
        return { boxes: first, meta: { tiled: false, tiles: 0 } };
    }

    const tiled = await tiledDetect(ocr, image, options);
    if (tiled.boxes.length) {
        return { boxes: tiled.boxes, meta: { tiled: true, tiles: tiled.tiles } };
    }
    return { boxes: first, meta: { tiled: true, tiles: tiled.tiles, empty: true } };
};

const withDetectionOverrides = async (ocr, overrides, fn) => {
    if (!ocr?.detection?.options || !overrides || typeof overrides !== "object") {
        return fn();
    }
    const original = { ...ocr.detection.options };
    try {
        Object.assign(ocr.detection.options, overrides);
        return await fn();
    } finally {
        ocr.detection.options = original;
    }
};

const pickBetterPass = (a, b) => {
    if (!a) return b;
    if (!b) return a;
    const aHasText = !!(a.processed?.text && a.processed.text.trim());
    const bHasText = !!(b.processed?.text && b.processed.text.trim());
    if (aHasText !== bHasText) return bHasText ? b : a;
    const aConf = typeof a.processed?.confidence === "number" ? a.processed.confidence : 0;
    const bConf = typeof b.processed?.confidence === "number" ? b.processed.confidence : 0;
    if (aConf !== bConf) return bConf > aConf ? b : a;
    const aCount = Array.isArray(a.recognition) ? a.recognition.length : 0;
    const bCount = Array.isArray(b.recognition) ? b.recognition.length : 0;
    return bCount > aCount ? b : a;
};

const roundUpTo32 = (value) => Math.max(32, Math.ceil(value / 32) * 32);

const buildDetMaxSideCandidates = (first, max) => {
    const candidates = [first];
    candidates.push(Math.min(max, first * 1.5));
    candidates.push(max);
    const unique = [...new Set(candidates.map((v) => roundUpTo32(v)))];
    return unique.filter((v) => v >= 960).sort((a, b) => a - b);
};

export const recognizeWithPaddleV5 = async (imageInput, options = {}) => {
    try {
        const ocr = await ensureService(options);
        const img = await loadImage(imageInput);
        const input = imageToInput(img, options.canvas);

        const channels = input.data.length / (input.width * input.height);
        if (!Number.isInteger(channels) || channels < 1 || channels > 4) {
            throw new Error("invalid-image-channels");
        }

        let image = new OcrImage(input.width, input.height, channels, input.data);
        if (ocr.docOrientationSession && ocr.preprocessModels?.docOrientation) {
            image = await applyDocOrientation(image, ocr.docOrientationSession, ocr.docOrientationSize);
        }
        if (ocr.docUnwarpSession && ocr.preprocessModels?.docUnwarp) {
            image = await applyDocUnwarp(image, ocr.docUnwarpSession, ocr.docUnwarpSize);
        }
        const padding = options.detection?.padding ?? DEFAULT_DETECTION_OPTIONS.padding;
        if (padding) {
            image = image.padding({
                padding,
                color: [255, 255, 255, 255]
            });
        }

        const formatResult = (pass, extra = {}) => {
            const blocks = pass.recognition.map((item, index) => ({
                id: String(index),
                text: item.text,
                points: toBlockPoints(item.box)
            }));
            return {
                text: pass.processed.text,
                points: blocks.map((block) => block.points),
                blocks,
                boxes: pass.recognition.map((item) => item.box),
                confidence: pass.processed.confidence * 100,
                ...extra
            };
        };

        const upscaleOptions = resolveUpscaleOptions(options);
        const firstPass = await runOcrPass(ocr, image, options);

        const avgHeight = averageBoxHeight(firstPass.recognition);
        const shouldUpscale = upscaleOptions.enabled && (
            firstPass.recognition.length === 0 ||
            firstPass.processed.confidence < upscaleOptions.minConfidence ||
            avgHeight < upscaleOptions.minAvgBoxHeight
        );

        if (shouldUpscale) {
            const desiredScale = upscaleOptions.adaptive
                ? computeAdaptiveUpscaleScale(avgHeight, firstPass.processed.confidence, upscaleOptions)
                : upscaleOptions.scale;
            // Important: for detection, resizing the whole image doesn't help when det always scales long-side to maxSideLength.
            // What helps is increasing detection maxSideLength (i.e., higher-resolution inference for the detector).
            const detBase = ocr.detection?.options?.maxSideLength ?? DEFAULT_DETECTION_OPTIONS.maxSideLength;
            const detMaxCap = Math.min(upscaleOptions.maxSide, 2560);
            let initialDetMaxSide = Math.min(detMaxCap, detBase * Math.min(desiredScale, upscaleOptions.maxScale));

            // Extreme aspect ratio fallback: make sure the resized *short side* is not too small.
            // resizedShortSide ~= shortSide * detMaxSideLength / longSide
            // => detMaxSideLength >= minResizedShortSide * longSide / shortSide
            try {
                const w = image.width;
                const h = image.height;
                const longSide = Math.max(w, h);
                const shortSide = Math.max(1, Math.min(w, h));
                const aspect = Math.max(w / Math.max(1, h), h / Math.max(1, w));
                const minResizedShortSide = typeof options.detection?.minResizedShortSide === "number"
                    ? Math.max(32, Math.floor(options.detection.minResizedShortSide))
                    : 64;
                const minAspect = typeof options.detection?.minResizedShortSideAspectRatio === "number"
                    ? Math.max(1, options.detection.minResizedShortSideAspectRatio)
                    : 8;

                if (aspect >= minAspect && longSide > 0) {
                    const required = (minResizedShortSide * longSide) / shortSide;
                    const requiredDetMaxSide = Math.min(detMaxCap, roundUpTo32(Math.ceil(required)));
                    if (requiredDetMaxSide > initialDetMaxSide) {
                        initialDetMaxSide = requiredDetMaxSide;
                    }
                }
            } catch (_) { }
            const detCandidates = buildDetMaxSideCandidates(initialDetMaxSide, detMaxCap);

            const debugPasses = [];
            const recordDebug = (payload) => {
                if (!upscaleOptions.debug) return;
                debugPasses.push(payload);
            };

            let bestPass = firstPass;
            let bestScale = 1;
            recordDebug({
                pass: "original",
                scale: 1,
                detMaxSideLength: detBase,
                confidence: firstPass.processed.confidence,
                avgBoxHeight: avgHeight,
                blocks: firstPass.recognition.length,
                detTiled: !!firstPass.detectionMeta?.tiled,
                detTiles: firstPass.detectionMeta?.tiles ?? 0
            });

            for (let i = 0; i < upscaleOptions.attempts && i < detCandidates.length; i++) {
                const detMaxSideLength = detCandidates[i];

                const noBoxes = firstPass.recognition.length === 0;
                const tinyText = noBoxes || (typeof avgHeight === "number" && avgHeight > 0 && avgHeight < 10);

                const detOverrides = {
                    maxSideLength: detMaxSideLength,
                    // If tiny text, the default min area may filter boxes away on full image.
                    ...(tinyText ? { minimumAreaThreshold: 10 } : null),
                    ...(tinyText ? { textPixelThreshold: 0.45 } : null)
                };

                const pass = await withDetectionOverrides(ocr, detOverrides, async () => runOcrPass(ocr, image, options));
                const picked = pickBetterPass(bestPass, pass);
                if (picked === pass) {
                    bestPass = pass;
                    // keep reporting an approximate "scale" for UI/telemetry: detMaxSideLength relative to baseline.
                    bestScale = detBase ? detMaxSideLength / detBase : 1;
                }

                recordDebug({
                    pass: `upscale-${i + 1}`,
                    scale: detBase ? detMaxSideLength / detBase : 1,
                    detMaxSideLength,
                    confidence: pass.processed.confidence,
                    avgBoxHeight: averageBoxHeight(pass.recognition),
                    blocks: pass.recognition.length,
                    detTiled: !!pass.detectionMeta?.tiled,
                    detTiles: pass.detectionMeta?.tiles ?? 0
                });

                const passOk = pass.recognition.length > 0 && pass.processed.confidence >= upscaleOptions.minConfidence;
                if (passOk) break;
            }
            return formatResult(bestPass, {
                upscaled: bestPass !== firstPass,
                upscaleScale: bestScale,
                ...(upscaleOptions.debug ? { upscaleDebug: debugPasses } : {})
            });
        }

        return formatResult(firstPass, { upscaled: false });
    } catch (err) {
        try { console.error("Paddle OCR v5 recognize failed:", err); } catch (_) { }
        return {
            text: "",
            points: [],
            blocks: [],
            error: err && err.message ? err.message : "paddle-ocr-v5-failed"
        };
    }
};

export const resetPaddleOcrV5 = async () => {
    if (service && typeof service.destroy === "function") {
        await service.destroy();
    }
};
