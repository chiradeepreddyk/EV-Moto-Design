"use strict";

global.window = global;
require("./prd-data.js");
require("./powertrain-benchmarks.js");
require("./engineering-core.js");

const fs = require("fs");
const failures = [];
let checks = 0;

function check(condition, message) {
  checks += 1;
  if (!condition) failures.push(message);
}

function near(actual, expected, tolerance, message) {
  check(Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance, `${message}: expected ${expected} ± ${tolerance}, received ${actual}`);
}

function fixture() {
  const state = JSON.parse(JSON.stringify(PRD_DATA.defaults));
  state.components = JSON.parse(JSON.stringify(PRD_DATA.componentDefaults));
  return state;
}

function interpolateShockTravel(points, wheelTravel) {
  const target = Math.max(points[0].wheelTravel, Math.min(points.at(-1).wheelTravel, wheelTravel));
  const upperIndex = points.findIndex(point => point.wheelTravel >= target);
  if (upperIndex <= 0) return points[0].shockTravel;
  const upper = points[upperIndex];
  const lower = points[upperIndex - 1];
  const fraction = (target - lower.wheelTravel) / (upper.wheelTravel - lower.wheelTravel);
  return lower.shockTravel + (upper.shockTravel - lower.shockTravel) * fraction;
}

const canonicalTabs = [
  "stance", "steering", "suspension", "anti_squat", "sensitivity", "sag",
  "powertrain", "vehicle_calculators", "battery_calculators", "electrical"
];
check(JSON.stringify(PRD_DATA.tabs.map(tab => tab.id)) === JSON.stringify(canonicalTabs), "PRD tab IDs and order must remain exact");

const defaultState = fixture();
const defaultOutputs = EngineeringCore.calculate(defaultState);
for (const key of ["massProperties", "ergonomics", "steering", "suspension", "sag", "antiSquat", "powertrain", "vehicle", "battery", "electrical", "sensitivity"]) {
  check(defaultOutputs[key]?.ok === true, `Default fixture must close ${key}: ${defaultOutputs[key]?.error || "unknown error"}`);
}
near(defaultOutputs.electrical.electricalMass.value, defaultOutputs.massProperties.electricalMass, 1e-9, "Electrical mass must be counted once in Mass Properties");
near(defaultOutputs.electrical.massReconciliation.value, 0, 1e-9, "Electrical mass reconciliation");
near(defaultOutputs.antiSquat.reciprocalCheck.value, 1, 1e-9, "Anti-squat reciprocal identity");
near(defaultOutputs.powertrain.dutyEnergy.value, defaultOutputs.powertrain.shaftPower.value * defaultState.powertrain.dutyDurationMinutes / 60, 1e-9, "Named-duty energy must integrate the entered duration");
check(defaultOutputs.powertrain.dutyCase.gear === defaultState.powertrain.dutyGear, "Named duty must retain its selected gear");
near(defaultOutputs.sag.expectedFrontForkStaticSag.value, defaultOutputs.sag.loadCases.Kerb.frontForkSag, 1e-9, "Expected front static sag must use calculated fork compression");
near(defaultOutputs.sag.expectedRearShockRiderSag.value, defaultOutputs.sag.loadCases["Solo rider"].rearShockSag, 1e-9, "Expected rear rider sag must use calculated shock stroke");
near(defaultOutputs.sag.rearShockSag.value, interpolateShockTravel(defaultOutputs.suspension.points, defaultOutputs.sag.loadedGeometryInput.rearWheelDisplacement), 1e-9, "Active rear sag must interpolate shock stroke at wheel equilibrium");
check(Math.abs(defaultOutputs.sag.rearShockSag.value - defaultOutputs.sag.loadedGeometryInput.rearWheelDisplacement) > 1e-3, "Displayed rear shock sag must not alias rear-wheel displacement");
near(defaultOutputs.sag.expectedRearShockRiderPercent.value, defaultOutputs.sag.expectedRearShockRiderSag.value / defaultOutputs.sag.rearShockTravelAvailable.value * 100, 1e-9, "Expected rear rider percentage must use usable shock stroke");
check(defaultOutputs.sag.loadCases["Solo rider"].frontForkSag >= defaultOutputs.sag.loadCases.Kerb.frontForkSag, "Adding the rider must not reduce front fork sag");
check(defaultOutputs.sag.loadCases["Solo rider"].rearShockSag >= defaultOutputs.sag.loadCases.Kerb.rearShockSag, "Adding the rider must not reduce rear shock sag");
check(!("frontAirPressure" in defaultOutputs.sag) && !("frontSealMargin" in defaultOutputs.sag), "Sag outputs must omit fork-air pressure and seal-margin diagnostics");

