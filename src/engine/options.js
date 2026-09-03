/**
 * The stl2step flag set, described once.
 *
 * Three things need to agree about what a flag is called and what it accepts: the options
 * form, the live command preview, and the parser that reads a pasted command back into the
 * form. Writing that knowledge three times guarantees it drifts, so everything below is
 * derived from this one table.
 *
 * Two conventions worth knowing before reading it:
 *
 * `null` means "not set", and an unset option emits no flag at all. Upstream documents a
 * default for `--schema`, `--engine` and `--smooth-angle` but not for the tolerances, so
 * inventing one for `--weld` would silently change what the engine does. Leaving them unset
 * lets the engine's own default stand, and the command preview shows honestly that we are
 * not passing anything.
 *
 * Negative flags are stored as the positive idea. The CLI takes `--no-unify`, but a checkbox
 * reading "Unify coplanar faces" that is on by default is far easier to reason about than one
 * reading "No unify". So the option is `unify: true` and `offFlag` carries the spelling to
 * emit when the user turns it off.
 */

export const ENGINE_VERBATIM = 'verbatim'
export const ENGINE_TRUEFORM = 'trueform'

/** Grouping for the options panel, in display order. */
export const OPTION_GROUPS = [
  {
    id: 'engine',
    label: 'Engine',
    help: 'How faces are reconstructed. The single biggest lever on the result.'
  },
  {
    id: 'geometry',
    label: 'Geometry',
    help: 'How the incoming mesh is interpreted and cleaned up before conversion.'
  },
  {
    id: 'output',
    label: 'Output',
    help: 'What gets written, and how hard the engine tries to certify it.'
  },
  {
    id: 'performance',
    label: 'Performance',
    help: 'Does not affect the geometry, only how long it takes.'
  }
]

