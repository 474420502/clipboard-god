const USER_BLOCK_TEMPLATE = '\n---\n<user>\n%s\n---\n';

function hasMeaningfulText(value) {
    return typeof value === 'string' && value.trim().length > 0;
}

function toTrimmedString(value) {
    if (value == null) return '';
    return String(value).trim();
}

function buildUserMessageBlock(text) {
    return USER_BLOCK_TEMPLATE.replace('%s', String(text || ''));
}

module.exports = {
    hasMeaningfulText,
    toTrimmedString,
    buildUserMessageBlock,
};
