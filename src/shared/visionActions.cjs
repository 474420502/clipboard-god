const VISION_ACTION_ICON_BODIES = {
    eye: [
        '<path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z" />',
        '<circle cx="12" cy="12" r="3" />'
    ].join('\n'),
    document: [
        '<path d="M6 5h12v14H6z" />',
        '<path d="M9 9h6" />',
        '<path d="M9 13h6" />',
        '<path d="M9 17h4" />'
    ].join('\n'),
    steps: [
        '<path d="M5 6h14" />',
        '<path d="M5 12h9" />',
        '<path d="M5 18h6" />',
        '<path d="M16 10l3 2-3 2" />'
    ].join('\n'),
    solve: [
        '<circle cx="12" cy="12" r="8" />',
        '<path d="M12 8v4l3 3" />',
        '<path d="M16 5h4v4" />',
        '<path d="m20 5-4.5 4.5" />'
    ].join('\n'),
    grid: [
        '<rect x="4" y="5" width="16" height="14" rx="2" ry="2" />',
        '<path d="M4 10h16" />',
        '<path d="M9 10v9" />',
        '<path d="M15 10v9" />'
    ].join('\n'),
    browser: [
        '<rect x="3" y="4" width="18" height="16" rx="2" ry="2" />',
        '<path d="M3 8h18" />',
        '<path d="m10 11-3 3 3 3" />',
        '<path d="m14 11 3 3-3 3" />'
    ].join('\n'),
    custom: [
        '<path d="m12 3 1.9 4.1L18 9l-4.1 1.9L12 15l-1.9-4.1L6 9l4.1-1.9L12 3Z" />',
        '<path d="M19 16v5" />',
        '<path d="M21.5 18.5h-5" />'
    ].join('\n')
};

const BUILTIN_VISION_ACTIONS = [
    {
        id: 'vl-describe',
        label: '解析图片',
        title: '解析图片 / Parse image',
        icon: 'eye',
        fileNamePrefix: 'vl-describe',
        prompt: [
            '请解析这张图片的主要内容。',
            '输出结构：',
            '1. 这是什么画面、页面或场景。',
            '2. 3 到 5 条最重要的信息。',
            '3. 如果图中有明显按钮、状态、错误、数字或关键文字，请单独列出。',
            '4. 如果适合进一步追问，也给出 2 到 3 个建议方向。',
            '请直接输出结果，不要写多余寒暄。'
        ].join('\n')
    },
    {
        id: 'vl-ocr',
        label: '图片转文字',
        title: '图片转文字 / Image to text',
        icon: 'document',
        fileNamePrefix: 'vl-ocr',
        prompt: [
            '处理图片转文字(ocr),对于数字0123456789需要比较认真。',
            '如果图片里有多语言文本，请按原语言原样保留。',
            '请完整识别这张图片里所有可见文字，不要做摘要，不要解释。',
            '要求：',
            '1. 保留原有段落、列表、表格和标题层级。',
            '2. 表格尽量转成 Markdown 表格。',
            '3. 看不清的少量内容用 [unclear] 标记。',
            '4. 只输出识别结果本身，不要添加前言或结尾说明。'
        ].join('\n')
    },
    {
        id: 'vl-next-step',
        label: '看图解决问题',
        title: '看图解决问题 / Solve from image',
        icon: 'solve',
        fileNamePrefix: 'vl-solve-problem',
        prompt: [
            '请把这张图片当成用户当前正在处理的问题现场，直接按“看图解决问题”来回答。',
            '输出结构：',
            '1. 当前画面在做什么，或者具体卡在什么问题上。',
            '2. 关键证据：重要按钮、状态、报错、数字、步骤或缺失项。',
            '3. 应该怎么解决：给出 2 到 5 条可执行步骤，按优先级排序。',
            '4. 如果还缺信息，请明确指出还需要补什么。',
            '如果这是软件界面、网页、表单、报错页或控制台截图，请优先按“解决问题”来回答，而不是只做表面描述。'
        ].join('\n')
    },
    {
        id: 'vl-structured-data',
        label: '提取结构化信息',
        title: '提取结构化信息 / Structured extraction',
        icon: 'grid',
        fileNamePrefix: 'vl-structured-data',
        prompt: [
            '请从这张图片中提取可复用的结构化信息。',
            '输出要求：',
            '1. 先列出图片类型和你识别到的主要信息块。',
            '2. 把关键信息整理成结构化结果，优先使用 Markdown 。',
            '3. 如果图片里有表格、字段、表单、卡片、指标、时间、金额、编号、状态，请尽量拆成明确字段。',
            '4. 对不确定的信息标注 confidence 或备注 unclear，不要硬编。',
            '5. 如果适合，也补充一个简短的字段说明表。',
            '只输出提取结果和必要备注，不要写多余寒暄。'
        ].join('\n')
    },
    {
        id: 'vl-recreate-web',
        label: '截图复刻Web组件',
        title: '截图复刻 Web 组件 / Recreate web component',
        icon: 'browser',
        fileNamePrefix: 'vl-recreate-web',
        prompt: [
            '请根据这张截图复刻其中的 Web 组件或页面片段。',
            '输出结构：',
            '1. 先说明你识别到的组件类型、层级结构和布局关系。',
            '2. 再输出可直接复用的前端代码，优先给 HTML + CSS；如果更合适，也可以给 React JSX + CSS。',
            '3. 颜色、圆角、边框、间距、字号、阴影、对齐方式尽量贴近截图。',
            '4. 文案内容按截图还原；看不清的文案用合理占位并标注。',
            '5. 如果这是一个复杂区域，优先复刻最核心、最可复用的组件，而不是整页无差别铺开。',
            '不要输出解释性长文，直接给结构说明和代码。'
        ].join('\n')
    }
];

