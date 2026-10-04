// OWNER: LEAD (shared data). Read by FEATURE-MOBS (behaviour), FEATURE-AUDIO (voices), FEATURE-INV (spawn eggs).
// Numbers are Java Edition values (see docs/SPEC.md §2.6). Sizes in blocks, speeds are the movement
// speed ATTRIBUTE. Ground speed in blocks/second for an attribute a and AI modifier m is
//   v ≈ 43.2 * (a*m)^2        (pig 0.25 -> 2.7 b/s wander; panic m=1.25 -> 4.2 b/s)
// because mobs use input = speed = a*m in the player movement formula (SPEC §2.1).

export const MOBS = Object.freeze({
  pig: {
    category: 'creature', priority: 'P0', hp: 10, w: 0.9, h: 0.9, eye: 0.8, speed: 0.25,
    drops: [{ item: 'porkchop', min: 1, max: 3, cooked: 'cooked_porkchop' }],
    breed: ['carrot', 'potato'], tempt: ['carrot', 'potato', 'carrot_on_a_stick'], rideWith: 'saddle', steerWith: 'carrot_on_a_stick',
    biomes: ['plains', 'forest', 'birch_forest', 'taiga'], group: [2, 4], xp: [1, 3], voice: 'pig',
  },
  cow: {
    category: 'creature', priority: 'P0', hp: 10, w: 0.9, h: 1.4, eye: 1.3, speed: 0.2,
    drops: [{ item: 'leather', min: 0, max: 2 }, { item: 'beef', min: 1, max: 3, cooked: 'cooked_beef' }],
    breed: ['wheat'], tempt: ['wheat'], milkable: true,
    biomes: ['plains', 'forest', 'birch_forest', 'taiga'], group: [2, 4], xp: [1, 3], voice: 'cow',
  },
  sheep: {
    category: 'creature', priority: 'P0', hp: 8, w: 0.9, h: 1.3, eye: 1.23, speed: 0.23,
    drops: [{ item: 'wool', min: 1, max: 1 }, { item: 'mutton', min: 1, max: 2, cooked: 'cooked_mutton' }], // 'wool' => <color>_wool
    breed: ['wheat'], tempt: ['wheat'], shearable: true, shearDrops: [1, 3], regrowEatsGrass: true,
    // natural colour weights (percent) — original kid twist: rare pink is a little less rare
    colorWeights: { white: 80, black: 5, gray: 5, light_gray: 5, brown: 3, pink: 2 },
    // Original Blockcraft easter egg (P1): dye the same sheep with 3 different colours within 200 ticks and it
    // becomes a rainbow sheep (wool cycles through the 16 colours, one per second; shearing drops a random colour).
    rainbow: { dyes: 3, windowTicks: 200, cycleTicks: 20 },
    biomes: ['plains', 'forest', 'birch_forest', 'taiga', 'snowy', 'mountains'], group: [2, 4], xp: [1, 3], voice: 'sheep',
  },
  chicken: {
    category: 'creature', priority: 'P0', hp: 4, w: 0.4, h: 0.7, eye: 0.644, speed: 0.25,
    drops: [{ item: 'chicken', min: 1, max: 1, cooked: 'cooked_chicken' }, { item: 'feather', min: 0, max: 2 }],
    breed: ['wheat_seeds'], tempt: ['wheat_seeds'], noFallDamage: true, slowFall: true, layEggTicks: [6000, 12000],
    biomes: ['plains', 'forest', 'birch_forest'], group: [2, 4], xp: [1, 3], voice: 'chicken',
  },
  wolf: {
    category: 'creature', priority: 'P0', hp: 8, tamedHp: 40, w: 0.6, h: 0.85, eye: 0.68, speed: 0.3, attack: { easy: 4, normal: 4 },
    tameItem: 'bone', tameChance: 1 / 3, followTeleportDist: 12, sitToggle: true, collar: 'red',
    breed: ['porkchop', 'cooked_porkchop', 'beef', 'cooked_beef', 'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton', 'rotten_flesh'],
    tempt: [], begItems: ['bone', 'porkchop', 'cooked_porkchop', 'beef', 'cooked_beef', 'chicken', 'cooked_chicken', 'mutton', 'cooked_mutton'],
    biomes: ['forest', 'taiga', 'snowy'], group: [1, 4], xp: [1, 3], voice: 'wolf',
  },
  cat: {
    category: 'creature', priority: 'P1', hp: 10, w: 0.6, h: 0.7, eye: 0.35, speed: 0.3,
    tameItem: 'chicken', tameChance: 1 / 3, followTeleportDist: 12, sitToggle: true, scaresCreepers: true,
    breed: ['chicken'], tempt: ['chicken', 'cooked_chicken'], biomes: ['plains'], group: [1, 1], xp: [1, 3], voice: 'cat',
  },
  horse: {
    category: 'creature', priority: 'P1', hp: [15, 30], w: 1.3965, h: 1.6, eye: 1.52, speed: [0.1125, 0.3375], jump: [0.4, 1.0],
    tameByRiding: true, temperPerAttempt: 5, temperItems: { sugar: 3, wheat: 3, apple: 3, golden_apple: 10, carrot: 5 },
    rideWith: 'saddle', breed: ['golden_apple', 'carrot'], biomes: ['plains'], group: [2, 6], xp: [1, 3], voice: 'horse',
    colors: ['white', 'creamy', 'chestnut', 'brown', 'black', 'gray', 'dark_brown'],
  },
  zombie: {
    category: 'monster', priority: 'P1', hp: 20, armor: 2, w: 0.6, h: 1.95, eye: 1.74, speed: 0.23,
    attack: { easy: 2.5, normal: 3 }, followRange: 35, burnsInSun: true, babyChance: 0.05,
    drops: [{ item: 'rotten_flesh', min: 0, max: 2 }], xp: [5, 5], voice: 'zombie',
  },
  skeleton: {
    category: 'monster', priority: 'P1', hp: 20, w: 0.6, h: 1.99, eye: 1.74, speed: 0.25,
    ranged: { range: 15, intervalTicks: { easy: 60, normal: 40 }, damage: { easy: [1, 3], normal: [2, 4] } }, burnsInSun: true, fleesWolves: true,
    drops: [{ item: 'bone', min: 0, max: 2 }, { item: 'arrow', min: 0, max: 2 }], xp: [5, 5], voice: 'skeleton',
  },
  creeper: {
    category: 'monster', priority: 'P1', hp: 20, w: 0.6, h: 1.7, eye: 1.445, speed: 0.25,
    fuseTicks: 30, fuseStartRange: 3, fuseCancelRange: 7, explosionPower: 3, fleesCats: true,
    drops: [{ item: 'gunpowder', min: 0, max: 2 }], xp: [5, 5], voice: 'creeper',
  },
  spider: {
    category: 'monster', priority: 'P1', hp: 16, w: 1.4, h: 0.9, eye: 0.65, speed: 0.3,
    attack: { easy: 2, normal: 2 }, climbsWalls: true, neutralAtLight: 12, leap: true,
    drops: [{ item: 'string', min: 0, max: 2 }], xp: [5, 5], voice: 'spider',
  },
  // ---- judge FID-6 (round 1): more mob kinds, added by the MOBS lane (behaviour: src/entities/more_mobs.js).
  // `water`: swims, spawned in water by spawning.js (own cap), never by the land spawner. `voice` must be one of the
  // AUDIO catalogue voices (more_mobs.js plays pitched stand-ins until AUDIO adds real voices). Drops only use items
  // that exist: no cod / ink sac / rabbit hide / slime ball / ender pearl / sweet berries items yet (black dye is the
  // ink stand-in, leather the hide, apple the berries).
  cod: {
    category: 'creature', priority: 'P2', water: true, school: true, hp: 3, w: 0.5, h: 0.3, eye: 0.2, speed: 0.1,
    group: [3, 6], xp: [1, 3], voice: 'chicken',
  },
  tropical_fish: {
    category: 'creature', priority: 'P2', water: true, school: true, warm: true, hp: 3, w: 0.5, h: 0.4, eye: 0.25, speed: 0.1,
    group: [3, 6], xp: [1, 3], voice: 'chicken',
  },
  squid: {
    category: 'creature', priority: 'P2', water: true, hp: 10, w: 0.8, h: 0.95, eye: 0.6, speed: 0.1, minDepth: 4,
    drops: [{ item: 'black_dye', min: 1, max: 3 }], group: [1, 3], xp: [1, 3], voice: 'cow',
  },
  rabbit: {
    category: 'creature', priority: 'P2', hp: 3, w: 0.4, h: 0.5, eye: 0.4, speed: 0.3,
    drops: [{ item: 'leather', min: 0, max: 1 }], breed: ['carrot', 'dandelion'], tempt: ['carrot', 'dandelion'],
    biomes: ['desert', 'snowy', 'taiga', 'birch_forest'], spawnOn: ['grass_block', 'sand', 'snow'], group: [2, 3], xp: [1, 3], voice: 'chicken',
  },
  fox: {
    category: 'creature', priority: 'P2', hp: 10, w: 0.6, h: 0.7, eye: 0.4, speed: 0.3,
    breed: ['apple'], tempt: ['apple'], sleepsByDay: true,
    biomes: ['taiga', 'snowy'], spawnOn: ['grass_block', 'snow'], group: [2, 4], xp: [1, 3], voice: 'wolf',
  },
  bee: {
    category: 'creature', priority: 'P2', hp: 10, w: 0.7, h: 0.6, eye: 0.3, speed: 0.3, flies: true, attack: { easy: 2, normal: 2 },
    breed: ['dandelion', 'poppy', 'cornflower', 'orange_tulip', 'pink_tulip', 'allium', 'lily_of_the_valley', 'blue_orchid'],
    tempt: ['dandelion', 'poppy', 'cornflower', 'orange_tulip', 'pink_tulip', 'allium', 'lily_of_the_valley', 'blue_orchid'],
    biomes: ['plains', 'forest'], group: [1, 3], xp: [1, 3], voice: 'spider',
  },
  enderman: {
    category: 'monster', priority: 'P2', hp: 40, w: 0.6, h: 2.9, eye: 2.55, speed: 0.3, attack: { easy: 4.5, normal: 7 },
    neutral: true, teleports: true, spawnWeight: 10, xp: [5, 5], voice: 'zombie',
  },
  slime: {
    category: 'monster', priority: 'P2', hp: 4, w: 0.52, h: 0.52, eye: 0.325, speed: 0.3, sizes: [1, 2, 4], splits: true,
    spawnWeight: 30, maxSpawnY: 40, xp: [1, 4], voice: 'spider',
  },
  villager: {
    category: 'creature', priority: 'P2', hp: 20, w: 0.6, h: 1.95, eye: 1.62, speed: 0.2,
    professions: ['farmer', 'librarian', 'cleric', 'smith', 'shepherd'], group: [1, 1], voice: 'pig',
  },
  iron_golem: {
    category: 'creature', priority: 'P2', hp: 100, w: 1.4, h: 2.7, eye: 2.3, speed: 0.25, attack: { easy: 7, normal: 10 },
    drops: [{ item: 'iron_ingot', min: 3, max: 5 }, { item: 'poppy', min: 0, max: 2 }], group: [1, 1], voice: 'zombie',
  },
});

