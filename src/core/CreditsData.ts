// ============================================
// CREDITS DATA — every third-party asset that ships in public/
// ============================================
//
// This file is the single source of truth for the credits modal. It is meant to
// be EDITED BY HAND as sources are tracked down: an entry with no `author` is
// rendered as "to fill in", so adding the author (and ideally `sourceUrl` +
// `license`) is all it takes to promote it to a confirmed credit.
//
// What is already filled in came from the assets themselves, not from memory:
//   • GLBs: the `asset.extras` block Sketchfab writes on export (author,
//     license, source, title) survived the gltf-transform pipeline on 7 models.
//   • Freesound: files named `<id>__<username>__<title>` carry both the
//     uploader and the sound id, so the canonical page is freesound.org/s/<id>/.
//     The per-upload license still has to be read off that page — Freesound
//     mixes CC0, CC BY and CC BY-NC — so those entries keep `license` empty.
//   • Pixabay: files named `<uploader>-<title>-<id>` carry the uploader slug.
//   • freetouse.com: the music filenames carry "Artist - Title (freetouse.com)".
//   • simple-icons: the tech glyphs are generated from the npm package by
//     scripts/generate-tech-icons.cjs, so their provenance is in the repo.
//   • Quaternius and Kenney: named by the project author, then pinned to a pack
//     by the texture atlas baked into each GLB (see the helpers below).
//
// `atlas` is a lead, not an attribution: it is the texture name baked into the
// GLB, which usually identifies the asset pack the model came from. Models that
// share an atlas came from the same pack, so one confirmed source fills several
// rows at once.

/** A note that has to read correctly in both UI languages. */
export interface BilingualNote {
    en: string;
    pt: string;
}

export interface CreditEntry {
    /** What the thing is in this project (the label the user reads first). */
    name: string;
    /** Path under public/, or a short descriptor for non-file assets. */
    file?: string;
    /** Original title given by its author, when it differs from `name`. */
    title?: string;
    /** Leave undefined while unknown — that is what marks the entry pending. */
    author?: string;
    authorUrl?: string;
    /** Platform it came from: Sketchfab, Freesound, Pixabay, freetouse.com… */
    source?: string;
    /** Direct link to the asset page. */
    sourceUrl?: string;
    /** Asset pack the model belongs to, for authors who publish in bundles. */
    pack?: string;
    packUrl?: string;
    license?: string;
    licenseUrl?: string;
    /** Texture atlas baked into the model — a lead on which pack it came from. */
    atlas?: string;
    note?: BilingualNote;
}

export interface CreditSection {
    /** i18n key for the sub-heading; omit for a single unlabelled list. */
    labelKey?: string;
    entries: CreditEntry[];
}

export interface CreditGroup {
    id: string;
    /** i18n key for the group heading. */
    titleKey: string;
    sections: CreditSection[];
}

// ── Licences referenced more than once ───────────────────────────────────────
const CC_BY_4 = { license: 'CC BY 4.0', licenseUrl: 'http://creativecommons.org/licenses/by/4.0/' };
const SKETCHFAB_STD = { license: 'Sketchfab Standard', licenseUrl: 'https://sketchfab.com/licenses' };
const PIXABAY = { source: 'Pixabay', license: 'Pixabay Content License', licenseUrl: 'https://pixabay.com/service/license-summary/' };
const FREETOUSE = {
    source: 'freetouse.com',
    sourceUrl: 'https://freetouse.com/music',
    license: 'Free To Use (credit required)',
    licenseUrl: 'https://freetouse.com/music',
};

/** Freesound uploads are addressable by id — the license still varies per upload. */
function freesound(id: string) {
    return { source: 'Freesound', sourceUrl: `https://freesound.org/s/${id}/` };
}

// ── Quaternius ───────────────────────────────────────────────────────────────
// Everything Quaternius publishes is CC0, so none of this is legally required —
// it is here because the work deserves the name on it.
//
// He publishes by PACK, and the pack is what the evidence in the GLBs points
// at: the baked texture atlas is per-pack, so `Atlas_Pirate` says Pirate Kit
// and the `Leaves_NormalTree_<letter>` variant scheme says the nature megakit
// (its selling point is seven swappable leaf varieties). That makes the pack
// page the stable, checkable link; an individual model page is a bonus and is
// only filled in where the model's own name was matched.
const QUATERNIUS = {
    author: 'Quaternius',
    authorUrl: 'https://quaternius.com/',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
};

