import { AIService } from './ai-service.js';
import { UIManager } from './ui-manager.js';
import { SummaryManager } from './summary-manager.js';
import { PromptManager, TONE_INSTRUCTIONS, ROUTER_PROMPT } from './prompt-manager.js';
import { SessionManager } from './session-manager.js';
import { logger } from '../utils/log-manager.js';

const aiService = new AIService();
const uiManager = new UIManager();
const promptManager = new PromptManager();
// 세션 매니저 초기화
const sessionManager = new SessionManager(aiService, uiManager, {
    onSessionRestored: (messages) => {
        // 복구된 메시지로 현재 히스토리 상태 동기화
        conversationHistory = messages.map(m => ({ role: m.role, content: m.content }));

        // Local AI 컨텍스트 초기화 및 재주입 유도
        isLocalSessionSynced = false; // 다음 전송 시 히스토리 전체 주입
        aiService.destroy(); // 기존 세션(이전 대화 기억) 제거

        logger.info('SessionManager', `세션 복구됨: ${conversationHistory.length}개의 메시지`);
    }
});

// SummaryManager 초기화 (종속성 및 콜백 전달)
// SummaryManager 내부도 수정해야 하지만, 일단 콜백으로 logger.log를 전달하거나 내부에서 imporing하게 해야 함.
// 여기서는 saveDebugLog 호환성을 위해 래퍼를 전달하거나 SummaryManager가 직접 쓰게 변경 필요.
// SummaryManager.js를 직접 수정하는 것이 깔끔함. 일단 여기서는 콜백 제거.
const summaryManager = new SummaryManager(aiService, uiManager, {
    saveDebugLog: (type, msg, sessionName) => {
        logger.log('INFO', 'SummaryManager', msg, {
            type,
            sessionName,
            mode: aiService.isCloudMode ? 'Cloud' : 'Local'
        });
    },
    addToHistory: addToHistory
});


// 전역 상태 변수
let activeContexts = [];            // 현재 첨부된 컨텍스트 목록
let pendingActionInstruction = null; // 대기 중인 액션 지시사항 (검색, 번역 등)
let currentTone = '기본';            // 현재 선택된 톤 (기본, 정중하게, 친근하게)
let conversationHistory = [];       // 대화 히스토리
let isLocalSessionSynced = true;    // 로컬 세션 동기화 여부

/**
 * 대화 히스토리 추가 (토큰 관리)
 * @param {string} role 'user' | 'model'
 * @param {string} text 메시지 내용
 */
function addToHistory(role, text) {
    // 1. 텍스트 길이 제한 (3000자 초과 시 축약)
    let content = text;
    if (content.length > 3000) {
        content = content.substring(0, 3000) + "\n...(내용이 너무 길어 축약됨)";
    }

    // 2. 히스토리 추가
    conversationHistory.push({ role, content });

    // 세션 매니저에도 추가 (영구 저장)
    if (sessionManager) {
        sessionManager.addMessage(role, content);
    }

    // 3. Sliding Window (최근 15턴 유지)
    if (conversationHistory.length > 15) {
        conversationHistory.shift();
    }
}

// --- 초기화 (Initialization) ---

