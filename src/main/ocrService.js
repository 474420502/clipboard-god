const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const Config = require('./config');

const DEFAULT_CLI_COMMAND = 'paddleocr';
const CLI_TIMEOUT_MS = 10 * 60 * 1000;
const CLI_HELPER_VENV_NAMES = [
    '.venv-paddleocr-vl-rocm',
    'venv-paddleocr-vl-rocm',
    '.venv_paddleocr_rocm',
    'venv_paddleocr_rocm',
    '.venv-paddleocr-vl',
    'venv-paddleocr-vl',
    '.venv_paddleocr',
    'venv_paddleocr'
];
const GLOBAL_PYTHON_ENV_ROOTS = [
    '.venv',
    '.venvs',
    '.virtualenvs',
    '.local/share/virtualenvs',
    '.conda/envs',
    'miniconda3/envs',
    'anaconda3/envs',
    'miniforge3/envs',
    'mambaforge/envs'
];
const GLOBAL_PYTHON_BASE_ENVS = [
    'miniconda3',
    'anaconda3',
    'miniforge3',
    'mambaforge'
];
const PREFERRED_PYTHON_COMMANDS = ['python3.12', 'python3.11', 'python3.10', 'python3.13', 'python3', 'python'];
const DEFAULT_RUNTIME_TARGET = 'auto';
const PYTHON_PROBE_SCRIPT = [
    'import json, sys',
    'result = {',
    '  "python_executable": sys.executable,',
    '  "python_version": ".".join(str(v) for v in sys.version_info[:3]),',
    '}',
    'try:',
    '  import paddle',
    '  dev = getattr(paddle, "device", None)',
    '  result["paddle_version"] = getattr(paddle, "__version__", "")',
    '  result["paddle_compiled_with_cuda"] = bool(getattr(dev, "is_compiled_with_cuda", lambda: False)()) if dev else False',
    '  result["paddle_compiled_with_rocm"] = bool(getattr(dev, "is_compiled_with_rocm", lambda: False)()) if dev else False',
    '  result["custom_device_types"] = list(getattr(dev, "get_all_custom_device_type", lambda: [])() or []) if dev else []',
    '  if dev:',
    '    try:',
    '      result["current_device"] = dev.get_device()',
    '    except Exception as exc:',
    '      result["current_device_error"] = str(exc)',
    '    if result["paddle_compiled_with_cuda"] or result["paddle_compiled_with_rocm"]:',
    '      try:',
    '        dev.set_device("gpu:0")',
    '        result["gpu_probe_success"] = True',
    '        result["gpu_probe_device"] = dev.get_device()',
    '      except Exception as exc:',
    '        result["gpu_probe_success"] = False',
    '        result["gpu_probe_error"] = str(exc)',
    'except Exception as exc:',
    '  result["paddle_error"] = str(exc)',
    'try:',
    '  import paddleocr',
    '  result["paddleocr_version"] = getattr(paddleocr, "__version__", "")',
    'except Exception as exc:',
    '  result["paddleocr_error"] = str(exc)',
    'print(json.dumps(result, ensure_ascii=False))'
].join('\n');
const DEFAULT_OCR_VL_MAX_CONCURRENT_JOBS = Math.max(
    1,
    Math.min(
        2,
        Math.floor(
            ((typeof os.availableParallelism === 'function'
                ? os.availableParallelism()
                : ((os.cpus() || []).length || 4)) / 4)
        ) || 1
    )
);
const OCR_POOL_MAX_LIMIT = 8;

const ocrJobQueue = [];
let activeOcrJobs = 0;
let ocrJobSequence = 0;

const mimeTypeToExtension = (mimeType = '') => {
    const value = String(mimeType || '').toLowerCase();
    if (value.includes('jpeg') || value.includes('jpg')) return '.jpg';
    if (value.includes('webp')) return '.webp';
    if (value.includes('bmp')) return '.bmp';
    if (value.includes('gif')) return '.gif';
    return '.png';
};

const parseCliArgs = (input = '') => {
    const text = String(input || '').trim();
    if (!text) return [];

    const args = [];
    const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
    let match = null;

    while ((match = pattern.exec(text)) !== null) {
        args.push(match[1] || match[2] || match[3] || '');
    }

    return args.filter(Boolean);
};

const parseCliCommandSpec = (input = '') => {
    const tokens = parseCliArgs(input || DEFAULT_CLI_COMMAND);
    if (!tokens.length) {
        return { command: DEFAULT_CLI_COMMAND, prefixArgs: [] };
    }
    return {
        command: tokens[0],
        prefixArgs: tokens.slice(1)
    };
};

const hasCliFlag = (args = [], flagName = '') => {
    const normalizedFlag = String(flagName || '').trim();
    if (!normalizedFlag) return false;

    return (Array.isArray(args) ? args : []).some((arg) => {
        const text = String(arg || '').trim();
        return text === normalizedFlag || text.startsWith(`${normalizedFlag}=`);
    });
};