const QUATERNIUS_PACKS = {
    nature: { pack: 'Stylized Nature MegaKit', packUrl: 'https://poly.pizza/bundle/Stylized-Nature-MegaKit-T34GZFA0fm' },
    pirate: { pack: 'Pirate Kit', packUrl: 'https://poly.pizza/bundle/Pirate-kit-0q5ulmIYqQ' },
    survival: { pack: 'Survival Pack', packUrl: 'https://poly.pizza/bundle/Survival-Pack-XzvQPP0yWB' },
    fish: { pack: 'Animated Fish Bundle', packUrl: 'https://poly.pizza/bundle/Animated-Fish-Bundle-ZkGbjS8m8g' },
    animals: { pack: 'Animated Animal Pack', packUrl: 'https://poly.pizza/bundle/Animated-Animal-Pack-ILAPXeUYiS' },
} as const;

const QUATERNIUS_INDEX = 'https://poly.pizza/u/Quaternius';

/** A Quaternius model.
 *
 *  `packKey` is only passed where something actually establishes the pack — a
 *  baked atlas name, or a model page matched by name. Pass null for the rest:
 *  the author is confirmed either way, and a pack chip nobody checked would be
 *  a guess wearing the same styling as the evidence. Those fall back to his
 *  Poly Pizza index, which is where a deep link would be found. */
function quaternius(
    name: string,
    file: string,
    packKey: keyof typeof QUATERNIUS_PACKS | null,
    extra: Partial<CreditEntry> = {},
): CreditEntry {
    return {
        name,
        file,
        ...QUATERNIUS,
        ...(packKey ? QUATERNIUS_PACKS[packKey] : {}),
        source: 'Poly Pizza',
        sourceUrl: QUATERNIUS_INDEX,
        ...extra,
    };
}

// ── Kenney ───────────────────────────────────────────────────────────────────
// Also CC0, also credited by choice. Identified by the single `colormap` atlas
// his packs share, which is a different scheme from Quaternius' per-pack atlas.
const KENNEY = {
    author: 'Kenney',
    authorUrl: 'https://kenney.nl/',
    source: 'kenney.nl',
    sourceUrl: 'https://kenney.nl/assets',
    license: 'CC0 1.0',
    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
};

/** An asset whose author is still unknown — `atlas` carries the only lead. */
function pending(name: string, file: string, atlas?: string): CreditEntry {
    return { name, file, atlas };
}