async function init() {
    // 기본 설정 로드 및 적용
    try {
        const settings = await chrome.storage.sync.get(['defaultAIMode', 'defaultTone']);

        // 1. 기본 모드 적용
        if (settings.defaultAIMode === 'cloud') {
            aiService.isCloudMode = true;
        } else {
            aiService.isCloudMode = false;
        }

        // 2. 기본 톤 적용
        if (settings.defaultTone && TONE_INSTRUCTIONS[settings.defaultTone] !== undefined) {
            currentTone = settings.defaultTone;
            // UI 반영
            const toneLabel = document.querySelector('#btn-tone-toggle .label');
            if (toneLabel) toneLabel.textContent = currentTone;
        }
    } catch (e) {
        console.warn("설정 로드 실패:", e);
    }

    // 세션 매니저 초기화 및 상태 로드
    // (Local AI 초기화보다 먼저 실행하여 이전 상태 복구 시도)
    await sessionManager.init();

    // 로컬 AI 초기화 시도 (모드와 관계없이 준비)
    const result = await aiService.initLocalAI();
    if (!result.success) {
        // Local AI 초기화 실패 시 안내
        uiManager.hideWelcomeMessage();
        // Cloud 모드면 에러를 굳이 강조하지 않음 (선택사항)
        if (!aiService.isCloudMode) {
            uiManager.setStatus(uiManager.strings.fail + result.error, "#ef4444");
            if (result.error.includes("Gemini Nano")) {
                uiManager.showErrorGuide();
            }
        }
    } else {
        // Local 모드일 때만 '준비 완료' 표시 (Cloud 모드는 updateUIState에서 덮어씀)
        if (!aiService.isCloudMode) {
            uiManager.setStatus(uiManager.strings.readyLocal, "#10b981");
        }
    }

    // 보류 중인 텍스트 확인 (컨텍스트 메뉴 등으로 전달된 텍스트)
    chrome.storage.local.get('pendingText', (data) => {
        if (data.pendingText) {
            handlePendingText(data.pendingText);
            chrome.storage.local.remove('pendingText'); // 처리 후 삭제
        }
    });

    // 클라우드 모드 확인 및 UI 반영 (모델명 포함)
    await updateUIState();
}

/**
 * 현재 모드와 모델 설정에 따라 UI 갱신
 */
async function updateUIState() {
    const data = await chrome.storage.sync.get('geminiModelId');
    // 사용자가 보기 편한 이름으로 변환 (옵션 값 -> 표시 값)
    // gemini-2.0-flash -> Gemini 2.0 Flash
    // gemini-2.5-flash -> Gemini 2.5 Flash
    let displayModelName = "Gemini 2.5 Flash"; // 기본값

    if (data.geminiModelId) {
        if (data.geminiModelId === 'gemini-2.5-flash') {
            displayModelName = "Gemini 2.5 Flash";
        } else {
            // 그 외의 경우 (custom 값 등) 적절히 포맷팅하거나 그대로 사용
            // 예: gemini-2.0-flash -> Gemini 2.0 Flash
            const parts = data.geminiModelId.split('-');
            if (parts.length >= 3) { // gemini-X.X-flash 형식 가정
                displayModelName = `Gemini ${parts[1]} ${parts[2].charAt(0).toUpperCase() + parts[2].slice(1)}`;
            } else {
                displayModelName = data.geminiModelId;
            }
        }
    }

    if (aiService.isCloudMode) {
        uiManager.toggleCloudModeUI(true, displayModelName);
    } else {
        uiManager.toggleCloudModeUI(false);
    }
}


// ... (이벤트 핸들러) ...

// 1. 메시지 수신 (from Content Script, Background)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    // 텍스트 선택 후 'Orbit에 보내기' 실행 시
    if (request.type === 'Orbit_TEXT_SELECTED') {
        uiManager.setStatus(uiManager.strings.msgReceived, "#f59e0b");
        handlePendingText(request.text);
    }
});

// 2. 스토리지 변경 감지
chrome.storage.onChanged.addListener((changes, area) => {
    // 백그라운드에서 전달된 텍스트 감지
    if (area === 'local' && changes.pendingText && changes.pendingText.newValue) {
        handlePendingText(changes.pendingText.newValue);
        chrome.storage.local.remove('pendingText');
    }

    // 모델 변경 실시간 반영 (옵션 페이지에서 변경 시)
    if (area === 'sync' && changes.geminiModelId) {
        updateUIState();
    }
});

/**
 * 전달받은 텍스트를 컨텍스트로 추가 처리
 */
