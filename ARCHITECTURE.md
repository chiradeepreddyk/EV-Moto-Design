# Moto Geometry — Architecture & Data Flow

A complete walkthrough of what this codebase is, how it is layered, and how a single
keystroke travels from an input box to every dependent number on the screen.

---

## 1. What the application is

Moto Geometry is a **single-page, zero-dependency browser application** for motorcycle
concept architecture. It links packaging, chassis geometry, suspension, mass properties,
powertrain, battery studies and Energy/E-E closure into **one governed working
configuration**.

- Open `index.html` directly in a browser. No build, no npm, no server, no network.
- All state lives in memory and `localStorage`.
- All physics is hand-written JavaScript — no external solver, no CAD kernel, no 3D model.

### The one idea that explains every design decision

> **A finite number is not an accepted design.**

The codebase keeps *mathematical validity* and *engineering acceptance* as two
independent axes. Every result object carries both:

| Axis | Field | Values |
| --- | --- | --- |
| Did the maths run? | `runtime` | `current` · `stale` · `failed` |
| Is it engineering-approved? | `assessment` | `not_evaluated` · `conflict_invalid` |

A perfectly valid calculation is still `not_evaluated`. Nothing in the app can promote a
number to "approved" — that requires physical validation outside the tool. This is why
you see release gates permanently reading *not evaluated*, benchmark tables that state
they can never create a pass, and a disclaimer notice on nearly every panel.

---

## 2. File layout

### Loaded by the application (the live app is only these 5 scripts + HTML + CSS)

| File | Size | Role | Global it publishes |
| --- | --- | --- | --- |
| `index.html` | 2.6 KB | Shell only: header, context bar, empty `#nav` + `#main` | — |
| `styles.css` | 15 KB | Responsive layout, badge/status colours | — |
| `prd-data.js` | 12 KB | Tab order, every default value, component catalogue, source notes | `window.PRD_DATA` |
| `powertrain-benchmarks.js` | 4 KB | 5 frozen reference motorcycles with provenance URLs | `window.POWERTRAIN_BENCHMARKS` |
| `transmission-benchmarks.js` | 19 KB | 39 curated reference gearboxes for the Powertrain comparison | `window.TRANSMISSION_BENCHMARKS` |
| `engineering-core.js` | 78 KB | **All physics.** Pure functions, zero DOM access | `window.EngineeringCore` |
| `app.js` | 120 KB | State, persistence, rendering, SVG, canvas, events | *(IIFE, no export)* |

### Not loaded (development / verification only)

| File | Status |
| --- | --- |
| `verify-core.js` | Node.js regression suite. Run with `node verify-core.js` |
| `BMS_40_HOUR_CURRICULUM.md` | Standalone training document, unrelated to the app |

### Dead code — 1.86 MB of the repo's 2.5 MB

These three files are **not referenced by `index.html` and nothing imports them**. They
target DOM element IDs (`elecSeriesCells`, `elecPackMass`, …) that no longer exist in the
current HTML. They are leftovers from an earlier version of the application.

| File | Size | Note |
| --- | --- | --- |
| `gearing-commander-dataset.js` | 1.8 MB | 2,037 scraped motorcycle gearing records. `transmission-benchmarks.js` was extracted from it, so it now serves only as the archive that extract came from — the running app never loads it. |
| `electrical-architecture.js` | 38 KB | Older standalone electrical calculator with its own preset system |
| `engineering-calculators.js` | 28 KB | Older standalone calculator page |

Deleting all three would not change application behaviour.

### Referenced but missing

`README.md` points to `output/documents/Moto_Geometry_PRD_v1.3.docx` and
`output/documents/Moto_Geometry_PRD_Data_Contract_v1.3.json`. **Neither the folder nor the
files exist in the repository.** The governing PRD is therefore not in version control;
`prd-data.js` and `verify-core.js` are the only surviving encoding of the contract.

---

## 3. Layering

Load order in `index.html` is also the dependency order — each layer may only read
downward, never upward.

```
┌──────────────────────────────────────────────────────────────┐
│  index.html      shell: #nav (empty) + #main (empty)         │
└──────────────────────────────────────────────────────────────┘
                              ▲ writes innerHTML
┌──────────────────────────────────────────────────────────────┐
│  app.js          state · localStorage · render · events      │
│                  10 renderers · 5 SVG diagrams · 4 charts    │
└──────────────────────────────────────────────────────────────┘
             ▲ calls Core.calculate(state)      ▲ reads
┌────────────────────────────────────┐  ┌─────────────────────┐
│  engineering-core.js               │  │ powertrain-         │
│  pure physics · no DOM · no state  │  │ benchmarks.js       │
└────────────────────────────────────┘  └─────────────────────┘
             ▲ reads defaults & notes
┌──────────────────────────────────────────────────────────────┐
│  prd-data.js     tabs · defaults · componentDefaults · notes │
└──────────────────────────────────────────────────────────────┘
```

