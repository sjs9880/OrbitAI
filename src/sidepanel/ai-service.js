import { findAIModel } from '../utils/ai-utils.js';
import { SYSTEM_PROMPT } from './prompt-manager.js';
import { logger } from '../utils/log-manager.js';

export class AIService {
    constructor() {
        this.chatSession = null;
        this.isCloudMode = false;
        // 기본 시스템 프롬프트(this.systemPrompt) 제거됨 -> prompt-manager.js의 SYSTEM_PROMPT 사용
    }

    /**
     * 로컬 AI (Gemini Nano) 초기화
     * 사용자의 브라우저에서 실행되는 AI 모델을 준비합니다.
     */
    async initLocalAI() {
        try {
            // 1. 모델 리소스 찾기 (여러 API 네임스페이스 안전 탐색)
            const modelInterface = findAIModel();
            if (!modelInterface) {
                throw new Error("Gemini Nano 모델 인터페이스를 찾을 수 없습니다. \nChrome Canary/Dev 최신 버전 및 플래그 설정을 확인해주세요.");
            }

            // 2. 모델 가용성 확인 (availability API)
            // 'readily': 즉시 사용 가능
            // 'after-download': 사용 가능하지만 모델 다운로드 필요 (세션 생성 시 자동 다운로드)
            // 'no': 사용 불가능
            if (!modelInterface.availability) {
                throw new Error("모델이 availability API를 지원하지 않습니다. Chrome을 업데이트해주세요.");
            }

            const availability = await modelInterface.availability();
            logger.info('AI-Service', `Model availability: ${availability}`);

            if (availability === 'no') {
                throw new Error("Gemini Nano 모델을 현재 사용할 수 없습니다 (상태: 'no').");
            }

            // 3. 채팅 세션 생성 (설정값 적용)
            try {
                // 저장된 AI 매개변수(온도, TopK) 가져오기
                const data = await chrome.storage.sync.get(['modelTemperature', 'modelTopK']);
                const params = {
                    initialPrompts: [{ role: 'system', content: SYSTEM_PROMPT }],
                    temperature: data.modelTemperature, // 창의성 조절 (기본값: 저장된 값 또는 스트림 기본)
                    topK: data.modelTopK              // 단어 선택 범위 조절
                };

                this.chatSession = await modelInterface.create(params);
                logger.info('AI-Service', `Local AI Session created (Temp: ${params.temperature}, TopK: ${params.topK})`);

            } catch (createError) {
                console.warn("[AIService] 표준 세션 생성 실패, 구버전 호환성 시도:", createError);
                // 구버전 Chrome AI API 호환을 위한 폴백 (Fallback)
                try {
                    this.chatSession = await modelInterface.create({
                        systemPrompt: SYSTEM_PROMPT
                    });
                    logger.info('AI-Service', "Local AI Session created (Legacy)");
                } catch (fallbackError) {
                    throw new Error(`세션 생성 실패: ${createError.message}`);
                }
            }
            return { success: true };

        } catch (e) {
            logger.error('AI-Service', "Initialization Error", e);
            return { success: false, error: e.message };
        }
    }

    /**
     * 현재 활성 세션 종료 및 메모리 해제
     */
    destroy() {
        if (this.chatSession) {
            this.chatSession.destroy();
            this.chatSession = null;
        }
    }

    /**
     * AI 응답 생성
     * @param {string} prompt 사용자 입력 프롬프트
     * @param {function} onStream 스트리밍 응답 콜백 함수
     * @param {boolean} isCloud 클라우드 모드 강제 여부
     * @param {boolean} useSearch (클라우드 전용) 구글 검색 Grounding 사용 여부
     */
    async generate(prompt, onStream, isCloud = false, useSearch = false) {
        // 클라우드 모드 설정 확인 (인자값 또는 내부 상태)
        const useCloud = isCloud || this.isCloudMode;
        const startTime = Date.now();

        try {
            let result;
            if (useCloud) {
                result = await this._callCloudAI(prompt, onStream, useSearch);
            } else {
                result = await this._callLocalAI(prompt, onStream);
            }
            const duration = Date.now() - startTime;
            logger.info('AI-Service', `Generation completed (${duration}ms)`, { mode: useCloud ? 'Cloud' : 'Local' });
            return result;
        } catch (e) {
            // 로컬 AI 오류 발생 시 자동 복구 로직
            if (!useCloud) {
                logger.warn('AI-Service', `Local AI Error: ${e.message}. Attempting recovery...`);

                // 기존 세션 정리
                this.destroy();

                // 초기화 재시도
                const loadResult = await this.initLocalAI();
                if (loadResult.success && this.chatSession) {
                    logger.info('AI-Service', "Recovery successful, retrying request...");
                    const retryStart = Date.now();
                    const result = await this._callLocalAI(prompt, onStream);
                    logger.info('AI-Service', `Retry completed (${Date.now() - retryStart}ms)`);
                    return result;
                }
            }
            logger.error('AI-Service', "Generation Failed", e);
            throw e;
        }
    }