// ============================================================================
// 3D MODELS
// ============================================================================
const MODELS: CreditGroup = {
    id: 'models',
    titleKey: 'credits.group.models',
    sections: [
        {
            labelKey: 'credits.section.surface',
            entries: [
                {
                    name: 'Floating island',
                    file: 'models/surface/floating_island.glb',
                    title: 'floating Island',
                    author: 'Uthowaipru Chowdhury',
                    authorUrl: 'https://sketchfab.com/uthowaipru',
                    source: 'Sketchfab',
                    sourceUrl: 'https://sketchfab.com/3d-models/floating-island-0db7cf327c02461a94920070cdbebb19',
                    ...CC_BY_4,
                },
                {
                    name: 'Apple',
                    file: 'models/surface/apple.glb',
                    title: '[Animal Crossing New Leaf] Apple',
                    author: 'Starlight_lambda64',
                    authorUrl: 'https://sketchfab.com/Starlight_lambda64',
                    source: 'Sketchfab',
                    sourceUrl: 'https://sketchfab.com/3d-models/animal-crossing-new-leaf-apple-46edcd650f4f40959ae7e706d1cd704c',
                    ...SKETCHFAB_STD,
                },
                {
                    name: 'Dog bed',
                    file: 'models/surface/dog_bed.glb',
                    title: 'Dog Bed',
                    author: 'LibbyT',
                    authorUrl: 'https://sketchfab.com/s4014720',
                    source: 'Sketchfab',
                    sourceUrl: 'https://sketchfab.com/3d-models/dog-bed-29974c75f31c494eafe3304ea5e94546',
                    ...CC_BY_4,
                },
                {
                    name: 'Camp table',
                    file: 'models/surface/folding_tray_table.glb',
                    title: 'Folding Tray Table',
                    author: 'mokeymark',
                    authorUrl: 'https://sketchfab.com/mokeymark',
                    source: 'Sketchfab',
                    sourceUrl: 'https://sketchfab.com/3d-models/folding-tray-table-b254e5104cd64ce3a1af32431d706f98',
                    ...CC_BY_4,
                },
                quaternius('Palm tree', 'models/surface/tree.glb', 'nature', {
                    atlas: 'Bark_NormalTree.png / Leaves_NormalTree_C.png',
                }),
                quaternius('Bushes', 'models/surface/bush.glb', 'nature', {
                    atlas: 'Leaves_NormalTree_C.png / Flowers.png',
                }),
                quaternius('Mossy rock 1', 'models/surface/moss_rock1.glb', 'nature', { atlas: 'Rocks_Diffuse.png' }),
                quaternius('Mossy rock 2', 'models/surface/moss_rock2.glb', 'nature', { atlas: 'Rocks_Diffuse.png' }),
                quaternius('Mossy rock 3', 'models/surface/moss_rock3.glb', 'nature', { atlas: 'PathRocks_Diffuse.png' }),
                quaternius('Bonfire', 'models/surface/bonfire.glb', null),
                quaternius('Radio', 'models/surface/radio.glb', null),
                quaternius('Sword', 'models/surface/sword.glb', null),
                quaternius('Tent', 'models/surface/custom_tent.glb', null, {
                    note: {
                        en: 'Filename says custom_ — the mesh was edited here, so the shape may not match the original any more.',
                        pt: 'O nome traz custom_ — a malha foi editada aqui, então pode não bater mais com a original.',
                    },
                }),
                quaternius('Lantern', 'models/surface/lantern.glb', null),
                quaternius('Round rug', 'models/surface/rug_round.glb', null),
                quaternius('Dog bowl', 'models/surface/dog_bowl.glb', null),
                quaternius('Dog biscuit', 'models/surface/dog_biscuit.glb', null),
            ],
        },
        {
            labelKey: 'credits.section.underwater',
            entries: [
                {
                    name: 'Coral (main)',
                    file: 'models/underwater/coral.glb',
                    title: 'coral',
                    author: 'JonathanFreire',
                    authorUrl: 'https://sketchfab.com/JonathanFreire',
                    source: 'Sketchfab',
                    sourceUrl: 'https://sketchfab.com/3d-models/coral-3f051742aa3b466fa3b8df9bb990d170',
                    ...CC_BY_4,
                },
                {
                    name: 'Jellyfish',
                    file: 'models/underwater/jellyfish.glb',
                    title: 'Simple Jellyfish',
                    author: 'ricksticky',
                    authorUrl: 'https://sketchfab.com/ricksticky',
                    source: 'Sketchfab',
                    sourceUrl: 'https://sketchfab.com/3d-models/simple-jellyfish-f77876d8297846eeb23c4ad82dbebb97',
                    ...CC_BY_4,
                },
                {
                    name: 'Sea turtle',
                    file: 'models/underwater/seaturtle.glb',
                    title: 'SeaTurtle - Animated Low Poly',
                    author: 'WildPoly3D',
                    authorUrl: 'https://sketchfab.com/WildPoly3D',
                    source: 'Sketchfab',
                    sourceUrl: 'https://sketchfab.com/3d-models/seaturtle-animated-low-poly-14e7719da5d54841b43b2ab76240345c',
                    ...CC_BY_4,
                },
                quaternius('Coral-encrusted rock 1', 'models/underwater/coral_rock1.glb', 'pirate', { atlas: 'Atlas_Pirate.png' }),
                quaternius('Coral-encrusted rock 2', 'models/underwater/coral_rock2.glb', 'pirate', { atlas: 'Atlas_Pirate.png' }),
                quaternius('Coral-encrusted rock 3', 'models/underwater/coral_rock3.glb', 'pirate', { atlas: 'Atlas_Pirate.png' }),
                quaternius('Coral variant 1', 'models/underwater/coral1.glb', null),
                quaternius('Coral variant 2', 'models/underwater/coral2.glb', null),
                quaternius('Kelp', 'models/underwater/kelp.glb', null),
                quaternius('Anemone', 'models/underwater/anemone.glb', null),
                quaternius('Starfish', 'models/underwater/starfish.glb', null),
                quaternius('Crab', 'models/underwater/crab.glb', null),
                quaternius('Clownfish', 'models/underwater/clownfish.glb', 'fish', {
                    sourceUrl: 'https://poly.pizza/m/769fHo3eEB',
                }),
                quaternius('Blue tang ("Dori")', 'models/underwater/dorifish.glb', 'fish'),
                quaternius('Generic fish (shoal)', 'models/underwater/genericfish.glb', 'fish'),
                quaternius('Anglerfish', 'models/underwater/anglerfish.glb', 'fish'),
                quaternius('Whale', 'models/underwater/whale.glb', 'fish'),
                quaternius('Seahorse', 'models/underwater/seahorse.glb', null),
            ],
        },
        {
            labelKey: 'credits.section.character',
            entries: [
                quaternius('Pug ("Bartô")', 'models/character/pug.glb', 'animals', {
                    title: 'Characters Pug',
                    sourceUrl: 'https://poly.pizza/m/xvcUwuKl4c',
                    atlas: 'Zombie_Atlas.png',
                    note: {
                        en: 'The atlas name points at a character pack rather than the animal one — worth confirming which pack it shipped in.',
                        pt: 'O nome do atlas aponta para um pacote de personagens, não o de animais — vale confirmar em qual pacote veio.',
                    },
                }),
            ],
        },
        {
            labelKey: 'credits.section.props',
            entries: [
                quaternius('Gold chest', 'models/overall/gold_chest.glb', null),
                quaternius('Coin', 'models/overall/coin.glb', null),
                quaternius('Phone', 'models/overall/phone.glb', null),
                {
                    name: 'Chest (unused)',
                    file: 'models/overall/chest.glb',
                    atlas: 'colormap.png',
                    ...KENNEY,
                    note: {
                        en: 'Identified by the single colormap atlas his packs share. Which pack it came from is still open.',
                        pt: 'Identificado pelo atlas colormap único que os pacotes dele compartilham. De qual pacote veio ainda está em aberto.',
                    },
                },
                {
                    name: 'Shared prop atlas',
                    file: 'models/overall/Textures/colormap.png',
                    ...KENNEY,
                    note: {
                        en: 'The colour atlas that ships beside chest.glb.',
                        pt: 'O atlas de cores que acompanha o chest.glb.',
                    },
                },
            ],
        },
    ],
};

