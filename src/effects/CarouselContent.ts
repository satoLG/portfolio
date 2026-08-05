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
    /** Optional logo (path under /public). Drop a file in and it replaces the
     *  monogram with no code change — see `mono`. */
    icon?: string;
    /** Letters shown in the icon square while there is no logo file. Defaults to
     *  the heading's first letter. Company and school logos are trademarks we
     *  do not ship, so the monogram is the standing default, not a placeholder
     *  waiting to be filled. */
    mono?: string;
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
// Reverse-chronological (most recent first), as on the LinkedIn profile.

export const EXPERIENCE: EntryCard[] = [
    {
        kind: 'entry',
        heading: 'Bradesco',
        subheading: 'Desenvolvedor de software pleno',
        mono: 'B',
        period: 'mai. 2022 — atual',
        body: 'Aplicações web em Python — Django, FastAPI e pandas — com front-end em HTML, CSS e JavaScript. SQL Server, Redis e Docker na infraestrutura.',
    },
    {
        kind: 'entry',
        heading: 'TEx',
        subheading: 'Desenvolvedor de software sênior',
        mono: 'TX',
        period: 'out. 2020 — abr. 2022',
        body: 'Liderança técnica da equipe de inovações. Micro serviços em Python com Flask, Nameko e Tornado, sobre MongoDB, Redis e Docker.',
    },
    {
        kind: 'entry',
        heading: 'TEx',
        subheading: 'Desenvolvedor de software pleno',
        mono: 'TX',
        period: 'mai. 2019 — set. 2020',
        body: 'Aplicação web e web services em Delphi, com JavaScript e MySQL. Também na ferramenta de OCR.',
    },
    {
        kind: 'entry',
        heading: 'TEx',
        subheading: 'Desenvolvedor de software júnior',
        mono: 'TX',
        period: 'abr. 2017 — abr. 2019',
        body: 'Aplicação web em Delphi, com JavaScript e MySQL. Manutenção da ferramenta de OCR.',
    },
    {
        kind: 'entry',
        heading: 'IFSP',
        subheading: 'Monitor de curso — Análise e Desenvolvimento de Sistemas',
        mono: 'IF',
        period: 'set. 2015 — dez. 2015',
        body: 'Apoio aos alunos do primeiro semestre do curso. Dúvidas de lógica de programação, arquitetura de computadores e matemática discreta.',
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
// Formações acadêmicas first, then the certificates (most recent first). Same
// rule as EXPERIENCE for what goes where: heading = who issued it, subheading =
// what it was. `body` stays empty — these cards are subject + period only, so
// buildEntryLayout closes the card right after the divider.
//
// NOTE: only 3 certificates were listed on the profile at the time of writing.
// Adding more is just another entry at the top of the certificate run.

export const STUDIES: EntryCard[] = [
    {
        kind: 'entry',
        heading: 'Faculdade Impacta Tecnologia',
        mono: 'FI',
        subheading: 'Pós-graduação — Engenharia de Software',
        period: '2017 — 2018',
        body: '',
    },
    {
        kind: 'entry',
        heading: 'IFSP',
        mono: 'IF',
        subheading: 'Graduação — Tecnologia em Análise e Desenvolvimento de Sistemas',
        period: '2014 — 2016',
        body: '',
    },
    {
        kind: 'entry',
        heading: 'Alura',
        mono: 'A',
        subheading: 'NumPy: análise numérica eficiente com Python',
        period: 'ago. 2024',
        body: '',
    },
    {
        kind: 'entry',
        heading: 'Impacta Tecnologia',
        mono: 'IT',
        subheading: 'SQL 2019 — Módulo II',
        period: 'jan. 2024',
        body: '',
    },
    {
        kind: 'entry',
        heading: 'Alura',
        mono: 'A',
        subheading: 'Expressões regulares: capturando textos de forma mágica',
        period: 'out. 2022',
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