Every file is wrapped as `(function (global) { "use strict"; … })(window)`. There are no
ES modules, no bundler, no global namespace pollution beyond the three published objects.

**The critical boundary:** `engineering-core.js` never touches `document`. That is what
lets `verify-core.js` load it in Node with nothing but a `global.window = global` shim.

---

## 4. The state object

One plain object holds the entire configuration. It is assembled in `loadState()`
(`app.js:68`) by cloning `PRD_DATA.defaults`, then deep-merging anything stored in
`localStorage`.

```js
state = {
  meta: {
    project, configuration, revision,        // revision increments on EVERY edit
    units, frame, loadCase,                  // Kerb | Solo rider | Rider + pillion
    dutyCase,                                // Road | Urban | Grade | Performance duty
    electricalScenario,                      // drive | charge | off
    architectureVariant,                     // 5 E/E topology templates
    domainRevisions: { stance, steering, … } // per-domain revision counters
  },
  stance:     { … },   // 55 fields: wheelbase, rake, tyres, hardpoints, rider anthropometry
  steering:   { … },   // offsets, bracket span, study angles, fork spring
  suspension: { … },   // fork geometry, rear architecture, linkage hardpoints
  antiSquat:  { … },   // drive type, analysis step count
  sensitivity:{ … },   // parameter path, step, tolerance
  sag:        { … },   // dual-rate spring models front & rear
  powertrain: { … },   // torque-speed envelope, 6 gears, sprockets, duty point
  vehicle:    { … },   // road-load study inputs
  battery:    { … },   // range, charge, runtime study inputs
  electrical: { … },   // cell chemistry, S/P counts, DC-DC, OBC, cable, precharge
  components: [ … ]    // 15 electrical component instances (mass, X/Z, power, states)
}
```

### Two localStorage keys, deliberately separate

| Key | Holds | Bumps revision? |
| --- | --- | --- |
| `moto-geometry-prd-v1.3` | The engineering configuration above | **Yes** |
| `moto-geometry-ui-v1.3` | Diagram node positions, view layer, open/closed panels | **No** |

This separation is enforced on purpose: dragging a node in the electrical network diagram
is a *presentation* change and must never create a design revision.

### Legacy migration

`loadState()` also repairs old saved data — it collapses retired scenario names
(`ready_to_drive`, `derate`) into the three supported macro states, restores duty
duration/gear if out of range, and deletes obsolete `measuredFrontStatic`-style sag keys
that a previous version wrote.

---

## 5. The solver chain

`EngineeringCore.calculate(state)` (`engineering-core.js:1005`) runs the whole model in a
fixed order. Each function returns either `{ ok: true, … }` or `invalid("message")` —
there is no exception-based control flow, and **no partial result is ever presented as
current**.

```
                    ┌─────────────────────────────┐
                    │ componentMassProperties ×3  │  ← solved for all 3 load cases
                    │   Kerb / Solo / Pillion     │     every time
                    └──────────────┬──────────────┘
                                   │ CG, front & rear axle load
      ┌───────────┬────────────────┼───────────────┬──────────────┐
      ▼           ▼                ▼               ▼              ▼
 ergonomics    steering        suspension       gearing      electrical
 (2-link IK)  (trail, flop,   (swingarm arc,   (ratios,     (pack model,
              wheelie limit)   linkage, MR)     sprockets)   graph, LV)
                  │                │               │              │
                  └────────┬───────┘               ├──────────────┤
                           ▼                       ▼              ▼
                          sag                 vehicleStudy   batteryStudy
                   (bisection solve)          (road load)    (range/charge)
                           │
                           ▼
                       antiSquat
                  (force-line construction)
                           │
                           ▼
                     sensitivity  ← re-runs calculate() 3× on perturbed clones
```

### What each solver actually does