function handlePendingText(text) {
    if (activeContexts.includes(text)) {
        uiManager.setStatus(uiManager.strings.dupText, "#f59e0b");
        setTimeout(() => uiManager.setStatus(uiManager.strings.readyLocal, "#10b981"), 2000);
        return;
    }
    activeContexts.push(text);
    renderChips(); // 컨텍스트 칩 UI 렌더링

    // 입력창 커서 위치에 (Context N) 자동 삽입
    const input = uiManager.chatInput;
    const contextTag = `(Context ${activeContexts.length}) `;

    // 현재 커서 위치 확인 (포커스가 없으면 맨 뒤에 추가)
    if (document.activeElement !== input) {
        input.value += (input.value ? " " : "") + contextTag;
    } else {
        const start = input.selectionStart;
        const end = input.selectionEnd;
        const textBefore = input.value.substring(0, start);
        const textAfter = input.value.substring(end);

        input.value = textBefore + contextTag + textAfter;

        // 커서 위치 업데이트 (삽입된 태그 뒤로 이동)
        const newCursorPos = start + contextTag.length;
        input.setSelectionRange(newCursorPos, newCursorPos);
    }

    uiManager.setStatus(uiManager.strings.textAttached, "#2563eb");
    uiManager.chatInput.focus();
}

/**
 * 컨텍스트 칩 UI 업데이트
 */
function renderChips() {
    uiManager.renderContextChips(activeContexts, (index) => {
        // 삭제되는 컨텍스트 번호 (1-based)
        const removedNum = index + 1;
        const totalNum = activeContexts.length;

        // 1. 입력창에서 삭제된 태그 제거: `(Context N)` 또는 `(Context N) `
        let content = uiManager.chatInput.value;
        const tagToRemove = `(Context ${removedNum})`;

        // 태그 뒤에 공백이 있으면 함께 제거, 없으면 태그만 제거
        content = content.replace(new RegExp(`\\(Context ${removedNum}\\)\\s?`, 'g'), '');

        // 2. 입력창에서 뒤쪽 번호들을 앞당기기 (N+1 -> N)
        // 예: (Context 3) -> (Context 2)
        for (let i = removedNum + 1; i <= totalNum; i++) {
            const oldTag = `(Context ${i})`;
            const newTag = `(Context ${i - 1})`;
            content = content.replaceAll(oldTag, newTag);
        }

        // 입력값 업데이트
        uiManager.chatInput.value = content;

        // 3. 실제 데이터 삭제 및 재렌더링
        activeContexts.splice(index, 1);
        renderChips();
    });
}

// 3. 채팅 메시지 전송 처리

/**
 * 사용자 의도 분석
 */
async function analyzeIntent(userText) {
    try {
        // [NEW] 최근 대화 흐름 가져오기 (마지막 4개 메시지 = 2턴)
        // 너무 많이 가져오면 Local AI 토큰을 낭비하므로 판단에 필요한 최소한만 가져옵니다.
        const recentHistory = conversationHistory
            .slice(-4) // 최근 4개만
            .map(m => `${m.role === 'user' ? 'User' : 'AI'}: ${m.content.substring(0, 100)}`) // 내용이 길면 100자로 축약
            .join('\n');

        // [System] 역할 및 분류 규칙 (ROUTER_PROMPT 포함)
        const systemPrompt = `${ROUTER_PROMPT}`;

        // [User] 판단 대상 데이터 (히스토리 + 입력)
        const userPrompt = `[Recent Conversation History]
${recentHistory || "(없음)"}

[User Input]
${userText}`;

        const response = await aiService.generateIsolated(systemPrompt, userPrompt);

        const cleanResponse = response.trim().toUpperCase();

        // 키워드 매칭 로직 (기존 동일)
        if (cleanResponse.includes("SUMMARIZE")) return "SUMMARIZE";
        if (cleanResponse.includes("READ_PAGE")) return "READ_PAGE";
        if (cleanResponse.includes("READ_COMMENTS")) return "READ_COMMENTS";
        if (cleanResponse.includes("SEARCH")) return "SEARCH";

        return "GENERAL";
    } catch (e) {
        // 에러 발생 시 안전하게 일반 대화로 처리
        console.warn("[Router] Intent analysis failed:", e);
        return "GENERAL";
    }
}

