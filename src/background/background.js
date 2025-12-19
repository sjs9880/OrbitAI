// 아이콘 클릭 시 사이드 패널 열기
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => console.error(error));

// Content Script로부터 메시지 수신
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'OPEN_SIDE_PANEL') {
        // 사이드 패널 열기
        if (sender.tab) {
            chrome.sidePanel.open({ tabId: sender.tab.id })
                .catch(error => console.error("사이드 패널 열기 실패:", error));
        }
    } else if (request.type === 'Orbit_TEXT_SELECTED') {
        // 1. 스토리지에 저장 (패널이 닫혀있을 경우 대비)
        chrome.storage.local.set({ pendingText: request.text }, () => {
            // 2. 사이드 패널 열기
            if (sender.tab) {
                chrome.sidePanel.open({ tabId: sender.tab.id })
                    .catch(error => console.error("사이드 패널 열기 실패:", error));
            }
            // 3. 응답 전송 (에러 방지)
            sendResponse({ success: true });
        });
        return true; // 비동기 응답을 위해 true 반환
    }
});