// ============================================================================
// MUSIC
// ============================================================================
const MUSIC: CreditGroup = {
    id: 'music',
    titleKey: 'credits.group.music',
    sections: [
        {
            labelKey: 'credits.section.radioPlaylist',
            entries: [
                { name: 'At Ease', file: 'audio/music/Hazelwood - At Ease (freetouse.com).mp3', author: 'Hazelwood', ...FREETOUSE },
                { name: 'breeze', file: 'audio/music/massobeats - breeze (freetouse.com).mp3', author: 'massobeats', ...FREETOUSE },
                { name: 'Dark Heart', file: 'audio/music/Walen - Dark Heart (freetouse.com).mp3', author: 'Walen', ...FREETOUSE },
                { name: 'Fly With Me', file: 'audio/music/Moavii - Fly With Me (freetouse.com).mp3', author: 'Moavii', ...FREETOUSE },
                { name: 'Memories', file: 'audio/music/Lukrembo - Memories (freetouse.com).mp3', author: 'Lukrembo', ...FREETOUSE },
                { name: 'ocean', file: 'audio/music/massobeats - ocean (freetouse.com).mp3', author: 'massobeats', ...FREETOUSE },
                { name: 'Reflection', file: 'audio/music/Hazelwood - Reflection (freetouse.com).mp3', author: 'Hazelwood', ...FREETOUSE },
                { name: 'Stranded', file: 'audio/music/Moavii - Stranded (freetouse.com).mp3', author: 'Moavii', ...FREETOUSE },
                { name: 'Tranquility', file: 'audio/music/Project Ex - Tranquility (freetouse.com).mp3', author: 'Project Ex', ...FREETOUSE },
                { name: 'Umbrella', file: 'audio/music/Moavii - Umbrella (freetouse.com).mp3', author: 'Moavii', ...FREETOUSE },
                { name: 'After the Storm', file: 'audio/music/Aetheric - After the Storm (freetouse.com).mp3', author: 'Aetheric', ...FREETOUSE },
                { name: 'Echoes of the Fields', file: 'audio/music/Aetheric - Echoes of the Fields (freetouse.com).mp3', author: 'Aetheric', ...FREETOUSE },
                { name: 'The Sea', file: 'audio/music/Aetheric - The Sea (freetouse.com).mp3', author: 'Aetheric', ...FREETOUSE },
                {
                    name: 'Late Nights in Osaka',
                    file: 'audio/music/595751__yellowtree__late-nights-in-osaka.mp3',
                    author: 'yellowtree',
                    ...freesound('595751'),
                    note: {
                        en: 'Freesound licences vary per upload — read the licence off the sound page.',
                        pt: 'A licença no Freesound varia por upload — conferir na página do som.',
                    },
                },
            ],
        },
        {
            labelKey: 'credits.section.introMusic',
            entries: [
                {
                    name: 'Intro piano (sky loop)',
                    file: 'audio/music/320526__benpm__ambient-piano-music-3.mp3',
                    title: 'Ambient piano music 3',
                    author: 'benpm',
                    ...freesound('320526'),
                    note: {
                        en: 'Freesound licences vary per upload — read the licence off the sound page.',
                        pt: 'A licença no Freesound varia por upload — conferir na página do som.',
                    },
                },
            ],
        },
    ],
};

