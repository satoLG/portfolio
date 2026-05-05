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
        'settings.nature': 'Nature',
        'settings.music': 'Music',
        'settings.interface': 'Interface',
        'settings.character': 'Pug',

        // Graphics settings
        'settings.quality': 'Quality',
        'settings.preset': 'Preset',
        'settings.low': 'Low',
        'settings.custom': 'Custom',
        'settings.high': 'High',
        'settings.antialias': 'Antialias',
        'settings.shadows': 'Shadows',
        'settings.segments': 'Ocean Mesh',
        'settings.foam': 'Foam',
        'settings.bubbles': 'Bubbles',
        'settings.reflection': 'Ocean Reflection',
        'settings.off': 'Off',

        // Misc settings
        'settings.pixelation': 'Pixelation',
        'settings.none': 'None',
        'settings.medium': 'Medium',
        'settings.colorFilter': 'Color Filter',
        'settings.bw': 'B&W',
        'settings.sepia': 'Sepia',
        'settings.freeRoam': 'Free Roam Camera',

        // Button titles / tooltips
        'tooltip.toggleTheme': 'Toggle theme',
        'tooltip.settings': 'Settings',
        'tooltip.reflectionWarning': 'Ocean reflection renders the entire scene a second time each frame from a mirrored camera. This roughly doubles GPU cost and can heavily impact performance, especially on mobile. Disabled by default.',
        'tooltip.dive': 'Dive underwater',
        'tooltip.surface': 'Surface',

        // Confirm modal
        'modal.cancel': 'Cancel',
        'modal.confirm': 'Confirm',

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

        // Pug dialog
        'pug.dialog.0': 'woof woof.',
        'pug.dialog.1': 'woof woof...',

        // Pug night dialog
        'pug.night.0': 'ZzZzZz...',
        'pug.night.1': 'ZzZzZz...',

        // Pug reply options
        'pug.reply.hi':  'hi',
        'pug.reply.bye': 'bye',

        // Pug responses to reply
        'pug.reply.response.hi.day':   'what?',
        'pug.reply.response.hi.night': 'ZzZzZzZzZzz...',

        // Day dialog tree — after "hi" reply
        'pug.day.opa':         'hey...',
        'pug.day.whatsup':     "what's up?",

        // Second-level reply options
        'pug.reply.thisplace': 'what is this place?',
        'pug.reply.youtalk':   'you talk??',

        // Response to "you talk?"
        'pug.reply.response.youtalk': 'woof woof',

        // Place description sequence
        'pug.day.place.0': "it's a place where we can isolate ourselves a bit from the world",
        'pug.day.place.1': 'you can just close your eyes and listen to the sound of the wild',
        'pug.day.place.2': 'my family loves this place, especially Leo',
        'pug.day.place.3': "my name is Bartô, by the way",

        // Third-level reply options
        'pug.reply.likeit': 'I like it here, Bartô',
        'pug.reply.wholeo':  "who's Leo?",

        // Response to "I like it here"
        'pug.reply.response.likeit': 'glad to hear it, enjoy the view!',

        // Leo description sequence
        'pug.day.leo.0': "well.. he's the guy who gives me water, food and brought me here for a walk",
        'pug.day.leo.1': 'he also does other stuff in his free time, like these... let me show you on my phone',
    },

    'pt-br': {
        // Settings tabs
        'tab.audio': 'Áudio',
        'tab.graphics': 'Gráficos',
        'tab.misc': 'Outros',
        'tab.language': 'Idioma',

        // Audio settings
        'settings.nature': 'Natureza',
        'settings.music': 'Música',
        'settings.interface': 'Interface',
        'settings.character': 'Pug',

        // Graphics settings
        'settings.quality': 'Qualidade',
        'settings.preset': 'Predefinição',
        'settings.low': 'Baixo',
        'settings.custom': 'Personalizado',
        'settings.high': 'Alto',
        'settings.antialias': 'Antialias',
        'settings.shadows': 'Sombras',
        'settings.segments': 'Malha do Oceano',
        'settings.foam': 'Espuma',
        'settings.bubbles': 'Bolhas',
        'settings.reflection': 'Reflexo do Oceano',
        'settings.off': 'Desligado',

        // Misc settings
        'settings.pixelation': 'Pixelização',
        'settings.none': 'Nenhum',
        'settings.medium': 'Médio',
        'settings.colorFilter': 'Filtro de Cor',
        'settings.bw': 'P&B',
        'settings.sepia': 'Sépia',
        'settings.freeRoam': 'Câmera Livre',

        // Button titles / tooltips
        'tooltip.toggleTheme': 'Alternar tema',
        'tooltip.settings': 'Configurações',
        'tooltip.reflectionWarning': 'O reflexo do oceano renderiza a cena inteira uma segunda vez por frame a partir de uma câmera espelhada. Isso praticamente dobra o custo de GPU e pode impactar bastante o desempenho, especialmente em dispositivos móveis. Desativado por padrão.',
        'tooltip.dive': 'Mergulhar',
        'tooltip.surface': 'Voltar à superfície',

        // Confirm modal
        'modal.cancel': 'Cancelar',
        'modal.confirm': 'Confirmar',

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

        // Diálogo do pug
        'pug.dialog.0': 'au au.',
        'pug.dialog.1': 'au au...',

        // Diálogo do pug de noite
        'pug.night.0': 'ZzZzZz...',
        'pug.night.1': 'ZzZzZz...',

        // Opções de resposta do pug
        'pug.reply.hi':  'oi',
        'pug.reply.bye': 'tchau',

        // Respostas do pug às escolhas
        'pug.reply.response.hi.day':   'que foi ?',
        'pug.reply.response.hi.night': 'ZzZzZzZzZzz...',

        // Árvore de diálogo do dia — após resposta "oi"
        'pug.day.opa':         'opa...',
        'pug.day.whatsup':     'qual a boa ?',

        // Opções de resposta nível 2
        'pug.reply.thisplace': 'que lugar é esse ?',
        'pug.reply.youtalk':   'você fala ??',

        // Resposta a "você fala?"
        'pug.reply.response.youtalk': 'au au',

        // Sequência descrição do lugar
        'pug.day.place.0': 'é um lugar onde podemos nos isolar um pouco do mundo',
        'pug.day.place.1': 'você pode só fechar os olhos e ouvir o som da natureza',
        'pug.day.place.2': 'minha família gosta muito deste lugar, principalmente o Leo',
        'pug.day.place.3': 'meu nome é Bartô, a propósito',

        // Opções de resposta nível 3
        'pug.reply.likeit': 'gostei daqui, Bartô',
        'pug.reply.wholeo':  'quem é Leo ?',

        // Resposta a "gostei daqui"
        'pug.reply.response.likeit': 'fico feliz, aproveite a vista!',

        // Sequência descrição do Leo
        'pug.day.leo.0': 'bom.. é o cara que me dá água, comida e me trouxe pra passear aqui',
        'pug.day.leo.1': 'ele faz outras coisas também no tempo livre, tipo essas aqui... deixa eu mostrar no meu celular',
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
