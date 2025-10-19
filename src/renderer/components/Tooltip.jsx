import React from 'react';

function Tooltip({ content, visible }) {
    if (!visible) return null;

    return (
        <div className="custom-tooltip">
            <div className="custom-tooltip-content">{content}</div>
        </div>
    );
}

export default Tooltip;