// ============================================================================
// SOUND EFFECTS
// ============================================================================
const SFX: CreditGroup = {
    id: 'sfx',
    titleKey: 'credits.group.sfx',
    sections: [
        {
            labelKey: 'credits.section.uiSounds',
            entries: [
                { name: 'Light switch (to night)', file: 'audio/ui/dragon-studio-light-switch-382712.mp3', author: 'Dragon-Studio', ...PIXABAY },
                { name: 'Light switch (to day)', file: 'audio/ui/dragon-studio-light-switch-on-382714.mp3', author: 'Dragon-Studio', ...PIXABAY },
                { name: 'Button click', file: 'audio/ui/soundreality-button-202966.mp3', author: 'SoundReality', ...PIXABAY },
                { name: 'Bubble pop (expand)', file: 'audio/ui/universfield-bubble-pop-293342.mp3', author: 'Universfield', ...PIXABAY },
                { name: 'Bubble pop (collapse)', file: 'audio/ui/universfield-bubble-pop-06-351337.mp3', author: 'Universfield', ...PIXABAY },
                { name: 'Settings cog spin', file: 'audio/ui/712916__greyfeather__spinning-a-crank-fast.mp3', author: 'greyfeather', ...freesound('712916') },
                { name: 'Writing tick (unused)', file: 'audio/ui/335518__newagesoup__writing-short-8.mp3', author: 'newagesoup', ...freesound('335518') },
                {
                    ...pending('Dialog bubble pop', 'audio/ui/drop_002.ogg'),
                    note: {
                        en: 'Filename follows the numbered convention of the free UI-sound packs — identify the pack before crediting.',
                        pt: 'O nome segue a convenção numerada dos pacotes gratuitos de sons de interface — identificar o pacote antes de creditar.',
                    },
                },
                {
                    ...pending('Dialog typing tick', 'audio/ui/drop_003.ogg'),
                    note: {
                        en: 'Same pack as drop_002.ogg — one source fills both rows.',
                        pt: 'Mesmo pacote do drop_002.ogg — uma fonte preenche as duas linhas.',
                    },
                },
            ],
        },
        {
            labelKey: 'credits.section.worldSounds',
            entries: [
                { name: 'Apple impact', file: 'audio/overall/209012__owlstorm__fruit-impact-1.mp3', author: 'owlstorm', ...freesound('209012') },
                { name: 'Chest opening', file: 'audio/overall/771164__steprock__treasure-chest-open.mp3', author: 'steprock', ...freesound('771164') },
                { name: 'Water splash', file: 'audio/nature/surface/274060__junggle__water-splash-11.mp3', author: 'junggle', ...freesound('274060') },
                { name: 'Coral tap 1', file: 'audio/nature/underwater/321805__lloydevans09__pvc_pipe_hit_1.mp3', author: 'lloydevans09', ...freesound('321805') },
                { name: 'Coral tap 2', file: 'audio/nature/underwater/321808__lloydevans09__pvc_pipe_hit_3.mp3', author: 'lloydevans09', ...freesound('321808') },
                { name: 'Coral tap 3', file: 'audio/nature/underwater/321802__lloydevans09__pvc_pipe_hit_4.mp3', author: 'lloydevans09', ...freesound('321802') },
            ],
        },
        {
            labelKey: 'credits.section.ambience',
            entries: [
                { name: 'Underwater ambience loop', file: 'audio/nature/underwater/366159__dcsfx__underwater-loop-amb.opus', author: 'dcsfx', ...freesound('366159') },
                { name: 'Underwater bubbles', file: 'audio/nature/underwater/96742__robinhood76__01650-underwater-bubbles.mp3', author: 'Robinhood76', ...freesound('96742') },
                pending('Waves', 'audio/nature/surface/waves.mp3'),
                pending('Ocean loop', 'audio/nature/surface/ocean.opus'),
                pending('Breeze', 'audio/nature/surface/breeze.mp3'),
                pending('Fireplace', 'audio/nature/surface/fireplace.opus'),
                pending('Night crickets', 'audio/nature/surface/Crickets.mp3'),
            ],
        },
        {
            labelKey: 'credits.section.characterSounds',
            entries: [
                {
                    name: 'Pug snoring',
                    file: 'audio/character/pug/freesound_community-pug-roncando-95042.mp3',
                    author: 'Freesound Community',
                    ...PIXABAY,
                    note: { en: 'Pixabay id 95042.', pt: 'Id 95042 no Pixabay.' },
                },
                {
                    name: 'Pug bark',
                    file: 'audio/character/pug/freesound_community-pug-woof-2-103762.mp3',
                    author: 'Freesound Community',
                    ...PIXABAY,
                    note: {
                        en: 'Pixabay id 103762. Split in two (_PRIMEIRA / _SEGUNDA) for the dialog cues.',
                        pt: 'Id 103762 no Pixabay. Dividido em dois (_PRIMEIRA / _SEGUNDA) para as falas.',
                    },
                },
            ],
        },
    ],
};

