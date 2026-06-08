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

    applyUILimitations() {
        if (this.settings.hideSidebars) {
            const workspace = this.app.workspace;
            this.originalSidebarState = {
                left: workspace.leftSplit.collapsed,
                right: workspace.rightSplit.collapsed
            };
            workspace.leftSplit.collapse();
            workspace.rightSplit.collapse();
        }
        
        if (this.settings.dimNonActiveNotes) {
            document.body.classList.add("focus-mode-dim-others");
        }
        
        if (this.settings.hideStatusBar) {
            document.body.classList.add("focus-mode-hide-statusbar");
        }
        
        document.body.classList.add("focus-mode-active");
    }
    
    restoreUI() {
        if (this.settings.hideSidebars && this.originalSidebarState) {
            const workspace = this.app.workspace;
            if (!this.originalSidebarState.left) workspace.leftSplit.expand();
            if (!this.originalSidebarState.right) workspace.rightSplit.expand();
            this.originalSidebarState = null;
        }
        
        if (this.settings.dimNonActiveNotes) {
            document.body.classList.remove("focus-mode-dim-others");
        }
        
        if (this.settings.hideStatusBar) {
            document.body.classList.remove("focus-mode-hide-statusbar");
        }
        
        document.body.classList.remove("focus-mode-active");
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

class FocusStats {
    constructor() {
        this.data = [];
        this.achievements = {};
    }
    
    load(data) {
        if (data) {
            this.data = data.data || [];
            this.achievements = data.achievements || {};
        }
    }
    
    save() {
        return { data: this.data, achievements: this.achievements };
    }
    
    addSession(session) {
        const today = new Date().toISOString().split('T')[0];
        let dayStat = this.data.find(d => d.date === today);
        if (!dayStat) {
            dayStat = { date: today, totalFocusSeconds: 0, sessions: [], avgSessionLength: 0 };
            this.data.push(dayStat);
        }
        dayStat.sessions.push(session);
        dayStat.totalFocusSeconds += session.durationSeconds;
        dayStat.avgSessionLength = dayStat.totalFocusSeconds / dayStat.sessions.length;
        if (this.data.length > 90) this.data.shift();
    }
    
    getTotalMinutes() {
        return this.data.reduce((sum, d) => sum + d.totalFocusSeconds, 0) / 60;
    }
    
    getTotalSessions() {
        return this.data.reduce((sum, d) => sum + d.sessions.length, 0);
    }
    
    getCompletedSessions() {
        return this.data.reduce((sum, d) => sum + d.sessions.filter(s => s.completed).length, 0);
    }

    getStreak() {
        let streak = 0;
        const today = new Date().toISOString().split('T')[0];
        for (let i = this.data.length - 1; i >= 0; i--) {
            const date = this.data[i].date;
            const diff = (new Date(today) - new Date(date)) / (1000 * 60 * 60 * 24);
            if (diff <= streak + 1 && this.data[i].sessions.length > 0) {
                streak++;
            } else if (diff > streak + 1) {
                break;
            }
        }
        return streak;
    }
    
    getEarlySessions() {
        let count = 0;
        for (const day of this.data) {
            for (const session of day.sessions) {
                const hour = new Date(session.startTime).getHours();
                if (hour < 9) count++;
            }
        }
        return count;
    }
    
    getLateSessions() {
        let count = 0;
        for (const day of this.data) {
            for (const session of day.sessions) {
                const hour = new Date(session.startTime).getHours();
                if (hour >= 22) count++;
            }
        }
        return count;
    }
    
    getPomodoroCount() {
        let count = 0;
        for (const day of this.data) {
            for (const session of day.sessions) {
                if (Math.abs(session.durationSeconds - 1500) < 60) count++;
            }
        }
        return count;
    }
    
    getCurrentLevel() {
        const totalMinutes = this.getTotalMinutes();
        for (let i = PRODUCTIVITY_LEVELS.length - 1; i >= 0; i--) {
            if (totalMinutes >= PRODUCTIVITY_LEVELS[i].minMinutes) {
                return PRODUCTIVITY_LEVELS[i];
            }
        }
        return PRODUCTIVITY_LEVELS[0];
    }
    
    getNextLevel() {
        const current = this.getCurrentLevel();
        const currentIndex = PRODUCTIVITY_LEVELS.findIndex(l => l.name === current.name);
        if (currentIndex < PRODUCTIVITY_LEVELS.length - 1) {
            return PRODUCTIVITY_LEVELS[currentIndex + 1];
        }
        return null;
    }
    
    getProgressToNextLevel() {
        const current = this.getCurrentLevel();
        const next = this.getNextLevel();
        if (!next) return 100;
        const totalMinutes = this.getTotalMinutes();
        const progress = ((totalMinutes - current.minMinutes) / (next.minMinutes - current.minMinutes)) * 100;
        return Math.min(100, Math.max(0, progress));
    }
    
    checkAchievements() {
        const newAchievements = [];
        for (const ach of ACHIEVEMENTS) {
            if (!this.achievements[ach.id] && ach.condition(this)) {
                this.achievements[ach.id] = {
                    unlocked: true,
                    date: new Date().toISOString(),
                    name: ach.name,
                    description: ach.description
                };
                newAchievements.push(ach);
            }
        }
        return newAchievements;
    }
    
    getUnlockedAchievements() {
        return Object.values(this.achievements);
    }
    
    getBestDay() {
        if (!this.data.length) return null;
        const best = this.data.reduce((max, d) => d.totalFocusSeconds > max.totalFocusSeconds ? d : max, this.data[0]);
        return { date: best.date, minutes: Math.round(best.totalFocusSeconds / 60) };
    }
}