const nonGridSagState = fixture();
nonGridSagState.suspension.rearWheelToMetal = 103.7;
nonGridSagState.suspension.sweepSteps = 7;
const nonGridSagOutputs = EngineeringCore.calculate(nonGridSagState);
const nonGridShockAvailable = interpolateShockTravel(nonGridSagOutputs.suspension.points, nonGridSagOutputs.suspension.usableWheelTravel.value);
near(nonGridSagOutputs.sag.rearShockTravelAvailable.value, nonGridShockAvailable, 1e-9, "Usable shock stroke must interpolate a non-grid wheel-travel limit");
near(nonGridSagOutputs.sag.expectedRearShockRiderPercent.value, nonGridSagOutputs.sag.expectedRearShockRiderSag.value / nonGridShockAvailable * 100, 1e-9, "Non-grid rider-sag percentage must use interpolated shock stroke");

for (const architecture of ["direct", "linkage"]) {
  const architectureState = fixture();
  architectureState.suspension.rearArchitecture = architecture;
  const architectureOutputs = EngineeringCore.calculate(architectureState);
  check(architectureOutputs.sag.ok === true && Number.isFinite(architectureOutputs.sag.rearShockSag.value), `${architecture} rear suspension must produce finite shock sag`);
  near(architectureOutputs.sag.rearShockSag.value, interpolateShockTravel(architectureOutputs.suspension.points, architectureOutputs.sag.loadedGeometryInput.rearWheelDisplacement), 1e-9, `${architecture} shock sag must follow the kinematic curve`);
}

const trailState = fixture();
trailState.stance.frontTyreWidth = 144.1;
trailState.stance.frontTyreAspect = 100;
trailState.stance.frontRim = 17;
trailState.stance.targetRake = 30;
trailState.steering.upperOffset = 80;
const trail = EngineeringCore.steering(trailState);
near(trail.groundTrail.value, 115.470053838, 1e-6, "Foale ground-trail fixture");
near(trail.normalTrail.value, 100, 1e-6, "Foale normal-trail fixture");

const repeatedRoot = EngineeringCore.solveDischarge(400, 0.1, 400);
check(repeatedRoot.ok === true, "Zero-discriminant discharge boundary must return the repeated root");
near(repeatedRoot.current, 2000, 1e-9, "Zero-discriminant current");

const invalidPackState = fixture();
invalidPackState.electrical.series = 0;
check(EngineeringCore.batteryPack(invalidPackState).ok === false, "Zero series count must be rejected");

const chargeState = fixture();
chargeState.meta.electricalScenario = "charge";
const chargeOutputs = EngineeringCore.calculate(chargeState);
check(chargeOutputs.electrical.ok === true, "Charge scenario must close under the default fixture");
check(chargeOutputs.electrical.busCurrent.value < 0, "Charge current must use the energy-into-storage sign convention");
const offState = fixture();
offState.meta.electricalScenario = "off";
const offOutputs = EngineeringCore.calculate(offState);
check(offOutputs.electrical.ok === true, "Off scenario must close under the default fixture");
near(offOutputs.electrical.lvContinuous.value, 0, 1e-12, "Off scenario continuous LV demand");
near(offOutputs.electrical.busCurrent.value, 0, 1e-12, "Off scenario traction/charge current");

