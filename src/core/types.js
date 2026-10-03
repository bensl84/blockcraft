// OWNER: LEAD (shared, frozen). JSDoc type definitions only (no runtime code). docs/SPEC.md is normative;
// these typedefs mirror it so editors can type-check `@param {import('../core/types.js').X}`.

/**
 * A system plugged into the main loop (SPEC §3.4). All methods optional except name.
 * @typedef {Object} System
 * @property {string} name                         unique; also the key in game.sys and in WorldMeta.systems
 * @property {boolean} [stub]                      true while the module is still a stub
 * @property {(game: Game) => (void|Promise<void>)} [init]   once at boot, in INIT order (renderer first)
 * @property {(game: Game) => void} [tick]         fixed 20 TPS while game.state === 'playing'
 * @property {(game: Game, dt: number, alpha: number) => void} [frame]  every animation frame, any state
 * @property {(game: Game) => object} [serialize]  per-world save data (JSON-safe) -> WorldMeta.systems[name]
 * @property {(game: Game, data: object|undefined) => void} [deserialize] restore (data undefined for a new world)
 * @property {(game: Game) => void} [dispose]
 */

/**
 * @typedef {Object} ItemStack
 * @property {string} item     item key (src/data/items.js)
 * @property {number} count    1..maxStack
 * @property {number} [damage] tool/armor damage taken (durability used)
 * @property {object} [data]   extra (e.g. {color} for future dyed items)
 */

/**
 * Result of raycast() (SPEC §7.3).
 * @typedef {Object} RayHit
 * @property {number} x @property {number} y @property {number} z   hit block cell
 * @property {number} face                                         FACE index of the face that was entered
 * @property {number} nx @property {number} ny @property {number} nz face normal (place into x+nx, y+ny, z+nz)
 * @property {number} id @property {number} state
 * @property {number} dist                                         distance from origin to hit point
 * @property {number} px @property {number} py @property {number} pz exact hit point
 */

/**
 * Mesher output for one pass of one section (SPEC §5.4). quads*4 vertices.
 * @typedef {Object} MeshBuffers
 * @property {Float32Array} position  xyz per vertex, section-local (0..16)
 * @property {Uint16Array} tex        [layer, u, v, flags] per vertex (u,v in 1/256 units of a tile)
 * @property {Uint8Array} light       [sky*16, block*16, ao 0..3, shade*255] per vertex
 * @property {number} quads
 */
/**
 * @typedef {Object} SectionMesh
 * @property {MeshBuffers|null} opaque
 * @property {MeshBuffers|null} cutout
 * @property {MeshBuffers|null} translucent
 */

/**
 * CORE-A output (SPEC §5.1).
 * @typedef {Object} TextureSet
 * @property {number} size       16
 * @property {number} count      layers
 * @property {Uint8Array} data   RGBA8, size*size*4*count, layer-major, row 0 = TOP row of the image
 * @property {Map<string, number>} index
 * @property {(key: string) => number} layer   base layer for a key ('missing' layer for unknown keys)
 */

/**
 * @typedef {Object} WorldMeta
 * @property {string} id @property {string} name @property {number} seed
 * @property {'default'|'flat'|'islands'|'snowy'} preset
 * @property {'creative'|'survival'} mode
 * @property {'peaceful'|'easy'|'normal'} difficulty
 * @property {object} rules                   DEFAULT_RULES shape
 * @property {number} createdAt @property {number} lastPlayed @property {number} playTicks
 * @property {{x:number,y:number,z:number}} spawn
 * @property {{x:number,y:number,z:number,yaw:number}|null} home
 * @property {string|null} thumbnail          data URL (jpeg) or null
 * @property {number} formatVersion
 * @property {Object<string, object>} systems system.serialize() outputs keyed by system name
 */

/**
 * The global game object (SPEC §3.2). Systems are also reachable as game.<name> shortcuts.
 * @typedef {Object} Game
 */

export {};