// 3. 채팅 메시지 전송 처리 (Agentic Router 적용)
async function sendMessage() {
    const text = uiManager.chatInput.value.trim();

    // 입력값과 컨텍스트, 액션 모두 없으면 전송 중단
    if (!text && activeContexts.length === 0 && !pendingActionInstruction) return;

    // [Core Rule 1] 사용자 메시지 UI 표시 & 히스토리 저장 (Clean User Query)
    // 히스토리 상시 활성화 (옵션 제거됨)
    const enableHistory = true;

    // 사용자 메시지 UI 표시 & 히스토리 저장
    if (text) {
        // UI에는 컨텍스트 칩 등 표시를 위해 기존 로직 유지
        uiManager.appendMessage('user', text, aiService.isCloudMode ? 'cloud' : 'local', [...activeContexts]);

        // 히스토리에는 순수 텍스트만 저장
        addToHistory('user', text);
    } else {
        // 텍스트 없이 컨텍스트만 있는 경우
        uiManager.appendMessage('user', '(컨텍스트만 전송)', aiService.isCloudMode ? 'cloud' : 'local', [...activeContexts]);
    }

    // 입력창 초기화
    uiManager.chatInput.value = '';
    uiManager.chatInput.style.height = 'auto';

    // ---------------------------------------------------------
    // 의도 파악 (Router)
    // ---------------------------------------------------------

    // 이미 컨텍스트가 있거나 특정 액션이 지정된 경우 의도 파악 스킵하고 바로 GENERAL/Action 수행
    let intent = "GENERAL";

    if (pendingActionInstruction || activeContexts.length > 0) {
        if (isSearchAction) {
            intent = "SEARCH";
        } else {
            intent = "GENERAL";
        }
    } else {
        // UI에 분석 중 표시 (시스템 메시지가 히스토리에 남지 않도록 주의)
        const analyzingBubble = uiManager.appendMessage('system', "🤔 생각하는 중...");

        intent = await analyzeIntent(text);

        // 분석 완료 후 버블 제거 (또는 내용 업데이트를 위해 유지)
        analyzingBubble.remove();
    }

    logger.info('Router', `Detected Intent: ${intent}`);

    // ---------------------------------------------------------
    // 의도에 따른 분기 처리
    // ---------------------------------------------------------

    let responseBubble = null;
    let revertToLocal = false;

    try {
        // CASE A: [SUMMARIZE] 전체 요약
        if (intent === "SUMMARIZE") {
            await summaryManager.handlePageSummary();
            return; // 종료
        }

        // 공통 변수 준비
        let pageContext = null;
        let finalPrompt = "";

        // CASE B: [READ_PAGE] 페이지 기반 질의응답
        // CASE B: [READ_PAGE] 또는 [READ_COMMENTS]
        if (intent === "READ_PAGE" || intent === "READ_COMMENTS") {
            const isCommentMode = (intent === "READ_COMMENTS");
            const msg = isCommentMode ? "🗣️ 댓글 반응을 수집하여 분석 중..." : "📖 페이지 본문을 읽고 답변 작성 중...";

            responseBubble = uiManager.appendMessage('system', msg);

            // 데이터 수집 (타겟 분리)
            const target = isCommentMode ? 'comments' : 'content';
            // Safety Cap: 6000자
            // getPageText 수정됨: { text, title, url, missingTranscript } 반환
            const { text: fetchedText, title, url, missingTranscript } = await summaryManager.getPageText(target, 6000);

            // [UX 개선] 자막이 없는 경우 사용자에게 알림
            if (missingTranscript) {
                uiManager.appendMessage('system', "⚠️ 자막을 찾을 수 없습니다. 영상 제목과 설명만으로 답변합니다.\n(더 정확한 답변을 원하시면 영상의 '스크립트 표시'를 눌러주세요.)");
            }

            // 데이터 검증
            if (!fetchedText || fetchedText.length < 10) {
                const errMsg = isCommentMode
                    ? "이 페이지에서 댓글을 찾을 수 없습니다."
                    : "페이지 본문을 읽을 수 없습니다. (Readability 실패)";
                uiManager.updateBubble(responseBubble, errMsg + " 일반적인 지식으로 답변합니다.");

                // 데이터 없이 GENERAL 모드로 진행 (finalPrompt 생성 로직으로 넘어감)
                intent = "GENERAL";
            } else {
                // 데이터 주입 (히스토리 저장 X, 프롬프트용 1회성 주입)
                let safeText = fetchedText;
                if (safeText.length >= 6000) safeText += "\n...(시스템: 내용 축약됨)";

                const contextHeader = isCommentMode ? "[User Reactions/Comments]" : "[Page Content]";

                // PromptManager.build에 전달할 임시 activeContexts 생성
                const tempContexts = [...activeContexts, `${contextHeader}\nTitle: ${title}\nURL: ${url}\n\n${safeText}`];

                // 프롬프트 생성
                const contextData = {
                    pageContext: { title, url }, // 메타데이터
                    historyContext: getHistoryContext(aiService.isCloudMode),
                    activeContexts: tempContexts, // 여기에 본문/댓글 포함됨
                    currentTone,
                    pendingActionInstruction
                };
                finalPrompt = promptManager.build(text, contextData, aiService);
            }
        }

        // CASE C: [SEARCH] 검색
        if (intent === "SEARCH") {
            // [NEW] 검색 로직 통일: 자동 감지된 경우에도 명시적 지시사항 주입
            if (!pendingActionInstruction) {
                pendingActionInstruction = "'input'에 대해 검색하고 최신 정보를 기반으로 설명해주세요.";
            }
            isSearchAction = true;

            if (!aiService.isCloudMode) {
                // Local -> Cloud 일시 전환
                uiManager.appendMessage('system', "🌍 검색을 위해 Cloud AI를 호출합니다...");

                aiService.isCloudMode = true;
                revertToLocal = true; // 복구 플래그 설정
                await updateUIState();
            }
            // Cloud Search는 기본 generate 프롬프트(Cloud 모델의 기능)에 의존
            intent = "GENERAL";
        }

        // CASE D: [GENERAL] (또는 Fallback)
        if (intent === "GENERAL") {
            if (!responseBubble) {
                responseBubble = uiManager.appendMessage('system', uiManager.strings.generating);
            }

            // 일반적인 프롬프트 생성
            let historyContext = getHistoryContext(aiService.isCloudMode);

            // 페이지 메타데이터는 있을 수도 있음
            let metaPageContext = null;
            try {
                const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
                if (tab) metaPageContext = { title: tab.title, url: tab.url };
            } catch (e) { }

            const contextData = {
                pageContext: metaPageContext,
                historyContext,
                activeContexts,
                currentTone,
                pendingActionInstruction
            };

            finalPrompt = promptManager.build(text, contextData, aiService);
        }

        // ---------------------------------------------------------
        // AI 실행 및 결과 처리
        // ---------------------------------------------------------

        logger.info('AI', 'Request Sent', {
            prompt: finalPrompt,
            mode: aiService.isCloudMode ? 'Cloud' : 'Local'
        });

        // 컨텍스트 소비 (UI용)
        activeContexts = [];
        renderChips();

        // 액션 초기화
        if (pendingActionInstruction) {
            pendingActionInstruction = null;
            isSearchAction = false;
            document.querySelectorAll('.action-chip').forEach(btn => btn.classList.remove('active'));
        }

        let finalResponse = "";
        await aiService.generate(finalPrompt, (chunk) => {
            uiManager.updateBubble(responseBubble, chunk);
            finalResponse = chunk;
        });

        // AI 응답 히스토리 저장
        if (finalResponse) {
            addToHistory('model', finalResponse);
        }

        logger.info('AI', 'Response Received', {
            response: finalResponse,
            mode: aiService.isCloudMode ? 'Cloud' : 'Local'
        });

    } catch (e) {
        console.error(e);
        if (responseBubble) {
            uiManager.updateBubble(responseBubble, "❌ 오류: " + e.message);
        } else {
            uiManager.appendMessage('system', "❌ 오류: " + e.message);
        }
        logger.error('System', e.message);
    } finally {
        if (revertToLocal) {
            aiService.isCloudMode = false; //Local 모드로 전환
            aiService.destroy(); //기존 세션 파괴
            isLocalSessionSynced = false; //다음 요청 시 히스토리가 포함된 새 세션을 생성하도록 유도
            await updateUIState();
        }
    }
}