const buildStructuredCliArgs = (config = {}, extraArgs = []) => {
    const structuredArgs = [];
    const device = String(config.ocrVlDevice || '').trim();
    const cpuThreads = Math.max(0, Number(config.ocrVlCpuThreads) || 0);
    const enableMkldnn = config.ocrVlEnableMkldnn !== false;

    if (device && !hasCliFlag(extraArgs, '--device')) {
        structuredArgs.push('--device', device);
    }

    if (cpuThreads > 0 && !hasCliFlag(extraArgs, '--cpu_threads')) {
        structuredArgs.push('--cpu_threads', String(cpuThreads));
    }

    if (!hasCliFlag(extraArgs, '--enable_mkldnn')) {
        structuredArgs.push('--enable_mkldnn', toBooleanCliValue(enableMkldnn));
    }

    return structuredArgs;
};

const resolveMaxConcurrentJobs = (config = {}) => {
    const requested = Math.max(1, Number(config.ocrVlMaxConcurrentJobs) || DEFAULT_OCR_VL_MAX_CONCURRENT_JOBS);
    return Math.min(OCR_POOL_MAX_LIMIT, requested);
};

const drainOcrQueue = () => {
    const maxConcurrentJobs = resolveMaxConcurrentJobs(Config.getAll() || {});

    while (activeOcrJobs < maxConcurrentJobs && ocrJobQueue.length) {
        const job = ocrJobQueue.shift();
        const queueWaitMs = Math.max(0, Date.now() - job.enqueuedAt);
        activeOcrJobs += 1;

        Promise.resolve()
            .then(async () => {
                const result = await job.run();
                if (!result || typeof result !== 'object' || Array.isArray(result)) {
                    return result;
                }

                return {
                    ...result,
                    queueWaitMs,
                    queueDepthAtEnqueue: job.queueDepthAtEnqueue,
                    poolMaxConcurrentJobs: maxConcurrentJobs
                };
            })
            .then(job.resolve, job.reject)
            .finally(() => {
                activeOcrJobs = Math.max(0, activeOcrJobs - 1);
                queueMicrotask(drainOcrQueue);
            });
    }
};

const scheduleOcrJob = (run) => new Promise((resolve, reject) => {
    ocrJobQueue.push({
        id: ++ocrJobSequence,
        run,
        resolve,
        reject,
        enqueuedAt: Date.now(),
        queueDepthAtEnqueue: ocrJobQueue.length + activeOcrJobs
    });
    queueMicrotask(drainOcrQueue);
});

const quoteToken = (value) => (/\s/.test(value) ? JSON.stringify(value) : value);

const serializeCliCommandSpec = (spec) => {
    if (!spec || !spec.command) return DEFAULT_CLI_COMMAND;
    return [spec.command, ...(spec.prefixArgs || [])].map((item) => quoteToken(String(item || ''))).join(' ');
};

const basename = (value = '') => {
    try {
        return path.basename(String(value || ''));
    } catch (_) {
        return String(value || '');
    }
};

const isGenericPaddleCommand = (spec) => {
    if (!spec || !spec.command) return true;
    const commandName = basename(spec.command);
    const prefixArgs = Array.isArray(spec.prefixArgs) ? spec.prefixArgs : [];

    if (commandName === 'paddleocr' && prefixArgs.length === 0 && !path.isAbsolute(spec.command)) {
        return true;
    }

    if ((commandName === 'python' || commandName === 'python3') && prefixArgs.join(' ') === '-m paddleocr' && !path.isAbsolute(spec.command)) {
        return true;
    }

    return false;
};

const toBooleanCliValue = (value) => (value ? 'True' : 'False');

const tailLines = (input, lineCount = 20) => {
    const text = String(input || '').trim();
    if (!text) return '';
    return text.split(/\r?\n/).slice(-lineCount).join('\n');
};

const joinDetails = (...parts) => parts.map((part) => String(part || '').trim()).filter(Boolean).join('\n\n');

const normalizeRuntimeTarget = (value) => {
    const normalized = String(value || DEFAULT_RUNTIME_TARGET).trim().toLowerCase();
    if (normalized === 'rocm' || normalized === 'cpu') {
        return normalized;
    }
    return DEFAULT_RUNTIME_TARGET;
};

const readTextFileIfExists = async (filePath) => {
    if (!filePath) return '';
    try {
        return String(await fs.promises.readFile(filePath, 'utf8')).trim();
    } catch (_) {
        return '';
    }
};

const findCommandOnPath = async (commandName) => {
    const name = String(commandName || '').trim();
    if (!name) return '';

    if (path.isAbsolute(name)) {
        return (await isExecutableFile(name)) ? name : '';
    }

    const entries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
    for (const entry of entries) {
        const candidate = path.join(entry, name);
        if (await isExecutableFile(candidate)) {
            return candidate;
        }
    }

    return '';
};

const parseJsonFromOutput = (input = '') => {
    const text = String(input || '').trim();
    if (!text) return null;

    try {
        return JSON.parse(text);
    } catch (_) {
        // fall through
    }

    const lines = text.split(/\r?\n/).reverse();
    for (const line of lines) {
        const candidate = String(line || '').trim();
        if (!candidate) continue;
        try {
            return JSON.parse(candidate);
        } catch (_) {
            // keep scanning
        }
    }

    return null;
};

