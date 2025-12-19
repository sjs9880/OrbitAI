export class SessionManager {
    constructor(aiService, uiManager, callbacks = {}) {
        this.aiService = aiService;
        this.uiManager = uiManager;
        this.callbacks = callbacks; // { onSessionRestored: (messages) => ... }
        this.currentSession = {
            id: crypto.randomUUID(),
            startTime: Date.now(),
            messages: [],
            status: 'active'
        };
        this.savedSessions = [];
    }

    /**
     * 초기화: 저장된 세션 로드 및 미완료 작업 처리
     */
    async init() {
        await this.loadSessions();
        await this.processPendingSummaries();
        // UI에 히스토리 칩 렌더링 요청
        this.renderHistoryChips();
    }

    /**
     * 저장된 세션 로드
     */
    async loadSessions() {
        const data = await chrome.storage.local.get(['savedSessions', 'currentSession']);
        this.savedSessions = data.savedSessions || [];

        // 이전 세션이 'ended' 상태로 남아있다면(패널 닫힘 등), 저장 목록으로 이동
        if (data.currentSession && data.currentSession.messages && data.currentSession.messages.length > 0) {
            // 이미 저장된 세션인지 확인 (중복 방지)
            const exists = this.savedSessions.find(s => s.id === data.currentSession.id);
            if (!exists) {
                // 요약이 안 된 상태로 저장 목록에 추가
                this.savedSessions.unshift(data.currentSession);
                await this.saveStorage();
            }
        }

        // 새 세션 시작
        this.startNewSession(false); // false: 기존 UI 유지만 함 (실제 메시지는 복구 안함, 빈 화면)
    }

    /**
     * 보류 중인(제목 없는) 세션 요약 처리 (Lazy Summarization)
     */
    async processPendingSummaries() {
        let needsSave = false;

        for (let session of this.savedSessions) {
            if (!session.title && session.messages.length > 0) {
                // 요약 생성 시도
                try {
                    const title = await this.generateSummary(session.messages);
                    session.title = title;
                    needsSave = true;
                } catch (e) {
                    console.warn("요약 생성 실패:", e);
                    session.title = "새로운 대화"; // 실패 시 기본 제목
                    needsSave = true;
                }
            }
        }

        if (needsSave) {
            await this.saveStorage();
            this.renderHistoryChips();
        }
    }

    /**
     * AI를 사용해 대화 내용 요약 (Local AI 사용)
     */
    async generateSummary(messages) {
        // [System] 역할 및 제약 조건 (규칙)
        const systemPrompt = `당신은 대화 내용을 요약하여 제목을 짓는 AI입니다.
다음 규칙을 엄격히 따르세요:
1. 5단어 이내의 짧은 한국어로 요약할 것.
2. 부가적인 설명 없이 결과 텍스트만 출력할 것.
3. 따옴표나 특수문자를 포함하지 말 것.`;

        // [User] 데이터 (대화 내용)
        const conversationText = messages.map(m => `${m.role}: ${m.content}`).join('\n');
        const userPrompt = `[Conversation Data]\n${conversationText}`;

        try {
            // Local AI 독립 세션 생성 및 실행
            const result = await this.aiService.generateIsolated(systemPrompt, userPrompt);
            return result.trim().replace(/^["']|["']$/g, ''); // 따옴표 제거
        } catch (e) {
            console.error("Local AI 요약 중 오류:", e);
            // Local AI 실패 시, 메시지 첫 부분 사용 등의 fallback
            return messages[0].content.substring(0, 10) + "...";
        }
    }

    /**
     * 현재 세션에 메시지 추가 및 실시간 저장
     */
    async addMessage(role, content) {
        this.currentSession.messages.push({
            role,
            content,
            timestamp: Date.now()
        });
        // 실시간 저장
        await chrome.storage.local.set({ currentSession: this.currentSession });
    }

    /**
     * 새 채팅 시작 (현재 세션 아카이빙)
     */
    async archiveAndReset() {
        // 현재 세션이 내용이 있으면 저장 목록에 추가
        if (this.currentSession.messages.length > 0) {
            this.currentSession.status = 'ended';

            // 최신 대화 내용을 반영하기 위해 기존 제목 제거 (재요약 유도)
            this.currentSession.title = null;

            // 이미 존재하는 세션이면 제거 (업데이트를 위해)
            this.savedSessions = this.savedSessions.filter(s => s.id !== this.currentSession.id);

            // 저장 목록 맨 앞에 추가
            this.savedSessions.unshift(this.currentSession);

            // 최대 20개까지만 유지
            if (this.savedSessions.length > 20) {
                this.savedSessions.pop();
            }

            await this.saveStorage();

            // 즉시 UI 업데이트 (칩 추가)
            this.renderHistoryChips();

            // 요약 생성 (비동기로 실행)
            this.processPendingSummaries();
        }

        // 새 세션 시작
        this.startNewSession(true);
    }

    /**
     * 새 세션 상태 초기화
     * @param {boolean} clearUI - UI도 초기화할지 여부
     */
    startNewSession(clearUI = true) {
        this.currentSession = {
            id: crypto.randomUUID(),
            startTime: Date.now(),
            messages: [],
            status: 'active'
        };
        chrome.storage.local.set({ currentSession: this.currentSession });

        if (clearUI) {
            this.uiManager.clearMessages();
            // 환영 메시지 다시 표시
            this.uiManager.showWelcomeMessage();
        }
    }

    /**
     * 특정 세션 복구
     */
    async restoreSession(sessionId) {
        const session = this.savedSessions.find(s => s.id === sessionId);
        if (!session) return;

        // 현재 작업 중인 내용이 있다면 저장 (아카이빙)
        if (this.currentSession.messages.length > 0) {
            // 이미 존재하는 세션이면 제거 후 최신 상태로 저장
            this.savedSessions = this.savedSessions.filter(s => s.id !== this.currentSession.id);

            this.savedSessions = this.savedSessions.filter(s => s.id !== this.currentSession.id);

            // 최신 대화 내용을 반영하기 위해 기존 제목 제거 (재요약 유도)
            this.currentSession.title = null;

            this.currentSession.status = 'ended';
            this.savedSessions.unshift(this.currentSession);
            await this.saveStorage();
            this.processPendingSummaries(); // 비동기 요약
        }

        // 선택한 세션을 현재 세션으로 설정 (복사)
        this.currentSession = JSON.parse(JSON.stringify(session));
        this.currentSession.status = 'active'; // 다시 활성화해서 대화 이어나가기

        await chrome.storage.local.set({ currentSession: this.currentSession });

        // 상태 업데이트: 복구된 세션을 목록 상단으로 이동시킬지 여부는 기획에 따라 결정
        // 여기서는 목록 순서는 유지하고 내용만 불러옴

        // UI 업데이트
        this.uiManager.clearMessages();
        // UI 업데이트
        this.uiManager.clearMessages();
        session.messages.forEach(msg => {
            // 메시지 타입에 따라 cloud/local 클래스 구분은 저장 시 했어야 함.
            // 여기서는 단순화를 위해 모델 역할이면 무조건 표시
            // 'model' 역할을 'system'으로 매핑하여 UI에 전달
            const uiRole = msg.role === 'model' ? 'system' : msg.role;

            // activeContexts는 따로 저장 안했으므로 [] 처리
            this.uiManager.appendMessage(uiRole, msg.content, 'local', []);
        });

        // 콜백 호출 (상태 동기화)
        if (this.callbacks.onSessionRestored) {
            this.callbacks.onSessionRestored(session.messages);
        }
    }

    /**
     * 저장소에 변경사항 반영
     */
    async saveStorage() {
        await chrome.storage.local.set({ savedSessions: this.savedSessions });
    }

    /**
     * UI 매니저를 통해 히스토리 칩 렌더링
     */
    async deleteSession(sessionId) {
        // Remove from saved sessions
        this.savedSessions = this.savedSessions.filter(s => s.id !== sessionId);

        // If the deleted session is the current one, reset the current session
        if (this.currentSession.id === sessionId) {
            this.startNewSession(true);
        }

        await this.saveStorage();
        this.renderHistoryChips();
    }

    /**
     * UI 매니저를 통해 히스토리 칩 렌더링
     */
    renderHistoryChips() {
        // 상위 10개 세션만 전달 (공간 고려)
        const recentSessions = this.savedSessions.slice(0, 10);
        this.uiManager.renderHistoryChips(
            recentSessions,
            (sessionId) => this.restoreSession(sessionId),
            (sessionId) => this.deleteSession(sessionId)
        );
    }

    /**
     * 패널 종료 시 호출 (상태 저장)
     */
    handleUnload() {
        if (this.currentSession.messages.length > 0) {
            // 현재 상태 그대로 저장 (status는 active일 수도 있음)
            // 여기서 status를 'ended'로 바꾸지 않는 이유는, 
            // 사용자가 실수로 닫고 바로 다시 열었을 때 작업을 이어서 하게 하기 위함일 수도 있으나,
            // 요청사항은 "패널 닫아도 저장하고 초기화" 이므로 status='ended'로 마킹하는 것이 안전.
            this.currentSession.status = 'ended';
            chrome.storage.local.set({ currentSession: this.currentSession });
        }
    }
}