// ============================================================================
// IMAGES & TEXTURES
// ============================================================================
const IMAGES: CreditGroup = {
    id: 'images',
    titleKey: 'credits.group.images',
    sections: [
        {
            labelKey: 'credits.section.sceneTextures',
            entries: [
                pending('Water normal map 1', 'images/waterNormal1.webp'),
                pending('Water normal map 2', 'images/waterNormal2.webp'),
                pending('Blue-noise dither', 'images/bluenoise.webp'),
                pending('Sand', 'images/sand.webp'),
                pending('Checker (debug)', 'images/basicChecker.png'),
                pending('Cloud sprite', 'images/cloud10.png'),
                {
                    ...pending('Fire spritesheet', 'images/fire_spritesheet.png'),
                    note: {
                        en: 'Ships with a downscaled mobile twin (fire_spritesheet_mobile.png) — same source.',
                        pt: 'Acompanha a versão reduzida para mobile (fire_spritesheet_mobile.png) — mesma fonte.',
                    },
                },
            ],
        },
        {
            labelKey: 'credits.section.coverArt',
            entries: [
                {
                    name: 'Radio playlist cover art',
                    file: 'images/music/*.webp',
                    note: {
                        en: 'Artwork belongs to each track\'s artist (see the Music group). Confirm per cover whether it may be reproduced.',
                        pt: 'As artes pertencem ao artista de cada faixa (ver o grupo Música). Confirmar por capa se pode ser reproduzida.',
                    },
                },
                {
                    name: 'Default cover placeholder',
                    file: 'images/music-default.svg',
                    note: {
                        en: 'Generic music glyph — confirm whether it was drawn in-house or taken from an icon set.',
                        pt: 'Ícone genérico de música — confirmar se foi feito em casa ou veio de um conjunto de ícones.',
                    },
                },
            ],
        },
        {
            labelKey: 'credits.section.icons',
            entries: [
                {
                    name: 'Technology glyphs',
                    file: 'images/tech/*.svg',
                    author: 'Simple Icons contributors',
                    authorUrl: 'https://github.com/simple-icons/simple-icons',
                    source: 'simple-icons',
                    sourceUrl: 'https://simpleicons.org/',
                    license: 'CC0 1.0',
                    licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/',
                    note: {
                        en: 'Baked from the npm package by scripts/generate-tech-icons.cjs; brand colours are the brands\' own.',
                        pt: 'Gerados do pacote npm por scripts/generate-tech-icons.cjs; as cores são as próprias das marcas.',
                    },
                },
                {
                    name: 'Company & school marks',
                    file: 'images/logos/*.webp',
                    note: {
                        en: 'Bradesco, Alura, Impacta, IFSP and TEX — trademarks of their respective owners, shown to identify where the work happened.',
                        pt: 'Bradesco, Alura, Impacta, IFSP e TEX — marcas de seus respectivos donos, exibidas para identificar onde o trabalho aconteceu.',
                    },
                },
                {
                    name: 'Project screenshots & icons',
                    file: 'images/projects/*.webp',
                    author: 'Leonardo Sato',
                    authorUrl: 'https://github.com/satoLG',
                    source: 'Own work',
                    note: {
                        en: 'Captures of this author\'s own projects.',
                        pt: 'Capturas dos projetos do próprio autor.',
                    },
                },
                {
                    name: 'Site icons & favicon',
                    file: 'icons/*.png, favicon.svg',
                    author: 'Leonardo Sato',
                    authorUrl: 'https://github.com/satoLG',
                    source: 'Own work',
                },
            ],
        },
    ],
};

