/**
 * CarouselContent.ts — the content behind the underwater tab carousel.
 *
 * CardCarousel.ts owns the geometry, punch masks and animation; this file owns
 * nothing but data, so copy edits never touch the rendering code.
 *
 * Layout is computed at runtime (text is measured and wrapped against the real
 * card width), so `body` / `heading` are written as plain sentences here — no
 * manual line breaks.
 */

export type TabId = 'experiencia' | 'projetos' | 'estudos';

export interface TabDef {
    id: TabId;
    label: string;
}

/** The three floating titles, left → right. */
export const TABS: TabDef[] = [
    { id: 'experiencia', label: 'Experiência' },
    { id: 'projetos', label: 'Projetos' },
    { id: 'estudos', label: 'Estudos' },
];

/**
 * A chronological entry — shared by Experiência and Estudos.
 * Visual weight, top to bottom: heading (loudest) → subheading → period →
 * divider → body.
 */
export interface EntryCard {
    kind: 'entry';
    /** Company (Experiência) or institution / certificate issuer (Estudos). */
    heading: string;
    /** Role (Experiência) or course / certificate subject (Estudos). */
    subheading: string;
    /** e.g. "jan 2023 — dez 2024" */
    period: string;
    /** Two SHORT sentences at most — the card is deliberately terse. */
    body: string;
}

export interface ProjectCard {
    kind: 'project';
    name: string;
    /** Icon shown to the left of the name (path under /public). */
    icon: string;
    body: string;
    /** Screenshot for the card's image section (path under /public). */
    shot: string;
    /** Opened in a new tab by the card's button. */
    url: string;
    cta: string;
}

export type CardData = EntryCard | ProjectCard;

// ─── EXPERIÊNCIA ─────────────────────────────────────────────────────────────
// TODO(content): placeholder scaffolding — LinkedIn blocks automated reads
// (HTTP 403 without a session), so these are template rows, NOT real history.
// Replace with the real entries, most recent first.

export const EXPERIENCE: EntryCard[] = [
    {
        kind: 'entry',
        heading: 'Empresa 3',
        subheading: 'Cargo',
        period: '2024 — atual',
        body: 'Primeira frase curta sobre a experiência. Segunda frase curta.',
    },
    {
        kind: 'entry',
        heading: 'Empresa 2',
        subheading: 'Cargo',
        period: '2022 — 2024',
        body: 'Primeira frase curta sobre a experiência. Segunda frase curta.',
    },
    {
        kind: 'entry',
        heading: 'Empresa 1',
        subheading: 'Cargo',
        period: '2020 — 2022',
        body: 'Primeira frase curta sobre a experiência. Segunda frase curta.',
    },
];

// ─── PROJETOS ────────────────────────────────────────────────────────────────
// Mirrors satoLG/projects_hub → src/data/projects.ts. Icons and screenshots were
// lifted from that repo's public/img and re-encoded to webp under
// public/images/projects/.

export const PROJECTS: ProjectCard[] = [
    {
        kind: 'project',
        name: 'Biscoidino',
        icon: '/images/projects/biscoidino-icon.webp',
        shot: '/images/projects/biscoidino-shot.webp',
        body: 'Site oficial da Biscoidino, uma loja de biscoitos artesanais de família. Vitrine dos produtos e a história da marca.',
        url: 'https://www.biscoidino.com.br',
        cta: 'VISITAR SITE',
    },
    {
        kind: 'project',
        name: 'City of God Flight',
        icon: '/images/projects/city-of-god-flight-icon.webp',
        shot: '/images/projects/city-of-god-flight-shot.webp',
        body: 'Jogo de voo side-scrolling sobre os telhados da cidade. Desvie dos obstáculos e ganhe altitude nesse arcade acelerado.',
        url: 'https://satolg.github.io/city_of_god_flight/',
        cta: 'VISITAR SITE',
    },
    {
        kind: 'project',
        name: 'Trystero Walking Trainer',
        icon: '/images/projects/trystero-walking-trainer-icon.webp',
        shot: '/images/projects/trystero-walking-trainer-shot.webp',
        body: 'Versão multiplayer do Walking Pokémon Trainer, com conexão peer-to-peer via Trystero. Caminhe junto com amigos em tempo real.',
        url: 'https://satolg.github.io/trystero_walking_pkmn_trainer/',
        cta: 'VISITAR SITE',
    },
    {
        kind: 'project',
        name: 'Trystero 3D Lab',
        icon: '/images/projects/trystero-3d-lab-icon.webp',
        shot: '/images/projects/trystero-3d-lab-shot.webp',
        body: 'Sandbox 3D multiplayer em tempo real feito com Three.js e Trystero. Manipule objetos e interaja com outros usuários no mesmo espaço.',
        url: 'https://satolg.github.io/trystero_3d_lab/',
        cta: 'VISITAR SITE',
    },
];

// ─── ESTUDOS ─────────────────────────────────────────────────────────────────
// TODO(content): same placeholder note as EXPERIENCE — formações acadêmicas
// first, then the 5 most recent LinkedIn certificates.

export const STUDIES: EntryCard[] = [
    {
        kind: 'entry',
        heading: 'Instituição',
        subheading: 'Curso / formação',
        period: '2018 — 2022',
        body: 'Uma frase curta sobre a formação.',
    },
    {
        kind: 'entry',
        heading: 'Emissor do certificado',
        subheading: 'Assunto do certificado',
        period: '2025',
        body: '',
    },
    {
        kind: 'entry',
        heading: 'Emissor do certificado',
        subheading: 'Assunto do certificado',
        period: '2025',
        body: '',
    },
    {
        kind: 'entry',
        heading: 'Emissor do certificado',
        subheading: 'Assunto do certificado',
        period: '2024',
        body: '',
    },
    {
        kind: 'entry',
        heading: 'Emissor do certificado',
        subheading: 'Assunto do certificado',
        period: '2024',
        body: '',
    },
    {
        kind: 'entry',
        heading: 'Emissor do certificado',
        subheading: 'Assunto do certificado',
        period: '2023',
        body: '',
    },
];

export const TAB_CARDS: Record<TabId, CardData[]> = {
    experiencia: EXPERIENCE,
    projetos: PROJECTS,
    estudos: STUDIES,
};

/** Slot count the carousel must allocate up front. */
export const MAX_CARDS = Math.max(...TABS.map(t => TAB_CARDS[t.id].length));