const formatTriedCommands = (attempts = []) => {
    if (!Array.isArray(attempts) || !attempts.length) return '';
    return `Tried commands:\n${attempts.map((attempt) => `- ${attempt}`).join('\n')}`;
};

const fileExists = async (targetPath) => {
    try {
        await fs.promises.access(targetPath, fs.constants.F_OK);
        return true;
    } catch (_) {
        return false;
    }
};

const isExecutableFile = async (targetPath) => {
    try {
        await fs.promises.access(targetPath, fs.constants.X_OK);
        return true;
    } catch (_) {
        return false;
    }
};

const candidateKey = (candidate) => `${candidate.command}::${(candidate.prefixArgs || []).join('\u0001')}`;

const buildPreferredPythonEntries = async () => {
    const results = [];
    const seen = new Set();

    for (const name of PREFERRED_PYTHON_COMMANDS) {
        const resolvedPath = await findCommandOnPath(name);
        if (!resolvedPath || seen.has(resolvedPath)) continue;
        seen.add(resolvedPath);
        results.push({ command: name, resolvedPath });
    }

    return results;
};

const pushCandidate = (list, seen, candidate) => {
    if (!candidate || !candidate.command) return;
    const key = candidateKey(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    list.push(candidate);
};

const addChildDirectories = async (roots, parentDir) => {
    if (!parentDir || !(await fileExists(parentDir))) return;

    roots.add(parentDir);

    try {
        const entries = await fs.promises.readdir(parentDir, { withFileTypes: true });
        for (const entry of entries) {
            if (!entry.isDirectory()) continue;
            roots.add(path.join(parentDir, entry.name));
        }
    } catch (_) {
        // ignore search root expansion failures
    }
};

const buildSearchRoots = async () => {
    const roots = new Set();
    const configDir = Config && Config.configPath ? path.dirname(Config.configPath) : '';
    const appRoot = path.resolve(__dirname, '..', '..');
    const homeDir = os.homedir();

    [process.cwd(), appRoot, configDir, homeDir].forEach((value) => {
        const next = String(value || '').trim();
        if (next) roots.add(next);
    });

    for (const childRootName of ['workspace', 'projects', 'code', 'src', 'dev']) {
        await addChildDirectories(roots, path.join(homeDir, childRootName));
    }

    return Array.from(roots);
};

const detectHostRuntime = async () => {
    const rocminfoPath = await findCommandOnPath('rocminfo') || (await isExecutableFile('/opt/rocm/bin/rocminfo') ? '/opt/rocm/bin/rocminfo' : '');
    const rocmVersion = await readTextFileIfExists('/opt/rocm/.info/version');
    const rocmLibrariesVersion = await readTextFileIfExists('/opt/rocm/.info/version-hip-libraries');
    const pythonCommands = await buildPreferredPythonEntries();

    let gpuName = '';
    let gpuArch = '';
    let rocminfoAvailable = false;
    let rocminfoError = '';

    if (rocminfoPath) {
        const result = await runCli(rocminfoPath, [], process.cwd(), 20 * 1000);
        if (!result.error && !result.timedOut && (result.code === 0 || String(result.stdout || '').trim())) {
            rocminfoAvailable = true;
            const output = `${result.stdout || ''}\n${result.stderr || ''}`;
            const marketingMatches = Array.from(output.matchAll(/Marketing Name:\s*(.+)/g))
                .map((match) => String(match[1] || '').trim())
                .filter((value) => value && !/processor/i.test(value));
            const archMatches = Array.from(output.matchAll(/Name:\s*(gfx[0-9a-z]+)/gi))
                .map((match) => String(match[1] || '').trim())
                .filter(Boolean);
            gpuName = marketingMatches[0] || '';
            gpuArch = archMatches[0] || '';
        } else {
            rocminfoError = tailLines(result.stderr || result.stdout, 10);
        }
    }

    return {
        hasRocm: !!(rocminfoPath || rocmVersion),
        rocminfoPath,
        rocminfoAvailable,
        rocminfoError,
        rocmVersion,
        rocmLibrariesVersion,
        gpuName,
        gpuArch,
        pythonCommands,
        preferredPythonCommand: pythonCommands[0] || null
    };
};

const resolveAutoDetectedCandidates = async () => {
    const candidates = [];
    const seen = new Set();

    const addEnvironmentRoot = async (envRoot, source) => {
        const rootPath = String(envRoot || '').trim();
        if (!rootPath) return;

        const cliPath = path.join(rootPath, 'bin', 'paddleocr');
        const pythonPath = path.join(rootPath, 'bin', 'python');

        if (await isExecutableFile(cliPath)) {
            pushCandidate(candidates, seen, {
                command: cliPath,
                prefixArgs: [],
                source: `${source}:cli`,
                persistedCommand: cliPath
            });
        }

        if (await isExecutableFile(pythonPath)) {
            pushCandidate(candidates, seen, {
                command: pythonPath,
                prefixArgs: ['-m', 'paddleocr'],
                source: `${source}:python`,
                persistedCommand: serializeCliCommandSpec({ command: pythonPath, prefixArgs: ['-m', 'paddleocr'] })
            });
        }
    };

    const addEnvironmentChildren = async (parentDir, sourcePrefix) => {
        const baseDir = String(parentDir || '').trim();
        if (!baseDir || !(await fileExists(baseDir))) return;

        await addEnvironmentRoot(baseDir, `${sourcePrefix}:root`);

        try {
            const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) continue;
                await addEnvironmentRoot(path.join(baseDir, entry.name), `${sourcePrefix}:${entry.name}`);
            }
        } catch (_) {
            // ignore user environment enumeration failures
        }
    };

    for (const rootDir of await buildSearchRoots()) {
        for (const venvName of CLI_HELPER_VENV_NAMES) {
            const venvRoot = path.join(rootDir, venvName);
            const cliPath = path.join(venvRoot, 'bin', 'paddleocr');
            const pythonPath = path.join(venvRoot, 'bin', 'python');

            if (await isExecutableFile(cliPath)) {
                pushCandidate(candidates, seen, {
                    command: cliPath,
                    prefixArgs: [],
                    source: `auto:${venvName}:cli`,
                    persistedCommand: cliPath
                });
            }

            if (await isExecutableFile(pythonPath)) {
                pushCandidate(candidates, seen, {
                    command: pythonPath,
                    prefixArgs: ['-m', 'paddleocr'],
                    source: `auto:${venvName}:python`,
                    persistedCommand: serializeCliCommandSpec({ command: pythonPath, prefixArgs: ['-m', 'paddleocr'] })
                });
            }
        }
    }

    const localCliPath = path.join(os.homedir(), '.local', 'bin', 'paddleocr');
    if (await isExecutableFile(localCliPath)) {
        pushCandidate(candidates, seen, {
            command: localCliPath,
            prefixArgs: [],
            source: 'auto:user-local-bin',
            persistedCommand: localCliPath
        });
    }

    const homeDir = os.homedir();
    for (const envName of GLOBAL_PYTHON_BASE_ENVS) {
        await addEnvironmentRoot(path.join(homeDir, envName), `auto:${envName}:base`);
    }

    for (const envRoot of GLOBAL_PYTHON_ENV_ROOTS) {
        await addEnvironmentChildren(path.join(homeDir, envRoot), `auto:${envRoot}`);
    }

    return candidates;
};