const BUILTIN_VISION_ACTION_IDS = new Set(BUILTIN_VISION_ACTIONS.map((item) => item.id));

const CUSTOM_VISION_ACTION_TEMPLATE = {
    label: '自定义动作',
    prompt: [
        '请根据这张图片完成以下自定义任务。',
        '输出要求：',
        '1. 直接完成任务本身。',
        '2. 如果信息不足，请明确说明还缺什么。',
        '3. 不要输出多余寒暄。',
        '',
        '你可以把这个按钮改成：页面审查、字段校验、测试用例生成、差异比对等。'
    ].join('\n')
};

function sanitizeText(value, fallback = '') {
    const next = typeof value === 'string' ? value.trim() : '';
    return next || fallback;
}

function sanitizeActionId(value, fallback = '') {
    return String(value || fallback || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function sanitizeIcon(value, fallback = 'custom') {
    const next = String(value || '').trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(VISION_ACTION_ICON_BODIES, next) ? next : fallback;
}

function sanitizeFileNamePrefix(value, fallback = 'vision-action') {
    return String(value || fallback || 'vision-action')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/^-+|-+$/g, '') || fallback;
}

function normalizeBuiltinAction(base, raw) {
    const label = sanitizeText(raw && raw.label, base.label);
    return {
        id: base.id,
        label,
        title: sanitizeText(raw && raw.title, label),
        prompt: sanitizeText(raw && raw.prompt, base.prompt),
        icon: sanitizeIcon(raw && raw.icon, base.icon),
        fileNamePrefix: base.fileNamePrefix,
        builtin: true
    };
}

function normalizeCustomAction(raw, index = 0) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }

    const id = sanitizeActionId(raw.id);
    const label = sanitizeText(raw.label, '');
    const prompt = sanitizeText(raw.prompt, '');

    if (!id || !label || !prompt || BUILTIN_VISION_ACTION_IDS.has(id)) {
        return null;
    }

    return {
        id,
        label,
        title: sanitizeText(raw.title, label),
        prompt,
        icon: sanitizeIcon(raw.icon, 'custom'),
        fileNamePrefix: sanitizeFileNamePrefix(raw.fileNamePrefix || id, `vision-action-${index + 1}`),
        builtin: false
    };
}

function normalizeVisionActions(actions = []) {
    const rawList = Array.isArray(actions)
        ? actions.filter((item) => item && typeof item === 'object')
        : [];
    const rawById = new Map();

    rawList.forEach((item) => {
        const id = sanitizeActionId(item.id);
        if (id && !rawById.has(id)) {
            rawById.set(id, item);
        }
    });

    const builtins = BUILTIN_VISION_ACTIONS.map((item) => normalizeBuiltinAction(item, rawById.get(item.id)));
    const customs = rawList
        .map((item, index) => normalizeCustomAction(item, index))
        .filter(Boolean);

    return [...builtins, ...customs];
}

function createCustomVisionAction(seed = {}) {
    const fallbackLabel = sanitizeText(seed.label, CUSTOM_VISION_ACTION_TEMPLATE.label);
    const generatedId = sanitizeActionId(seed.id)
        || sanitizeActionId(`custom-${fallbackLabel}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`);

    return normalizeCustomAction({
        id: generatedId,
        label: fallbackLabel,
        title: sanitizeText(seed.title, fallbackLabel),
        prompt: sanitizeText(seed.prompt, CUSTOM_VISION_ACTION_TEMPLATE.prompt),
        icon: sanitizeIcon(seed.icon, 'custom'),
        fileNamePrefix: sanitizeFileNamePrefix(seed.fileNamePrefix || generatedId, generatedId)
    }) || {
        id: generatedId,
        label: fallbackLabel,
        title: fallbackLabel,
        prompt: CUSTOM_VISION_ACTION_TEMPLATE.prompt,
        icon: 'custom',
        fileNamePrefix: sanitizeFileNamePrefix(generatedId, 'custom-action'),
        builtin: false
    };
}

function getDefaultVisionActions() {
    return BUILTIN_VISION_ACTIONS.map((item) => normalizeBuiltinAction(item, item));
}

function toPersistedVisionActions(actions = []) {
    return normalizeVisionActions(actions).map((item) => ({
        id: item.id,
        label: item.label,
        prompt: item.prompt,
        icon: item.icon
    }));
}

function getVisionActionIconBody(icon) {
    return VISION_ACTION_ICON_BODIES[sanitizeIcon(icon, 'custom')] || VISION_ACTION_ICON_BODIES.custom;
}

module.exports = {
    BUILTIN_VISION_ACTIONS,
    CUSTOM_VISION_ACTION_TEMPLATE,
    VISION_ACTION_ICON_BODIES,
    createCustomVisionAction,
    getDefaultVisionActions,
    getVisionActionIconBody,
    normalizeVisionActions,
    toPersistedVisionActions
};

module.exports.default = module.exports;