| Function | Method |
| --- | --- |
| `tyre` | Nominal diameter from width/aspect/rim — the single source of every wheel radius |
| `ergonomics` | Two-link inverse kinematics. `circleIntersections()` finds elbow from shoulder+grip and knee from hip+peg, then reports joint angles and clearances |
| `steering` | Foale trail formula, wheel flop, kinematic turn radius, quasi-static braking transfer, rigid-body wheelie/stoppie limits from live CG |
| `rearKinematicsAt` | Rotates the swingarm about the pivot to a target axle height, then solves the rocker/dogbone linkage by circle intersection. Supports `direct` and `linkage` architectures |
| `suspension` | Sweeps `rearKinematicsAt` across travel, differentiates shock vs wheel displacement for local motion ratio, computes wheel rates and the fork air-spring compression |
| `componentMassProperties` | Mass-weighted CG over glider + rider + pillion + luggage + all 15 electrical components; static beam solve for axle loads. Rejects a CG outside the wheelbase |
| `sag` | 64-iteration bisection (`solveSagForce`) finds where dual-rate spring force equals sprung load, front and rear. Rear shock stroke is **interpolated from the linkage curve**, not aliased to wheel travel |
| `antiSquat` | Upper chain tangent between sprocket pitch circles → intersect with the swingarm line → force centre → Foale anti-squat %, cross-checked against the Cossalter reciprocal |
| `gearing` | Transmission tab. 1–6 gear ratio stack, overall ratios, per-gear speed/torque curves, cruise RPM. Final drive on the real hardpoints: ISO 606 open-chain length, even link count chosen inside the axle-adjuster window, closed-form centre distance for that count, axle move, sprocket pitch/outside/root diameters, wrap angle, peak chain tension and safety factor, chain speed, wear recurrence. Also the ±3-tooth sprocket matrix and a current-vs-proposed sprocket comparison. Chains and toothed belts (8M/14M) share one code path |
| `motorSizing` | Motor sizing tab. Max RPM from top speed in the tallest ratio, base RPM from the constant-power speed ratio, then one minimum peak torque per target (top speed, grade at speed, 0–60, 0–100). Acceleration targets are bisected over an explicit-Euler run with instant best-gear selection and an optional wheelie cap. The same runs score the committed motor. Ratios come linked from `gearing` or as one manual overall ratio |
| `braking` | Braking tab. Solo and Rider + pillion cases from live mass properties. Rigid-body load transfer, front-only / rear-only / combined adhesion limits (capped at the stoppie threshold), homologation-form stopping distance, brake torque at the adhesion limit, clamp force, line pressure and lever/pedal effort. Reproduces the KTM 390 sheet |
| `vehicleStudy` | First-order road load: rolling + aero + grade → required power and shaft torque |
| `electrical` | Pack S/P model, quadratic constant-Voc discharge solve, **breadth-first reachability over the LV graph** so a component only counts if it has a live source path, DC-DC headroom, cable drop, precharge RC |
| `batteryStudy` | Required energy → proposed S/P pack, AC supply limits, charge time with taper, two runtime models |
| `sensitivity` | Central difference — clones state, perturbs one parameter ±step, and **calls `calculate()` recursively** on each clone |

### The sensitivity recursion

```js
function sensitivity(state, calculate) {
  const plus  = JSON.parse(JSON.stringify(state));
  const minus = JSON.parse(JSON.stringify(state));
  plus [path[0]][path[1]] += step;
  minus[path[0]][path[1]] -= step;

  const baseResults  = calculate(base,  false);   // ← false disables sensitivity
  const plusResults  = calculate(plus,  false);   //   preventing infinite recursion
  const minusResults = calculate(minus, false);
  …
}
```

This is why the derivatives are *real* — the entire model is re-solved three times rather
than the response being approximated analytically. It also classifies each output as
`linear` / `mildly nonlinear` / `nonlinear` by comparing forward and backward differences.

### The electrical reachability check

The most subtle piece of logic. A low-voltage component is not counted just because it is
selected and enabled in the scenario — the code walks the graph outward from the DC-DC and
LV battery, following only LV power edges that are themselves enabled, and counts a load
**only if it is reachable**:

```js
const reachable = new Set(/* dcdc and lvBattery nodes */);
let changed = true;
while (changed) {
  changed = false;
  graph.edges.filter(/* enabled LV power edges between active nodes */).forEach(edge => {
    if (reachable.has(edge.fromNodeId) && !reachable.has(edge.toNodeId)) {
      reachable.add(edge.toNodeId); changed = true;
    }
  });
}
```

An orphaned load raises the violation *"Active LV component X has no enabled source path"*
rather than silently inflating the power budget.

---

## 6. The render cycle — what a keystroke actually does

There is no virtual DOM and no reactive framework. **Every single input event rebuilds the
entire application HTML.**

