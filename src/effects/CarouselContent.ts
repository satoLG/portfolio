/**
 * CarouselContent.ts — the content behind the underwater tab carousel.
 *
 * CardCarousel.ts owns the geometry, punch masks and animation; this file owns
 * nothing but data, so copy edits never touch the rendering code.
 *
 * Layout is computed at runtime (text is measured and wrapped against the real
 * card width), so `body` / `subheading` are written as plain sentences here — no
 * manual line breaks.
 *
 * TRANSLATION. Every string a reader parses as language is a `Localized` pair
 * and flips with the site's language switch. PROPER NOUNS DO NOT: company and
 * school names (`heading`) and product names (`name`) are plain strings,
 * because "IFSP" and "Biscoidino" are what those things are called in any
 * language. CardCarousel rebuilds the cards on the language change, so the
 * wrapping and the punch masks are re-measured against the new copy.
 *
 * ORDER. Both timelines run MOST RECENT FIRST, because the carousel lays cards
 * out left to right in array order and opens parked at its left end — so the
 * present is what you land on and the past is what you pan towards.
 */

import { getCurrentLanguage } from '../core/i18n';

// ─── Localisation ────────────────────────────────────────────────────────────

/** A string in both site languages. */
export interface Localized {
    pt: string;
    en: string;
}

export function loc(pt: string, en: string): Localized {
    return { pt, en };
}

/** Resolve against the active language. A plain string passes straight through
 *  — that is how a proper noun with no translation is written. */
export function text(v: Localized | string): string {
    if (typeof v === 'string') return v;
    return getCurrentLanguage() === 'pt-br' ? v.pt : v.en;
}

// ─── Tabs ────────────────────────────────────────────────────────────────────

export type TabId = 'experiencia' | 'projetos' | 'estudos';

export interface TabDef {
    id: TabId;
    label: Localized;
}

/** The three floating titles, left → right. */
export const TABS: TabDef[] = [
    { id: 'experiencia', label: loc('Experiência', 'Experience') },
    { id: 'projetos', label: loc('Projetos', 'Projects') },
    { id: 'estudos', label: loc('Estudos', 'Studies') },
];

// ─── Card shapes ─────────────────────────────────────────────────────────────

/**
 * A chronological entry — shared by Experiência and Estudos.
 * Visual weight, top to bottom: heading (loudest) → subheading → period →
 * divider → tech tags / body.
 */
export interface EntryCard {
    kind: 'entry';
    /** Company (Experiência) or institution / certificate issuer (Estudos).
     *  A proper noun — NEVER translated. */
    heading: string;
    /** Estudos only: what KIND of study this is — Graduação, Pós-graduação,
     *  Curso. Rendered as its own tag above the title, louder than the title
     *  itself, so a course never reads as a degree at a glance. */
    credential?: Localized;
    /** Role (Experiência) or course / degree subject (Estudos). */
    subheading: Localized;
    /** e.g. "jan. 2023 — dez. 2024" */
    period: Localized;
    /** Two SHORT sentences at most — the card is deliberately terse. */
    body: Localized;
    /** Experiência only: the stack, as slugs into public/images/tech (written
     *  by scripts/generate-tech-icons.cjs). Rendered as a row of brand-coloured
     *  glyphs between the header and the description. */
    tech?: string[];
    /** Logo (path under /public), shown in the card's icon square. */
    icon?: string;
    /** Fallback letters for the icon square when there is no logo file.
     *  Defaults to the heading's first letter. */
    mono?: string;
    /** Credential / certificate page. When set, the card ends with a link to it
     *  and the description stacks above. */
    url?: string;
    /** Link label. Defaults to "VER CERTIFICADO" / "VIEW CERTIFICATE". */
    cta?: Localized;
}

export interface ProjectCard {
    kind: 'project';
    /** Product name. A plain string for the ones that have a single name in any
     *  language; a Localized pair only where THE PRODUCT ITSELF ships one — the
     *  card follows what the thing calls itself, it does not invent a
     *  translation. */
    name: string | Localized;
    /** Icon shown to the left of the name (path under /public). */
    icon: string;
    body: Localized;
    /** Screenshot for the card's image section (path under /public). */
    shot: string;
    /** Opened in a new tab by the card's button. */
    url: string;
    cta: Localized;
}

export type CardData = EntryCard | ProjectCard;

export const DEFAULT_CERT_CTA = loc('VER CERTIFICADO', 'VIEW CERTIFICATE');
const VISIT_SITE = loc('VISITAR SITE', 'VISIT SITE');

// ─── EXPERIÊNCIA ─────────────────────────────────────────────────────────────
// MOST RECENT FIRST — see the ORDER note at the top of the file.
//
// Logos live in public/images/logos/ (192px webp). They are square, full-bleed
// brand tiles carrying their own backgrounds, so the icon slot renders them edge
// to edge (.oc-logo) instead of letterboxing them the way the project icons —
// loose marks on transparency — need (.oc-icon).
//
// `tech` only lists technologies that HAVE a glyph. SQL Server is deliberately
// absent from Bradesco's row: simple-icons dropped the mark over trademark
// policy, so there is nothing to draw. It stays named in the body copy.

