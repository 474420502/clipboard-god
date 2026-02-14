import { Image } from "./image";
import { DEFAULT_DETECTION_OPTIONS } from "./constants";

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

const nms = (boxes, threshold) => {
    if (!threshold || threshold <= 0) return boxes;
    const sorted = [...boxes].sort((a, b) => b.width * b.height - a.width * a.height);
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

export class DetectionService {
    constructor(ortModule, session, options = {}) {
        this.session = session;
        this.ortModule = ortModule;
        this.options = {
            ...DEFAULT_DETECTION_OPTIONS,
            ...options
        };
    }

    async run(image) {
        const input = await this.preprocessDetection(image);
        const detection = await this.runInference(input.tensor, input.resizeParams);
        if (!detection) {
            return [];
        }
        return this.postprocessDetection(detection, input);
    }

    async preprocessDetection(image) {
        const resizeParams = this.calculateResizeDimensions(image);
        const resizedImage = image.resize({
            width: resizeParams.dstWidth,
            height: resizeParams.dstHeight
        });
        const tensor = resizedImage.tensor({
            mean_values: this.options.mean,
            norm_values: this.options.stdDeviation
        });
        return { tensor, resizeParams };
    }

    calculateResizeDimensions(image) {
        const maxSideLen = this.options.maxSideLength;
        const { width: srcWidth, height: srcHeight } = image;
        const ratio = srcWidth > srcHeight ? maxSideLen / srcWidth : maxSideLen / srcHeight;
        let dstWidth = Math.floor(srcWidth * ratio);
        let dstHeight = Math.floor(srcHeight * ratio);
        // Use ceil-to-multiple to avoid losing resolution, especially for tiny short-sides.
        // PaddleOCR-style preprocess typically rounds up to the next multiple of 32.
        if (dstWidth % 32 !== 0) dstWidth = Math.max(Math.ceil(dstWidth / 32) * 32, 32);
        if (dstHeight % 32 !== 0) dstHeight = Math.max(Math.ceil(dstHeight / 32) * 32, 32);
        const scaleWidth = dstWidth / srcWidth;
        const scaleHeight = dstHeight / srcHeight;

        return {
            srcHeight,
            srcWidth,
            dstHeight,
            dstWidth,
            scaleWidth,
            scaleHeight
        };
    }

    async runInference(tensor, resizeParams) {
        const inputTensor = new this.ortModule.Tensor("float32", tensor, [
            1,
            3,
            resizeParams.dstHeight,
            resizeParams.dstWidth
        ]);
        const feeds = { x: inputTensor };
        const results = await this.session.run(feeds);
        const outputTensor = results[this.session.outputNames[0] || "fetch_name_0"];
        if (!outputTensor) {
            return null;
        }
        return outputTensor.data;
    }

    postprocessDetection(detection, input) {
        const { dstWidth, dstHeight } = input.resizeParams;
        const greyImage = new Image(dstWidth, dstHeight, 1, new Uint8Array(detection.map((v) => Math.round(v * 255))));
        const thresholdedImage = greyImage.threshold({
            threshold: 255 * this.options.textPixelThreshold
        });
        const dilateImage = thresholdedImage.dilate({
            norm: "LInf",
            k: 1
        });
        const boxes = dilateImage.contours({
            minArea: this.options.minimumAreaThreshold
        });
        const finalBoxes = boxes.map((box) => {
            const paddedBox = this.applyPaddingToRect(box, dstWidth, dstHeight);
            return this.convertToOriginalCoordinates(paddedBox, input.resizeParams);
        });
        return nms(finalBoxes, this.options.nmsThreshold);
    }

    applyPaddingToRect(rect, maxWidth, maxHeight, paddingVertical = this.options.paddingBoxVertical || 0.6, paddingHorizontal = this.options.paddingBoxHorizontal || 0.8) {
        const verticalPadding = Math.round(rect.height * paddingVertical);
        const horizontalPadding = Math.round(rect.height * paddingHorizontal);

        let x = rect.x - horizontalPadding;
        let y = rect.y - verticalPadding;
        let width = rect.width + 2 * horizontalPadding;
        let height = rect.height + 2 * verticalPadding;

        x = Math.max(0, x);
        y = Math.max(0, y);

        const rightEdge = Math.min(maxWidth, rect.x + rect.width + horizontalPadding);
        const bottomEdge = Math.min(maxHeight, rect.y + rect.height + verticalPadding);
        width = rightEdge - x;
        height = bottomEdge - y;

        return { x, y, width, height };
    }

    convertToOriginalCoordinates(rect, resizeParams) {
        const scaledX = rect.x / resizeParams.scaleWidth;
        const scaledY = rect.y / resizeParams.scaleHeight;
        const scaledWidth = rect.width / resizeParams.scaleWidth;
        const scaledHeight = rect.height / resizeParams.scaleHeight;

        const x = Math.max(0, Math.round(scaledX));
        const y = Math.max(0, Math.round(scaledY));
        const width = Math.min(resizeParams.srcWidth - x, Math.round(scaledWidth));
        const height = Math.min(resizeParams.srcHeight - y, Math.round(scaledHeight));

        return { x, y, width, height };
    }
}