```
 user types in an input
          │
          ▼
 ┌────────────────────────────────────────────────┐
 │ bindInputs() listener  (app.js:656)            │
 │  • set(path, value)          write into state  │
 │  • state.meta.revision += 1                    │
 │  • domainRevisions[owner] += 1                 │
 │  • lastChange = "path changed by owner"        │
 │  • stale = new Set(dependencies[owner])        │
 └────────────────────┬───────────────────────────┘
                      ▼
 ┌────────────────────────────────────────────────┐
 │ renderApp()  (app.js:638)                      │
 │  1. recalculate()  → Core.calculate(state)     │
 │                    → persist() to localStorage │
 │  2. build HTML string: closure view + 10 tabs  │
 │  3. #main.innerHTML = html      ← full replace │
 │  4. enhanceRenderedViews()  inject diagrams    │
 │  5. bindInputs()            re-attach ALL      │
 │  6. bindElectricalNetworkInteraction()         │
 │  7. updateChrome()          nav dots, pill     │
 │  8. rAF → drawCharts()      canvas plots       │
 └────────────────────────────────────────────────┘
```

Because `innerHTML` is replaced wholesale, all listeners die and must be rebound every
cycle — hence `bindInputs()` is called from inside `renderApp()`. All 10 tab sections are
rendered every time; CSS `.active` decides which one is visible.

### Staleness propagation

Editing a field does not just invalidate that tab. The `dependencies` map (`app.js:16`)
declares who consumes whom:

```js
stance      → steering, suspension, sag, powertrain, motor_sizing, braking, electrical,
              sensitivity, vehicle_calculators, battery_calculators, anti_squat
steering    → suspension, sag, sensitivity
suspension  → sag, anti_squat, sensitivity
sag         → anti_squat, sensitivity, electrical
powertrain  → motor_sizing, vehicle_calculators, anti_squat, electrical, battery_calculators
electrical  → stance, sag, anti_squat, motor_sizing, braking, vehicle_calculators,
              battery_calculators, sensitivity
vehicle     → motor_sizing          (CdA, Crr and air density are linked into sizing)
```

Downstream tabs get a `stale` badge and a nav dot. Note `electrical → stance`: component
mass feeds back into the CG, so changing a battery mass marks the packaging tab stale.

### Rendering style

Every renderer is a function returning a template literal. There is no component model:

```js
function renderSteering(tab) {
  const o = outputs.steering;
  return `<section class="view ${activeTab === tab.id ? "active" : ""}" …>
    ${viewHead(tab)}
    ${input("steering.upperOffset", "Upper offset", "mm")}
    ${metric("Ground trail", o.groundTrail, { owner: "steering" })}
  </section>`;
}
```

Three helpers do most of the work:

- **`input(path, label, unit, options)`** — emits a field wired by `data-path`, so the
  event handler knows exactly which state key to write.
- **`metric(name, item, options)`** — emits a result card with both badges, resolving
  `failed` if the parent solver returned `ok: false` and `stale` from the stale set.
- **`linkedField(path, …)`** — a read-only mirror of another tab's value, labelled with
  its owner and source revision. This enforces single ownership visually.

`esc()` HTML-escapes every interpolated value, which matters because project names and
component labels are free text.

### The `enhanceRenderedViews()` post-pass

Rather than complicate each renderer, `enhanceRenderedViews()` (`app.js:608`) runs after
`innerHTML` is set and injects diagrams and context controls into the already-rendered DOM.
Transmission, Motor sizing and Braking no longer use it: they render their whole layout
directly, with compact KPI tiles (`kpi`, `kpiStrip`), linked-value lists (`linkedList`) and
standard-value dropdowns with a Custom escape hatch (`stdField`).

---

## 7. Visualisation

### SVG constructions — generated from solver output, not decoration

Five diagrams share one auto-fitting transform, `diagramFrame()` (`app.js:215`), which
takes the extreme points of the construction, adds a 4% margin and computes a **uniform**
scale so X and Z are never distorted:

```js
const scale = Math.min((width - 2*pad)/(xmax - xmin), (height - 2*pad)/(zmax - zmin));
return { scale, tx: x => x0 + x*scale, ty: z => z0 - z*scale };   // note: Z flips
```

| Diagram | Draws |
| --- | --- |
| `steeringDiagram` | Steering axis, fork axis, ground trail, normal trail perpendicular, both tyres |
| `suspensionDiagram` | Rear swingarm at extension/mid/bump, linkage rocker + dogbone, fork travel |
| `antiSquatDiagram` | Sprocket pitch circles, chain tangent, force centre, loaded CG, 100% reference line |
| `sagDiagram` | Loaded chassis against unladen reference, with pitch applied along the wheelbase |
| `powertrainDiagram` | Functional torque path boxes + true-scale sprocket/chain construction |

