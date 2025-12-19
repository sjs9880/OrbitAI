/**
 * LogManager.js
 * 중앙 집중식 로깅 관리 클래스
 * Console 출력과 Chrome Storage 저장을 동시에 처리하며, 버퍼링을 통해 성능을 최적화합니다.
 */
class LogManager {
    constructor() {
        if (LogManager.instance) {
            return LogManager.instance;
        }

        this.buffer = [];
        this.FLUSH_THRESHOLD = 1; // 버퍼가 이 크기에 도달하면 저장
        this.STORAGE_KEY = 'debugLogs';
        this.isEnabled = true; // 기본값, 스토리지에서 동기화됨

        // 초기 설정 로드
        this._loadSettings();

        // 설정 변경 감지
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'sync' && changes.enableDebugLog) {
                this.isEnabled = changes.enableDebugLog.newValue;
                this.info('System', `Debug logging ${this.isEnabled ? 'enabled' : 'disabled'}`);
            }
        });

        // 윈도우/패널 종료 시 잔여 로그 저장
        if (typeof window !== 'undefined') {
            window.addEventListener('unload', () => {
                this.flush();
            });
        }

        LogManager.instance = this;
    }

    _loadSettings() {
        chrome.storage.sync.get('enableDebugLog', (data) => {
            // undefined일 경우 기본적으로 true 또는 false? 
            // 기존 코드에서는 data.enableDebugLog가 설정되어야 함.
            // 명시적으로 감지되지 않으면 true로 두거나, 기존 로직 따름.
            // 여기서는 기존 로직과 호환되도록 함.
            this.isEnabled = !!data.enableDebugLog;
        });
    }

    /**
     * 로그 기록 메인 메서드
     * @param {string} level 'INFO' | 'WARN' | 'ERROR' | 'DEBUG'
     * @param {string} category 로그 발생 위치 또는 카테고리 (예: 'Router', 'System')
     * @param {string} message 로그 메시지
     * @param {any} data 추가 데이터 (JSON 객체 등)
     * @param {string|null} sessionId 관련 세션 ID (선택 사항)
     */
    log(level, category, message, data = null, sessionId = null) {
        // 1. Console 출력 (항상 개발자 도구에서 보임)
        this._printToConsole(level, category, message, data);

        // 2. Storage 저장 (로그 기능 활성화 시에만)
        if (!this.isEnabled) return;

        const logEntry = {
            timestamp: Date.now(),
            level: level,
            type: this._mapLevelToType(level), // 기존 로직 호환성 (REQUEST/RESPONSE 등은 별도 처리 필요하지만 일단 level 기반 매핑)
            category: category,
            message: message,
            data: data ? JSON.parse(JSON.stringify(data)) : null, // 참조 끊기
            sessionId: sessionId
        };

        this.buffer.push(logEntry);

        if (this.buffer.length >= this.FLUSH_THRESHOLD) {
            this.flush();
        }
    }

    // 편의 메서드들
    info(category, message, data = null, sessionId = null) {
        this.log('INFO', category, message, data, sessionId);
    }

    warn(category, message, data = null, sessionId = null) {
        this.log('WARN', category, message, data, sessionId);
    }

    error(category, message, data = null, sessionId = null) {
        this.log('ERROR', category, message, data, sessionId);
    }

    debug(category, message, data = null, sessionId = null) {
        this.log('DEBUG', category, message, data, sessionId);
    }

    /**
     * 버퍼 내용을 스토리지에 저장
     */
    async flush() {
        if (this.buffer.length === 0) return;

        const newLogs = [...this.buffer];
        this.buffer = []; // 버퍼 즉시 비움

        try {
            const data = await chrome.storage.local.get(this.STORAGE_KEY);
            const existingLogs = data[this.STORAGE_KEY] || [];

            // 최대 200개 유지
            const updatedLogs = [...existingLogs, ...newLogs].slice(-200);

            await chrome.storage.local.set({ [this.STORAGE_KEY]: updatedLogs });
        } catch (e) {
            console.error("Failed to flush logs to storage:", e);
        }
    }

    _printToConsole(level, category, message, data) {
        const style = this._getStyle(level);
        const prefix = `%c[${category}]`;

        if (data) {
            console.groupCollapsed(`${prefix} ${message}`, style);
            console.log(data);
            console.groupEnd();
        } else {
            console.log(`${prefix} ${message}`, style);
        }
    }

    _getStyle(level) {
        switch (level) {
            case 'ERROR': return 'background: #fee2e2; color: #991b1b; padding: 2px 4px; border-radius: 2px; font-weight: bold;';
            case 'WARN': return 'background: #fef3c7; color: #92400e; padding: 2px 4px; border-radius: 2px;';
            case 'INFO': return 'background: #dbeafe; color: #1e40af; padding: 2px 4px; border-radius: 2px;';
            case 'DEBUG': return 'color: #6b7280; font-style: italic;';
            default: return 'color: #374151;';
        }
    }

    // 기존 type 호환성을 위한 매핑
    _mapLevelToType(level) {
        // 기존 뷰어 필터 호환을 위해 유지하거나, 뷰어를 업데이트해야 함.
        // options.js 수정 예정이므로 여기서는 기본적인 값만 반환.
        return level;
    }
}

// 싱글톤 인스턴스 export
export const logger = new LogManager();
