export class UIManager {
    constructor() {
        this.statusEl = document.getElementById('status-bar');
        this.chatMessages = document.getElementById('chat-messages');
        this.chatInput = document.getElementById('chat-input');
        this.contextChipsArea = document.getElementById('context-chips-area');

        // 스크롤 버튼
        this.scrollBtn = document.getElementById('scroll-to-bottom-btn');
        this._initScrollHandler();

        // 문자열 정의
        this.strings = {
            connecting: "AI 모델 연결 중...",
            readyLocal: "🟢 Orbit AI 준비 완료",
            readyCloud: "☁️ Cloud AI 모드 (Gemini 2.0 Flash)",
            fail: "❌ AI 연결 실패: ",
            noModel: "Gemini Nano를 찾을 수 없습니다.",
            generating: "생성 중...",
            sessionError: "⚠️ AI 세션이 준비되지 않았습니다.",
            msgReceived: "📨 데이터 수신 중...",
            textAttached: "📝 텍스트가 첨부되었습니다.",
            dupText: "⚠️ 이미 첨부된 텍스트입니다."
        };
    }

    _initScrollHandler() {
        if (!this.chatMessages) return;

        // 스크롤 이벤트
        this.chatMessages.addEventListener('scroll', () => {
            this._toggleScrollButton();
        });

        // 버튼 클릭
        if (this.scrollBtn) {
            this.scrollBtn.addEventListener('click', () => {
                this.scrollToBottom(true);
            });
        }
    }

    _toggleScrollButton() {
        if (!this.chatMessages || !this.scrollBtn) return;

        const { scrollTop, scrollHeight, clientHeight } = this.chatMessages;
        const isAtBottom = scrollHeight - scrollTop - clientHeight < 50; // 50px 임계값

        if (isAtBottom) {
            this.scrollBtn.classList.add('hidden');
        } else {
            this.scrollBtn.classList.remove('hidden');
        }
    }

    setStatus(text, color) {
        this.statusEl.textContent = text;
        if (color) this.statusEl.style.color = color;
    }