const defaultGraph = defaultOutputs.electrical.graph;
check(defaultGraph.nodes.some(node => node.componentInstanceId === "dcdc"), "Electrical graph must represent the DC-DC as a physical node");
check(defaultGraph.nodes.some(node => node.componentInstanceId === "lvBattery"), "Electrical graph must represent the LV backup battery as an independent physical node");
check(defaultGraph.edges.some(edge => edge.fromNodeId === "dc_dc" && edge.toNodeId === "pdu"), "Dashboard/LDU template must connect the DC-DC to the PDU");
check(defaultGraph.edges.some(edge => edge.fromNodeId === "lv_battery" && edge.toNodeId === "pdu"), "Dashboard/LDU template must connect the LV backup battery to the PDU");
check(defaultGraph.edges.filter(edge => edge.graph === "communication").every(edge => ["CAN", "signal"].includes(edge.voltageDomain)), "Communications must remain separate from electrical power edges");
check(defaultGraph.edges.filter(edge => edge.graph === "communication").every(edge => ![edge.fromNodeId, edge.toNodeId].includes("motor")), "Motor phase hardware must not be inferred as a CAN node");
check(defaultGraph.nodes.every(node => ["source","storage","converter","junction","distribution","load","filter","sensor"].includes(node.role)), "Power nodes must use the PRD role vocabulary");
check(defaultOutputs.electrical.lvContinuous.value > 0, "Default drive scenario must reach configured active LV loads through the selected topology");
check(defaultGraph.edges.every(edge => ["drive","charge"].some(scenario => edge.enabledStates.split(",").includes(scenario))), "Every functional edge must declare one of the three supported macro scenarios");

// --- Charge path: AC inlet -> filter -> OBC -> HV junction -> pack, with the BMS commanding rather than conducting.
const edgeBetween = (from, to) => defaultGraph.edges.some(edge => edge.fromNodeId === from && edge.toNodeId === to);
check(edgeBetween("ac_inlet", "ac_filter") && edgeBetween("ac_filter", "obc"), "AC charge energy must be filtered between the inlet and the OBC");
check(edgeBetween("obc", "hv_junction"), "OBC output must reach the pack through the HV junction");
check(!defaultGraph.edges.some(edge => edge.graph === "power" && edge.voltageDomain !== "LV" && [edge.fromNodeId, edge.toNodeId].includes("bms")),
  "BMS must never carry HV or AC charge current; it regulates by commanding the OBC");
check(defaultGraph.edges.some(edge => edge.graph === "communication" && edge.fromNodeId === "bms" && edge.toNodeId === "obc" && /CC\/CV/.test(edge.purpose || "")),
  "BMS must command the OBC constant-current / constant-voltage setpoint over the control graph");
check(defaultGraph.edges.some(edge => edge.graph === "communication" && edge.fromNodeId === "throttle" && edge.toNodeId === "vcu_gateway"),
  "Rider throttle demand must enter the control graph at the vehicle controller");
check(defaultGraph.edges.some(edge => edge.graph === "communication" && edge.fromNodeId === "bms" && edge.toNodeId === "vcu_gateway"),
  "BMS must publish pack power limits to the vehicle controller");
check(defaultGraph.edges.filter(edge => edge.graph === "power" && edge.voltageDomain !== "LV").every(edge => edge.toNodeId !== "throttle" && edge.fromNodeId !== "throttle"),
  "Throttle must remain a control-graph sensor and never a power node");
// --- LV distribution: step down at the DC-DC, distribute at the PDU, then dashboard and LDU-fed peripherals.
check(edgeBetween("dc_dc", "pdu") && edgeBetween("pdu", "dashboard") && edgeBetween("pdu", "ldu"),
  "Default LV topology must step down at the DC-DC and distribute through the PDU to the dashboard and LDU");
check(["lighting", "controllers_sensors", "actuators_peripherals"].every(id => edgeBetween("ldu", id)),
  "LDU must feed the configured lamps, controllers and peripheral loads");

for (const variant of ["centralized_pdu", "dashboard_ldu", "front_rear_zonal", "distributed_smart_loads", "redundant_critical_loads"]) {
  const variantState = fixture();
  variantState.meta.architectureVariant = variant;
  const variantOutput = EngineeringCore.calculate(variantState).electrical;
  check(variantOutput.ok === true && variantOutput.graphIssues.length === 0, `Architecture template ${variant} must expand to a valid editable graph`);
}

// --- Steering: head tube to fork centre-to-centre distance.
check(Number.isFinite(defaultOutputs.steering.headTubeToForkCC.value), "Head tube to fork C-C distance must be finite");
const parallelClampState = fixture();
parallelClampState.steering.underBracketOffset = parallelClampState.steering.upperOffset;
const parallelClamp = EngineeringCore.steering(parallelClampState);
near(parallelClamp.headTubeToForkCC.value, parallelClampState.steering.upperOffset, 1e-9,
  "Parallel clamp axes must place the fork axis exactly the upper offset from the steering axis");