const derivePythonCommandFromCandidate = async (candidate) => {
    if (!candidate || !candidate.command) return '';
    const command = String(candidate.command || '').trim();
    if (!command) return '';

    const commandBase = basename(command).toLowerCase();
    if (commandBase.startsWith('python')) {
        if (path.isAbsolute(command)) {
            return command;
        }
        return await findCommandOnPath(command);
    }

    if (path.isAbsolute(command)) {
        const binDir = path.dirname(command);
        for (const name of ['python', 'python3']) {
            const pythonPath = path.join(binDir, name);
            if (await isExecutableFile(pythonPath)) {
                return pythonPath;
            }
        }
    }

    return '';
};

const buildCliCandidates = async (configuredCommand) => {
    const configuredSpec = parseCliCommandSpec(configuredCommand || DEFAULT_CLI_COMMAND);
    const configuredCandidate = {
        command: configuredSpec.command,
        prefixArgs: configuredSpec.prefixArgs,
        source: 'config',
        persistedCommand: serializeCliCommandSpec(configuredSpec)
    };

    const candidates = [];
    const seen = new Set();
    const isGeneric = isGenericPaddleCommand(configuredSpec);

    if (!isGeneric) {
        pushCandidate(candidates, seen, configuredCandidate);
    }

    const autoDetected = await resolveAutoDetectedCandidates();
    autoDetected.forEach((candidate) => pushCandidate(candidates, seen, candidate));

    pushCandidate(candidates, seen, configuredCandidate);

    pushCandidate(candidates, seen, {
        command: 'paddleocr',
        prefixArgs: [],
        source: 'fallback:path-paddleocr',
        persistedCommand: 'paddleocr'
    });

    pushCandidate(candidates, seen, {
        command: 'python3',
        prefixArgs: ['-m', 'paddleocr'],
        source: 'fallback:python3-module',
        persistedCommand: 'python3 -m paddleocr'
    });
    pushCandidate(candidates, seen, {
        command: 'python',
        prefixArgs: ['-m', 'paddleocr'],
        source: 'fallback:python-module',
        persistedCommand: 'python -m paddleocr'
    });

    return candidates;
};

const normalizeFailureDetails = (result, attempts, extra = '') => {
    const output = tailLines(result && (result.stderr || result.stdout) ? (result.stderr || result.stdout) : '', 30);
    return joinDetails(extra, output, formatTriedCommands(attempts));
};

