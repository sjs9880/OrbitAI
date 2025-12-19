import { findAIModel, findAIModelWithSource } from '../utils/ai-utils.js';

document.addEventListener('DOMContentLoaded', () => {
    // --- DOM 요소 참조 ---
    const testBtn = document.getElementById('test-btn'); // 매핑: retry-btn
    const restartBtn = document.getElementById('restart-btn');
    const stopBtn = document.getElementById('stop-btn'); // 매핑: destroy-btn
    const statusText = document.getElementById('status-text');
    const logConsole = document.getElementById('log-console');

    const apiKeyInput = document.getElementById('api-key-input');
    const saveKeyBtn = document.getElementById('save-key-btn');
    const clearKeyBtn = document.getElementById('clear-key-btn');
    const keyStatusMsg = document.getElementById('key-status-msg');
    const modelSelect = document.getElementById('model-select');

    const debugToggle = document.getElementById('debug-toggle');
    const debugLogViewer = document.getElementById('debug-log-viewer');
    const clearLogBtn = document.getElementById('clear-log-btn');
    const logSearchInput = document.getElementById('log-search-input');
    const logCategoryFilter = document.getElementById('log-category-filter');

    // 전역 변수로 활성 세션 관리
    let activeSession = null;
    let currentLevelFilter = 'ALL'; // INFO, WARN, ERROR
    let currentCategoryFilter = 'ALL'; // System, AI, etc.
    let currentSearchTerm = '';

    let allLogsCache = []; // 전체 로그 캐시 (필터링용)
    let savedSessionsCache = []; // 세션 제목 매핑용 캐시

    // 가이드 카드 요소
    const guideCard = document.getElementById('nano-guide-card');
    const guideHeader = document.getElementById('guide-card-header');
    const guideContent = document.getElementById('guide-content');
    const guideArrow = document.getElementById('guide-arrow');
    const guideTitle = document.getElementById('guide-title');
    const guideIcon = document.getElementById('guide-icon');

    const guideOpenFlagsBtn = document.getElementById('guide-open-flags');

    // --- 헬퍼 함수 (Helper Functions) ---

    // 가이드 카드 토글 로직
    if (guideHeader) {
        guideHeader.addEventListener('click', () => {
            const isHidden = guideContent.style.display === 'none';
            guideContent.style.display = isHidden ? 'block' : 'none';
            guideArrow.textContent = isHidden ? '▲' : '▼';
        });
    }

    // 테스트 로그 출력 함수
    function log(msg) {
        // 현재 세션의 테스트 로그 (콘솔 영역)
        if (logConsole) {
            const p = document.createElement('div');
            p.textContent = `> ${msg}`;
            logConsole.appendChild(p);
            logConsole.scrollTop = logConsole.scrollHeight;
        }
    }

    // 설정 상태 메시지 표시
    function showMsg(text, color) {
        if (!keyStatusMsg) return;
        keyStatusMsg.textContent = text;
        keyStatusMsg.style.color = color;
        setTimeout(() => {
            keyStatusMsg.textContent = "";
        }, 3000);
    }

    // 세션 강제 종료 함수
    async function stopSession() {
        if (activeSession) {
            try {
                log("🔄 기존 세션 종료(destroy) 시도...");
                activeSession.destroy();
                log("✅ 기존 세션이 정상적으로 종료되었습니다.");
            } catch (e) {
                log(`⚠️ 세션 종료 중 오류(무시됨): ${e.message}`);
            }
            activeSession = null;
        } else {
            log("ℹ️ 종료할 활성 세션이 없습니다.");
        }

        // 상태 UI 초기화
        if (statusText) {
            statusText.textContent = "연결 끊김";
            statusText.style.color = "gray";
        }
        if (stopBtn) stopBtn.disabled = true;
        if (testBtn) testBtn.disabled = false;
    }

    // 메인 테스트 로직 (연결 테스트)
    async function startSession() {
        if (testBtn) testBtn.disabled = true;
        if (stopBtn) stopBtn.disabled = true;

        // 시작 전 기존 세션 정리 (안전장치)
        await stopSession();

        if (statusText) {
            statusText.textContent = "AI 모델 탐색 중...";
            statusText.style.color = "orange";
        }
        if (logConsole) logConsole.innerHTML = ""; // 로그 초기화

        try {
            // 1. 모델 인터페이스 탐색
            let found = null;
            for (let i = 1; i <= 10; i++) {
                found = findAIModelWithSource();
                if (found) break;
                log(`API 찾는 중... (${i}/10)`);
                await new Promise(r => setTimeout(r, 500));
            }

            if (!found) throw new Error("AI 인터페이스를 찾을 수 없습니다.");

            const { api: modelInterface, source: sourceName } = found;
            log(`✅ 감지 성공![${sourceName}]`);

            // 2. 가용성 체크 (availability 우선)
            log("가용성(availability) 확인 중...");
            let status = "unknown";

            if (modelInterface.availability) {
                status = await modelInterface.availability();
            } else if (modelInterface.capabilities) {
                status = (await modelInterface.capabilities()).available; // 구형 API 폴백
                log("⚠️ availability() 미지원, capabilities() 사용됨");
            } else {
                throw new Error("모델 상태를 확인할 수 있는 API가 없습니다.");
            }

            log(`상태 결과: ${status}`);

            // 'readily', 'after-download' 허용
            const validStates = ['readily', 'after-download', 'available', 'no-restrictions'];
            if (!validStates.includes(status)) throw new Error(`모델 사용 불가 상태입니다: ${status}`);

            // 3. 세션 생성
            log("세션 생성 시도 (initialPrompts 사용)...");

            try {
                activeSession = await modelInterface.create({
                    initialPrompts: [{ role: "system", content: "You are a helpful assistant." }]
                });
                log("생성 성공!");
            } catch (e) {
                log(`⚠️ 생성 실패, 에러: ${e.message}`);
                throw e;
            }

            if (!activeSession) throw new Error("세션 객체가 생성되지 않았습니다.");

            // 성공 처리
            if (statusText) {
                statusText.textContent = `🟢 연결됨(${sourceName})`;
                statusText.style.color = "green";
            }
            if (stopBtn) stopBtn.disabled = false; // 종료 버튼 활성화
            log("세션 생성 완료. (ID: Active)");

            // 4. 응답 테스트 (스트림 방식)
            log("--- 응답 테스트 (Stream) ---");
            const stream = activeSession.promptStreaming("안녕? 짧게 대답해줘.");
            let fullText = "";
            for await (const chunk of stream) {
                fullText = chunk;
            }
            log(`응답: "${fullText}"`);

        } catch (e) {
            if (statusText) {
                statusText.textContent = "❌ 실패";
                statusText.style.color = "red";
            }
            log(`[ERROR] ${e.message}`);
            console.error(e);
            if (stopBtn) stopBtn.disabled = true;
        } finally {
            if (testBtn) testBtn.disabled = false;
        }
    }

    async function restartSession() {
        log("🔄 재시작 중...");
        await startSession();
    }

    // 가이드 카드 상태 체크 (Gemini Nano 가용성 확인)
    async function checkNanoAvailability() {
        if (!guideCard) return;
        guideCard.style.display = 'block';

        let found = null;
        for (let i = 0; i < 5; i++) {
            found = findAIModelWithSource();
            if (found) break;
            await new Promise(r => setTimeout(r, 500));
        }

        try {
            if (!found) throw new Error("Not found");
            const api = found.api;
            let status = 'unknown';

            if (api.availability) status = await api.availability();
            else if (api.capabilities) status = (await api.capabilities()).available;

            const validStates = ['readily', 'after-download', 'available', 'no-restrictions'];
            setGuideState(validStates.includes(status));
        } catch (e) {
            setGuideState(false);
        }
    }

    // 가이드 카드 UI 상태 변경
    function setGuideState(isAvailable) {
        if (isAvailable) {
            guideCard.style.background = '#f0fdf4';
            guideCard.style.borderColor = '#bbf7d0';
            guideTitle.style.color = '#15803d';
            guideTitle.textContent = "Local AI 사용 가능 (설정 가이드 보기)";
            guideIcon.textContent = "✅";
            guideArrow.style.color = '#15803d';
            guideContent.style.display = 'none';
            guideArrow.textContent = '▼';
        } else {
            guideCard.style.background = '#fff1f2';
            guideCard.style.borderColor = '#fecdd3';
            guideTitle.style.color = '#be123c';
            guideTitle.textContent = "Local AI (Gemini Nano) 설정 가이드";
            guideIcon.textContent = "🚨";
            guideArrow.style.color = '#be123c';
            guideContent.style.display = 'block';
            guideArrow.textContent = '▲';
        }
    }

    // 로드 시 가이드 상태 확인
    checkNanoAvailability();

    // 이벤트 리스너 등록
    if (testBtn) testBtn.addEventListener('click', startSession);
    if (restartBtn) restartBtn.addEventListener('click', restartSession);
    if (stopBtn) stopBtn.addEventListener('click', stopSession);

    if (guideOpenFlagsBtn) {
        guideOpenFlagsBtn.addEventListener('click', () => {
            chrome.tabs.create({ url: "chrome://flags/#optimization-guide-on-device-model" });
        });
    }

    // --- API 키 & 설정 로직 ---
    chrome.storage.sync.get(['geminiApiKey', 'geminiModelId', 'enableDebugLog', 'enableHistory'], (data) => {
        if (data.geminiApiKey && apiKeyInput) {
            apiKeyInput.value = data.geminiApiKey;
            if (keyStatusMsg) {
                keyStatusMsg.textContent = "✅ 저장된 API 키가 있습니다.";
                keyStatusMsg.style.color = "green";
            }
        }
        if (modelSelect) {
            // 값이 없으면 'gemini-2.5-flash' 기본값
            modelSelect.value = data.geminiModelId || 'gemini-2.5-flash';
        }
        if (debugToggle) {
            debugToggle.checked = !!data.enableDebugLog;
        }
    });

    if (saveKeyBtn) {
        saveKeyBtn.addEventListener('click', () => {
            const key = apiKeyInput.value.trim();
            if (!key) {
                showMsg("키를 입력해주세요.", "red");
                return;
            }
            chrome.storage.sync.set({ geminiApiKey: key }, () => {
                showMsg("API 키가 안전하게 저장되었습니다.", "green");
            });
        });
    }

    if (clearKeyBtn) {
        clearKeyBtn.addEventListener('click', () => {
            chrome.storage.sync.remove('geminiApiKey', () => {
                apiKeyInput.value = "";
                showMsg("API 키가 삭제되었습니다.", "gray");
            });
        });
    }

    if (modelSelect) {
        modelSelect.addEventListener('change', () => {
            const modelId = modelSelect.value;
            chrome.storage.sync.set({ geminiModelId: modelId });
        });
    }

    if (debugToggle) {
        debugToggle.addEventListener('change', () => {
            chrome.storage.sync.set({ enableDebugLog: debugToggle.checked });
        });
    }

    // --- 로그 뷰어 로직 (New) ---

    // 1. 검색어 입력 이벤트
    if (logSearchInput) {
        logSearchInput.addEventListener('input', (e) => {
            currentSearchTerm = e.target.value.toLowerCase();
            renderLogs(allLogsCache);
        });
    }

    // 2. 카테고리 필터 이벤트
    if (logCategoryFilter) {
        logCategoryFilter.addEventListener('change', (e) => {
            currentCategoryFilter = e.target.value;
            renderLogs(allLogsCache);
        });
    }

    // 3. 레벨 필터 버튼 이벤트
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentLevelFilter = btn.dataset.filter; // ALL, INFO, WARN, ERROR
            renderLogs(allLogsCache);
        });
    });

    function renderLogs(logs) {
        if (!debugLogViewer) return;
        allLogsCache = logs || [];

        debugLogViewer.innerHTML = '';
        console.log("Rendering logs:", allLogsCache.length); // 디버깅용

        try {
            // 필터링 적용
            const filteredLogs = allLogsCache.filter(log => {
                // Level Check (field name: level or type for backward compat)
                const logLevel = (log.level || log.type || 'INFO').toUpperCase();

                // 기존 로그 호환성: REQUEST/RESPONSE/USER/SYSTEM -> INFO 처리
                let normalizedLevel = logLevel;
                if (['REQUEST', 'RESPONSE', 'USER', 'SYSTEM'].includes(logLevel)) normalizedLevel = 'INFO';

                if (currentLevelFilter !== 'ALL' && normalizedLevel !== currentLevelFilter) {
                    return false;
                }

                // Category Check
                // 구형 로그는 category가 없을 수 있음 -> 'System' 또는 'Unknown' 취급
                const logCategory = log.category || 'System';
                if (currentCategoryFilter !== 'ALL' && logCategory !== currentCategoryFilter) {
                    return false;
                }

                // Search Check
                if (currentSearchTerm) {
                    const msg = (log.message || log.content || "").toString().toLowerCase();
                    const dataStr = log.data ? JSON.stringify(log.data).toLowerCase() : "";
                    if (!msg.includes(currentSearchTerm) && !dataStr.includes(currentSearchTerm)) {
                        return false;
                    }
                }

                return true;
            });


            if (filteredLogs.length === 0) {
                debugLogViewer.innerHTML = '<div class="log-placeholder">조건에 맞는 로그가 없습니다.</div>';
                return;
            }

            // 렌더링 최적화: DocumentFragment 사용
            const fragment = document.createDocumentFragment();

            filteredLogs.forEach(log => {
                const details = document.createElement('details');
                details.className = 'log-entry-details';

                // 메인 텍스트 및 중요도 판별을 위한 사전 분석
                let mainText = log.message || log.content || "";
                if (typeof mainText === 'object') mainText = JSON.stringify(mainText);

                const category = log.category || 'System';
                let isImportantAI = false;

                // 1) AI Service Logs
                if (category === 'AI' && (mainText.includes('Request Sent') || mainText.includes('Response Received'))) {
                    isImportantAI = true;
                }
                // 2) SummaryManager Logs
                else if (category === 'SummaryManager') {
                    if (log.data) {
                        if (typeof log.data === 'object' && (log.data.type === 'REQUEST' || log.data.type === 'RESPONSE')) {
                            isImportantAI = true;
                        } else if (typeof log.data === 'string' && (log.data.includes('REQUEST') || log.data.includes('RESPONSE'))) {
                            isImportantAI = true;
                        }
                    }
                }

                // 스타일 적용 (에러/경고/중요AI)
                if (log.level === 'ERROR' || log.type === 'ERROR') {
                    details.style.borderLeft = "4px solid #ef4444"; // Red
                    details.style.background = "#fef2f2";
                    details.style.color = "#b91c1c"; // Text color for error
                } else if (log.level === 'WARN') {
                    details.style.borderLeft = "4px solid #f59e0b"; // Amber
                    details.style.background = "#fffbeb";
                    details.style.color = "#b45309";
                } else if (isImportantAI) {
                    details.style.borderLeft = "4px solid #ffffff"; // White Highlight
                    details.style.background = "rgba(255, 255, 255, 0.05)"; // Dark theme friendly highlight
                }

                const summary = document.createElement('summary');
                summary.className = 'log-entry-summary';

                // Time
                let timeStr = "Unknown Time";
                if (log.timestamp) {
                    try {
                        timeStr = new Date(log.timestamp).toLocaleTimeString();
                    } catch (e) { timeStr = "Invalid Date"; }
                }

                // Level Chips
                const level = log.level || log.type || 'INFO';
                // category 변수는 위에서 정의됨

                // [NEW] Main Text Enhancement (Title Customization)
                if (category === 'AI') {
                    // 1. Request Sent: <UserQuery> 추출
                    if (mainText.includes('Request Sent')) {
                        let promptText = "";
                        if (log.data && typeof log.data === 'object' && log.data.prompt) {
                            promptText = log.data.prompt;
                        } else if (typeof log.data === 'string') {
                            try { const d = JSON.parse(log.data); if (d.prompt) promptText = d.prompt; } catch (e) { promptText = log.data; }
                        }

                        // <UserQuery> 태그 내용 추출
                        const match = promptText.match(/<UserQuery>([\s\S]*?)<\/UserQuery>/);
                        if (match && match[1]) {
                            const queryContent = match[1].trim().replace(/\n/g, ' ').substring(0, 200); // 200자 제한
                            mainText += ` : ${queryContent}${match[1].length > 200 ? '...' : ''}`;
                        } else if (promptText) {
                            // 태그가 없으면 전체에서 일부 추출 (User Input 등)
                            // Fallback: [User Input] 캡션 찾기
                            const inputMatch = promptText.match(/\[User Input\]\s*([\s\S]*?)$/);
                            if (inputMatch && inputMatch[1]) {
                                const content = inputMatch[1].trim().replace(/\n/g, ' ').substring(0, 200);
                                mainText += ` : ${content}...`;
                            }
                        }
                    }
                    // 2. Response Received: 응답 내용 추출
                    else if (mainText.includes('Response Received')) {
                        let responseText = "";
                        if (log.data && typeof log.data === 'object' && log.data.response) {
                            responseText = log.data.response;
                        } else if (typeof log.data === 'string') {
                            try { const d = JSON.parse(log.data); if (d.response) responseText = d.response; } catch (e) { responseText = log.data; }
                        }

                        if (responseText) {
                            const cleanResponse = responseText.replace(/\n/g, ' ').substring(0, 200); // 200자 제한
                            mainText += ` : ${cleanResponse}${responseText.length > 200 ? '...' : ''}`;
                        }
                    }
                }

                const previewText = String(mainText).substring(0, 250) + (String(mainText).length > 250 ? "..." : "");

                // [NEW] Mode Badge (Local/Cloud) logic
                let modeBadge = '';
                let mode = '';
                // 1. log.data.mode 확인
                if (log.data && log.data.mode) {
                    mode = log.data.mode;
                }
                // 2. data가 없으면 message에서 추론 (하위 호환)
                else if (typeof log.data === 'string' && log.data.includes('mode')) {
                    try { const d = JSON.parse(log.data); if (d.mode) mode = d.mode; } catch (e) { }
                }

                if (mode) {
                    const badgeClass = mode.toLowerCase() === 'cloud' ? 'model-cloud' : 'model-local';
                    modeBadge = `<span class="log-model ${badgeClass}">${mode}</span>`;
                }

                // [NEW] Highlight Logic (Request/Response)
                let contentClass = 'log-content';
                if (isImportantAI) {
                    contentClass += ' log-highlight-white';
                }

                summary.innerHTML = `
                    <div class="summary-left">
                        <span class="log-time">${timeStr}</span>
                        <span class="log-type ${level}">${level}</span>
                        <span class="log-category">[${category}]</span>
                        ${modeBadge}
                        <span class="summary-preview">${previewText}</span>
                    </div>
                `;
                details.appendChild(summary);

                // Full Content
                const contentDiv = document.createElement('div');
                contentDiv.className = contentClass;

                // Message
                const msgP = document.createElement('p');
                msgP.style.fontWeight = 'bold';
                msgP.style.marginBottom = '8px';
                msgP.textContent = String(mainText); // 전체 메시지
                contentDiv.appendChild(msgP);

                // Data (JSON)
                if (log.data) {
                    const jsonPre = document.createElement('pre');
                    try {
                        jsonPre.innerHTML = syntaxHighlight(log.data);
                    } catch (e) {
                        jsonPre.textContent = JSON.stringify(log.data, null, 2);
                        console.warn("JSON Highlight failed:", e);
                    }
                    contentDiv.appendChild(jsonPre);
                }

                details.appendChild(contentDiv);
                fragment.appendChild(details);
            });

            debugLogViewer.appendChild(fragment);

        } catch (error) {
            console.error("Render Logs Failed:", error);
            debugLogViewer.innerHTML = `<div class="log-placeholder" style="color:red">로그 렌더링 중 오류가 발생했습니다.<br>${error.message}</div>`;
        }
    }

    function syntaxHighlight(json) {
        if (json === undefined || json === null) return '';
        if (typeof json !== 'string') {
            json = JSON.stringify(json, undefined, 2);
        }
        if (!json) return '';

        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            let cls = 'json-number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'json-key';
                } else {
                    cls = 'json-string';
                    // 문자열 값인 경우, \n을 실제 개행으로 변환하여 가독성 확보
                    // 단, 키(key)가 아닌 값(value)인 경우에만 적용
                    match = match.replace(/\\n/g, '\n');
                }
            } else if (/true|false/.test(match)) {
                cls = 'json-boolean';
            } else if (/null/.test(match)) {
                cls = 'json-null';
            }
            return '<span class="' + cls + '">' + match + '</span>';
        });
    }

    // 저장된 세션 정보 로드 (제목 매핑용)
    function loadSavedSessionsForLogs() {
        chrome.storage.local.get('savedSessions', (data) => {
            savedSessionsCache = data.savedSessions || [];
            // 세션 정보가 업데이트되었을 수 있으므로 로그 재렌더링 시도
            if (activeSession || allLogsCache.length > 0) {
                renderLogs(allLogsCache);
            }
        });
    }

    // 초기화 및 스토리지 변경 감지에 추가
    loadSavedSessionsForLogs();
    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.savedSessions) {
            loadSavedSessionsForLogs();
        }
    });

    chrome.storage.local.get('debugLogs', (data) => {
        if (data.debugLogs) {
            renderLogs(data.debugLogs);
        } else {
            console.log("No debug logs found, rendering empty state.");
            renderLogs([]);
        }
    });

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes.debugLogs) {
            renderLogs(changes.debugLogs.newValue);
        }
    });

    if (clearLogBtn) {
        clearLogBtn.addEventListener('click', () => {
            chrome.storage.local.set({ debugLogs: [] });
            renderLogs([]);
        });
    }

    // --- AI 매개변수 설정 로직 ---

    // UI 요소
    const tempSlider = document.getElementById('temp-slider');
    const tempValue = document.getElementById('temp-value');
    const topkSlider = document.getElementById('topk-slider');
    const topkValue = document.getElementById('topk-value');
    const saveParamsBtn = document.getElementById('save-params-btn');
    const resetParamsBtn = document.getElementById('reset-params-btn');
    const paramsStatusMsg = document.getElementById('params-status-msg');

    // 1. 매개변수 초기화
    async function initParams() {
        // 모델에서 지원하는 범위 로드
        try {
            // 안전한 API 접근
            const model = findAIModel();

            if (model && model.params) {
                const defaults = await model.params();
                // 슬라이더 최대값 설정
                if (defaults.maxTemperature) tempSlider.max = defaults.maxTemperature;
                if (defaults.maxTopK) topkSlider.max = defaults.maxTopK;
                // 기본값 저장 (복원용)
                tempSlider.dataset.defaultInfo = defaults.defaultTemperature;
                topkSlider.dataset.defaultInfo = defaults.defaultTopK;
            }
        } catch (e) {
            console.warn("모델 파라미터 로드 실패:", e);
        }

        // 저장된 값 불러오기
        chrome.storage.sync.get(['modelTemperature', 'modelTopK'], (data) => {
            if (data.modelTemperature !== undefined) tempSlider.value = data.modelTemperature;
            if (data.modelTopK !== undefined) topkSlider.value = data.modelTopK;
            updateSliderDisplay();
        });
    }

    function updateSliderDisplay() {
        tempValue.textContent = tempSlider.value;
        topkValue.textContent = topkSlider.value;
    }

    if (tempSlider && topkSlider) {
        tempSlider.addEventListener('input', updateSliderDisplay);
        topkSlider.addEventListener('input', updateSliderDisplay);

        saveParamsBtn.addEventListener('click', () => {
            const t = parseFloat(tempSlider.value);
            const k = parseInt(topkSlider.value);
            chrome.storage.sync.set({ modelTemperature: t, modelTopK: k }, () => {
                showParamsMsg("설정이 저장되었습니다.", "green");
            });
        });

        resetParamsBtn.addEventListener('click', () => {
            // API 기본값이 있으면 사용, 없으면 일반적인 기본값 사용
            const defaultTemp = parseFloat(tempSlider.dataset.defaultInfo) || 1.0;
            const defaultTopK = parseInt(topkSlider.dataset.defaultInfo) || 3;
            tempSlider.value = defaultTemp;
            topkSlider.value = defaultTopK;
            updateSliderDisplay();
            chrome.storage.sync.set({ modelTemperature: defaultTemp, modelTopK: defaultTopK }, () => {
                showParamsMsg("기본값으로 복원되었습니다.", "gray");
            });
        });
    }

    function showParamsMsg(text, color) {
        if (!paramsStatusMsg) return;
        paramsStatusMsg.textContent = text;
        paramsStatusMsg.style.color = color;
        setTimeout(() => paramsStatusMsg.textContent = "", 3000);
    }

    // --- 일반 설정 (기본 모드 & 톤) ---
    const defaultModeSelect = document.getElementById('default-mode-select');
    const defaultToneSelect = document.getElementById('default-tone-select');

    if (defaultModeSelect && defaultToneSelect) {
        // 초기값 로드
        chrome.storage.sync.get(['defaultAIMode', 'defaultTone'], (data) => {
            if (data.defaultAIMode) defaultModeSelect.value = data.defaultAIMode;
            if (data.defaultTone) defaultToneSelect.value = data.defaultTone;
        });

        // 변경 이벤트 리스너
        defaultModeSelect.addEventListener('change', () => {
            chrome.storage.sync.set({ defaultAIMode: defaultModeSelect.value }, () => {
                // 저장 완료 피드백 (필요 시)
            });
        });

        defaultToneSelect.addEventListener('change', () => {
            chrome.storage.sync.set({ defaultTone: defaultToneSelect.value }, () => {
                // 저장 완료 피드백 (필요 시)
            });
        });
    }

    // 초기화 호출
    initParams();
});