/**
 * 히스토리 컨텍스트 문자열 생성 헬퍼
 */
function getHistoryContext(isCloud) {
    if (conversationHistory.length === 0) return "";

    // 히스토리가 비어있거나 할 때 오류 방지
    const historyStr = conversationHistory.map(h => `${h.role}: ${h.content}`).join('\n---\n');

    if (isCloud) {
        return `<ConversationHistory>\n${historyStr}\n</ConversationHistory>\n`;
    } else if (!isLocalSessionSynced) {
        isLocalSessionSynced = true;
        return `<PreviousContext>\n${historyStr}\n</PreviousContext>\n`;
    }
    return "";
}


// 4. UI 툴바 및 버튼 이벤트
document.getElementById('send-btn').addEventListener('click', sendMessage);

// 입력창 자동 높이 조절
uiManager.chatInput.addEventListener('input', function () {
    this.style.height = 'auto';
    this.style.height = (this.scrollHeight) + 'px';
});

uiManager.chatInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
        // 전송 후 높이 초기화
        uiManager.chatInput.style.height = 'auto';
    }
});

// 모델 전환 버튼 (Local <-> Cloud)
document.getElementById('btn-model-toggle').addEventListener('click', () => {
    aiService.isCloudMode = !aiService.isCloudMode;
    // Local Mode로 진입 시 동기화 플래그 초기화
    if (!aiService.isCloudMode) {
        isLocalSessionSynced = false;
    }
    updateUIState();
});

