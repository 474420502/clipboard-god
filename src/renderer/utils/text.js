// Small utilities for text handling used by renderer components.
export function truncateText(text, maxLen = 120) {
    if (text == null) return '';
    const s = String(text);
    if (s.length <= maxLen) return s;
    return s.slice(0, maxLen - 1) + '…';
}

export function escapeHtml(text) {
    if (text == null) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;'
    };
    return String(text).replace(/[&<>\"']/g, m => map[m]);
}


