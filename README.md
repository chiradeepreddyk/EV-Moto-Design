# Moto Geometry

Moto Geometry is a self-contained browser application implementing the product contract in `Moto_Geometry_PRD_v1.3`, extended to twelve modules. It links package, geometry, suspension, braking, mass properties, transmission, motor sizing, battery studies, and Energy & E/E concept closure through one governed working configuration.

Open `index.html` directly in a modern browser. No package installation, build step, external model, or network resource is required.

Steering, suspension, anti-squat, sag and powertrain include live solver-scaled 2D engineering constructions. Sag reports calculated front-fork compression and rear-shock stroke for Kerb/static, Solo-rider and active load cases. Rear shock sag is interpolated from the linkage kinematics at the solved equilibrium; wheel displacement is retained only for loaded-geometry calculations. Energy & E/E Integration provides a connected functional component network with selectable All, HV, LV and communications views. Nodes can be repositioned as a presentation-only layout without changing package coordinates, mass, CG or revision. It is not a harness-routing or production schematic tool.

**Braking** sizes front and rear hardware against the live Solo and Rider + pillion axle loads and CG height. Disc diameter, master-cylinder bore, caliper piston size and count, caliper architecture and pad compound are dropdowns of production sizes, each with a Custom entry; the effective disc radius is calculated from disc OD and pad height. It reports adhesion limits, stopping distance, brake torque, clamp force, line pressure and lever/pedal effort, with distribution, effort, pressure and stopping-distance charts.

**Transmission** owns the 1–6 speed ratio stack (1 = single-speed reduction), sprockets and final drive. Chain length and link count are solved for the real drive-sprocket and axle hardpoints, the link count is chosen to fit the axle-adjuster window, and sprocket diameters, wrap, chain tension and safety factor, a ±3-tooth sprocket matrix and a current-vs-proposed comparison are shown. 415–532 chains and 8M/14M toothed belts are supported.

**Motor sizing** back-solves the motor peak torque, peak power, base and max RPM from max speed, inclination and speed on it, and 0–60 / 0–100 times, through the overall ratios linked from Transmission or one manually entered ratio. It owns the committed motor envelope and duty case, compares the committed motor with the targets, and can apply the required motor in one step.

Motor sizing includes a small, versioned benchmark catalogue spanning Sport, Naked, Adventure and Touring references. Manufacturer-rated power, torque and any explicitly published final-drive data are shown with source links and missing fields are left blank. Benchmark deltas are descriptive context only and never create an engineering pass/fail result. Electrical study scenarios are intentionally limited to Drive, Charge and Off.

The mechanical duty case (on Motor sizing) names an operating point used by Transmission, Battery and Energy & E/E. Its engineering definition is the entered torque, RPM, duration and gear. The Road, Urban, Grade and Performance names do not silently inject preset assumptions.

## Application files

- `index.html` — application entry point
- `styles.css` — responsive professional interface
- `prd-data.js` — exact tab order, canonical IDs, defaults, and source notes
- `powertrain-benchmarks.js` — sourced, contextual motorcycle benchmark records
- `transmission-benchmarks.js` — curated reference gearboxes for the Transmission overlay
- `engineering-core.js` — calculations and central services
- `app.js` — state, information flow, status, and rendering
- `verify-core.js` — frozen regression and scope checks
- `output/documents/Moto_Geometry_PRD_v1.3.docx` — governing PRD
- `output/documents/Moto_Geometry_PRD_Data_Contract_v1.3.json` — machine-readable contract

The site distinguishes runtime state from engineering assessment. A finite result is not automatically an accepted design. First-order electrical, road-load, ergonomic, and geometry screens do not establish safety, compliance, durability, thermal performance, or production readiness.

To run the core checks with Node.js:

```text
node verify-core.js
```
