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
check(defaultGraph.edges.filter(edge => edge.graph === "communication").every(edge => edge.voltageDomain === "CAN"), "Communications must remain separate from electrical power edges");
check(defaultGraph.edges.filter(edge => edge.graph === "communication").every(edge => ![edge.fromNodeId, edge.toNodeId].includes("motor")), "Motor phase hardware must not be inferred as a CAN node");
check(defaultGraph.nodes.every(node => ["source","storage","converter","junction","distribution","load"].includes(node.role)), "Power nodes must use the PRD role vocabulary");
check(defaultOutputs.electrical.lvContinuous.value > 0, "Default drive scenario must reach configured active LV loads through the selected topology");
check(defaultGraph.edges.every(edge => ["drive","charge"].some(scenario => edge.enabledStates.split(",").includes(scenario))), "Every functional edge must declare one of the three supported macro scenarios");

for (const variant of ["centralized_pdu", "dashboard_ldu", "front_rear_zonal", "distributed_smart_loads", "redundant_critical_loads"]) {
  const variantState = fixture();
  variantState.meta.architectureVariant = variant;
  const variantOutput = EngineeringCore.calculate(variantState).electrical;
  check(variantOutput.ok === true && variantOutput.graphIssues.length === 0, `Architecture template ${variant} must expand to a valid editable graph`);
}

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
