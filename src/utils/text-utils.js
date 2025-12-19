/**
 * 텍스트 처리 유틸리티 (text-utils.js)
 * 문자열 조작 및 청킹 관련 기능을 제공합니다.
 */

/**
 * 텍스트를 문맥 단위로 자연스럽게 분할합니다.
 * 문장이나 단어 중간이 잘리지 않도록 문장 부호를 기준으로 자릅니다.
 * 
 * @param {string} text 원본 텍스트
 * @param {number} limit 청크 당 최대 길이
 * @param {number} overlap 청크 간 중첩 길이
 * @returns {string[]} 분할된 텍스트 배열
 */
export function smartSplitText(text, limit, overlap) {
    const chunks = [];
    let startIndex = 0;

    while (startIndex < text.length) {
        let endIndex = startIndex + limit;

        if (endIndex < text.length) {
            // limit 위치 근처의 문장 종결 부호(. ? ! \n) 찾기
            // limit부터 역으로 500자까지 탐색
            const searchEnd = text.substring(startIndex, endIndex);
            const lastPunctuation = Math.max(
                searchEnd.lastIndexOf("."),
                searchEnd.lastIndexOf("\n"),
                searchEnd.lastIndexOf("?"),
                searchEnd.lastIndexOf("!")
            );

            if (lastPunctuation > limit - 500) { // 너무 앞이 아니면 거기서 자름
                endIndex = startIndex + lastPunctuation + 1;
            } else {
                // 문장 부호를 못 찾으면 공백이라도 찾음
                const lastSpace = searchEnd.lastIndexOf(" ");
                if (lastSpace > limit - 200) {
                    endIndex = startIndex + lastSpace + 1;
                }
            }
        }

        const chunk = text.substring(startIndex, endIndex);
        chunks.push(chunk);

        // 다음 청크 시작 위치 계산 (오버랩 적용)
        if (endIndex >= text.length) break;
        startIndex = endIndex - overlap;
    }

    return chunks;
}