const probePythonEnvironment = async (pythonCommand) => {
    const resolvedPython = String(pythonCommand || '').trim();
    if (!resolvedPython) {
        return {
            success: false,
            details: 'Python executable was not resolved for this OCR command.'
        };
    }

    const result = await runCli(resolvedPython, ['-c', PYTHON_PROBE_SCRIPT], process.cwd(), 60 * 1000);
    if (result.error || result.timedOut || result.code !== 0) {
        return {
            success: false,
            details: normalizeFailureDetails(result, [], `Python probe failed: ${resolvedPython}`)
        };
    }

    const parsed = parseJsonFromOutput(result.stdout);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {
            success: false,
            details: joinDetails(`Python probe produced unreadable output for ${resolvedPython}.`, tailLines(result.stdout || result.stderr, 20))
        };
    }

    return {
        success: true,
        details: tailLines(result.stderr, 10),
        info: parsed
    };
};

const summarizeCandidateStatus = (candidateInfo = {}) => {
    if (!candidateInfo || typeof candidateInfo !== 'object') return 'unavailable';
    if (candidateInfo.supportsRocm) return 'rocm';
    if (candidateInfo.supportsCuda) return 'cuda';
    if (candidateInfo.ready) return 'cpu';
    if (candidateInfo.partial) return 'partial';
    return 'missing';
};

const probeCliCandidate = async (candidate, hostInfo) => {
    const displayCommand = serializeCliCommandSpec(candidate);
    const pythonCommand = await derivePythonCommandFromCandidate(candidate);
    const probe = await probePythonEnvironment(pythonCommand);
    const info = probe.success && probe.info && typeof probe.info === 'object' ? probe.info : {};

    const ready = !!(info.paddle_version && info.paddleocr_version);
    const partial = !!(!ready && (info.paddle_version || info.paddle_error || info.paddleocr_error));
    const supportsRocm = !!info.paddle_compiled_with_rocm;
    const supportsCuda = !!info.paddle_compiled_with_cuda;
    const gpuProbeSuccess = info.gpu_probe_success === true;
    const status = summarizeCandidateStatus({ ready, partial, supportsRocm, supportsCuda });

    return {
        source: candidate.source || 'unknown',
        displayCommand,
        persistedCommand: candidate.persistedCommand || displayCommand,
        pythonCommand,
        ready,
        partial,
        status,
        supportsRocm,
        supportsCuda,
        gpuProbeSuccess,
        pythonExecutable: info.python_executable || pythonCommand,
        pythonVersion: info.python_version || '',
        paddleVersion: info.paddle_version || '',
        paddleOcrVersion: info.paddleocr_version || '',
        paddleError: info.paddle_error || '',
        paddleOcrError: info.paddleocr_error || '',
        currentDevice: info.current_device || '',
        gpuProbeDevice: info.gpu_probe_device || '',
        gpuProbeError: info.gpu_probe_error || '',
        customDeviceTypes: Array.isArray(info.custom_device_types) ? info.custom_device_types : [],
        details: probe.details || '',
        hostGpuName: hostInfo && hostInfo.gpuName ? hostInfo.gpuName : '',
        hostGpuArch: hostInfo && hostInfo.gpuArch ? hostInfo.gpuArch : ''
    };
};

const chooseRecommendedCandidate = (candidates = [], hostInfo = {}, target = DEFAULT_RUNTIME_TARGET) => {
    const normalizedTarget = normalizeRuntimeTarget(target);
    const readyCandidates = candidates.filter((item) => item && item.ready);

    if ((normalizedTarget === 'rocm' || (normalizedTarget === 'auto' && hostInfo && hostInfo.hasRocm))) {
        const rocmCandidates = readyCandidates.filter((item) => item.supportsRocm);
        if (rocmCandidates.length) {
            const gpuReady = rocmCandidates.find((item) => item.gpuProbeSuccess);
            return gpuReady || rocmCandidates[0];
        }

        const cudaCandidates = readyCandidates.filter((item) => item.supportsCuda && item.gpuProbeSuccess);
        if (cudaCandidates.length) {
            return cudaCandidates[0];
        }

        return null;
    }

    if (normalizedTarget === 'cpu') {
        const cpuCandidates = readyCandidates.filter((item) => !item.supportsRocm && !item.supportsCuda);
        if (cpuCandidates.length) {
            return cpuCandidates[0];
        }
    }

    return readyCandidates[0] || candidates.find((item) => item && item.partial) || null;
};

