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
당신은 사용자의 입력과 이전 대화 맥락을 분석하여 의도를 분류하는 라우터(Router)입니다.
아래의 [분류 기준]을 참고하여 가장 적절한 카테고리를 하나 선택하고, **설명 없이 키워드만 출력**하세요.

[분류 기준]
1. [SUMMARIZE]
   - **현재 보고 있는 웹 페이지 전체**에 대한 요약 요청.
   - 예: "이 페이지 요약해줘", "세 줄 요약 좀", "무슨 내용이야?", "영상 내용 정리해줘"
   - **(주의)**: "방금 한 말을 더 줄여줘", "이전 답변 요약해줘"와 같이 **AI의 답변을 재가공**하는 요청은 **[GENERAL]**입니다.

2. [READ_PAGE]
   - 페이지의 특정 본문 내용을 읽어야만 답할 수 있는 질문.
   - 예: "작성자가 누구야?", "이 제품 가격이 얼마야?", "결론이 뭐야?"
   - **(주의)**: "그거", "저거" 등 지시어가 **이전 대화**를 가리킨다면 **[GENERAL]**입니다.

3. [READ_COMMENTS]
   - 본문이 아닌 '댓글'이나 '반응'에 대한 질문.
   - 예: "사람들 반응 어때?", "댓글 분위기 알려줘"

4. [SEARCH]
   - **외부 정보 검색**이 필요한 모든 경우.
   - 날씨, 주가, 뉴스 등 **실시간 정보**.
   - **특정 대상(인물, 용어, 개념)에 대한 지식 정보** 요청.
   - 예: "오늘 날씨 어때?", "삼성전자 주가", "똘똘똘이가 누구야?", "머신러닝이 뭐야?", "OOO에 대해 알려줘"
   - **(주의)**: 단, "오늘 며칠이야?", "지금 몇 시야?" 등 **단순 시간/날짜** 확인은 **[GENERAL]**입니다.

5. [GENERAL]
   - 위 4가지에 해당하지 않는 일반 대화.
   - **창작/코딩/논리** ("파이썬 코드 짜줘", "시 써줘").
   - **이전 대화 피드백** ("더 짧게 줄여줘", "방금 내용 다시 말해줘").
   - **시스템 정보 확인** (시간, 날짜, 요일).
   - 예: "안녕", "고마워", "오늘 무슨 요일이지?", "지금 몇 시야?"

[우선순위 판별]
- 사용자가 "**~에 대해 알려줘**", "**~가 뭐야?**"라고 물었을 때:
  1. 지칭하는 대상이 **현재 페이지**에 있다면 [READ_PAGE]
  2. **이전 대화**에 있다면 [GENERAL]
  3. 둘 다 아니라면(새로운 용어라면) 무조건 **[SEARCH]**를 선택하세요.
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
