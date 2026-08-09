/**
 * 应用类型定义
 */

/**
 * 错误类型定义
 */
class AppError extends Error {
    constructor(message, code, type = 'general') {
        super(message);
        this.name = 'AppError';
        this.code = code;
        this.type = type;
    }
}

module.exports = {
    AppError
};