// ============================================================================
// FONTS
// ============================================================================
const FONTS: CreditGroup = {
    id: 'fonts',
    titleKey: 'credits.group.fonts',
    sections: [
        {
            entries: [
                {
                    name: 'Wotfard',
                    file: 'UI body type',
                    source: 'fonts.cdnfonts.com',
                    sourceUrl: 'https://fonts.cdnfonts.com/css/wotfard',
                    note: {
                        en: 'Served from a third-party CDN — confirm the foundry and whether web use is licensed.',
                        pt: 'Servida por CDN de terceiros — confirmar a fundição e se o uso web é licenciado.',
                    },
                },
                {
                    name: 'Jersey 10 / Jersey 15',
                    file: 'pixel-mode type',
                    source: 'Google Fonts',
                    sourceUrl: 'https://fonts.google.com/specimen/Jersey+10',
                },
                { name: 'Margarine', file: 'display type', source: 'Google Fonts', sourceUrl: 'https://fonts.google.com/specimen/Margarine' },
                { name: 'Pangolin', file: 'dialog type', source: 'Google Fonts', sourceUrl: 'https://fonts.google.com/specimen/Pangolin' },
            ],
        },
    ],
};

// ============================================================================
// LIBRARIES
// ============================================================================
const LIBRARIES: CreditGroup = {
    id: 'libraries',
    titleKey: 'credits.group.libraries',
    sections: [
        {
            entries: [
                { name: 'Three.js', file: 'renderer', source: 'threejs.org', sourceUrl: 'https://threejs.org/', author: 'mrdoob & contributors', authorUrl: 'https://github.com/mrdoob/three.js', license: 'MIT', licenseUrl: 'https://github.com/mrdoob/three.js/blob/dev/LICENSE' },
                { name: 'cannon-es', file: 'physics', source: 'GitHub', sourceUrl: 'https://github.com/pmndrs/cannon-es', author: 'pmndrs & contributors', authorUrl: 'https://github.com/pmndrs', license: 'MIT', licenseUrl: 'https://github.com/pmndrs/cannon-es/blob/master/LICENSE' },
                { name: 'WaveSurfer.js', file: 'audio waveform', source: 'wavesurfer.xyz', sourceUrl: 'https://wavesurfer.xyz/', author: 'katspaugh & contributors', authorUrl: 'https://github.com/katspaugh', license: 'BSD-3-Clause', licenseUrl: 'https://github.com/katspaugh/wavesurfer.js/blob/main/LICENSE' },
                { name: 'lil-gui', file: 'debug GUI', source: 'lil-gui.georgealways.com', sourceUrl: 'https://lil-gui.georgealways.com/', author: 'George Michael Brower', authorUrl: 'https://github.com/georgealways', license: 'MIT', licenseUrl: 'https://github.com/georgealways/lil-gui/blob/master/LICENSE' },
                { name: 'bezier-easing', file: 'easing curves', source: 'GitHub', sourceUrl: 'https://github.com/gre/bezier-easing', author: 'Gaëtan Renaudeau', authorUrl: 'https://github.com/gre', license: 'MIT', licenseUrl: 'https://github.com/gre/bezier-easing/blob/master/LICENSE' },
            ],
        },
    ],
};

export const creditGroups: CreditGroup[] = [MODELS, MUSIC, SFX, IMAGES, FONTS, LIBRARIES];

/** An entry counts as pending until it names who made it. */
export function isPending(entry: CreditEntry): boolean {
    return !entry.author;
}

/** [credited, total] for a group — drives the counter on each group header. */
export function groupProgress(group: CreditGroup): [number, number] {
    let credited = 0;
    let total = 0;
    for (const section of group.sections) {
        for (const entry of section.entries) {
            total++;
            if (!isPending(entry)) credited++;
        }
    }
    return [credited, total];
}
