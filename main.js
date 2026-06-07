const { Plugin, PluginSettingTab, Setting, Notice, Modal } = require('obsidian');

// ==================== НАСТРОЙКИ ====================
const DEFAULT_SETTINGS = {
    blockNotifications: true,
    blockSystemNotices: true,
    blockFilePushNotifications: true,
    hideSidebars: true,
    autoStartBreakTimer: false,
    defaultFocusMinutes: 25,
    collectAnalytics: true,
};

module.exports = class FocusModePlus extends Plugin {
    async startFocusSession(customMinutes) {
        if (this.isFocusActive) return;
        
        const minutes = customMinutes || this.settings.defaultFocusMinutes;
        
        // Активируем блокировку уведомлений
        if (this.settings.blockNotifications) {
            this.notificationBlocker.activate();
        }
        
        this.applyUILimitations();
        this.timer.start(minutes, false);
        this.isFocusActive = true;
        this.currentSessionStart = Date.now();
        
        this.updateFocusButton();
        
        const level = this.stats.getCurrentLevel();
        new Notice(`🧘 Режим фокуса ВКЛЮЧЕН (${minutes} мин) | Уведомления отключены | Ваш уровень: ${level.name} ${level.icon}`);
        
        // Дополнительное уведомление о блокировке
        if (this.settings.blockNotifications) {
            console.log("[Focus Mode] Все уведомления заблокированы на время сессии");
        }
    }

    async endFocusSession(completed) {
        if (!this.isFocusActive) return;
        
        const duration = this.currentSessionStart ? (Date.now() - this.currentSessionStart) / 1000 : 0;
        
        // Деактивируем блокировку уведомлений
        if (this.settings.blockNotifications) {
            this.notificationBlocker.deactivate();
        }
        
        if (this.timer) this.timer.stop();
        this.restoreUI();
        
        if (duration > 30) {
            const session = {
                startTime: this.currentSessionStart,
                endTime: Date.now(),
                durationSeconds: duration,
                completed: completed,
                interrupted: !completed
            };
            this.stats.addSession(session);
            await this.saveStats();
            
            const newAchievements = this.stats.checkAchievements();
            for (const ach of newAchievements) {
                new Notice(`🏆 Новое достижение: ${ach.name}!`);
            }
            
            const level = this.stats.getCurrentLevel();
            const progress = this.stats.getProgressToNextLevel();
            if (progress < 100) {
                new Notice(`${level.icon} Прогресс к следующему уровню: ${Math.round(progress)}%`);
            }
        }
        
        this.isFocusActive = false;
        this.currentSessionStart = null;
        this.updateFocusButton();
        
        new Notice(completed ? "Фокус-сессия завершена! Хорошая работа ✨" : "Режим фокуса ВЫКЛЮЧЕН");
    }
    
    async toggleFocusMode() {
        if (this.isFocusActive) {
            await this.endFocusSession(false);
        } else {
            await this.startFocusSession();
        }
    }

    async onload() {
        console.log("Загрузка Focus Mode+...");
        
        this.stats = new FocusStats();
        await this.loadSettings();
        
        this.isFocusActive = false;
        this.currentSessionStart = null;
        this.originalSidebarState = null;
        
        // Инициализация блокировщика уведомлений
        this.notificationBlocker = new NotificationBlocker();
        this.notificationBlocker.setSettings(this.settings);
        
        // Создаём кнопки
        if (this.settings.showRibbonButtons) {
            this.createRibbonButtons();
        }
        
        // Статус-бар для таймера
        const statusBar = this.addStatusBarItem();
        statusBar.style.marginRight = "10px";
        this.timer = new FocusTimer(statusBar, () => this.endFocusSession(true));
        
        // Команды
        this.addCommand({
            id: 'toggle-focus-mode',
            name: 'Включить/выключить режим фокуса',
            callback: () => this.toggleFocusMode()
        });
        
        this.addCommand({
            id: 'show-focus-stats',
            name: 'Показать статистику',
            callback: () => new StatsModal(this.app, this.stats).open()
        });
        
        this.addCommand({
            id: 'show-recommendations',
            name: 'Показать рекомендации',
            callback: () => new RecommendationsModal(this.app, this.stats).open()
        });
        
        this.addSettingTab(new FocusSettingTab(this.app, this));
        
        const newAchievements = this.stats.checkAchievements();
        for (const ach of newAchievements) {
            new Notice(`🏆 Новое достижение: ${ach.name}!`);
        }
        
        this.registerEvent(this.app.workspace.on('quit', () => this.saveStats()));
        console.log("Focus Mode+ загружен!");
    }
    
    createRibbonButtons() {
        const ribbonContainer = document.createElement('div');
        ribbonContainer.style.display = 'flex';
        ribbonContainer.style.flexDirection = 'column';
        ribbonContainer.style.gap = '8px';
        ribbonContainer.style.padding = '8px 0';
        
        this.focusBtn = ribbonContainer.createEl('button', { text: '🎯' });
        this.focusBtn.style.cssText = `
            background: var(--interactive-accent);
            color: white;
            border: none;
            border-radius: 8px;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            font-weight: bold;
            margin: 0 8px;
            transition: all 0.2s;
        `;
        this.focusBtn.onclick = () => this.toggleFocusMode();
        
        const statsBtn = ribbonContainer.createEl('button', { text: '📊' });
        statsBtn.style.cssText = `
            background: var(--background-secondary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 8px;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            margin: 0 8px;
            transition: all 0.2s;
        `;
        statsBtn.onclick = () => new StatsModal(this.app, this.stats).open();
        
        const recBtn = ribbonContainer.createEl('button', { text: '💡' });
        recBtn.style.cssText = `
            background: var(--background-secondary);
            border: 1px solid var(--background-modifier-border);
            border-radius: 8px;
            padding: 6px 12px;
            cursor: pointer;
            font-size: 12px;
            margin: 0 8px;
            transition: all 0.2s;
        `;
        recBtn.onclick = () => new RecommendationsModal(this.app, this.stats).open();
        
        const ribbon = document.querySelector('.workspace-ribbon.mod-left .sidebar-toggle-button');
        if (ribbon && ribbon.parentNode) {
            ribbon.parentNode.insertBefore(ribbonContainer, ribbon.nextSibling);
            this.ribbonContainer = ribbonContainer;
        } else {
            const fallbackContainer = this.addStatusBarItem();
            fallbackContainer.style.gap = '8px';
            fallbackContainer.appendChild(this.focusBtn);
            fallbackContainer.appendChild(statsBtn);
            fallbackContainer.appendChild(recBtn);
        }
    }
    
    updateFocusButton() {
        if (this.focusBtn) {
            if (this.isFocusActive) {
                this.focusBtn.textContent = '⏹️';
                this.focusBtn.style.background = 'var(--background-modifier-error)';
            } else {
                this.focusBtn.textContent = '🎯';
                this.focusBtn.style.background = 'var(--interactive-accent)';
            }
        }
    }
}
class FocusTimer {
    constructor(statusBar, onComplete) {
        this.statusBarItem = statusBar;
        this.onCompleteCallback = onComplete;
        this.timerInterval = null;
        this.isRunning = false;
        this.remainingSeconds = 0;
        this.updateDisplay("⏱️ Фокус не активен");
    }
    