const buildInstallSuggestion = (hostInfo = {}, target = DEFAULT_RUNTIME_TARGET) => {
    const normalizedTarget = normalizeRuntimeTarget(target);
    const effectiveTarget = normalizedTarget === 'auto'
        ? (hostInfo && hostInfo.hasRocm ? 'rocm' : 'cpu')
        : normalizedTarget;
    const preferredPython = hostInfo && hostInfo.preferredPythonCommand ? hostInfo.preferredPythonCommand.command : 'python3';
    const appRoot = path.resolve(__dirname, '..', '..');
    const venvName = effectiveTarget === 'rocm' ? '.venv-paddleocr-vl-rocm' : '.venv-paddleocr-vl';
    const venvPath = path.join(appRoot, venvName);
    const expectedCommand = path.join(venvPath, 'bin', 'paddleocr');

    const commands = [
        `${preferredPython} -m venv ${JSON.stringify(venvName)}`,
        `source ${JSON.stringify(path.join(venvName, 'bin', 'activate'))}`,
        'python -m pip install -U pip setuptools wheel',
        'python -m pip install "paddlepaddle==3.2.1" -i https://www.paddlepaddle.org.cn/packages/stable/cpu/',
        'python -m pip install -U "paddleocr[doc-parser]"'
    ];

    const notes = [];
    if (effectiveTarget === 'rocm') {
        notes.push('The PaddleOCR-VL AMD GPU guide documents Python 3.9-3.13 and PaddlePaddle 3.2.1+ for manual setup, but it recommends the official AMD GPU Docker image as the most reliable path.');
        if (hostInfo && hostInfo.gpuName) {
            notes.push(`This host reports AMD GPU: ${hostInfo.gpuName}${hostInfo.gpuArch ? ` (${hostInfo.gpuArch})` : ''}.`);
        }
        if (!/mi300/i.test(String(hostInfo && hostInfo.gpuName ? hostInfo.gpuName : ''))) {
            notes.push('Official PaddleOCR-VL AMD GPU validation is currently focused on MI300X. Consumer Radeon / workstation AMD GPUs may still report CPU-only Paddle even when ROCm is installed.');
        }
        notes.push('If re-detect still reports `paddle_compiled_with_rocm=false` or continues to recommend CPU after the manual install, treat that environment as CPU fallback and prefer the official AMD GPU image: `ccr-2vdh3abv-pub.cnc.bj.baidubce.com/paddlepaddle/paddleocr-vl:latest-amd-gpu`.');
        notes.push('After installation, run the OCR runtime re-detect action to verify that the new environment reports ROCm support and to switch the command automatically.');
    } else {
        notes.push('This installs a CPU-only PaddleOCR-VL environment and keeps the OCR CLI on local execution without GPU requirements.');
    }

    return {
        target: effectiveTarget,
        pythonCommand: preferredPython,
        venvName,
        venvPath,
        expectedCommand,
        expectedDevice: effectiveTarget === 'rocm' ? 'gpu:0' : '',
        commands,
        notes
    };
};

const detectRuntimeEnvironment = async (options = {}) => {
    const target = normalizeRuntimeTarget(options.target);
    const host = await detectHostRuntime();
    const configuredCommand = String(Config.get('ocrVlCliCommand') || DEFAULT_CLI_COMMAND).trim() || DEFAULT_CLI_COMMAND;
    const candidates = await buildCliCandidates(configuredCommand);
    const candidateDetails = [];

    for (const candidate of candidates) {
        candidateDetails.push(await probeCliCandidate(candidate, host));
    }

    const configuredCandidate = candidateDetails.find((item) => item.displayCommand === configuredCommand || item.persistedCommand === configuredCommand) || null;
    const recommendedCandidate = chooseRecommendedCandidate(candidateDetails, host, target);
    const installSuggestion = buildInstallSuggestion(host, target);
    const recommendedDevice = recommendedCandidate && (recommendedCandidate.supportsRocm || recommendedCandidate.supportsCuda)
        ? 'gpu:0'
        : '';
    const needsInstall = !recommendedCandidate || (installSuggestion.target === 'rocm' && !recommendedCandidate.supportsRocm);

    return {
        success: true,
        target,
        host,
        configuredCommand,
        configuredCandidate,
        candidates: candidateDetails,
        recommendedCandidate,
        recommendedCommand: recommendedCandidate ? recommendedCandidate.persistedCommand : '',
        recommendedDevice,
        needsInstall,
        installSuggestion
    };
};

const redetectRuntimeEnvironment = async (options = {}) => {
    const detection = await detectRuntimeEnvironment(options);
    const currentConfig = Config.getAll() || {};
    const updates = {};

    if (detection.recommendedCandidate && detection.recommendedCommand) {
        if (String(currentConfig.ocrVlCliCommand || '').trim() !== String(detection.recommendedCommand || '').trim()) {
            updates.ocrVlCliCommand = detection.recommendedCommand;
        }
        if (String(currentConfig.ocrVlDevice || '').trim() !== String(detection.recommendedDevice || '').trim()) {
            updates.ocrVlDevice = detection.recommendedDevice;
        }
    } else if (
        detection.configuredCandidate
        && detection.configuredCandidate.ready
        && !detection.configuredCandidate.supportsRocm
        && !detection.configuredCandidate.supportsCuda
        && String(currentConfig.ocrVlDevice || '').trim()
    ) {
        // Keep CPU-only environments runnable by clearing a stale forced GPU device.
        updates.ocrVlDevice = '';
    }

    if (!Object.keys(updates).length) {
        return {
            success: true,
            changedKeys: [],
            autoConfigured: false,
            detection,
            config: currentConfig,
            error: null
        };
    }

    const result = await Config.setMany(updates);
    return {
        success: !!(result && result.success !== false),
        changedKeys: Object.keys(updates),
        autoConfigured: true,
        detection,
        config: result && result.config ? result.config : Config.getAll(),
        error: result && result.error ? result.error : null
    };
};

