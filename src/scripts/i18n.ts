// ============================================
// INTERNATIONALIZATION (i18n)
// ============================================

const LANGUAGE_STORAGE_KEY = 'portfolio-language';

export type Language = 'en-us' | 'pt-br';

type TranslationDict = Record<string, string>;

const translations: Record<Language, TranslationDict> = {
    'en-us': {
        // Settings tabs
        'tab.audio': 'Audio',
        'tab.graphics': 'Graphics',
        'tab.misc': 'Misc',
        'tab.language': 'Language',

        // Audio settings
        'settings.audioMode': 'Audio Mode',
        'settings.webAudioApi': 'Web Audio API',
        'settings.audioTag': 'Audio Tag',
        'settings.nature': 'Nature',
        'settings.music': 'Music',
        'settings.interface': 'Interface',

        // Graphics settings
        'settings.preset': 'Preset',
        'settings.low': 'Low',
        'settings.custom': 'Custom',
        'settings.high': 'High',
        'settings.antialias': 'Antialias',
        'settings.shadows': 'Shadows',

        // Misc settings
        'settings.pixelation': 'Pixelation',
        'settings.none': 'None',
        'settings.medium': 'Medium',

        // Button titles / tooltips
        'tooltip.toggleTheme': 'Toggle theme',
        'tooltip.settings': 'Settings',
        'tooltip.dive': 'Dive underwater',
        'tooltip.surface': 'Surface',

        // Confirm modal
        'modal.cancel': 'Cancel',
        'modal.confirm': 'Confirm',

        // Audio mode modal
        'modal.changeAudioMode': 'Change Audio Mode',
        'modal.webAudioApiDesc': 'Web Audio API mode provides superior sound quality and reliability, especially on mobile devices. Audio plays exclusively within the site — no background playback or media controls. The page will reload to apply this change.',
        'modal.audioTagDesc': 'Audio Tag mode uses standard HTML5 audio elements with background playback support and OS media controls integration. Audio quality may vary on some devices. The page will reload to apply this change.',

        // Preset modal
        'modal.switchToLow': 'Switch to Low Preset',
        'modal.switchToHigh': 'Switch to High Preset',
        'modal.presetLowDesc': 'This will disable antialias and disable shadows. Antialias changes require a page reload.',
        'modal.presetHighDesc': 'This will enable antialias and enable shadows. Antialias changes require a page reload.',

        // Antialias modal
        'modal.enableAntialias': 'Enable Antialias',
        'modal.disableAntialias': 'Disable Antialias',
        'modal.antialiasDesc': 'Changing antialias requires a page reload to take effect. Antialias smooths jagged edges but may impact performance on some devices.',

        // Media player
        'player.showPlaylist': 'Show playlist',
        'player.minimize': 'Minimize',
        'player.previous': 'Previous',
        'player.play': 'Play',
        'player.next': 'Next',
        'player.loop': 'Loop',
        'player.playlist': 'Playlist',
        'player.songs': 'songs',
    },

    'pt-br': {
        // Settings tabs
        'tab.audio': 'Áudio',
        'tab.graphics': 'Gráficos',
        'tab.misc': 'Outros',
        'tab.language': 'Idioma',

        // Audio settings
        'settings.audioMode': 'Modo de Áudio',
        'settings.webAudioApi': 'Web Audio API',
        'settings.audioTag': 'Audio Tag',
        'settings.nature': 'Natureza',
        'settings.music': 'Música',
        'settings.interface': 'Interface',

        // Graphics settings
        'settings.preset': 'Predefinição',
        'settings.low': 'Baixo',
        'settings.custom': 'Personalizado',
        'settings.high': 'Alto',
        'settings.antialias': 'Antialias',
        'settings.shadows': 'Sombras',

        // Misc settings
        'settings.pixelation': 'Pixelização',
        'settings.none': 'Nenhum',
        'settings.medium': 'Médio',

        // Button titles / tooltips
        'tooltip.toggleTheme': 'Alternar tema',
        'tooltip.settings': 'Configurações',
        'tooltip.dive': 'Mergulhar',
        'tooltip.surface': 'Voltar à superfície',

        // Confirm modal
        'modal.cancel': 'Cancelar',
        'modal.confirm': 'Confirmar',

        // Audio mode modal
        'modal.changeAudioMode': 'Alterar Modo de Áudio',
        'modal.webAudioApiDesc': 'O modo Web Audio API oferece qualidade de som superior e maior confiabilidade, especialmente em dispositivos móveis. O áudio é reproduzido exclusivamente no site — sem reprodução em segundo plano ou controles de mídia. A página será recarregada para aplicar esta alteração.',
        'modal.audioTagDesc': 'O modo Audio Tag utiliza elementos de áudio HTML5 padrão com suporte a reprodução em segundo plano e integração com controles de mídia do sistema. A qualidade do áudio pode variar em alguns dispositivos. A página será recarregada para aplicar esta alteração.',

        // Preset modal
        'modal.switchToLow': 'Mudar para Predefinição Baixa',
        'modal.switchToHigh': 'Mudar para Predefinição Alta',
        'modal.presetLowDesc': 'Isso irá desativar o antialias e as sombras. Alterações no antialias requerem recarregamento da página.',
        'modal.presetHighDesc': 'Isso irá ativar o antialias e as sombras. Alterações no antialias requerem recarregamento da página.',

        // Antialias modal
        'modal.enableAntialias': 'Ativar Antialias',
        'modal.disableAntialias': 'Desativar Antialias',
        'modal.antialiasDesc': 'Alterar o antialias requer recarregamento da página. O antialias suaviza bordas serrilhadas, mas pode impactar o desempenho em alguns dispositivos.',

        // Media player
        'player.showPlaylist': 'Mostrar playlist',
        'player.minimize': 'Minimizar',
        'player.previous': 'Anterior',
        'player.play': 'Reproduzir',
        'player.next': 'Próxima',
        'player.loop': 'Repetir',
        'player.playlist': 'Playlist',
        'player.songs': 'músicas',
    }
};

let currentLanguage: Language = (localStorage.getItem(LANGUAGE_STORAGE_KEY) as Language) || 'en-us';

const changeListeners: Array<(lang: Language) => void> = [];

/** Get the current active language */
export function getCurrentLanguage(): Language {
    return currentLanguage;
}

/** Translate a key to the current language */
export function t(key: string): string {
    return translations[currentLanguage]?.[key] ?? translations['en-us']?.[key] ?? key;
}

/** Register a callback to be invoked whenever the language changes */
export function onLanguageChange(cb: (lang: Language) => void): void {
    changeListeners.push(cb);
}

/** Set the active language and update all translated elements in the DOM */
export function setLanguage(lang: Language): void {
    currentLanguage = lang;
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
    applyTranslations();
    changeListeners.forEach(cb => cb(lang));
}

/** Walk all elements with [data-i18n] and update their text content */
export function applyTranslations(): void {
    // Update textContent of elements with data-i18n
    document.querySelectorAll<HTMLElement>('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n')!;
        el.textContent = t(key);
    });

    // Update title/tooltip of elements with data-i18n-title
    document.querySelectorAll<HTMLElement>('[data-i18n-title]').forEach(el => {
        const key = el.getAttribute('data-i18n-title')!;
        el.title = t(key);
    });

    // Update placeholder of elements with data-i18n-placeholder
    document.querySelectorAll<HTMLInputElement>('[data-i18n-placeholder]').forEach(el => {
        const key = el.getAttribute('data-i18n-placeholder')!;
        el.placeholder = t(key);
    });
}