export const OPTION_SPEC = [
  // ---- Engine ------------------------------------------------------------
  {
    key: 'engine',
    group: 'engine',
    flag: '--engine',
    type: 'enum',
    default: ENGINE_VERBATIM,
    choices: [
      {
        value: ENGINE_VERBATIM,
        label: 'Verbatim',
        help: 'Keep the mesh exactly as it is. Every triangle becomes a planar face.'
      },
      {
        value: ENGINE_TRUEFORM,
        label: 'TrueForm',
        help: 'Recover analytic surfaces, so a tessellated cylinder becomes a real cylinder.'
      }
    ],
    label: 'Conversion mode',
    help: 'Verbatim is faithful and fast. TrueForm produces cleaner CAD geometry but has to fit surfaces, which takes longer and can fail on noisy meshes.',
    // Upstream also accepts --smooth and --refit for trueform, and --no-smooth for verbatim.
    // We always write the explicit --engine form, but the parser understands the aliases.
    aliases: [
      { flag: '--smooth', value: ENGINE_TRUEFORM },
      { flag: '--refit', value: ENGINE_TRUEFORM },
      { flag: '--no-smooth', value: ENGINE_VERBATIM }
    ]
  },
  {
    key: 'smoothTol',
    group: 'engine',
    flag: '--smooth-tol',
    type: 'number',
    default: null,
    unit: 'mm',
    min: 0,
    step: 0.001,
    label: 'Surface fit tolerance',
    help: 'How far a fitted surface may stray from the mesh. Tighter follows the mesh more closely; looser gives simpler, cleaner surfaces.',
    // Only meaningful when the fitter is actually running.
    requires: { key: 'engine', value: ENGINE_TRUEFORM }
  },
  {
    key: 'smoothAngle',
    group: 'engine',
    flag: '--smooth-angle',
    type: 'number',
    default: null,
    placeholder: '2.0',
    unit: 'deg',
    min: 0,
    step: 0.1,
    label: 'Near flat gate',
    help: 'Normals differing by less than this are treated as one smooth region. Upstream default is 2.0.',
    requires: { key: 'engine', value: ENGINE_TRUEFORM }
  },
  {
    key: 'smoothFillets',
    group: 'engine',
    type: 'bool',
    default: true,
    offFlag: '--no-smooth-fillets',
    label: 'Recover fillets',
    help: 'Try to rebuild rounded edges as true fillet surfaces. Turn off if fillet recovery is distorting the part.',
    requires: { key: 'engine', value: ENGINE_TRUEFORM }
  },

  // ---- Geometry ----------------------------------------------------------
  {
    key: 'units',
    group: 'geometry',
    flag: '--units',
    type: 'enum',
    default: null,
    choices: [
      { value: 'mm', label: 'Millimetres' },
      { value: 'in', label: 'Inches' }
    ],
    label: 'Input units',
    help: 'STL files carry no unit information, so this states what the numbers in the file mean.'
  },
  {
    key: 'scale',
    group: 'geometry',
    flag: '--scale',
    type: 'number',
    default: null,
    placeholder: '1.0',
    min: 0,
    step: 0.1,
    label: 'Extra scale factor',
    help: 'Uniform multiplier applied on top of the unit conversion.'
  },
  {
    key: 'weld',
    group: 'geometry',
    flag: '--weld',
    type: 'number',
    default: null,
    unit: 'mm',
    min: 0,
    step: 0.001,
    label: 'Vertex weld tolerance',
    help: 'Vertices closer together than this are merged into one. This is what stitches a mesh of loose triangles into a connected surface.'
  },
  {
    key: 'unify',
    group: 'geometry',
    type: 'bool',
    default: true,
    offFlag: '--no-unify',
    label: 'Unify coplanar faces',
    help: 'Merge adjacent triangles that lie in the same plane into a single face. Off gives one face per triangle, which is faithful but produces very heavy STEP files.'
  },
  {
    key: 'unifyAngle',
    group: 'geometry',
    flag: '--unify-angle',
    type: 'number',
    default: null,
    unit: 'deg',
    min: 0,
    step: 0.1,
    label: 'Coplanar threshold',
    help: 'How far two normals may differ and still count as the same plane.',
    requires: { key: 'unify', value: true }
  },

  // ---- Output ------------------------------------------------------------
  {
    key: 'schema',
    group: 'output',
    flag: '--schema',
    type: 'enum',
    default: 'AP214',
    choices: [
      { value: 'AP203', label: 'AP203', help: 'Oldest and most widely accepted. Geometry only.' },
      { value: 'AP214', label: 'AP214', help: 'The usual choice for mechanical CAD. Adds colour and assembly data.' },
      { value: 'AP242', label: 'AP242', help: 'Newest. Supersedes both, and carries tolerancing data.' }
    ],
    label: 'STEP schema',
    help: 'The STEP protocol to write. AP214 is the safe default and opens everywhere.'
  },
  {
    key: 'solid',
    group: 'output',
    type: 'bool',
    default: true,
    offFlag: '--no-solid',
    label: 'Emit solids',
    help: 'Try to produce a closed solid body. Off writes open shells instead, which is the right answer for a surface model or a mesh with holes that cannot be repaired.'
  },
  {
    key: 'sewTol',
    group: 'output',
    flag: '--sew-tol',
    type: 'number',
    default: null,
    unit: 'mm',
    min: 0,
    step: 0.001,
    label: 'Repair tolerance',
    help: 'Gap size the repair pass will try to close when sewing faces into a shell.'
  },
  {
    key: 'forceSew',
    group: 'output',
    type: 'bool',
    default: false,
    onFlag: '--force-sew',
    label: 'Force repair pass',
    help: 'Send every body through repair, even ones that already look watertight. Slower, but it can rescue a body that reads as closed and is not.'
  },
  {
    key: 'verify',
    group: 'output',
    type: 'bool',
    default: true,
    offFlag: '--no-verify',
    label: 'Verify after writing',
    help: 'Read the finished STEP back and check it against the source. Worth the time in almost every case: this is what populates the watertight check and the volume comparison.'
  },

  // ---- Performance -------------------------------------------------------
  {
    key: 'threads',
    group: 'performance',
    flag: '--threads',
    type: 'number',
    default: null,
    placeholder: 'all cores',
    min: 1,
    step: 1,
    label: 'Worker threads',
    help: 'Leave unset to use every core. Lower it to keep the machine responsive during a long batch.'
  }
]

/** Spec lookup by option key. */
export const OPTION_BY_KEY = Object.fromEntries(OPTION_SPEC.map((o) => [o.key, o]))

/** A fresh options object with every key at its documented default. */
export function defaultOptions() {
  return Object.fromEntries(OPTION_SPEC.map((o) => [o.key, o.default]))
}

/**
 * Whether an option is currently live, given the rest of the form.
 *
 * `--smooth-tol` does nothing in verbatim mode and `--unify-angle` does nothing with
 * unify off. Dependent options stay visible but disabled, which keeps the panel from
 * reflowing as you change mode, and they are dropped from the built command so we never
 * pass a flag the engine will ignore.
 */
export function isActive(option, options) {
  if (!option.requires) return true
  return options[option.requires.key] === option.requires.value
}

/** Options that differ from their default, for the "modified" count on a group header. */
export function changedKeys(options) {
  return OPTION_SPEC.filter((o) => {
    const v = options[o.key]
    return v !== o.default && isActive(o, options)
  }).map((o) => o.key)
}