    appendMessage(role, text, mode, contexts = []) {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${role}`;
        if (mode) msgDiv.classList.add(mode);

        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        if (role === 'system') {
            bubble.innerHTML = window.marked ? window.marked.parse(text) : text;
        } else {
            bubble.textContent = text;
        }

        msgDiv.appendChild(bubble);

        // 채팅 내역에 컨텍스트 표시 (User 메시지인 경우) -> 말풍선 아래로 이동
        if (role === 'user' && contexts && contexts.length > 0) {
            const contextContainer = document.createElement('div');
            contextContainer.className = 'message-contexts';
            contexts.forEach((ctx, idx) => {
                const chip = document.createElement('div');
                chip.className = 'history-chip';
                chip.textContent = `${idx + 1}. ${ctx.length > 15 ? ctx.substring(0, 15) + "..." : ctx}`;
                chip.title = ctx;
                contextContainer.appendChild(chip);
            });
            msgDiv.appendChild(contextContainer);
        }

        this.chatMessages.appendChild(msgDiv);

        // 새 메시지 수신 시 항상 하단으로 스크롤
        this.scrollToBottom(true);

        return bubble;
    }

    updateBubble(bubble, text) {
        if (window.marked) {
            bubble.innerHTML = window.marked.parse(text);
        } else {
            bubble.textContent = text;
        }
        // 이미 하단에 있을 때만 스크롤 (스마트 스크롤)
        this.scrollToBottom(false);
    }

    scrollToBottom(force = true) {
        if (!this.chatMessages) return;

        if (force) {
            this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
        } else {
            const { scrollTop, scrollHeight, clientHeight } = this.chatMessages;
            const distanceToBottom = scrollHeight - scrollTop - clientHeight;

            // 임계값 50px로 축소 (안전을 위해 80px 사용)
            if (distanceToBottom < 40) {
                this.chatMessages.scrollTop = this.chatMessages.scrollHeight;
            }
        }
        this._toggleScrollButton();
    }

    renderContextChips(contexts, onRemove) {
        this.contextChipsArea.innerHTML = '';
        contexts.forEach((ctx, index) => {
            const chip = document.createElement('div');
            chip.className = 'chip';
            chip.title = ctx;

            const textSpan = document.createElement('span');
            textSpan.className = 'text';
            // 칩 앞부분에 번호 추가 (1. 내용...)
            textSpan.textContent = `${index + 1}. ${ctx.length > 20 ? ctx.substring(0, 20) + "..." : ctx}`;

            const closeBtn = document.createElement('span');
            closeBtn.className = 'close-btn';
            closeBtn.textContent = '×';
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                onRemove(index);
            };

            chip.appendChild(textSpan);
            chip.appendChild(closeBtn);
            this.contextChipsArea.appendChild(chip);
        });
    }

    toggleCloudModeUI(isCloud, modelName = 'Gemini 2.0 Flash') {
        const btn = document.getElementById('btn-model-toggle');
        const label = btn.querySelector('.label');

        if (isCloud) {
            btn.classList.add('active');
            document.body.classList.add('cloud-mode');
            label.textContent = '☁️ Cloud AI';
            // 모델명이 전달되면 반영, 아니면 기본값 표시
            this.setStatus(`☁️ Cloud AI 모드 (${modelName})`, "#7c3aed");
        } else {
            btn.classList.remove('active');
            document.body.classList.remove('cloud-mode');
            label.textContent = '💻 Local AI';
            this.setStatus(this.strings.readyLocal, "#10b981");
        }
    }

    showErrorGuide() {
        const guideHtml = `
<div class="error-guide">
    <div class="title" style="font-weight:bold; color:#b91c1c; margin-bottom:5px;">❌ Local AI를 사용할 수 없습니다</div>
    <div class="desc" style="font-size:12px; color:#4b5563; margin-bottom:8px;">
        Local AI 모델이 감지되지 않습니다.<br>
        설정 페이지에서 상세 가이드를 확인해 주세요.
    </div>
    <button id="btn-open-options" class="guide-btn" style="background:#ef4444; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; width:100%;">
        ⚙️ 설정 및 가이드 보기
    </button>
</div>`;

        const msgDiv = document.createElement('div');
        msgDiv.className = 'message system';

        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = guideHtml;

        msgDiv.appendChild(bubble);
        this.chatMessages.appendChild(msgDiv);
        this.scrollToBottom();

        setTimeout(() => {
            const btn = document.getElementById('btn-open-options');
            if (btn) {
                btn.addEventListener('click', () => {
                    if (chrome.runtime.openOptionsPage) {
                        chrome.runtime.openOptionsPage();
                    } else {
                        window.open(chrome.runtime.getURL('src/options/options.html'));
                    }
                });
            }
        }, 100);
    }

    hideWelcomeMessage() {
        const welcomeMsg = document.querySelector('.message.system'); // Corrected selector
        if (welcomeMsg && welcomeMsg.textContent.includes('안녕하세요')) {
            welcomeMsg.style.display = 'none';
        }
    }

    showLocalSearchError(onSwitch) {
        const errorHtml = `
<div class="search-error">
    <div style="font-weight:bold; color:#f59e0b; margin-bottom:5px;">⚠️ 기능 제한</div>
    <div style="font-size:12px; margin-bottom:8px;">
        Local AI 모델은 실시간 웹 검색을 지원하지 않습니다.<br>
        Cloud AI로 전환하여 검색하시겠습니까?
    </div>
    <button id="btn-switch-cloud" style="background:#2563eb; color:white; border:none; padding:6px 12px; border-radius:4px; cursor:pointer; width:100%; font-size:12px;">
        ☁️ Cloud AI로 전환 및 검색
    </button>
</div>`;

        const msgDiv = document.createElement('div');
        msgDiv.className = 'message system';
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = errorHtml;
        msgDiv.appendChild(bubble);
        this.chatMessages.appendChild(msgDiv);
        this.scrollToBottom();

        setTimeout(() => {
            const btn = document.getElementById('btn-switch-cloud');
            if (btn) {
                btn.addEventListener('click', onSwitch);
            }
        }, 100);
    }
    renderHistoryChips(sessions, onClick, onDelete) {
        const container = document.getElementById('history-chips-container');
        if (!container) return;

        container.innerHTML = '';
        sessions.forEach(session => {
            const btn = document.createElement('div'); // Changed to div for better control
            btn.className = 'history-chip-btn';
            btn.title = session.title || '새로운 대화';

            const span = document.createElement('span');
            span.textContent = session.title || '새로운 대화';
            span.onclick = () => onClick(session.id); // Text click triggers selection

            const deleteBtn = document.createElement('span');
            deleteBtn.className = 'close-btn';
            deleteBtn.textContent = '×';
            deleteBtn.onclick = (e) => {
                e.stopPropagation();
                if (confirm('정말 이 대화 기록을 삭제하시겠습니까?')) {
                    onDelete(session.id);
                }
            };

            btn.appendChild(span);
            btn.appendChild(deleteBtn);

            container.appendChild(btn);
        });
    }

    clearMessages() {
        this.chatMessages.innerHTML = '';
    }

    showWelcomeMessage() {
        // 이미 있으면 스킵
        if (this.chatMessages.querySelector('.message.system p')?.textContent.includes('안녕하세요')) return;

        const msgDiv = document.createElement('div');
        msgDiv.className = 'message system';
        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        const p1 = document.createElement('p');
        p1.textContent = "안녕하세요! Orbit AI 입니다. 👋";
        const p2 = document.createElement('p');
        p2.textContent = "작성 중인 글을 드래그하거나, 아래에 질문을 입력해 보세요.";

        bubble.appendChild(p1);
        bubble.appendChild(p2);
        msgDiv.appendChild(bubble);

        this.chatMessages.appendChild(msgDiv);
    }
}