export const EXPERIENCE: EntryCard[] = [
    {
        kind: 'entry',
        heading: 'Bradesco',
        subheading: loc('Desenvolvedor de software pleno', 'Mid-level software developer'),
        mono: 'B', icon: '/images/logos/bradesco.webp',
        period: loc('mai. 2022 — atual', 'May 2022 — present'),
        body: loc(
            'Aplicações web em Python — Django, FastAPI e pandas — com front-end em HTML, CSS e JavaScript. SQL Server, Redis e Docker na infraestrutura.',
            'Web applications in Python — Django, FastAPI and pandas — with an HTML, CSS and JavaScript front-end. SQL Server, Redis and Docker in the infrastructure.',
        ),
        tech: ['python', 'django', 'fastapi', 'pandas', 'html5', 'css', 'javascript', 'redis', 'docker'],
    },
    {
        kind: 'entry',
        heading: 'TEx',
        subheading: loc('Desenvolvedor de software sênior', 'Senior software developer'),
        mono: 'TX', icon: '/images/logos/tex.webp',
        period: loc('out. 2020 — abr. 2022', 'Oct 2020 — Apr 2022'),
        body: loc(
            'Liderança técnica da equipe de inovações. Micro serviços em Python com Flask, Nameko e Tornado, sobre MongoDB, Redis e Docker.',
            'Tech lead of the innovation team. Microservices in Python with Flask, Nameko and Tornado, over MongoDB, Redis and Docker.',
        ),
        tech: ['python', 'flask', 'mongodb', 'redis', 'docker'],
    },
    {
        kind: 'entry',
        heading: 'TEx',
        subheading: loc('Desenvolvedor de software pleno', 'Mid-level software developer'),
        mono: 'TX', icon: '/images/logos/tex.webp',
        period: loc('mai. 2019 — set. 2020', 'May 2019 — Sep 2020'),
        body: loc(
            'Aplicação web e web services em Delphi, com JavaScript e MySQL. Também na ferramenta de OCR.',
            'Web application and web services in Delphi, with JavaScript and MySQL. Also on the OCR tool.',
        ),
        tech: ['delphi', 'javascript', 'mysql'],
    },
    {
        kind: 'entry',
        heading: 'TEx',
        subheading: loc('Desenvolvedor de software júnior', 'Junior software developer'),
        mono: 'TX', icon: '/images/logos/tex.webp',
        period: loc('abr. 2017 — abr. 2019', 'Apr 2017 — Apr 2019'),
        body: loc(
            'Aplicação web em Delphi, com JavaScript e MySQL. Manutenção da ferramenta de OCR.',
            'Web application in Delphi, with JavaScript and MySQL. Maintenance of the OCR tool.',
        ),
        tech: ['delphi', 'javascript', 'mysql'],
    },
    {
        kind: 'entry',
        heading: 'IFSP',
        subheading: loc(
            'Monitor de curso — Análise e Desenvolvimento de Sistemas',
            'Course monitor — Systems Analysis and Development',
        ),
        mono: 'IF', icon: '/images/logos/ifsp.webp',
        period: loc('set. 2015 — dez. 2015', 'Sep 2015 — Dec 2015'),
        body: loc(
            'Apoio aos alunos do primeiro semestre do curso. Dúvidas de lógica de programação, arquitetura de computadores e matemática discreta.',
            'Support for first-semester students: programming logic, computer architecture and discrete mathematics.',
        ),
    },
];

// ─── PROJETOS ────────────────────────────────────────────────────────────────
// Mirrors satoLG/projects_hub → src/data/projects.ts. Icons and screenshots were
// lifted from that repo's public/img and re-encoded to webp under
// public/images/projects/ — except Defend the Crystal, whose card art is its own
// crystal logo and a capture of its start screen.