const classifyCliFailure = (result, attempts, extra = '') => {
    const details = normalizeFailureDetails(result, attempts, extra);

    if (result && result.error) {
        return {
            success: false,
            text: '',
            error: result.error && result.error.code === 'ENOENT'
                ? 'paddleocr-vl-cli-not-found'
                : 'paddleocr-vl-cli-failed',
            details
        };
    }

    if (result && result.timedOut) {
        return {
            success: false,
            text: '',
            error: 'paddleocr-vl-cli-timeout',
            details
        };
    }

    const combinedOutput = `${result && result.stderr ? result.stderr : ''}\n${result && result.stdout ? result.stdout : ''}`.toLowerCase();

    if (
        combinedOutput.includes("dependency 'paddlepaddle' is not installed") ||
        combinedOutput.includes('engine \'paddle_static\' is unavailable') ||
        combinedOutput.includes('no module named \'paddle\'') ||
        combinedOutput.includes('no module named "paddle"')
    ) {
        return {
            success: false,
            text: '',
            error: 'paddleocr-vl-cli-missing-paddlepaddle',
            details
        };
    }

    return {
        success: false,
        text: '',
        error: 'paddleocr-vl-cli-failed',
        details
    };
};

const collectFiles = async (rootDir) => {
    const results = [];
    const entries = await fs.promises.readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
        const absPath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            results.push(...await collectFiles(absPath));
            continue;
        }
        results.push(absPath);
    }

    return results;
};

const pickNewestFile = async (paths) => {
    const withStats = await Promise.all(paths.map(async (filePath) => ({
        filePath,
        stat: await fs.promises.stat(filePath)
    })));

    withStats.sort((left, right) => right.stat.mtimeMs - left.stat.mtimeMs);
    return withStats.length ? withStats[0].filePath : '';
};

const findNewestByExtension = async (rootDir, extensions) => {
    const lowerSet = new Set((extensions || []).map((ext) => String(ext || '').toLowerCase()));
    const files = await collectFiles(rootDir);
    const matched = files.filter((filePath) => lowerSet.has(path.extname(filePath).toLowerCase()));
    if (!matched.length) return '';
    return pickNewestFile(matched);
};

const extractTextFromJson = (value, results = []) => {
    if (!value) return results;

    if (typeof value === 'string') {
        const next = value.trim();
        if (next) results.push(next);
        return results;
    }

    if (Array.isArray(value)) {
        value.forEach((item) => extractTextFromJson(item, results));
        return results;
    }

    if (typeof value === 'object') {
        if (Array.isArray(value.parsing_res_list)) {
            value.parsing_res_list.forEach((item) => {
                if (item && typeof item === 'object' && typeof item.block_content === 'string') {
                    extractTextFromJson(item.block_content, results);
                }
            });
            return results;
        }

        if (Array.isArray(value.blocks)) {
            value.blocks.forEach((item) => {
                if (!item || typeof item !== 'object') return;
                if (typeof item.block_content === 'string') {
                    extractTextFromJson(item.block_content, results);
                    return;
                }
                if (typeof item.text === 'string') {
                    extractTextFromJson(item.text, results);
                }
            });
            return results;
        }

        for (const [key, child] of Object.entries(value)) {
            if (key === 'markdown' || key === 'text' || key === 'content') {
                extractTextFromJson(child, results);
                continue;
            }
            if (typeof child === 'object') {
                extractTextFromJson(child, results);
            }
        }
    }

    return results;
};

const cleanupDir = async (rootDir) => {
    if (!rootDir) return;
    try {
        await fs.promises.rm(rootDir, { recursive: true, force: true });
    } catch (_) {
        // ignore cleanup failures
    }
};

const runCli = (command, args, cwd, timeoutMs) => new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;
    let child = null;

    const finish = (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
    };

    try {
        child = spawn(command, args, {
            cwd,
            env: process.env,
            stdio: ['ignore', 'pipe', 'pipe']
        });
    } catch (error) {
        finish({ code: null, stdout, stderr, error, timedOut: false });
        return;
    }

    const timer = setTimeout(() => {
        timedOut = true;
        try {
            child.kill('SIGKILL');
        } catch (_) {
            // ignore
        }
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
        stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
        stderr += chunk.toString();
    });

    child.on('error', (error) => {
        clearTimeout(timer);
        finish({ code: null, stdout, stderr, error, timedOut });
    });

    child.on('close', (code) => {
        clearTimeout(timer);
        finish({ code, stdout, stderr, error: null, timedOut });
    });
});