// 톤 변경 버튼
document.getElementById('btn-tone-toggle').addEventListener('click', function () {
    // TONE_INSTRUCTIONS에서 키만 추출
    const tones = Object.keys(TONE_INSTRUCTIONS); // ['기본', '정중하게', '친근하게']
    let nextIdx = (tones.indexOf(currentTone) + 1) % tones.length;
    currentTone = tones[nextIdx];
    this.querySelector('.label').textContent = currentTone;
});

// 5. 퀵 액션 버튼 처리
let isSearchAction = false; // 검색 액션 플래그

document.querySelectorAll('.action-chip').forEach(btn => {
    btn.addEventListener('click', async () => {
        // 토글 로직 (페이지 요약 버튼 제외)
        if (btn.id !== 'btn-page-summary') {
            if (btn.classList.contains('active')) {
                btn.classList.remove('active');
                pendingActionInstruction = null;
                isSearchAction = false;
                return;
            }
            // 다른 칩 비활성화 후 현재 칩 활성화
            document.querySelectorAll('.action-chip').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        }

        const action = btn.dataset.action;

        if (action === 'summarize-page' || btn.id === 'btn-page-summary') {
            // 페이지 요약 실행
            await summaryManager.handlePageSummary();
        } else {
            let instruction = "";
            isSearchAction = false; // 기본값 초기화

            if (action === 'search') {
                instruction = "'input'에 대해 검색하고 최신 정보를 기반으로 답변해주세요.";
                isSearchAction = true;
            }
            if (action === 'translate') instruction = "'input'을 읽고 별도로 요청한 언어 또는 한국어로 자연스럽게 번역해주세요. 또, 필요한 경우 주석을 첨부하여 이해를 도와주세요.";
            if (action === 'campus') instruction = "'input'을 읽고 맞춤법과 문법을 검토하고, 자연스러운 문장으로 재구성해주세요. 그리고 그 이유를 간단히 설명해주세요.";

            pendingActionInstruction = instruction;
            uiManager.chatInput.focus();
        }
    });
});

// '새 채팅' 및 '옵션' 버튼 리스너
document.getElementById('btn-new-chat').addEventListener('click', async () => {
    await sessionManager.archiveAndReset();
    conversationHistory = []; // 내부 히스토리도 초기화

    // AI 세션 초기화
    aiService.destroy();
    isLocalSessionSynced = true; // 빈 상태이므로 동기화 필요 없음
});

document.getElementById('btn-options-page').addEventListener('click', () => {
    if (chrome.runtime.openOptionsPage) {
        chrome.runtime.openOptionsPage();
    } else {
        window.open(chrome.runtime.getURL('src/options/options.html'));
    }
});


// 리소스 정리 (창 닫힐 때)
window.addEventListener('unload', () => {
    sessionManager.handleUnload(); // 상태 저장
    aiService.destroy();
});

// 시작 진입점
init();