const raisedGripState = JSON.parse(JSON.stringify(parallelClampState));
raisedGripState.stance.gripZ = Number(raisedGripState.stance.gripZ) + 250;
near(EngineeringCore.steering(raisedGripState).headTubeToForkCC.value, parallelClamp.headTubeToForkCC.value, 1e-9,
  "Parallel clamp C-C distance must not vary with the measurement height");
check(Math.abs(defaultOutputs.steering.headTubeToForkCC.value - defaultState.steering.upperOffset) > 1e-6,
  "Unequal clamp offsets must converge the axes so C-C is a solved value, not the entered upper offset");

// --- Suspension: retired fork screens must stay retired.
check(!("forkTubeId" in defaultOutputs.suspension) && !("forkSealMargin" in defaultOutputs.suspension),
  "Suspension outputs must omit fork tube ID and seal pressure margin");
check(!("forkWall" in PRD_DATA.defaults.suspension) && !("forkOilVolume" in PRD_DATA.defaults.suspension) && !("frontSealPressureLimit" in PRD_DATA.defaults.suspension),
  "Stanchion wall, fork oil volume and seal pressure screen must be removed from the contract defaults");

// --- Suspension: wheel-referred load vs deflection curves.
const curves = defaultOutputs.sag.loadCurves;
check(curves?.front?.points?.length > 1 && curves?.rear?.points?.length > 1, "Load vs deflection curves must be sampled for both wheels");
for (const side of ["front", "rear"]) {
  const curve = curves[side];
  check(curve.points.every(point => Number.isFinite(point.travel) && Number.isFinite(point.force)), `${side} load curve must be finite throughout`);
  check(curve.points.every((point, index) => index === 0 || point.force >= curve.points[index - 1].force - 1e-9), `${side} load curve must rise monotonically with deflection`);
  near(curve.points.at(-1).travel, curve.maxTravel, 1e-9, `${side} load curve must span the full usable travel`);
  check(curve.markers.every(marker => marker.travel >= 0 && marker.travel <= curve.maxTravel + 1e-9), `${side} curve markers must lie inside the travel domain`);
}
const kerbFrontMarker = curves.front.markers.find(marker => marker.label === "Kerb sag");
near(kerbFrontMarker.travel, defaultOutputs.sag.loadCases.Kerb.frontWheelDisplacement, 1e-9,
  "Front kerb marker must sit at the solved kerb equilibrium");
const riderRearMarker = curves.rear.markers.find(marker => marker.label === "Solo rider sag");
near(riderRearMarker.travel, defaultOutputs.sag.loadCases["Solo rider"].rearWheelDisplacement, 1e-9,
  "Rear rider marker must sit at the solved rider equilibrium");

// --- Battery: LV demand is a sizing input, not a display figure.
near(defaultOutputs.battery.requiredLoadEnergy.value,
  defaultOutputs.battery.tractionLoadEnergy.value + defaultOutputs.battery.lvEnergyOverRange.value, 1e-9,
  "Required load energy must be traction energy plus LV auxiliary energy");
near(defaultOutputs.battery.lvContinuousDemand.value, defaultOutputs.electrical.lvContinuous.value / 1000, 1e-9,
  "Battery sizing must consume the LV continuous demand solved by Energy and E/E");
near(defaultOutputs.battery.lvPeakDemand.value, defaultOutputs.electrical.lvPeak.value / 1000, 1e-9,
  "Battery sizing must consume the LV peak demand solved by Energy and E/E");
check(defaultOutputs.battery.lvEnergyOverRange.value > 0, "Default drive scenario must contribute non-zero LV energy to pack sizing");
const noLoadState = fixture();
noLoadState.meta.electricalScenario = "off";
const noLoadBattery = EngineeringCore.calculate(noLoadState).battery;
near(noLoadBattery.requiredLoadEnergy.value, noLoadBattery.tractionLoadEnergy.value, 1e-9,
  "With no LV demand the sizing must reduce exactly to the traction-only case");