const readCliOutput = async (outputDir, stdout) => {
    const markdownPath = await findNewestByExtension(outputDir, ['.md', '.markdown']);
    const jsonPath = await findNewestByExtension(outputDir, ['.json']);

    const markdown = markdownPath
        ? await fs.promises.readFile(markdownPath, 'utf8')
        : '';

    let rawJson = null;
    if (jsonPath) {
        const jsonText = await fs.promises.readFile(jsonPath, 'utf8');
        rawJson = JSON.parse(jsonText);
    }

    const extractedText = rawJson
        ? extractTextFromJson(rawJson).join('\n\n').trim()
        : '';

    const text = String(markdown || extractedText || stdout || '').trim();
    if (!text) {
        return {
            success: false,
            text: '',
            error: 'paddleocr-vl-cli-no-output'
        };
    }

    return {
        success: true,
        text,
        blocks: [],
        points: [],
        confidence: null,
        upscaled: false,
        upscaleScale: 1,
        engine: 'paddleocr-vl-cli',
        markdown,
        raw: rawJson
    };
};

const normalizeImageData = (imageData) => {
    if (!imageData) return null;
    if (imageData instanceof Uint8Array) return imageData;
    if (Buffer.isBuffer(imageData)) return new Uint8Array(imageData);
    if (Array.isArray(imageData)) return Uint8Array.from(imageData);
    return null;
};

const maybePersistResolvedCommand = async (candidate, currentCommand) => {
    const nextValue = String(candidate && candidate.persistedCommand ? candidate.persistedCommand : '').trim();
    const prevValue = String(currentCommand || '').trim();
    if (!nextValue || nextValue === prevValue) return false;

    try {
        await Config.set('ocrVlCliCommand', nextValue);
        return true;
    } catch (_) {
        return false;
    }
};

const performRecognizeText = async (payload = {}) => {
    const bytes = normalizeImageData(payload.imageData);
    if (!bytes || !bytes.length) {
        return {
            success: false,
            text: '',
            error: 'invalid-image-data'
        };
    }

    const config = Config.getAll();
    const configuredCommand = String(config.ocrVlCliCommand || DEFAULT_CLI_COMMAND).trim() || DEFAULT_CLI_COMMAND;
    const extraArgs = parseCliArgs(config.ocrVlCliArgs || '');
    const structuredArgs = buildStructuredCliArgs(config, extraArgs);
    const preprocessModels = payload.preprocessModels && typeof payload.preprocessModels === 'object'
        ? payload.preprocessModels
        : {};

    let tempDir = '';
    try {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'clipboard-god-vl-'));
        const outputDir = path.join(tempDir, 'output');
        const inputPath = path.join(tempDir, `input${mimeTypeToExtension(payload.mimeType)}`);

        await fs.promises.mkdir(outputDir, { recursive: true });
        await fs.promises.writeFile(inputPath, Buffer.from(bytes));

        const docParserArgs = [
            'doc_parser',
            '-i',
            inputPath,
            '--save_path',
            outputDir,
            '--use_doc_orientation_classify',
            toBooleanCliValue(preprocessModels.docOrientation !== false),
            '--use_doc_unwarping',
            toBooleanCliValue(!!preprocessModels.docUnwarp),
            ...structuredArgs,
            ...extraArgs
        ];

        const candidates = await buildCliCandidates(configuredCommand);
        const attemptedCommands = [];
        let lastFailure = {
            success: false,
            text: '',
            error: 'paddleocr-vl-cli-not-found',
            details: ''
        };

        for (const candidate of candidates) {
            const displayCommand = serializeCliCommandSpec(candidate);
            attemptedCommands.push(displayCommand);

            const result = await runCli(
                candidate.command,
                [...(candidate.prefixArgs || []), ...docParserArgs],
                tempDir,
                CLI_TIMEOUT_MS
            );

            if (!result.error && !result.timedOut) {
                const output = await readCliOutput(outputDir, result.stdout);
                if (!output.success) {
                    if (result.code === 0) {
                        lastFailure = {
                            ...output,
                            details: joinDetails(output.details, formatTriedCommands(attemptedCommands))
                        };
                        continue;
                    }

                    lastFailure = {
                        ...classifyCliFailure(result, attemptedCommands, `Active command: ${displayCommand}`),
                        details: joinDetails(
                            classifyCliFailure(result, attemptedCommands, `Active command: ${displayCommand}`).details,
                            output.details
                        )
                    };
                    continue;
                }

                const autoConfigured = await maybePersistResolvedCommand(candidate, configuredCommand);
                return {
                    ...output,
                    resolvedCommand: displayCommand,
                    autoConfigured,
                    hadNonZeroExit: result.code !== 0,
                    warningDetails: result.code !== 0 ? tailLines(result.stderr || result.stdout, 20) : ''
                };
            }

            lastFailure = classifyCliFailure(result, attemptedCommands, `Active command: ${displayCommand}`);
        }

        return lastFailure;
    } catch (error) {
        return {
            success: false,
            text: '',
            error: 'paddleocr-vl-cli-failed',
            details: error && error.message ? error.message : ''
        };
    } finally {
        await cleanupDir(tempDir);
    }
};

const recognizeText = async (payload = {}) => scheduleOcrJob(() => performRecognizeText(payload));

module.exports = {
    recognizeText,
    detectRuntimeEnvironment,
    redetectRuntimeEnvironment
};