export const PROJECTS: ProjectCard[] = [
    {
        kind: 'project',
        // The game ships its own name in both languages (apps/web/src/i18n.js,
        // brand.title), so the card uses the game's, not a translation of mine.
        name: loc('Defenda o Cristal', 'Defend the Crystal'),
        // The favicon the game declares (index.html → ./img/crystal-logo.png)
        // and a capture of its start screen, both taken from the repo itself.
        icon: '/images/projects/defend-the-crystal-icon.webp',
        shot: '/images/projects/defend-the-crystal-shot.webp',
        // English is the repo's own meta description, trimmed to the card's line
        // budget. Portuguese follows the game's own PT vocabulary.
        body: loc(
            'Tower defense 3D cooperativo no navegador. Escolha uma classe, monte um labirinto de torres e segure as ondas de monstros com até 4 amigos.',
            'Free co-op 3D tower defense in your browser. Pick a class, build a maze of towers, and fend off monster waves with up to 4 friends.',
        ),
        url: 'https://defend-the-crystal.vercel.app/',
        cta: VISIT_SITE,
    },
    {
        kind: 'project',
        name: 'Biscoidino',
        icon: '/images/projects/biscoidino-icon.webp',
        shot: '/images/projects/biscoidino-shot.webp',
        body: loc(
            'Site oficial da Biscoidino, uma loja de biscoitos artesanais de família. Vitrine dos produtos e a história da marca.',
            'Official site for Biscoidino, a family-run artisanal cookie shop. A showcase of the products and the story behind the brand.',
        ),
        url: 'https://www.biscoidino.com.br',
        cta: VISIT_SITE,
    },
    {
        kind: 'project',
        name: 'City of God Flight',
        icon: '/images/projects/city-of-god-flight-icon.webp',
        shot: '/images/projects/city-of-god-flight-shot.webp',
        body: loc(
            'Jogo de voo side-scrolling sobre os telhados da cidade. Desvie dos obstáculos e ganhe altitude nesse arcade acelerado.',
            'Side-scrolling flight game over the city rooftops. Dodge the obstacles and gain altitude in this fast-paced arcade.',
        ),
        url: 'https://satolg.github.io/city_of_god_flight/',
        cta: VISIT_SITE,
    },
    {
        kind: 'project',
        name: 'Walking Trainer',
        icon: '/images/projects/trystero-walking-trainer-icon.webp',
        shot: '/images/projects/trystero-walking-trainer-shot.webp',
        body: loc(
            'Versão multiplayer do Walking Pokémon Trainer, com conexão peer-to-peer via Trystero. Caminhe junto com amigos em tempo real.',
            'Multiplayer take on Walking Pokémon Trainer, peer-to-peer over Trystero. Walk alongside friends in real time.',
        ),
        url: 'https://satolg.github.io/trystero_walking_pkmn_trainer/',
        cta: VISIT_SITE,
    },
];

// ─── ESTUDOS ─────────────────────────────────────────────────────────────────
// DEGREES FIRST, then courses — a graduação outranks a certificate no matter
// when each happened, so the two groups never interleave. WITHIN each group the
// order is chronological, most recent first, same as EXPERIENCE.
//
// `credential` carries the kind (Graduação / Pós-graduação / Curso) as its own
// tag, so `subheading` is just the subject.

export const STUDIES: EntryCard[] = [
    {
        kind: 'entry',
        heading: 'Faculdade Impacta Tecnologia',
        credential: loc('Pós-graduação', 'Postgraduate'),
        subheading: loc('Engenharia de Software', 'Software Engineering'),
        mono: 'FI', icon: '/images/logos/impacta.webp',
        period: loc('2017 — 2018', '2017 — 2018'),
        body: loc('', ''),
    },
    {
        kind: 'entry',
        heading: 'IFSP',
        credential: loc('Graduação', 'Undergraduate'),
        subheading: loc(
            'Tecnologia em Análise e Desenvolvimento de Sistemas',
            'Technology in Systems Analysis and Development',
        ),
        mono: 'IF', icon: '/images/logos/ifsp.webp',
        period: loc('2014 — 2016', '2014 — 2016'),
        body: loc('', ''),
    },
    {
        kind: 'entry',
        heading: 'Alura',
        credential: loc('Curso', 'Course'),
        subheading: loc(
            'NumPy: análise numérica eficiente com Python',
            'NumPy: efficient numerical analysis with Python',
        ),
        mono: 'A', icon: '/images/logos/alura.webp',
        period: loc('ago. 2024', 'Aug 2024'),
        body: loc('', ''),
        url: 'https://cursos.alura.com.br/certificate/3ef9832b-05e4-4fd6-96a8-174c728ba27e',
    },
    {
        kind: 'entry',
        heading: 'Impacta Tecnologia',
        credential: loc('Curso', 'Course'),
        subheading: loc('SQL 2019, Módulo II', 'SQL 2019, Module II'),
        mono: 'IT', icon: '/images/logos/impacta.webp',
        period: loc('jan. 2024', 'Jan 2024'),
        body: loc('', ''),
        url: 'https://www.impacta.com.br/certificado/a3NBRzE5bUUvOTVHTXdjaWlZaWFnZz09',
    },
    {
        kind: 'entry',
        heading: 'Alura',
        credential: loc('Curso', 'Course'),
        subheading: loc(
            'Expressões regulares: capturando textos de forma mágica',
            'Regular expressions: capturing text magically',
        ),
        mono: 'A', icon: '/images/logos/alura.webp',
        period: loc('out. 2022', 'Oct 2022'),
        body: loc('', ''),
        url: 'https://cursos.alura.com.br/certificate/bb05ea11-c30e-4902-93ff-9292d081e7e8',
    },
];

export const TAB_CARDS: Record<TabId, CardData[]> = {
    experiencia: EXPERIENCE,
    projetos: PROJECTS,
    estudos: STUDIES,
};

/** Slot count the carousel must allocate up front. */
export const MAX_CARDS = Math.max(...TABS.map(t => TAB_CARDS[t.id].length));
