export const DEFAULT_DETECTION_OPTIONS = {
    padding: 0,
    mean: [0.485 * 255, 0.456 * 255, 0.406 * 255],
    stdDeviation: [1 / 0.229 / 255, 1 / 0.224 / 255, 1 / 0.255 / 255],
    maxSideLength: 960,
    textPixelThreshold: 0.5,
    minimumAreaThreshold: 20,
    paddingBoxVertical: 0.4,
    paddingBoxHorizontal: 0.6,
    nmsThreshold: 0
};

export const DEFAULT_RECOGNITION_OPTIONS = {
    mean: [127.5, 127.5, 127.5],
    stdDeviation: [1.0 / 127.5, 1.0 / 127.5, 1.0 / 127.5],
    imageHeight: 48,
    charactersDictionary: []
};
