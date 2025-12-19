// 드래그 시 플로팅 버튼 표시
let floatingBtn = null;

document.addEventListener('mouseup', (e) => {
    // Selection 업데이트 타이밍 확보를 위한 지연
    setTimeout(() => {
        const selection = window.getSelection();
        const text = selection.toString().trim();

        if (text.length > 0) {
            showFloatingButton(e.pageX, e.pageY, text);
        } else {
            removeFloatingButton();
        }
    }, 10);
});

document.addEventListener('mousedown', (e) => {
    // 버튼 클릭이 아닐 경우 제거
    if (floatingBtn && !floatingBtn.contains(e.target)) {
        removeFloatingButton();
    }
});

function showFloatingButton(x, y, text) {
    if (floatingBtn) removeFloatingButton();

    // 텍스트 선택 영역 좌표 가져오기 (마우스 좌표 대신 사용)
    const selection = window.getSelection();
    if (selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // 스크롤 위치 보정
    const absoluteTop = rect.top + window.scrollY;
    const absoluteLeft = rect.left + window.scrollX;

    floatingBtn = document.createElement('div');
    floatingBtn.textContent = 'Orbit 에게 물어보기';
    floatingBtn.style.position = 'absolute';
    // 텍스트 선택 영역의 오른쪽 아래에 표시
    floatingBtn.style.left = `${absoluteLeft + rect.width}px`;
    floatingBtn.style.top = `${absoluteTop + rect.height + 5}px`;
    floatingBtn.style.background = '#2563eb';
    floatingBtn.style.color = 'white';
    floatingBtn.style.padding = '5px 10px';
    floatingBtn.style.borderRadius = '5px';
    floatingBtn.style.cursor = 'pointer';
    floatingBtn.style.zIndex = '2147483647'; // 최대값으로 설정
    floatingBtn.style.boxShadow = '0 2px 5px rgba(0,0,0,0.2)';
    floatingBtn.style.fontSize = '12px';
    floatingBtn.style.whiteSpace = 'nowrap';

    floatingBtn.addEventListener('click', () => {
        console.log("[Orbit] 🖱️ 플로팅 버튼 클릭됨. 선택된 텍스트:", text);
        floatingBtn.textContent = "Sending..."; // Visual Feedback

        // 백그라운드 및 사이드패널로 메시지 전송 (Orbit_TEXT_SELECTED)
        chrome.runtime.sendMessage({
            type: 'Orbit_TEXT_SELECTED',
            text: text
        }, (response) => {
            console.log("[Orbit] 📤 sendMessage 콜백 실행됨");
            if (chrome.runtime.lastError) {
                console.error("[Orbit] ❌ 메시지 전송 실패:", chrome.runtime.lastError.message);
                floatingBtn.textContent = "Failed!";
                floatingBtn.style.background = "red";
                setTimeout(removeFloatingButton, 1000);
            } else {
                console.log("[Orbit] ✅ 메시지 전송 성공 (Background/SidePanel 수신 확인 필요)");
                floatingBtn.textContent = "Sent!";
                floatingBtn.style.background = "#10b981";
                setTimeout(removeFloatingButton, 500);
            }
        });
    });

    document.body.appendChild(floatingBtn);
}

function removeFloatingButton() {
    if (floatingBtn) {
        floatingBtn.remove();
        floatingBtn = null;
    }
}