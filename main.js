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

const PRODUCTIVITY_LEVELS = [
    { name: "🌱 Начинающий", minMinutes: 0, maxMinutes: 30, icon: "🌱", color: "#9e9e9e", description: "Каждое большое путешествие начинается с первого шага!" },
    { name: "⚡ В движении", minMinutes: 30, maxMinutes: 90, icon: "⚡", color: "#4caf50", description: "Вы набираете обороты!" },
    { name: "🔥 В зоне", minMinutes: 90, maxMinutes: 180, icon: "🔥", color: "#ff9800", description: "Отличный темп! Так держать!" },
    { name: "💪 Мастер фокуса", minMinutes: 180, maxMinutes: 300, icon: "💪", color: "#2196f3", description: "Вы в топе по концентрации!" },
    { name: "🏆 Легенда", minMinutes: 300, maxMinutes: Infinity, icon: "🏆", color: "#ffd700", description: "Вы достигли статуса легенды продуктивности!" }
];

const ACHIEVEMENTS = [
    { id: "first_focus", name: "🎯 Первый шаг", description: "Провести первую фокус-сессию", condition: (stats) => stats.getTotalSessions() >= 1 },
    { id: "seven_days", name: "📅 7 дней подряд", description: "Фокусироваться 7 дней подряд", condition: (stats) => stats.getStreak() >= 7 },
    { id: "marathon", name: "🏃 Марафонец", description: "Набрать 10 часов фокуса суммарно", condition: (stats) => stats.getTotalMinutes() >= 600 },
    { id: "early_bird", name: "🌅 Ранняя пташка", description: "10 сессий до 9 утра", condition: (stats) => stats.getEarlySessions() >= 10 },
    { id: "night_owl", name: "🦉 Ночная сова", description: "10 сессий после 22:00", condition: (stats) => stats.getLateSessions() >= 10 },
    { id: "perfectionist", name: "💎 Перфекционист", description: "Завершить 50 сессий без прерываний", condition: (stats) => stats.getCompletedSessions() >= 50 },
    { id: "pomodoro_master", name: "🍅 Мастер помидора", description: "Провести 100 сессий по 25 минут", condition: (stats) => stats.getPomodoroCount() >= 100 }
];

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

    async saveStats() {
        await this.saveData(this.stats.save());
    }
    
    async loadSettings() {
        try {
            const loadedData = await this.loadData();
            
            if (loadedData && loadedData.settings) {
                this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData.settings);
            } else if (loadedData && !loadedData.settings) {
                this.settings = Object.assign({}, DEFAULT_SETTINGS, loadedData);
            } else {
                this.settings = Object.assign({}, DEFAULT_SETTINGS);
            }
            
            if (loadedData && loadedData.data) {
                this.stats.data = loadedData.data;
            }
            if (loadedData && loadedData.achievements) {
                this.stats.achievements = loadedData.achievements;
            }
        } catch (e) {
            console.error("Error loading settings:", e);
            this.settings = Object.assign({}, DEFAULT_SETTINGS);
        }
    }

    async saveSettings() {
        try {
            await this.saveData({ 
                settings: this.settings, 
                data: this.stats.data, 
                achievements: this.stats.achievements 
            });
        } catch (e) {
            console.error("Error saving settings:", e);
        }
    }

    onunload() {
        console.log("Выгрузка Focus Mode+");
        if (this.notificationBlocker && this.notificationBlocker.isActive) {
            this.notificationBlocker.deactivate();
        }
        this.restoreUI();
        if (this.timer) this.timer.stop();
        if (this.ribbonContainer) this.ribbonContainer.remove();
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

class StatsModal extends Modal {
    constructor(app, stats) {
        super(app);
        this.stats = stats;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.addClass("focus-stats-modal");
        
        const level = this.stats.getCurrentLevel();
        const totalMinutes = this.stats.getTotalMinutes();
        const totalHours = (totalMinutes / 60).toFixed(1);
        
        contentEl.createEl("h2", { text: `${level.icon} Ваш уровень: ${level.name}`, attr: { style: `color: ${level.color}` } });
        
        const nextLevel = this.stats.getNextLevel();
        if (nextLevel) {
            const progress = this.stats.getProgressToNextLevel();
            contentEl.createEl("p", { text: `До ${nextLevel.name}: ${Math.round(progress)}%` });
            const progressBar = contentEl.createEl("div", { cls: "progress-bar" });
            progressBar.createEl("div", { cls: "progress-fill", attr: { style: `width: ${progress}%` } });
            contentEl.createEl("small", { text: `Всего минут: ${Math.round(totalMinutes)} / ${nextLevel.minMinutes}` });
        }
        
        contentEl.createEl("h3", { text: "📊 Основные показатели" });
        const statsGrid = contentEl.createEl("div", { cls: "stats-grid" });
        statsGrid.createEl("div", { text: `⏱️ Всего часов: ${totalHours}`, cls: "stat-card" });
        statsGrid.createEl("div", { text: `🎯 Сессий: ${this.stats.getTotalSessions()}`, cls: "stat-card" });
        statsGrid.createEl("div", { text: `✅ Завершено: ${this.stats.getCompletedSessions()}`, cls: "stat-card" });
        statsGrid.createEl("div", { text: `📅 Текущая серия: ${this.stats.getStreak()} дней`, cls: "stat-card" });
        
        const achievements = this.stats.getUnlockedAchievements();
        if (achievements.length > 0) {
            contentEl.createEl("h3", { text: "🏅 Достижения" });
            const achDiv = contentEl.createEl("div", { cls: "achievements" });
            for (const ach of achievements) {
                achDiv.createEl("div", { text: `${ach.name} — ${ach.description}`, cls: "achievement" });
            }
        }
        
        const best = this.stats.getBestDay();
        if (best) {
            contentEl.createEl("p", { text: `🏆 Рекордный день: ${best.date} — ${best.minutes} минут` });
        }
    }
    
    onClose() {
        this.contentEl.empty();
    }
}

class NotificationBlocker {
    constructor() {
        this.originalNotify = null;
        this.isActive = false;
        this.blockedCount = 0;
        this.allowedDomains = [
            'obsidian.md',
            'github.com',
            'fonts.googleapis.com'
        ];
    }
    
    activate() {
        if (this.isActive) return;
        
        // Сохраняем оригинальный метод Notice
        if (typeof Notice !== 'undefined' && Notice.prototype.show) {
            this.originalNotify = Notice.prototype.show;
        }
        
        // Переопределяем глобальный Notice
        window.originalNotice = window.Notice;
        window.Notice = class BlockedNotice {
            constructor(message, timeout) {
                // Блокируем все уведомления кроме системных
                if (message && !message.includes('фокус') && !message.includes('Фокус') && !message.includes('Статистика')) {
                    console.log(`[Focus Mode] Уведомление заблокировано: ${message}`);
                    return;
                }
                // Пропускаем только наши уведомления
                return new window.originalNotice(message, timeout);
            }
        };
        
        // Блокируем HTML5 Notifications
        if (this.settings?.blockSystemNotices && window.Notification) {
            this.originalNotification = window.Notification;
            window.Notification = class BlockedNotification {
                constructor(title, options) {
                    console.log(`[Focus Mode] HTML5 уведомление заблокировано: ${title}`);
                    return this;
                }
                static requestPermission() {
                    return Promise.resolve('denied');
                }
            };
            window.Notification.permission = 'denied';
        }
        
        // Добавляем CSS для скрытия уведомлений
        const styleId = 'focus-mode-notification-blocker';
        if (!document.getElementById(styleId)) {
            const style = document.createElement('style');
            style.id = styleId;
            style.textContent = `
                /* Скрываем стандартные уведомления Obsidian */
                .notice-container .notice,
                .mod-notice,
                .notification,
                [class*="notification"] {
                    display: none !important;
                    opacity: 0 !important;
                    visibility: hidden !important;
                }
                
                /* Скрываем плавающие подсказки */
                .tooltip,
                [class*="tooltip"] {
                    display: none !important;
                }
                
                /* Скрываем popup-уведомления */
                .popover,
                .modal-dialog {
                    display: none !important;
                }
            `;
            document.head.appendChild(style);
        }
        
        this.isActive = true;
        console.log('[Focus Mode] Система блокировки уведомлений активирована');
    }
    
    deactivate() {
        if (!this.isActive) return;
        
        // Восстанавливаем оригинальный Notice
        if (this.originalNotify) {
            Notice.prototype.show = this.originalNotify;
        }
        
        // Восстанавливаем глобальный Notice
        if (window.originalNotice) {
            window.Notice = window.originalNotice;
        }
        
        // Восстанавливаем HTML5 Notifications
        if (this.originalNotification) {
            window.Notification = this.originalNotification;
        }
        
        // Удаляем CSS стили
        const style = document.getElementById('focus-mode-notification-blocker');
        if (style) {
            style.remove();
        }
        
        this.isActive = false;
        console.log(`[Focus Mode] Система блокировки уведомлений деактивирована. Заблокировано уведомлений: ${this.blockedCount}`);
        this.blockedCount = 0;
    }
    
    setSettings(settings) {
        this.settings = settings;
    }
}

class RecommendationsModal extends Modal {
    constructor(app, stats) {
        super(app);
        this.stats = stats;
    }
    
    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl("h2", { text: "💡 Персональные рекомендации" });
        
        const totalMinutes = this.stats.getTotalMinutes();
        
        const recList = contentEl.createEl("div", { cls: "recommendations-list" });
        
        if (totalMinutes < 30) {
            recList.createEl("p", { text: "🌟 Начните с малого: 5-10 минут фокуса уже дадут результат!" });
            recList.createEl("p", { text: "📅 Поставьте цель: 3 короткие сессии в день" });
        } else if (totalMinutes < 90) {
            recList.createEl("p", { text: "⚡ Попробуйте технику Pomodoro: 25 минут работы, 5 отдыха" });
            recList.createEl("p", { text: "🎧 Создайте плейлист без слов для концентрации" });
        } else if (totalMinutes < 180) {
            recList.createEl("p", { text: "🔥 Вы уже в зоне! Добавьте физическую активность между сессиями" });
            recList.createEl("p", { text: "📝 Ведите журнал того, на что потратили фокус" });
        } else {
            recList.createEl("p", { text: "💪 Вы мастер! Делитесь опытом с другими" });
            recList.createEl("p", { text: "🧠 Попробуйте ультра-дифокусировку: полное отключение на 15 минут" });
        }
        
        const early = this.stats.getEarlySessions();
        const late = this.stats.getLateSessions();
        if (early > late && early > 0) {
            recList.createEl("p", { text: "🌅 Вы продуктивнее утром. Планируйте сложные задачи на первую половину дня!" });
        } else if (late > early && late > 0) {
            recList.createEl("p", { text: "🦉 Вечер — ваше время. Используйте утро для рутины и планирования." });
        }
        
        const nextLevel = this.stats.getNextLevel();
        if (nextLevel) {
            const need = Math.round(nextLevel.minMinutes - totalMinutes);
            recList.createEl("p", { text: `🎯 До уровня ${nextLevel.name} осталось ${need} минут фокуса. Это примерно ${Math.ceil(need/25)} сессий по 25 минут!` });
        }
        
        contentEl.createEl("hr");
        contentEl.createEl("p", { text: "✨ Помните: каждый день фокуса делает вас лучше на 1%", cls: "motivation" });
    }
    
    onClose() {
        this.contentEl.empty();
    }
}

class FocusSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }
    
    display() {
        const { containerEl } = this;
        containerEl.empty();
        
        containerEl.createEl("h2", { text: "🎯 Focus Mode+ Настройки" });
        
        // Секция: Уведомления
        containerEl.createEl("h3", { text: "🔕 Блокировка уведомлений" });
        
        new Setting(containerEl)
            .setName("Блокировать уведомления Obsidian")
            .setDesc("Отключает  уведомления Obsidian")
            .addToggle(t => t.setValue(this.plugin.settings.blockNotifications)
                .onChange(async (val) => {
                    this.plugin.settings.blockNotifications = val;
                    await this.plugin.saveSettings();
                }));
        
        new Setting(containerEl)
            .setName("Блокировать системные уведомления ОС")
            .setDesc("Требует перезагрузки")
            .addToggle(t => t.setValue(this.plugin.settings.blockSystemNotices)
                .onChange(async (val) => {
                    this.plugin.settings.blockSystemNotices = val;
                    await this.plugin.saveSettings();
                }));
        
        containerEl.createEl("hr");
        
        // Секция: Интерфейс
        containerEl.createEl("h3", { text: "🖥️ Время в режиме фокуса" });
        
        new Setting(containerEl)
            .setName("Длительность фокуса (минуты)")
            .addSlider(slider => slider
                .setLimits(5, 120, 5)
                .setValue(this.plugin.settings.defaultFocusMinutes)
                .setDynamicTooltip()
                .onChange(async (val) => {
                    this.plugin.settings.defaultFocusMinutes = val;
                    await this.plugin.saveSettings();
                }));
        
        containerEl.createEl("hr");
        
        // Секция: UI-ограничения
        containerEl.createEl("h3", { text: "🎨 Ограничения интерфейса в режиме фокуса" });
        
        new Setting(containerEl)
            .setName("Скрывать боковые панели")
            .setDesc("Автоматически сворачивать левую и правую панели")
            .addToggle(t => t.setValue(this.plugin.settings.hideSidebars)
                .onChange(async (val) => {
                    this.plugin.settings.hideSidebars = val;
                    await this.plugin.saveSettings();
                }));
        
        
        containerEl.createEl("hr");
        
        // Секция: Статистика
        if (this.plugin.stats) {
            const level = this.plugin.stats.getCurrentLevel();
            const totalMinutes = this.plugin.stats.getTotalMinutes();
            containerEl.createEl("h3", { text: `🏅 Ваш текущий уровень: ${level.name} ${level.icon}` });
            containerEl.createEl("p", { text: `Всего минут фокуса: ${Math.round(totalMinutes)}` });
            containerEl.createEl("p", { text: level.description, attr: { style: `color: ${level.color}` } });
            
            containerEl.createEl("hr");
        }
        
        new Setting(containerEl)
            .setName("Сбросить статистику")
            .setDesc("ВНИМАНИЕ: это удалит все ваши данные")
            .addButton(btn => btn
                .setButtonText("Сбросить")
                .setWarning()
                .onClick(async () => {
                    if (this.plugin.stats) {
                        this.plugin.stats.data = [];
                        this.plugin.stats.achievements = {};
                        await this.plugin.saveStats();
                        new Notice("Статистика сброшена");
                        this.display();
                    }
                }));
    }
}