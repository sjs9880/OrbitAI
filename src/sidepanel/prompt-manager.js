export const SYSTEM_PROMPT = `당신은 유능한 AI 비서 'Orbit'입니다.
사용자의 요청(User Query)을 읽고 참고 자료(Context)를 활용하여 지시사항(Instruction)에 따라 잘못된 정보를 제공하지 않도록 주의를 기울여 답변해주세요.
별도의 요청이 없는 경우 한국어를 사용하여 답변해주세요.

'SystemInformation' 은 사용자가 요청하는 정보를 제공하는 데 도움이 되는 시스템 정보가 포함되어 있습니다.

'Instruction' 은 당신의 행동에 대한 지침을 담고 있습니다. 
'Tone' 은 당신이 답변할 때 사용할 태도를 담고 있습니다. 없는 경우 친절한 톤을 유지하세요.
'Action' 은 당신이 해야 할 행동에 대한 지침을 담고 있습니다. 없는 경우 요청(UserQuery)에 대한 답변을 제공하는 것이 기본 지침입니다.

'Input' 은 사용자가 제공한 자료와 요청사항입니다.
'Context' 은 사용자가 첨부한 참고 자료입니다. 이 자료에 대해 사용자가 물어보거나 요청 할 수 있습니다.
'UserQuery' 은 사용자의 요청입니다. 여기에는 자료가 포함될 수 있습니다. 비어 있는 경우 'Action' 를 따르세요.`;

export const ROUTER_PROMPT = `
사용자의 입력 및 대화 히스토리를 분석하여 다음 5가지 중 하나로 분류하고 키워드만 출력하세요. 설명은 필요 없습니다.
1. [SUMMARIZE]: 페이지 내용에 대한 요약 요청인 경우. "이 페이지 요약해줘", "세 줄 요약 좀", "전체 내용 정리" 등
2. [READ_PAGE]: 페이지의 본문 내용을 참고해야 답할 수 있는 질문인 경우. "이 내용에 대해 어떻게 생각해?", "이 제품 가격이 얼마야?", "결론이 뭐야?", "작성자가 누구야?" 등
3. [READ_COMMENTS]: 페이지의 댓글에 대한 질문인 경우. "사람들 반응 어때?", "댓글 분위기 알려줘", "욕하는 사람 많아?", "베플 내용이 뭐야?" 등
4. [SEARCH]: 외부 검색이 필요한 질문인 경우. "오늘 날씨", "삼성전자 주가", "최신 뉴스" 등
5. [GENERAL]: 일반적인 대화인 경우. "안녕", "파이썬 코드 짜줘", "지금 이야기 한 내용을 정리해줘", "요약하자면?", "오늘이 무슨 요일이지?" 등.
`;

export const TONE_INSTRUCTIONS = {
    '기본': '',
    '정중하게': '답변은 정중하고 격식 있는 비즈니스 톤으로 작성해 주세요.',
    '친근하게': '친한 친구와 대화하는 것처럼 친근하고 부드러운 대화 톤으로 응답을 작성하되 예의 바른 태도를 유지해 주세요.'
};

export class PromptManager {
    constructor() {
    }

    /**
     * 최종 프롬프트 문자열 구성
     * @param {string} userText 사용자 입력 텍스트
     * @param {Object} contextData 컨텍스트 데이터 모음
     * @param {Object} aiService AIService 인스턴스 (Cloud 모드 확인용)
     */
    build(userText, contextData, aiService) {
        const {
            pageContext,
            historyContext,
            activeContexts,
            currentTone,
            pendingActionInstruction
        } = contextData;

        let prompt = "";

        // Cloud 모드는 시스템 프롬프트를 별도로 지원하지 않으므로 직접 포함
        if (aiService.isCloudMode) {
            prompt += `<systemPrompt>\n${SYSTEM_PROMPT}\n</systemPrompt>\n\n`;
        }

        prompt += `<SystemInformation>\n`;
        prompt += `<Current Time>\n${new Date().toLocaleString('kr-KR', { dateStyle: 'full', timeStyle: 'medium' })}\n</Current Time>\n`;

        // 페이지 정보 추가
        if (pageContext) {
            prompt += `<Current Page>\nTitle: ${pageContext.title}\nURL: ${pageContext.url}\n</Current Page>\n`;
        }

        // 히스토리 주입
        if (historyContext) {
            prompt += historyContext;
        }
        prompt += `</SystemInformation>\n\n`;

        // 지시사항 (Instruction) 섹션
        if ((currentTone !== '기본' && TONE_INSTRUCTIONS[currentTone]) || pendingActionInstruction) {
            prompt += `<Instruction>\n`;
            if (currentTone !== '기본' && TONE_INSTRUCTIONS[currentTone]) {
                prompt += `<Tone>\n${TONE_INSTRUCTIONS[currentTone]}\n</Tone>\n`;
            }
            if (pendingActionInstruction) {
                prompt += `<Action>\n${pendingActionInstruction}\n</Action>\n`;
            }
            prompt += `</Instruction>\n\n`;
        }

        prompt += `<input>\n`;
        if (activeContexts && activeContexts.length > 0) {
            activeContexts.forEach((ctx, i) => {
                prompt += `<Context ${i + 1}>\n${ctx}\n</Context>\n`;
            });
        }
        prompt += `<UserQuery>\n${userText}\n</UserQuery>\n`;
        prompt += `</input>`;

        return prompt;
    }
}
