/**
 * AI 유틸리티 (ai-utils.js)
 * AI 모델 탐색 및 공통 관련 기능을 제공합니다.
 */

/**
 * 브라우저 전역 객체에서 AI 모델 인터페이스를 안전하게 탐색합니다.
 * window.ai, self.ai, 또는 전역 LanguageModel을 확인합니다.
 * 
 * @returns {object|null} 찾은 AI 모델 인터페이스 또는 null
 */
export function findAIModel() {
    if (typeof window !== 'undefined' && window.ai && window.ai.languageModel) {
        return window.ai.languageModel;
    }
    if (typeof self !== 'undefined' && self.ai && self.ai.languageModel) {
        return self.ai.languageModel;
    }
    if (typeof LanguageModel !== 'undefined') {
        return LanguageModel;
    }
    return null;
}

/**
 * AI 모델 인터페이스와 출처를 함께 반환합니다 (디버깅용).
 * 
 * @returns {object|null} { api, source } 형태의 객체 또는 null
 */
export function findAIModelWithSource() {
    if (typeof window !== 'undefined' && window.ai && window.ai.languageModel) {
        return { api: window.ai.languageModel, source: 'window.ai' };
    }
    if (typeof self !== 'undefined' && self.ai && self.ai.languageModel) {
        return { api: self.ai.languageModel, source: 'self.ai' };
    }
    if (typeof LanguageModel !== 'undefined') {
        return { api: LanguageModel, source: 'Global LanguageModel' };
    }
    return null;
}