    /**
     * 로컬 AI 모델 호출 (Streaming)
     */
    async _callLocalAI(prompt, onStream) {
        if (!this.chatSession) throw new Error("로컬 AI 세션이 초기화되지 않았습니다.");

        // 스트리밍 방식으로 응답 수신
        const stream = this.chatSession.promptStreaming(prompt);
        let fullResponse = "";

        for await (const chunk of stream) {
            const currentFull = fullResponse;
            // Chrome AI API 동작 방식 대응: 
            // 새로운 청크가 전체 텍스트를 포함하는 경우(누적)와 델타(추가분)인 경우를 구분하여 처리
            // (대부분의 Gemini Nano 구현은 전체 텍스트를 누적해서 보냄)
            if (chunk.startsWith(currentFull) && currentFull.length > 0) {
                fullResponse = chunk;
            } else {
                fullResponse += chunk;
            }

            if (onStream) onStream(fullResponse);
        }
        return fullResponse;
    }

    /**
     * 클라우드 AI 모델 호출 (Google Gemini API)
     */
    async _callCloudAI(prompt, onStream, useSearch = false) {
        // API 키 및 모델 ID 가져오기
        const data = await chrome.storage.sync.get(['geminiApiKey', 'geminiModelId']);
        const apiKey = data.geminiApiKey;
        // 기본값: gemini-2.5-flash (사용자 피드백 반영)
        const modelId = data.geminiModelId || 'gemini-2.5-flash';

        if (!apiKey) throw new Error("API Key가 설정되지 않았습니다. 설정 페이지에서 키를 입력해주세요.");

        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;

        // 요청 본문 (Request Body) 구성
        const requestBody = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        // 실시간 정보 검색 기능 (Dynamic Retrieval)
        // 항상 도구를 제공하여 모델이 검색 필요 여부를 판단하도록 함
        requestBody.tools = [{ google_search: {} }];

        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error?.message || response.statusText);
        }

        const result = await response.json();
        let text = result.candidates[0].content.parts[0].text;

        // Grounding Metadata 처리 (검색 결과 인용)
        const groundingMetadata = result.candidates[0].groundingMetadata;
        if (groundingMetadata && groundingMetadata.groundingChunks) {
            const sources = groundingMetadata.groundingChunks
                .filter(chunk => chunk.web)
                .map(chunk => `- [${chunk.web.title}](${chunk.web.uri})`)
                .join('\n');

            if (sources) {
                text += `\n\n**🔍 참조 출처:**\n${sources}`;
            }
        }

        // 클라우드 API는 현재 비-스트리밍(단일 응답) 방식 사용 중이지만,
        // 인터페이스 통일을 위해 스트림 콜백 한번 호출
        if (onStream) onStream(text);
        return text;
    }

    /**
     * 로컬 AI 독립 세션 생성 및 실행
     * 청크 단위 요약 등 메인 컨텍스트와 분리된 작업 수행 시 사용
     * 실행 후 즉시 세션을 파괴하여 메모리를 확보함
     */
    async generateIsolated(systemPrompt, userPrompt) {
        let session = null;
        try {
            const modelInterface = findAIModel();
            if (!modelInterface) throw new Error("Local AI 모델을 찾을 수 없습니다.");

            // [변경] 최신 표준: initialPrompts를 사용하여 시스템 역할 부여
            const params = {
                initialPrompts: [{ role: 'system', content: systemPrompt }]
            };

            try {
                // 표준 방식 시도
                session = await modelInterface.create(params);
            } catch (e) {
                console.warn("표준 세션 생성 실패, 구버전 속성(systemPrompt) 시도");
                // 구버전 브라우저 호환성 Fallback
                session = await modelInterface.create({ systemPrompt: systemPrompt });
            }

            // 프롬프트 실행 (비-스트리밍)
            const result = await session.prompt(userPrompt);
            return result;
        } catch (e) {
            console.warn("독립 세션 실행 중 오류:", e);
            throw e;
        } finally {
            // 사용 완료된 세션은 반드시 파괴하여 메모리 누수 방지
            if (session) {
                session.destroy();
            }
        }
    }
}
