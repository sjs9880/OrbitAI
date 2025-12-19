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

    // 전역 변수로 활성 세션 관리
    let activeSession = null;
    let currentLogFilter = 'ALL'; // 현재 로그 필터 상태
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
            if (validStates.includes(status)) {
                setGuideState(true);
            } else {
                setGuideState(false);
            }
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
            keyStatusMsg.textContent = "✅ 저장된 API 키가 있습니다.";
            keyStatusMsg.style.color = "green";
        }
        if (data.geminiModelId && modelSelect) {
            modelSelect.value = data.geminiModelId;
        }
        if (debugToggle) {
            debugToggle.checked = !!data.enableDebugLog;
        }
        const historyToggle = document.getElementById('history-toggle');
        if (historyToggle) {
            historyToggle.checked = !!data.enableHistory;
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

    const historyToggle = document.getElementById('history-toggle');
    if (historyToggle) {
        historyToggle.addEventListener('change', () => {
            chrome.storage.sync.set({ enableHistory: historyToggle.checked });
        });
    }

    // --- 로그 뷰어 로직 ---
    // --- 로그 뷰어 로직 ---

    // 필터 버튼 이벤트 연결
    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            // 활성 상태 변경
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // 필터 적용
            currentLogFilter = btn.dataset.filter;
            renderLogs(allLogsCache);
        });
    });

    function renderLogs(logs) {
        if (!debugLogViewer) return;
        allLogsCache = logs || []; // 캐시 업데이트

        debugLogViewer.innerHTML = '';

        // 필터링 적용
        let filteredLogs = allLogsCache;
        if (currentLogFilter !== 'ALL') {
            if (currentLogFilter === 'SYSTEM') {
                // SYSTEM은 INFO 등 일반 로그 포함, 또는 type이 'response'인 경우 등 정의 필요
                // 여기서는 type이 'RESPONSE'이거나 'INFO'인 것을 SYSTEM으로 간주예정이었으나,
                // 기존 코드에서 type을 어떻게 저장하는지 확인.
                // saveDebugLog 호출: 'REQUEST', 'RESPONSE', 'ERROR', 'INFO'
                // 따라서 SYSTEM -> RESPONSE, INFO
                // USER -> REQUEST
                // ERROR -> ERROR
                filteredLogs = allLogsCache.filter(l => l.type === 'RESPONSE' || l.type === 'INFO' || l.type === 'system');
            } else if (currentLogFilter === 'USER') {
                filteredLogs = allLogsCache.filter(l => l.type === 'REQUEST' || l.type === 'user');
            } else {
                filteredLogs = allLogsCache.filter(l => l.type === currentLogFilter);
            }
        }

        if (!filteredLogs || filteredLogs.length === 0) {
            debugLogViewer.innerHTML = '<div class="log-placeholder">표시할 로그가 없습니다.</div>';
            return;
        }

        filteredLogs.forEach(log => {
            // Details/Summary 구조로 변경
            const details = document.createElement('details');
            details.className = 'log-entry-details';
            details.open = false; // 기본적으로 닫힘

            const summary = document.createElement('summary');
            summary.className = 'log-entry-summary';

            const timeStr = new Date(log.timestamp).toLocaleTimeString();

            // 모델 배지
            let modelBadge = '';
            if (log.model) {
                const modelClass = log.model === 'Cloud' ? 'model-cloud' : 'model-local';
                modelBadge = `<span class="log-model ${modelClass}">${log.model}</span>`;
            }

            // 세션 배지 (ID 기반 최신 제목 조회)
            let sessionBadge = '';
            let sessionName = log.sessionName;

            // ID가 있는데 제목이 없거나, 기본값인 경우 업데이트 시도
            if (log.sessionId && (!sessionName || sessionName === '새로운 대화' || sessionName === '알 수 없음')) {
                const session = savedSessionsCache.find(s => s.id === log.sessionId);
                if (session && session.title) {
                    sessionName = session.title;
                }
            }

            // '새로운 대화'는 표시하지 않음 (사용자 요청)
            if (sessionName === '새로운 대화') sessionName = '';
            // 아직도 '새로운 대화'라면 현재 세션일 수 있음 (저장 목록에 없을 수 있음)
            // currentSession은 sidepanel에서 관리하므로 options에서는 접근 불가. 
            // 다만 storage.local.currentSession을 읽을 수는 있음 (실시간)

            if (log.sessionId) {
                // 사용자 요청: 제목 대신 세션 ID(명) 표시
                const shortId = log.sessionId.substring(0, 8);
                const tooltip = sessionName ? `${sessionName} (${log.sessionId})` : log.sessionId;
                sessionBadge = `<span class="log-session" title="${tooltip}">Session ${shortId}</span>`;
            } else if (sessionName) {
                // ID가 없을 때만 이름 사용 (구버전 로그 호환)
                sessionBadge = `<span class="log-session" title="${sessionName}">${sessionName}</span>`;
            }

            // 요약 텍스트 (본문 앞부분 50자)
            let previewText = "";
            if (typeof log.content === 'object') {
                previewText = JSON.stringify(log.content).substring(0, 50) + "...";
            } else {
                previewText = String(log.content).substring(0, 50) + (String(log.content).length > 50 ? "..." : "");
            }

            summary.innerHTML = `
                <div class="summary-left">
                    <span class="log-time">[${timeStr}]</span>
                    <span class="log-type ${log.type}">${log.type}</span>
                    ${modelBadge}
                    ${sessionBadge}
                </div>
                <div class="summary-preview">${previewText}</div>
            `;

            details.appendChild(summary);

            const contentDiv = document.createElement('div');
            contentDiv.className = 'log-content';
            if (typeof log.content === 'object') {
                contentDiv.innerHTML = syntaxHighlight(log.content);
            } else {
                contentDiv.textContent = log.content;
            }
            details.appendChild(contentDiv);

            debugLogViewer.appendChild(details);
        });

        // 스크롤 최하단 이동 (requestAnimationFrame 사용으로 렌더링 후 실행 보장)
        requestAnimationFrame(() => {
            debugLogViewer.scrollTop = debugLogViewer.scrollHeight;
        });
    }

    function syntaxHighlight(json) {
        if (typeof json !== 'string') {
            json = JSON.stringify(json, undefined, 2);
        }
        json = json.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return json.replace(/("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?)/g, function (match) {
            let cls = 'json-number';
            if (/^"/.test(match)) {
                if (/:$/.test(match)) {
                    cls = 'json-key';
                } else {
                    cls = 'json-string';
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
        if (data.debugLogs) renderLogs(data.debugLogs);
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