    updateDisplay(text) {
        if (typeof text === 'string') {
            this.statusBarItem.setText(text);
        } else {
            const mins = Math.floor(this.remainingSeconds / 60);
            const secs = this.remainingSeconds % 60;
            const icon = this.isBreak ? "☕" : "🎯";
            this.statusBarItem.setText(`${icon} ${mins}:${secs.toString().padStart(2,'0')}`);
        }
    }
    
    start(durationMinutes, isBreakMode = false) {
        this.stop();
        this.isBreak = isBreakMode;
        this.remainingSeconds = durationMinutes * 60;
        this.endTime = Date.now() + this.remainingSeconds * 1000;
        this.isRunning = true;
        this.updateDisplay();
        
        this.timerInterval = setInterval(() => {
            if (!this.isRunning) return;
            this.remainingSeconds = Math.max(0, Math.floor((this.endTime - Date.now()) / 1000));
            this.updateDisplay();
            if (this.remainingSeconds <= 0) this.complete();
        }, 100);
    }
    
    complete() {
        this.stop();
        new Notice(this.isBreak ? "Перерыв окончен!" : "Фокус-сессия завершена! 🎉");
        this.onCompleteCallback();
    }
    
    stop() {
        if (this.timerInterval) {
            clearInterval(this.timerInterval);
            this.timerInterval = null;
        }
        this.isRunning = false;
        this.updateDisplay("⏱️ Фокус не активен");
    }
}