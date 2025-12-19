import { smartSplitText } from '../utils/text-utils.js';

export class SummaryManager {
    constructor(aiService, uiManager, callbacks) {
        this.aiService = aiService;
        this.uiManager = uiManager;
        this.callbacks = callbacks; // { saveDebugLog, addToHistory }
    }

    /**
     * 페이지 요약 핸들러 (Hybrid Strategy)
     */
    /**
     * 페이지 텍스트 추출 (타겟별 분리 추출)
     * @param {string} target 'content' (본문) | 'comments' (댓글)
     * @param {number} maxChars 최대 추출 글자 수 (기본값: Local 40k, Cloud 100k)
     * @returns {Promise<{text: string, title: string, url: string}>}
     */
    /**
     * 페이지 텍스트 추출 (Readability 라이브러리 활용)
     * @param {string} target 'content' (본문) | 'comments' (댓글)
     * @param {number} maxChars 최대 추출 글자 수
     */
    /**
     * 페이지 텍스트 추출 (Readability + YouTube Special Support)
     * @param {string} target 'content' (본문) | 'comments' (댓글)
     * @param {number} maxChars 최대 추출 글자 수
     */
    async getPageText(target = 'content', maxChars = null) {
        if (!maxChars) {
            maxChars = this.aiService.isCloudMode ? 100000 : 40000;
        }

        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (!tab) throw new Error("활성 탭을 찾을 수 없습니다.");

        // YouTube 감지
        const isYouTube = (tab.url || "").includes('youtube.com/watch');

        // Readability.js 주입 (유튜브가 아니고, 본문 추출일 때만)
        if (target === 'content' && !isYouTube) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id },
                    files: ['assets/lib/Readability.js']
                });
            } catch (e) {
                // 이미 로드되었거나, 권한이 없거나, 제한된 페이지인 경우
                // 여기서 에러가 나더라도 아래 본문 추출 시도에서 처리되거나 Catch될 것이므로 경고만 로그
                console.warn("Readability 로드 실패 (제한된 페이지 가능성):", e);
            }
        }

        try {
            const result = await chrome.scripting.executeScript({
                target: { tabId: tab.id },
                func: (targetMode, limit, isYT) => {
                    let content = "";
                    let missingTranscript = false;
                    const doc = document;

                    try {
                        // ---------------------------------------------------------
                        // CASE 1: YouTube Special Logic
                        // ---------------------------------------------------------
                        if (isYT && targetMode === 'content') {
                            // 1. 제목
                            const titleEl = doc.querySelector('h1.ytd-video-primary-info-renderer') || doc.querySelector('#title h1');
                            const title = titleEl ? titleEl.innerText : "";

                            // 2. 설명창 (더보기 버튼이 눌려있지 않아도 텍스트가 존재하면 가져옴)
                            const descEl = doc.querySelector('#description-inline-expander') || doc.querySelector('#description');
                            const description = descEl ? descEl.innerText : "";

                            // 3. 스크립트 (Transcript) - 사용자가 패널을 열어둔 경우
                            // ytd-transcript-segment-renderer: 자막 한 줄 한 줄의 컨테이너
                            const scripts = doc.querySelectorAll('ytd-transcript-segment-renderer');
                            let scriptText = "";

                            if (scripts.length > 0) {
                                scriptText = "\n[Video Transcript]\n";
                                scripts.forEach(el => {
                                    // 시간 정보 제외하고 텍스트만 추출 (segment-text class)
                                    const textEl = el.querySelector('.segment-text');
                                    if (textEl) scriptText += textEl.innerText + " ";
                                });
                            } else {
                                // 자막이 없는 경우 플래그 설정
                                missingTranscript = true;
                            }

                            // 통합
                            content = `[Video Title]: ${title}\n\n[Description]:\n${description}\n${scriptText}`;
                        }

                        // ---------------------------------------------------------
                        // CASE 2: General Comments (YouTube & Others)
                        // ---------------------------------------------------------
                        else if (targetMode === 'comments') {
                            // 유튜브 댓글 태그 추가 (ytd-comment-thread-renderer)
                            const commentSelectors = [
                                '.u_cbox_content_wrap', // 네이버
                                '.comment-list',        // 티스토리
                                '#comments',
                                'ytd-comment-thread-renderer #content-text', // 유튜브 댓글 내용
                                '.reply_view',
                                '.comment_area',
                                '.alex-comment-area'
                            ];

                            let commentsText = "";
                            for (const sel of commentSelectors) {
                                const elements = doc.querySelectorAll(sel);
                                elements.forEach(el => {
                                    commentsText += el.innerText + "\n";
                                });
                            }
                            content = commentsText;
                        }

                        // ---------------------------------------------------------
                        // CASE 3: General Content (Readability)
                        // ---------------------------------------------------------
                        else if (targetMode === 'content') {
                            if (window.Readability) {
                                const article = new window.Readability(doc.cloneNode(true)).parse();
                                content = article ? article.textContent : doc.body.innerText;
                            } else {
                                content = doc.body.innerText;
                            }
                        }

                    } catch (e) {
                        console.error("Extraction error:", e);
                        content = "";
                    }

                    return {
                        content: content.replace(/\s+/g, ' ').trim().substring(0, limit),
                        missingTranscript: missingTranscript
                    };
                },
                args: [target, maxChars, isYouTube] // isYouTube 플래그 전달
            });

            const { content: pageText, missingTranscript } = result[0].result;

            return {
                text: pageText || "",
                title: tab.title,
                url: tab.url,
                missingTranscript: missingTranscript || false
            };

        } catch (e) {
            console.warn("Script execution failed (Restricted URL or permission error):", e);
            // 스크립트 실행 실패 시 (제한된 URL 등) 빈 내용 반환하여 크래시 방지
            return {
                text: "",
                title: tab.title || "Restricted Page",
                url: tab.url || "restricted://"
            };
        }
    }

    /**
     * 페이지 요약 핸들러 (Hybrid Strategy)
     */
    async handlePageSummary() {
        this.uiManager.setStatus("페이지 내용 가져오는 중...", "#2563eb");

        try {
            // 1. 텍스트 추출 (getPageText 재사용, 본문 모드)
            // { text, title, url, missingTranscript } 반환
            const { text, title, url, missingTranscript } = await this.getPageText('content');
            const tabInfo = { title, url };

            // 2. 모드별 분기 처리
            if (this.aiService.isCloudMode) {
                await this.processCloudSummary(text, tabInfo, missingTranscript);
            } else {
                await this.processLocalChunkedSummary(text, tabInfo, missingTranscript);
            }

        } catch (e) {
            console.error(e);
            console.error(e);
            this.callbacks.saveDebugLog('ERROR', `Page Summary Failed: ${e.message}`); // 에러 로그 추가
            this.uiManager.appendMessage('system', "❌ 페이지 요약 실패: " + e.message);
            this.uiManager.setStatus("오류 발생", "#ef4444");
        }
    }

    /**
     * [Cloud Mode] Bulk Processing
     * 분할 없이 전체 전송 (Gemini Flash 모델 활용)
     */
    async processCloudSummary(text, tabInfo, missingTranscript = false) {
        const prompt = `<Action Instruction>\n다음 웹 페이지의 내용을 핵심 사항을 중심으로 요약해 알기 쉽게 재구성 하여 작성해주세요.\n\n[Page Info]\nTitle: ${tabInfo.title}\nURL: ${tabInfo.url}\n\n[Page Content]\n${text}</Action Instruction>`;

        const sessionName = `[Page Summary] ${tabInfo.title}`;
        this.callbacks.saveDebugLog('REQUEST', prompt, sessionName);
        this.uiManager.appendMessage('user', "📄 현재 페이지 요약해줘 (Cloud)", 'cloud');

        if (missingTranscript) {
            this.uiManager.appendMessage('system', "⚠️ 자막을 찾을 수 없습니다. 영상 제목과 설명만으로 요약합니다.\n(더 정확한 요약을 원하시면 영상의 '스크립트 표시'를 눌러주세요.)");
        }

        // Cloud는 처리 시간이 걸릴 수 있으므로 스피너와 함께 메시지 표시
        const responseBubble = this.uiManager.appendMessage('system', "☁️ 클라우드 AI가 전체 내용을 분석 중입니다...");

        let finalResponse = "";
        try {
            await this.aiService.generate(prompt, (chunk) => {
                this.uiManager.updateBubble(responseBubble, chunk);
                finalResponse = chunk;
            });

            this.callbacks.saveDebugLog('RESPONSE', finalResponse, `[Page Summary] ${tabInfo.title}`);
            this.uiManager.setStatus("요약 완료", "#10b981");

            // 히스토리 저장 (상시 활성화)
            this.callbacks.addToHistory('user', `📄 현재 페이지 요약해줘 (Cloud)\n[Page Info] Title: ${tabInfo.title}`);
            this.callbacks.addToHistory('model', finalResponse);
        } catch (e) {
            console.error(e);
            this.callbacks.saveDebugLog('ERROR', `Cloud Summary Failed: ${e.message}`); // 에러 로그 추가
            this.uiManager.updateBubble(responseBubble, "요약 중 오류가 발생했습니다.");
            this.uiManager.setStatus("오류 발생", "#ef4444");
        }
    }

    /**
     * [Local Mode] Smart Chunking + Map-Reduce
     * 텍스트를 문맥 단위로 쪼개어 순차 요약 후 통합
     */
    async processLocalChunkedSummary(text, tabInfo, missingTranscript = false) {
        this.uiManager.appendMessage('user', "📄 현재 페이지 요약해줘 (Local)", 'local');

        if (missingTranscript) {
            this.uiManager.appendMessage('system', "⚠️ 자막을 찾을 수 없습니다. 영상 제목과 설명만으로 요약합니다.\n(더 정확한 요약을 원하시면 영상의 '스크립트 표시'를 눌러주세요.)");
        }
        const statusBubble = this.uiManager.appendMessage('system', "분석 시작...");

        // 1. 텍스트 길이 확인 및 분기 처리
        // 10,000자 미만이면 굳이 나누지 않고 한 번에 처리 (Gemini Nano 컨텍스트 내)
        if (text.length < 10000) {
            this.uiManager.updateBubble(statusBubble, "텍스트가 짧아 한 번에 분석합니다...");

            // [System] 요약 규칙
            const systemPrompt = `당신은 텍스트 요약 전문가입니다.
다음 지침에 따라 요약하세요:
1. 웹 페이지의 핵심 내용을 중심으로 알기 쉽게 재구성할 것.
2. 짧고 간결하게 작성할 것.`;

            // [User] 페이지 데이터
            const userPrompt = `[Page Info]
Title: ${tabInfo.title}
URL: ${tabInfo.url}

[Page Content]
${text}`;

            const sessionName = `[Page Summary] ${tabInfo.title}`;
            this.callbacks.saveDebugLog('REQUEST', userPrompt, sessionName);

            try {
                const summary = await this.aiService.generateIsolated(systemPrompt, userPrompt);
                this.uiManager.updateBubble(statusBubble, summary);
                this.callbacks.saveDebugLog('RESPONSE', summary, sessionName);
                this.uiManager.setStatus("요약 완료", "#10b981");

                // 히스토리 저장 (상시 활성화)
                this.callbacks.addToHistory('user', `📄 현재 페이지 요약해줘 (Local)\n[Page Info] Title: ${tabInfo.title}`);
                this.callbacks.addToHistory('model', summary);

            } catch (e) {
                console.error(e);
                this.callbacks.saveDebugLog('ERROR', `Local Short Summary Failed: ${e.message}`, sessionName); // 에러 로그 추가
                this.uiManager.updateBubble(statusBubble, "요약 실패: " + e.message);
                this.uiManager.setStatus("오류 발생", "#ef4444");
            }
            return;
        }

        // 2. Smart Chunking (4000자 제한, 200자 오버랩)
        // 4000자는 Local AI의 Context Window를 고려한 안전한 크기
        const chunks = smartSplitText(text, 4000, 200);
        const partialSummaries = [];

        // 2. Map Phase (순차 요약)
        for (let i = 0; i < chunks.length; i++) {
            const progressMsg = `🔄 로컬 AI 분석 중... (${i + 1}/${chunks.length} 파트)`;
            this.uiManager.updateBubble(statusBubble, progressMsg);

            // [System] 청크 요약 규칙
            const systemPrompt = `당신은 긴 글의 일부분을 요약하는 전문가입니다.
다음 규칙을 따르세요:
1. 제목과 문맥을 참고할 것.
2. 핵심 내용을 3문장 이내로 간결하게 요약할 것.`;

            // [User] 부분 텍스트
            const chunkPrompt = `[Page Title]: ${tabInfo.title}
[Part ${i + 1}/${chunks.length}]
${chunks[i]}`;

            try {
                // [중요] 독립 세션 사용 (Session Isolation)
                const sessionName = `[Page Summary] ${tabInfo.title}`;
                // 청크 요청 저장
                this.callbacks.saveDebugLog('REQUEST', `[Chunk ${i + 1}/${chunks.length}]\n${chunkPrompt}`, sessionName);

                const result = await this.aiService.generateIsolated(systemPrompt, chunkPrompt);

                // 청크 응답 저장
                this.callbacks.saveDebugLog('RESPONSE', `[Chunk ${i + 1}/${chunks.length}]\n${result}`, sessionName);

                partialSummaries.push(result);
            } catch (e) {
                console.warn(`Chunk ${i} 요약 실패:`, e);
                this.callbacks.saveDebugLog('ERROR', `Chunk ${i} Failed: ${e.message}`, sessionName); // 에러 로그 추가
                partialSummaries.push("(이 부분은 요약하지 못했습니다)");
            }
        }

        // 3. Reduce Phase (최종 결합)
        if (partialSummaries.length > 0) {
            this.uiManager.updateBubble(statusBubble, "✨ 최종 결과 정리 중...");

            const combinedText = partialSummaries.join("\n\n");

            // [System] 최종 통합 규칙
            const systemPrompt = `당신은 수집된 요약본을 통합하는 전문 에디터입니다.
다음 규칙을 따르세요:
1. 여러 부분으로 나뉜 요약 내용을 하나의 자연스러운 글로 통합할 것.
2. 핵심 내용을 글머리 기호(Bullet points) 리스트로 정리할 것.`;

            // [User] 통합할 데이터
            const finalPrompt = `[Page Title]: ${tabInfo.title}
[Summary Parts]
${combinedText}`;

            const sessionName = `[Page Summary] ${tabInfo.title}`;
            // 최종 통합 요청 저장
            this.callbacks.saveDebugLog('REQUEST', `[Final Synthesis]\n${finalPrompt}`, sessionName);

            try {
                const finalSummary = await this.aiService.generateIsolated(systemPrompt, finalPrompt);
                this.uiManager.updateBubble(statusBubble, finalSummary);
                this.callbacks.saveDebugLog('RESPONSE', finalSummary, sessionName);

                // 히스토리 저장 (상시 활성화)
                this.callbacks.addToHistory('user', `📄 현재 페이지 요약해줘 (Local)\n[Page Info] Title: ${tabInfo.title}`);
                this.callbacks.addToHistory('model', finalSummary);

            } catch (e) {
                // 실패 시 합본이라도 보여줌
                this.uiManager.updateBubble(statusBubble, "최종 요약 생성 실패. 부분 요약본을 표시합니다:\n\n" + combinedText);
            }
        } else {
            this.uiManager.updateBubble(statusBubble, "요약 가능한 내용을 추출하지 못했습니다.");
        }

        this.uiManager.setStatus("요약 완료", "#10b981");
    }
}