// --- Curated transmission benchmark catalogue.
require("./transmission-benchmarks.js");
const transmissions = global.TRANSMISSION_BENCHMARKS;
check(Array.isArray(transmissions.records) && transmissions.records.length >= 30, "Transmission benchmark catalogue must carry a usable comparison set");
check(["Sport", "Naked", "Adventure", "Touring", "Cruiser"].every(category => transmissions.records.some(record => record.benchmarkCategory === category)),
  "Transmission benchmarks must span every declared cohort");
check(transmissions.records.every(record => Array.isArray(record.gearRatios) && record.gearRatios.length >= 3 && record.gearRatios.every(ratio => ratio > 0)),
  "Every transmission benchmark must publish a positive gear-ratio stack");
check(transmissions.records.every(record => record.primaryRatio > 0 && record.finalRatio > 0 && record.maxRpm > 0 && record.tyre?.nominalCircumferenceMm > 0),
  "Every transmission benchmark must carry primary, final, max RPM and tyre circumference for the RPM comparison");
check(transmissions.records.every(record => record.sourceCategory && record.id && record.label), "Transmission benchmarks must retain upstream identity and category for audit");

const expectedCurrentRuntime = defaultOutputs.electrical.pack.capacityAh *
  ((defaultState.electrical.socMax - defaultState.electrical.socMin) / 100) *
  defaultState.battery.capacityDerate / defaultState.battery.runtimeCurrent;
near(defaultOutputs.battery.currentRuntime.value, expectedCurrentRuntime, 1e-9, "Constant-current runtime must use usable Ah without path energy efficiency");

for (const file of ["index.html", "app.js", "engineering-core.js", "prd-data.js", "powertrain-benchmarks.js", "styles.css"]) {
  const text = fs.readFileSync(file, "utf8");
  check(!/three\.js|react three|gltf|\bglb\b|model_3d|parametric 3d/i.test(text), `${file} must not contain excluded visual-model scope`);
}
const html = fs.readFileSync("index.html", "utf8");
check(!/id="(?:electricalScenario|architectureVariant|dutyCase)"/.test(html), "Domain-specific context selectors must not remain in the global context bar");
const appSource = fs.readFileSync("app.js", "utf8");
for (const diagram of ["steeringDiagram", "suspensionDiagram", "antiSquatDiagram", "sagDiagram", "powertrainDiagram", "electricalNetwork"]) check(appSource.includes(`function ${diagram}`), `${diagram} must remain implemented`);
check(appSource.includes('const electricalScenarios = [["drive","Drive"],["charge","Charge"],["off","Off"]]'), "Electrical scenario selector must contain exactly Drive, Charge and Off");
check(!appSource.includes("Measured sag checks"), "Measured sag UI must be replaced by calculated expected sag");
check(appSource.includes("Front fork sag") && appSource.includes("Rear shock sag"), "Sag UI must report suspension-member sag");
check(!appSource.includes('metric("Fork air pressure"') && !appSource.includes('metric("Fork seal margin"'), "Sag UI must not show fork-air pressure or seal-margin cards");
check(!/front wheel sag|rear wheel sag|expected front sag|expected rear sag/i.test(appSource), "Sag UI must not present wheel displacement as sag");
check(appSource.includes("data-electrical-network") && appSource.includes("electricalNodePositions") && appSource.includes("reset-network-layout"), "Electrical network must support presentation-only node positioning and reset");
check(appSource.includes("data-stance-advanced") && appSource.includes("lock-stance-advanced"), "Stance must provide a collapsed, lockable advanced editor");
check(Array.isArray(POWERTRAIN_BENCHMARKS.records) && POWERTRAIN_BENCHMARKS.records.length >= 4, "Powertrain benchmark catalogue must contain representative records");
check(["Sport","Naked","Adventure","Touring"].every(category => POWERTRAIN_BENCHMARKS.records.some(record => record.category === category)), "Powertrain benchmark catalogue must cover the requested motorcycle categories");
check(POWERTRAIN_BENCHMARKS.records.every(record => record.provenance?.url && record.provenance?.sourceType && record.provenance?.qualityFlag), "Every powertrain benchmark record must carry source and evidence quality");

if (failures.length) {
  console.error(`FAIL — ${failures.length} of ${checks} checks failed`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`PASS — ${checks} PRD/core checks`);
