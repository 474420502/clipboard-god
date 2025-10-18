import { useEffect, useRef } from 'react';

// useNumberShortcuts
// - filteredHistory: array of items displayed (used to select index)
// - enabled: boolean flag
// - pasteFn: function(item) -> triggers paste (should handle errors)
// The hook adds a keydown listener that ignores input-focused elements and
// only reacts to digits 1-9 when enabled.
export default function useNumberShortcuts(filteredHistory, enabled, pasteFn) {
    const enabledRef = useRef(enabled);
    const historyRef = useRef(filteredHistory);
    const pasteRef = useRef(pasteFn);

    useEffect(() => {
        enabledRef.current = enabled;
    }, [enabled]);
    useEffect(() => { historyRef.current = filteredHistory; }, [filteredHistory]);
    useEffect(() => { pasteRef.current = pasteFn; }, [pasteFn]);

    useEffect(() => {
        const handler = (event) => {
            // ignore when focus is on editable elements
            const active = document.activeElement;
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
                return;
            }

            if (!enabledRef.current) return;
            if (!(event.key >= '1' && event.key <= '9')) return;

            const index = parseInt(event.key, 10) - 1;
            const item = historyRef.current[index];
            if (item && typeof pasteRef.current === 'function') {
                try {
                    pasteRef.current(item);
                    event.preventDefault();
                } catch (err) {
                    // swallow — pasteFn should log
                }
            }
        };

        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, []);
}