### Interactive electrical network

`electricalNetwork()` renders nodes and bezier edges. Nodes are draggable via pointer
events and movable with arrow keys for accessibility. Positions are saved under
`architectureVariant:nodeId` in the **UI** preferences key — never in the engineering
state. Edges are dimmed when inactive in the current scenario, and each node's subtitle
shows live power flow (`38.4 kW out`, `312 W LV`).

### Canvas charts

`drawCharts()` plots only the active tab: motion ratio vs travel, anti-squat vs travel,
per-gear speed vs RPM, and a loaded-vs-unladen geometry bar comparison. It handles
`devicePixelRatio` for retina sharpness and redraws on resize.

The newer tabs use `xyChart()`, a small multi-series engine with nice-number ticks on both
axes, an optional right-hand axis, dashed series, reference lines and labelled points:

- **Motor sizing** — torque & power vs RPM (dual axis), wheel torque vs speed per gear with
  road load, wheel power vs speed, speed vs time against the targets, torque vs power.
- **Braking** — ideal front/rear force distribution with front-lock, rear-lock and
  iso-deceleration lines, lever/pedal effort vs deceleration, line pressure vs
  deceleration, stopping distance vs speed.

---

## 8. Verification

`verify-core.js` runs under Node with a one-line shim (`global.window = global`) — possible
only because the core is DOM-free.

```
node verify-core.js
```

It is unusually strict in two ways.

**Numeric fixtures** pin exact values, e.g. the Foale trail case:

```js
near(trail.groundTrail.value, 115.470053838, 1e-6, "Foale ground-trail fixture");
near(defaultOutputs.antiSquat.reciprocalCheck.value, 1, 1e-9, "reciprocal identity");
```

**Source-text assertions** freeze past design mistakes so they cannot return:

```js
check(!/three\.js|gltf|parametric 3d/i.test(text),  "must not contain excluded 3D scope");
check(!appSource.includes('metric("Fork air pressure"'), "Sag UI must not show that card");
check(!/front wheel sag|rear wheel sag/i.test(appSource),
      "Sag UI must not present wheel displacement as sag");
```

That last one is the important one. An earlier version reported rear *wheel* movement and
labelled it "sag". Real sag is *shock stroke*, which differs by the motion ratio. The fix
is now defended by three separate assertions — a numeric one proving the values differ, an
interpolation one proving the linkage curve is used, and a text one preventing the old
wording from reappearing.

Two spreadsheets are frozen as fixtures: the Ather acceleration time-step sheet
(velocity at 1.6 s and 4.0 s) and the KTM 390 braking sheet (dynamic loads, adhesion,
stopping distance, piston area, line pressure, lever and pedal effort, to 0.1 %; the sheet
uses g = 9.81 and π = 3.142).

---

## 9. Quick reference — where to change things

| I want to… | Edit |
| --- | --- |
| Change a default value | `prd-data.js` → `defaults` |
| Add/remove an electrical component | `prd-data.js` → `componentDefaults` |
| Change tab order or labels | `prd-data.js` → `tabs` *(also update `canonicalTabs` in `verify-core.js`)* |
| Add a chain/belt size or brake catalogue value | `prd-data.js` → `finalDriveCatalogue` / `brakeCatalogue` |
| Fix or add physics | `engineering-core.js` — add to the returned object, then surface with `metric()` |
| Change what a tab shows | the matching `renderXxx()` in `app.js` |
| Add a diagram | write a function returning SVG, inject via `enhanceRenderedViews()` |
| Change staleness propagation | `dependencies` map, `app.js:16` |
| Add a power/torque benchmark | `powertrain-benchmarks.js` — `provenance.url` is mandatory |
| Add a transmission reference | `transmission-benchmarks.js` — needs full `gearRatios`, `primaryRatio`, `finalRatio`, `maxRpm`, `tyre` |
| Add a regression guard | `verify-core.js` |

### Conventions worth preserving

1. **Core stays DOM-free.** It is what makes the model testable in Node.
2. **Return `invalid(message)`, never throw.** The UI renders the message verbatim.
3. **Every result goes through `result(value, unit, definition)`** so it carries a unit,
   a plain-English definition and both status badges.
4. **Escape everything** with `esc()` when interpolating into HTML.
5. **Presentation state never touches the engineering revision.**