/** Spawning (SPEC §2.6). Kid-scaled caps: fewer than Java's 70 monsters for weak laptops. */
export const SPAWN = Object.freeze({
  CREATURE_CAP: 24,            // passive animals within the loaded area
  MONSTER_CAP: 20,
  MIN_PLAYER_DIST: 24,         // never spawn closer than this
  MONSTER_DESPAWN_FAR: 128,    // instant despawn beyond (monsters only)
  MONSTER_DESPAWN_IDLE: 32,    // random despawn beyond this after 30 s idle (1/800 per tick)
  CHUNKGEN_ANIMAL_CHANCE: 0.1, // per freshly generated column (as Java)
  MONSTER_ATTEMPT_TICKS: 20,   // try a monster spawn pack once per second (cheaper than every tick)
  MONSTER_MAX_SKY_LIGHT: 7, MONSTER_MAX_BLOCK_LIGHT: 0,
  ANIMAL_MIN_LIGHT: 9,
  LOVE_TICKS: 600, BREED_COOLDOWN_TICKS: 6000, BABY_GROW_TICKS: 24000, BABY_FEED_SPEEDUP: 0.1,
  PANIC_TICKS: 100, PANIC_SPEED_MOD: 1.25, TEMPT_RANGE: 10, LOOK_AT_PLAYER_RANGE: 6,
});

export const MOB_TYPES = Object.freeze(Object.keys(MOBS));

/**
 * Natural spawn list for a biome. MOBS[type].biomes is the ONLY source of truth for where animals live
 * (worldgen BIOMES carry no animal list). Monsters have no biomes (they spawn by light level).
 * @param {string} biomeName worldgen BIOMES[].name
 * @param {(type: string) => boolean} [isImplemented] filter out mob types whose entity is not registered yet
 * @returns {string[]} mob types
 */
export function mobsForBiome(biomeName, isImplemented = () => true) {
  return MOB_TYPES.filter((t) => (MOBS[t].biomes || []).includes(biomeName) && isImplemented(t));
}
