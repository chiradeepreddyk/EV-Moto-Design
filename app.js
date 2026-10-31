(function () {
  "use strict";

  const DATA = window.PRD_DATA;
  const Core = window.EngineeringCore;
  const STORAGE_KEY = "moto-geometry-prd-v1.3";
  const UI_STORAGE_KEY = "moto-geometry-ui-v1.3";
  const groups = [
    ["Package", ["stance"]],
    ["Chassis", ["steering", "suspension", "anti_squat", "sensitivity", "sag", "braking"]],
    ["Propulsion and studies", ["powertrain", "motor_sizing", "vehicle_calculators", "battery_calculators"]],
    ["Energy and E/E", ["electrical"]]
  ];
  const ownerTab = { antiSquat: "anti_squat", vehicle: "vehicle_calculators", battery: "battery_calculators", motor: "motor_sizing" };
  const tabFor = owner => ownerTab[owner] || owner;
  const dependencies = {
    stance: ["steering", "suspension", "sag", "powertrain", "motor_sizing", "braking", "electrical", "sensitivity", "vehicle_calculators", "battery_calculators", "anti_squat"],
    steering: ["suspension", "sag", "sensitivity"],
    suspension: ["sag", "anti_squat", "sensitivity"],
    antiSquat: ["sensitivity"],
    sag: ["anti_squat", "sensitivity", "electrical"],
    powertrain: ["motor_sizing", "vehicle_calculators", "anti_squat", "electrical", "battery_calculators"],
    electrical: ["stance", "sag", "anti_squat", "motor_sizing", "braking", "vehicle_calculators", "battery_calculators", "sensitivity"],
    motor: [],
    braking: [],
    battery: [],
    vehicle: ["motor_sizing"],
    sensitivity: []
  };

  let state = loadState();
  let outputs = {};
  let activeTab = location.hash.replace("#", "") || "closure";
  if (activeTab !== "closure" && !DATA.tabs.some(tab => tab.id === activeTab)) activeTab = "closure";
  let stale = new Set();
  let lastChange = "Initial PRD configuration loaded";
  let fieldSequence = 0;
  let electricalViewLayer = "all";
  let selectedElectricalNodeId = "battery";
  let benchmarkCategory = "All";
  let transmissionReferenceId = "";
  let comboMetric = "topSpeed";
  const customFields = new Set();
  let stanceAdvancedOpen = false;
  let lastNetworkDragAt = 0;
  const uiPreferences = loadUiPreferences();
  const electricalNodePositions = uiPreferences.electricalNodePositions || {};
  electricalViewLayer = ["all","hv","lv","communications"].includes(uiPreferences.electricalViewLayer) ? uiPreferences.electricalViewLayer : "all";
  benchmarkCategory = uiPreferences.benchmarkCategory || "All";
  transmissionReferenceId = uiPreferences.transmissionReferenceId || "";
  comboMetric = uiPreferences.comboMetric || "topSpeed";
  (uiPreferences.customFields || []).forEach(path => customFields.add(path));
  stanceAdvancedOpen = Boolean(uiPreferences.stanceAdvancedOpen);

  function loadUiPreferences() {
    try { return JSON.parse(localStorage.getItem(UI_STORAGE_KEY)) || {}; } catch (_) { return {}; }
  }
  function persistUiPreferences() {
    uiPreferences.electricalNodePositions = electricalNodePositions;
    uiPreferences.electricalViewLayer = electricalViewLayer;
    uiPreferences.benchmarkCategory = benchmarkCategory;
    uiPreferences.transmissionReferenceId = transmissionReferenceId;
    uiPreferences.comboMetric = comboMetric;
    uiPreferences.customFields = [...customFields];
    uiPreferences.stanceAdvancedOpen = stanceAdvancedOpen;
    localStorage.setItem(UI_STORAGE_KEY, JSON.stringify(uiPreferences));
  }

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function mergeDeep(target, source) {
    if (!source || typeof source !== "object") return target;
    Object.keys(source).forEach(key => {
      if (source[key] && typeof source[key] === "object" && !Array.isArray(source[key])) {
        target[key] = mergeDeep(target[key] && typeof target[key] === "object" ? target[key] : {}, source[key]);
      } else target[key] = source[key];
    });
    return target;
  }
  function loadState() {
    const base = clone(DATA.defaults);
    base.components = clone(DATA.componentDefaults);
    try {
      const stored = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (stored) {
        mergeDeep(base, stored);
        const storedComponents = new Map((stored.components || []).map(component => [component.id, component]));
        const required = DATA.componentDefaults.map(component => ({ ...clone(component), ...(storedComponents.get(component.id) || {}) }));
        const custom = (stored.components || []).filter(component => !DATA.componentDefaults.some(item => item.id === component.id));
        base.components = [...required, ...custom];
      }
    } catch (_) {}
    base.components.forEach(component=>{
      const legacy=String(component.states||"").split(",").map(value=>value.trim());
      const macro=[];
      if(legacy.some(value=>["drive","ready_to_drive","derate"].includes(value)))macro.push("drive");
      if(legacy.includes("charge"))macro.push("charge");
      if(legacy.includes("off"))macro.push("off");
      component.states=[...new Set(macro.length?macro:["drive"])].join(",");
    });
    if (!(Number(base.powertrain.dutyDurationMinutes) > 0)) base.powertrain.dutyDurationMinutes = Number(DATA.defaults.powertrain.dutyDurationMinutes || 10);
    if (!(Number(base.powertrain.dutyGear) >= 1 && Number(base.powertrain.dutyGear) <= 6)) base.powertrain.dutyGear = Number(DATA.defaults.powertrain.dutyGear || 3);
    const gearCount = Math.max(1, Math.min(6, Math.round(Number(base.powertrain.gearCount) || 6)));
    if (Number(base.powertrain.dutyGear) > gearCount) base.powertrain.dutyGear = gearCount;
    const legacyScenario = String(base.meta.electricalScenario || "off");
    base.meta.electricalScenario = legacyScenario === "charge" ? "charge" : ["drive","ready_to_drive","derate"].includes(legacyScenario) ? "drive" : "off";
    ["measuredFrontStatic","measuredFrontRider","measuredRearStatic","measuredRearRider"].forEach(key => delete base.sag[key]);
    return base;
  }
  function persist() { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
  function contractState() {
    return {
      meta: clone(state.meta),
      components: clone(state.components),
      tabs: {
        stance: clone(state.stance), steering: clone(state.steering), suspension: clone(state.suspension),
        anti_squat: clone(state.antiSquat), sensitivity: clone(state.sensitivity), sag: clone(state.sag),
        braking: clone(state.braking), powertrain: clone(state.powertrain), motor_sizing: clone(state.motor), vehicle_calculators: clone(state.vehicle),
        battery_calculators: clone(state.battery), electrical: clone(state.electrical)
      }
    };
  }
  function contractOutputs() {
    return {
      central_services: { mass_properties: outputs.massProperties, mass_cases: outputs.massCases, ergonomics: outputs.ergonomics },
      tabs: {
        steering: outputs.steering, suspension: outputs.suspension, anti_squat: outputs.antiSquat,
        sensitivity: outputs.sensitivity, sag: outputs.sag, braking: outputs.braking, powertrain: outputs.powertrain, motor_sizing: outputs.motor,
        vehicle_calculators: outputs.vehicle, battery_calculators: outputs.battery, electrical: outputs.electrical
      }
    };
  }
  function recalculate() {
    outputs = Core.calculate(state);
    const failures = new Set(Object.entries(outputs).filter(([, value]) => value?.ok === false).map(([key]) => tabFor(key)));
    stale = new Set([...stale].filter(key => failures.has(key)));
    persist();
  }
  function get(path) { return path.split(".").reduce((value, key) => value?.[key], state); }
  function set(path, value) {
    const keys = path.split(".");
    let cursor = state;
    keys.slice(0, -1).forEach(key => cursor = cursor[key]);
    cursor[keys.at(-1)] = value;
  }
  function esc(value) { return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[char])); }
  function fmt(value, digits = 1) {
    if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
    return Number(value).toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
  }

  function input(path, label, unit = "", options = {}) {
    const value = get(path);
    const owner = options.owner || path.split(".")[0];
    const fieldId = `field-${path.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${++fieldSequence}`;
    if (options.type === "select") {
      return `<div class="field ${options.full ? "full" : ""}"><label for="${fieldId}">${esc(label)}</label><select id="${fieldId}" data-path="${esc(path)}" data-owner="${esc(owner)}">${options.values.map(item => {
        const option = typeof item === "string" ? { value: item, label: item } : item;
        return `<option value="${esc(option.value)}" ${String(option.value) === String(value) ? "selected" : ""}>${esc(option.label)}</option>`;
      }).join("")}</select>${options.help ? `<small>${esc(options.help)}</small>` : ""}</div>`;
    }
    const readOnly = options.readOnly ? "readonly aria-readonly=\"true\"" : "";
    return `<div class="field ${options.full ? "full" : ""}"><label for="${fieldId}">${esc(label)}${options.linked ? " · linked" : ""}</label><div class="field-row"><input id="${fieldId}" data-path="${esc(path)}" data-owner="${esc(owner)}" type="${options.type || "number"}" value="${esc(value)}" ${options.step ? `step="${options.step}"` : ""} ${options.min !== undefined ? `min="${options.min}"` : ""} ${readOnly}><span class="unit-label">${esc(unit || "—")}</span></div>${options.help ? `<small>${esc(options.help)}</small>` : ""}</div>`;
  }

  function metric(name, item, options = {}) {
    if (!item) item = { value: null, unit: "", definition: "Result unavailable", runtime: "failed", assessment: "conflict_invalid", evidence: [] };
    const parentInvalid = outputs[options.owner]?.ok === false;
    const runtime = parentInvalid ? "failed" : stale.has(tabFor(options.owner)) ? "stale" : item.runtime || (item.value === null ? "failed" : "current");
    const assessment = parentInvalid ? "conflict_invalid" : item.assessment || "not_evaluated";
    const value = typeof item.value === "string" ? item.value : fmt(item.value, options.digits ?? 1);
    return `<article class="metric"><div class="metric-name">${esc(name)}</div><div class="metric-value">${esc(value)} ${item.unit ? `<small>${esc(item.unit)}</small>` : ""}</div><div class="metric-note">${esc(item.definition || item.note || "")}</div><div class="metric-meta"><span class="badge ${runtime}">${runtime.replace("_", " ")}</span><span class="badge ${assessment}">${assessment.replace("_", " ")}</span>${(item.evidence || []).map(e => `<span class="badge evidence">${esc(e.replaceAll("_", " "))}</span>`).join("")}</div></article>`;
  }

  function invalidNotice(result, label) {
    if (result?.ok !== false) return "";
    return `<div class="notice danger"><strong>${esc(label)} unavailable.</strong> ${esc(result.error || "Invalid or incomplete inputs.")} No previous value is presented as current.</div>`;
  }

  const electricalScenarios = [["drive","Drive"],["charge","Charge"],["off","Off"]];
  const architectureVariants = [
    ["dashboard_ldu","Dashboard + LDU"],["centralized_pdu","Centralized PDU"],["front_rear_zonal","Front / rear zonal"],
    ["distributed_smart_loads","Distributed smart loads"],["redundant_critical_loads","Redundant critical loads"]
  ];
  function optionList(items, selected) { return items.map(([value,label]) => `<option value="${esc(value)}" ${String(value) === String(selected) ? "selected" : ""}>${esc(label)}</option>`).join(""); }
  function electricalContextControls(includeLayer = false, scope = activeTab) {
    return `<div class="local-context" aria-label="Electrical study context">
      <div class="field"><label for="local-electrical-scenario-${scope}">Electrical scenario</label><select id="local-electrical-scenario-${scope}" data-local-meta="electricalScenario">${optionList(electricalScenarios,state.meta.electricalScenario)}</select><small>Drive enables traction, Charge enables inlet/OBC paths, and Off is modelled as de-energised with 0 W demand.</small></div>
      <div class="field"><label for="local-architecture-${scope}">Architecture template</label><select id="local-architecture-${scope}" data-local-meta="architectureVariant">${optionList(architectureVariants,state.meta.architectureVariant)}</select><small>Instantiates an editable functional topology; selection alone does not prove correctness.</small></div>
      ${includeLayer ? `<div class="field"><label for="electrical-view-layer">Network view</label><select id="electrical-view-layer" data-electrical-view><option value="all" ${electricalViewLayer === "all" ? "selected" : ""}>All connections</option><option value="hv" ${electricalViewLayer === "hv" ? "selected" : ""}>HV power</option><option value="lv" ${electricalViewLayer === "lv" ? "selected" : ""}>LV power</option><option value="communications" ${electricalViewLayer === "communications" ? "selected" : ""}>Communications</option></select><small>Presentation only; changing this view does not create a design revision.</small></div>` : ""}
    </div>`;
  }

  function dutyCaseControl(linked = false) {
    const id = `duty-case-${activeTab}`;
    return `<div class="field"><label for="${id}">Mechanical duty case${linked ? " · linked" : ""}</label><select id="${id}" data-duty-case ${linked ? 'data-linked="true"' : ""}>${optionList([["Road duty","Road duty"],["Urban duty","Urban duty"],["Grade duty","Grade duty"],["Performance duty","Performance duty"]],state.meta.dutyCase)}</select><small>Names the propulsion operating point. Current calculations use the entered duty torque and RPM; the name does not inject anonymous preset values.</small></div>`;
  }

  function viewHead(tab, study = false) {
    return `<header class="view-head">${study ? `<span class="study-label">Study · does not commit owner data</span>` : ""}<p class="section-kicker">Tab ${tab.ordinal} · PRD v${DATA.version}</p><h2>${esc(tab.label)}</h2><p>${esc(tab.purpose)}</p></header>`;
  }

  function svgVehicle() {
    const s = state.stance;
    const f = Core.tyre(s.frontTyreWidth, s.frontTyreAspect, s.frontRim);
    const r = Core.tyre(s.rearTyreWidth, s.rearTyreAspect, s.rearRim);
    const W = 900, H = 430, pad = 42;
    const front = { x: Number(s.rearAxleX) + Number(s.wheelbase), z: Number(s.rearAxleZ) + r.radius - f.radius };
    const points = [
      ["PIVOT", 0, 0], ["REAR AXLE", s.rearAxleX, s.rearAxleZ], ["FRONT AXLE", front.x, front.z],
      ["SEAT", s.seatX, s.seatZ], ["GRIP", s.gripX, s.gripZ], ["FOOTPEG", s.pegX, s.pegZ], ["LOWEST", s.lowestPointX, s.lowestPointZ]
    ];
    const frame = diagramFrame([
      {x:Number(s.rearAxleX)-r.radius,z:Number(s.rearAxleZ)-r.radius},{x:Number(s.rearAxleX)+r.radius,z:Number(s.rearAxleZ)+r.radius},
      {x:front.x-f.radius,z:front.z-f.radius},{x:front.x+f.radius,z:front.z+f.radius},
      ...points.map(([,x,z])=>({x:Number(x),z:Number(z)}))
    ],W,H,pad);
    const tx=frame.tx,ty=frame.ty;
    return `<svg class="diagram" viewBox="0 0 ${W} ${H}" role="img" aria-label="Master-frame motorcycle package diagram using entered tyre and hardpoint coordinates">
      <defs><pattern id="grid" width="30" height="30" patternUnits="userSpaceOnUse"><path d="M30 0H0V30" fill="none" stroke="#e6e8e4" stroke-width="1"/></pattern></defs>
      <rect width="${W}" height="${H}" fill="url(#grid)"/><line x1="${pad}" y1="${ty(-r.radius + Number(s.rearAxleZ))}" x2="${W-pad}" y2="${ty(-r.radius + Number(s.rearAxleZ))}" stroke="#a6afa9" stroke-width="2"/>
      <circle cx="${tx(s.rearAxleX)}" cy="${ty(s.rearAxleZ)}" r="${r.radius*frame.scale}" fill="none" stroke="#183f4d" stroke-width="5"/><circle cx="${tx(front.x)}" cy="${ty(front.z)}" r="${f.radius*frame.scale}" fill="none" stroke="#183f4d" stroke-width="5"/>
      <path d="M${tx(s.rearAxleX)} ${ty(s.rearAxleZ)} L${tx(0)} ${ty(0)} L${tx(s.seatX)} ${ty(s.seatZ)} L${tx(s.gripX)} ${ty(s.gripZ)} M${tx(0)} ${ty(0)} L${tx(s.pegX)} ${ty(s.pegZ)} M${tx(s.seatX)} ${ty(s.seatZ)} L${tx(s.pegX)} ${ty(s.pegZ)}" fill="none" stroke="#2b6c86" stroke-width="3" stroke-dasharray="9 7"/>
      ${points.map(([label,x,z]) => `<g><circle cx="${tx(x)}" cy="${ty(z)}" r="5" fill="#d75f36"/><text x="${tx(x)+8}" y="${ty(z)-8}" fill="#334650" font-size="11" font-weight="800">${label} (${fmt(x,0)}, ${fmt(z,0)})</text></g>`).join("")}
      <text x="${pad}" y="24" fill="#61717b" font-size="11" font-weight="800">MASTER FRAME · MM · +X FORWARD · +Z UP</text>
    </svg>`;
  }

  function diagramFrame(points, width = 900, height = 360, pad = 46) {
    const finitePoints = points.filter(point => Number.isFinite(point?.x) && Number.isFinite(point?.z));
    let xmin=Math.min(...finitePoints.map(point=>point.x)),xmax=Math.max(...finitePoints.map(point=>point.x));
    let zmin=Math.min(...finitePoints.map(point=>point.z)),zmax=Math.max(...finitePoints.map(point=>point.z));
    const xSpan=Math.max(1,xmax-xmin),zSpan=Math.max(1,zmax-zmin),margin=Math.max(xSpan,zSpan)*.04;
    xmin-=margin;xmax+=margin;zmin-=margin;zmax+=margin;
    const scale=Math.min((width-2*pad)/(xmax-xmin),(height-2*pad)/(zmax-zmin));
    const usedW=(xmax-xmin)*scale,usedH=(zmax-zmin)*scale;
    const x0=(width-usedW)/2-xmin*scale,z0=(height-usedH)/2+zmax*scale;
    return { width,height,scale,tx:x=>x0+x*scale,ty:z=>z0-z*scale };
  }
  function diagramWheel(frame, centre, radius, options = {}) {
    return `<g opacity="${options.opacity ?? 1}"><circle cx="${frame.tx(centre.x)}" cy="${frame.ty(centre.z)}" r="${radius*frame.scale}" fill="none" stroke="${options.stroke || "#173b4d"}" stroke-width="${options.width || 4}" ${options.dashed?'stroke-dasharray="8 6"':""}/><circle cx="${frame.tx(centre.x)}" cy="${frame.ty(centre.z)}" r="4" fill="${options.stroke || "#173b4d"}"/></g>`;
  }
  function diagramGrid(id, frame, groundZ) {
    return `<defs><pattern id="${id}" width="25" height="25" patternUnits="userSpaceOnUse"><path d="M25 0H0V25" fill="none" stroke="#e8ebe7" stroke-width="1"/></pattern></defs><rect width="${frame.width}" height="${frame.height}" fill="url(#${id})"/><line x1="18" y1="${frame.ty(groundZ)}" x2="${frame.width-18}" y2="${frame.ty(groundZ)}" stroke="#8f9b97" stroke-width="2"/>`;
  }
  function steeringDiagram() {
    const o=outputs.steering,s=state.stance;if(!o?.ok)return invalidNotice(o,"Steering diagram");
    const rearTyre=Core.tyre(s.rearTyreWidth,s.rearTyreAspect,s.rearRim),frontTyre=Core.tyre(s.frontTyreWidth,s.frontTyreAspect,s.frontRim);
    const rear={x:Number(s.rearAxleX),z:Number(s.rearAxleZ)},groundZ=rear.z-rearTyre.radius,front={x:rear.x+Number(s.wheelbase),z:groundZ+frontTyre.radius},contact={x:front.x,z:groundZ};
    const intercept={x:contact.x+o.groundTrail.value,z:groundZ},rake=Number(s.targetRake)*Math.PI/180,axisTop={x:intercept.x-Math.tan(rake)*(frontTyre.radius+430),z:groundZ+frontTyre.radius+430};
    const forkRake=(o.forkRake?.value??Number(s.targetRake))*Math.PI/180,forkTop={x:front.x-Math.sin(forkRake)*Math.max(420,Number(state.suspension.forkLength)),z:front.z+Math.cos(forkRake)*Math.max(420,Number(state.suspension.forkLength))};
    const vx=axisTop.x-intercept.x,vz=axisTop.z-intercept.z,t=((contact.x-intercept.x)*vx+(contact.z-intercept.z)*vz)/(vx*vx+vz*vz),normalFoot={x:intercept.x+t*vx,z:intercept.z+t*vz};
    const extrema=[{x:rear.x-rearTyre.radius,z:groundZ},{x:rear.x+rearTyre.radius,z:rear.z+rearTyre.radius},{x:front.x-frontTyre.radius,z:groundZ},{x:front.x+frontTyre.radius,z:front.z+frontTyre.radius},axisTop,forkTop,{x:Number(s.seatX),z:Number(s.seatZ)},{x:Number(s.gripX),z:Number(s.gripZ)}];
    const f=diagramFrame(extrema,900,390,42);
    return `<svg class="diagram engineering-diagram" viewBox="0 0 900 390" role="img" aria-label="Steering geometry construction in the master coordinate frame">${diagramGrid("steering-grid",f,groundZ)}
      ${diagramWheel(f,rear,rearTyre.radius,{opacity:.35,dashed:true})}${diagramWheel(f,front,frontTyre.radius)}
      <path d="M${f.tx(rear.x)} ${f.ty(rear.z)} L${f.tx(0)} ${f.ty(0)} L${f.tx(s.seatX)} ${f.ty(s.seatZ)} L${f.tx(s.gripX)} ${f.ty(s.gripZ)}" fill="none" stroke="#9aa7a4" stroke-width="2" stroke-dasharray="8 6"/>
      <line x1="${f.tx(intercept.x)}" y1="${f.ty(intercept.z)}" x2="${f.tx(axisTop.x)}" y2="${f.ty(axisTop.z)}" stroke="#d75f36" stroke-width="3"/>
      <line x1="${f.tx(front.x)}" y1="${f.ty(front.z)}" x2="${f.tx(forkTop.x)}" y2="${f.ty(forkTop.z)}" stroke="#173b4d" stroke-width="5"/>
      <line x1="${f.tx(axisTop.x)}" y1="${f.ty(axisTop.z)}" x2="${f.tx(axisTop.x)}" y2="${f.ty(axisTop.z-150)}" stroke="#87928f" stroke-width="2" stroke-dasharray="6 5"/>
      <line x1="${f.tx(intercept.x)}" y1="${f.ty(groundZ+8)}" x2="${f.tx(contact.x)}" y2="${f.ty(groundZ+8)}" stroke="#266b92" stroke-width="4"/>
      <line x1="${f.tx(contact.x)}" y1="${f.ty(contact.z)}" x2="${f.tx(normalFoot.x)}" y2="${f.ty(normalFoot.z)}" stroke="#1f6b50" stroke-width="3"/>
      <text x="${f.tx(axisTop.x)+12}" y="${f.ty(axisTop.z)+18}" fill="#d75f36" font-size="11" font-weight="800">RAKE ${fmt(s.targetRake,1)}°</text>
      <text x="${(f.tx(intercept.x)+f.tx(contact.x))/2}" y="${f.ty(groundZ+8)-10}" text-anchor="middle" fill="#266b92" font-size="11" font-weight="800">GROUND TRAIL ${fmt(o.groundTrail.value,1)} mm</text>
      <text x="${(f.tx(contact.x)+f.tx(normalFoot.x))/2+8}" y="${(f.ty(contact.z)+f.ty(normalFoot.z))/2}" fill="#1f6b50" font-size="10" font-weight="800">NORMAL ${fmt(o.normalTrail.value,1)} mm</text>
      <text x="28" y="25" fill="#61717b" font-size="10" font-weight="800">MASTER FRAME · UNIFORM SCALE · +X FORWARD · +Z UP</text>
      <text x="${f.tx(front.x)}" y="${f.ty(front.z+frontTyre.radius)+18}" text-anchor="middle" fill="#173b4d" font-size="10">F ${s.frontTyreWidth}/${s.frontTyreAspect} R${s.frontRim}</text>
    </svg><p class="diagram-note">The construction is solver-scaled. The faint motorcycle provides package context; the steering axis, fork axis and trail constructions are emphasized.</p>`;
  }

  function suspensionDiagram() {
    const o=outputs.suspension,s=state.stance;if(!o?.ok||!o.points?.length)return invalidNotice(o,"Suspension diagram");
    const rearTyre=Core.tyre(s.rearTyreWidth,s.rearTyreAspect,s.rearRim),frontTyre=Core.tyre(s.frontTyreWidth,s.frontTyreAspect,s.frontRim),groundZ=Number(s.rearAxleZ)-rearTyre.radius;
    const p0=o.points[0],pm=o.points[Math.round((o.points.length-1)/2)],pe=o.points.at(-1),front={x:Number(s.rearAxleX)+Number(s.wheelbase),z:groundZ+frontTyre.radius},rake=Number(s.targetRake)*Math.PI/180,forkTop={x:front.x-Math.sin(rake)*Number(state.suspension.forkLength),z:front.z+Math.cos(rake)*Number(state.suspension.forkLength)},frontBump={x:front.x-Math.sin(rake)*Number(s.frontTravel),z:front.z+Math.cos(rake)*Number(s.frontTravel)},frameMount={x:Number(state.suspension.shockFrameX),z:Number(state.suspension.shockFrameZ)};
    const all=[{x:p0.axle.x-rearTyre.radius,z:groundZ},{x:p0.axle.x+rearTyre.radius,z:p0.axle.z+rearTyre.radius},{x:front.x-frontTyre.radius,z:groundZ},{x:front.x+frontTyre.radius,z:front.z+frontTyre.radius},forkTop,frontBump,frameMount,p0.axle,pm.axle,pe.axle,p0.swingMount,pm.swingMount,pe.swingMount,{x:Number(s.seatX),z:Number(s.seatZ)}].filter(Boolean),f=diagramFrame(all,900,410,44);
    const rearPose=(point,stroke,dashed,opacity)=>`${diagramWheel(f,point.axle,rearTyre.radius,{stroke, dashed,opacity})}<line x1="${f.tx(0)}" y1="${f.ty(0)}" x2="${f.tx(point.axle.x)}" y2="${f.ty(point.axle.z)}" stroke="${stroke}" stroke-width="${dashed?2:4}" ${dashed?'stroke-dasharray="8 6"':""} opacity="${opacity}"/><line x1="${f.tx(frameMount.x)}" y1="${f.ty(frameMount.z)}" x2="${f.tx(point.swingMount.x)}" y2="${f.ty(point.swingMount.z)}" stroke="${stroke}" stroke-width="${dashed?2:5}" ${dashed?'stroke-dasharray="8 6"':""} opacity="${opacity}"/>`;
    const linkage=state.suspension.rearArchitecture==="linkage"&&pm.dogboneSwing&&pm.rockerDogbone?`<path d="M${f.tx(pm.dogboneSwing.x)} ${f.ty(pm.dogboneSwing.z)} L${f.tx(pm.rockerDogbone.x)} ${f.ty(pm.rockerDogbone.z)} L${f.tx(state.suspension.rockerPivotX)} ${f.ty(state.suspension.rockerPivotZ)}" fill="none" stroke="#a66516" stroke-width="4"/><circle cx="${f.tx(state.suspension.rockerPivotX)}" cy="${f.ty(state.suspension.rockerPivotZ)}" r="5" fill="#a66516"/>`:"";
    return `<svg class="diagram engineering-diagram" viewBox="0 0 900 410" role="img" aria-label="Combined front and rear suspension construction through travel">${diagramGrid("suspension-grid",f,groundZ)}
      <path d="M${f.tx(p0.axle.x)} ${f.ty(p0.axle.z)} L${f.tx(0)} ${f.ty(0)} L${f.tx(s.seatX)} ${f.ty(s.seatZ)} L${f.tx(forkTop.x)} ${f.ty(forkTop.z)}" fill="none" stroke="#a5afac" stroke-width="2" stroke-dasharray="8 6"/>
      ${rearPose(p0,"#879794",true,.55)}${rearPose(pe,"#d75f36",true,.55)}${rearPose(pm,"#173b4d",false,1)}${linkage}
      ${diagramWheel(f,front,frontTyre.radius)}${diagramWheel(f,frontBump,frontTyre.radius,{stroke:"#d75f36",dashed:true,opacity:.5})}
      <line x1="${f.tx(front.x)}" y1="${f.ty(front.z)}" x2="${f.tx(forkTop.x)}" y2="${f.ty(forkTop.z)}" stroke="#173b4d" stroke-width="6"/><line x1="${f.tx(frontBump.x)}" y1="${f.ty(frontBump.z)}" x2="${f.tx(forkTop.x)}" y2="${f.ty(forkTop.z)}" stroke="#d75f36" stroke-width="3" stroke-dasharray="8 6"/>
      <text x="28" y="25" fill="#61717b" font-size="10" font-weight="800">FRONT + REAR KINEMATICS · MASTER FRAME · UNIFORM SCALE</text>
      <text x="${f.tx(pm.axle.x)+10}" y="${f.ty(pm.axle.z)-12}" fill="#173b4d" font-size="10" font-weight="800">MID TRAVEL · MR ${fmt(pm.motionRatio,3)}</text>
      <text x="${f.tx(frameMount.x)+10}" y="${f.ty(frameMount.z)-10}" fill="#173b4d" font-size="10">FRAME SHOCK MOUNT</text>
      <text x="${f.tx(front.x)+10}" y="${f.ty(front.z)+18}" fill="#173b4d" font-size="10">FORK ${fmt(state.suspension.forkLength,0)} mm</text>
    </svg><p class="diagram-note">Solid geometry is the mid-travel construction. Dashed outlines show extension and bump. Linkage hardpoints come from the same kinematic solution used for motion ratio.</p>`;
  }

  function antiSquatDiagram() {
    const o=outputs.antiSquat,m=outputs.massProperties,s=state.stance;if(!o?.ok||!o.samples?.length)return invalidNotice(o,"Anti-squat diagram");
    const sample=o.samples[0],rearTyre=Core.tyre(s.rearTyreWidth,s.rearTyreAspect,s.rearRim),frontTyre=Core.tyre(s.frontTyreWidth,s.frontTyreAspect,s.frontRim),groundZ=sample.contact.z,frontContact={x:sample.contact.x+Number(s.wheelbase),z:groundZ},frontCentre={x:frontContact.x,z:groundZ+frontTyre.radius},cg={x:m.cgX,z:m.cgZ},reference={x:frontContact.x,z:groundZ+(cg.z-groundZ)},instant=sample.instant;
    const all=[{x:sample.axle.x-rearTyre.radius,z:groundZ},{x:sample.axle.x+rearTyre.radius,z:sample.axle.z+rearTyre.radius},{x:frontCentre.x-frontTyre.radius,z:groundZ},{x:frontCentre.x+frontTyre.radius,z:frontCentre.z+frontTyre.radius},sample.drive,instant,cg,reference,sample.contact];
    const f=diagramFrame(all,900,390,45),chain=sample.tangent?`<line x1="${f.tx(sample.tangent.drive.x)}" y1="${f.ty(sample.tangent.drive.z)}" x2="${f.tx(sample.tangent.wheel.x)}" y2="${f.ty(sample.tangent.wheel.z)}" stroke="#d97706" stroke-width="4"/>`:"";
    return `<svg class="diagram engineering-diagram" viewBox="0 0 900 390" role="img" aria-label="Anti-squat force-line construction at suspension extension">${diagramGrid("antisquat-grid",f,groundZ)}${diagramWheel(f,sample.axle,rearTyre.radius)}${diagramWheel(f,frontCentre,frontTyre.radius,{opacity:.32,dashed:true})}
      <line x1="${f.tx(0)}" y1="${f.ty(0)}" x2="${f.tx(sample.axle.x)}" y2="${f.ty(sample.axle.z)}" stroke="#173b4d" stroke-width="5"/>
      <circle cx="${f.tx(sample.drive.x)}" cy="${f.ty(sample.drive.z)}" r="${sample.frontPitchRadius*f.scale}" fill="none" stroke="#d97706" stroke-width="3"/><circle cx="${f.tx(sample.axle.x)}" cy="${f.ty(sample.axle.z)}" r="${sample.rearPitchRadius*f.scale}" fill="none" stroke="#d97706" stroke-width="3"/>${chain}
      <line x1="${f.tx(sample.contact.x)}" y1="${f.ty(sample.contact.z)}" x2="${f.tx(instant.x)}" y2="${f.ty(instant.z)}" stroke="#1f6b50" stroke-width="4"/>
      <line x1="${f.tx(sample.contact.x)}" y1="${f.ty(sample.contact.z)}" x2="${f.tx(reference.x)}" y2="${f.ty(reference.z)}" stroke="#266b92" stroke-width="3" stroke-dasharray="8 6"/>
      <circle cx="${f.tx(cg.x)}" cy="${f.ty(cg.z)}" r="7" fill="#d75f36"/><circle cx="${f.tx(instant.x)}" cy="${f.ty(instant.z)}" r="6" fill="#1f6b50"/>
      <text x="28" y="25" fill="#61717b" font-size="10" font-weight="800">EXTENSION CONSTRUCTION · ACTIVE LOAD-CASE CG · UNIFORM SCALE</text>
      <text x="${f.tx(cg.x)+10}" y="${f.ty(cg.z)-8}" fill="#d75f36" font-size="10" font-weight="800">CG (${fmt(cg.x,0)}, ${fmt(cg.z,0)})</text>
      <text x="${f.tx(instant.x)+10}" y="${f.ty(instant.z)-8}" fill="#1f6b50" font-size="10" font-weight="800">FORCE CENTRE</text>
      <text x="${f.tx(sample.contact.x)+10}" y="${f.ty(sample.contact.z)-12}" fill="#1f6b50" font-size="11" font-weight="800">${fmt(sample.anti,1)}% ANTI-SQUAT</text>
    </svg><p class="diagram-note">Green is the calculated drive-force construction; blue is the 100% reference. The shaft-drive option remains a geometric pivot-line screen, not a bevel-gear torque-reaction model.</p>`;
  }

  function sagDiagram() {
    const o=outputs.sag,s=state.stance;if(!o?.ok)return invalidNotice(o,"Loaded-geometry diagram");
    const rearTyre=Core.tyre(s.rearTyreWidth,s.rearTyreAspect,s.rearRim),frontTyre=Core.tyre(s.frontTyreWidth,s.frontTyreAspect,s.frontRim),rear={x:Number(s.rearAxleX),z:Number(s.rearAxleZ)},groundZ=rear.z-rearTyre.radius,front={x:rear.x+Number(s.wheelbase),z:groundZ+frontTyre.radius},row=o.loadCases?.[state.meta.loadCase]||{frontForkSag:o.frontForkSag.value,rearShockSag:o.rearShockSag.value,...o.loadedGeometryInput};
    const frontWheelDisplacement=Number(row.frontWheelDisplacement),rearWheelDisplacement=Number(row.rearWheelDisplacement);
    const body=(x,z)=>{const fraction=(x-rear.x)/Number(s.wheelbase);return {x,z:z-rearWheelDisplacement-(frontWheelDisplacement-rearWheelDisplacement)*fraction};};
    const pivot0={x:0,z:0},seat0={x:Number(s.seatX),z:Number(s.seatZ)},grip0={x:Number(s.gripX),z:Number(s.gripZ)},low0={x:Number(s.lowestPointX),z:Number(s.lowestPointZ)},pivot=body(pivot0.x,pivot0.z),seat=body(seat0.x,seat0.z),grip=body(grip0.x,grip0.z),low=body(low0.x,low0.z);
    const all=[{x:rear.x-rearTyre.radius,z:groundZ},{x:rear.x+rearTyre.radius,z:rear.z+rearTyre.radius},{x:front.x-frontTyre.radius,z:groundZ},{x:front.x+frontTyre.radius,z:front.z+frontTyre.radius},seat0,grip0,low0,seat,grip,low],f=diagramFrame(all,900,390,44);
    return `<svg class="diagram engineering-diagram" viewBox="0 0 900 390" role="img" aria-label="Quasi-static loaded motorcycle geometry for the active load case">${diagramGrid("sag-grid",f,groundZ)}${diagramWheel(f,rear,rearTyre.radius)}${diagramWheel(f,front,frontTyre.radius)}
      <path d="M${f.tx(rear.x)} ${f.ty(rear.z)} L${f.tx(pivot0.x)} ${f.ty(pivot0.z)} L${f.tx(seat0.x)} ${f.ty(seat0.z)} L${f.tx(grip0.x)} ${f.ty(grip0.z)}" fill="none" stroke="#8b9995" stroke-width="3" stroke-dasharray="8 6"/>
      <path d="M${f.tx(rear.x)} ${f.ty(rear.z)} L${f.tx(pivot.x)} ${f.ty(pivot.z)} L${f.tx(seat.x)} ${f.ty(seat.z)} L${f.tx(grip.x)} ${f.ty(grip.z)}" fill="none" stroke="#173b4d" stroke-width="5"/>
      <line x1="${f.tx(low.x)}" y1="${f.ty(low.z)}" x2="${f.tx(low.x)}" y2="${f.ty(groundZ)}" stroke="#1f6b50" stroke-width="4"/>
      <circle cx="${f.tx(low.x)}" cy="${f.ty(low.z)}" r="5" fill="#1f6b50"/>
      <text x="28" y="25" fill="#61717b" font-size="10" font-weight="800">${esc(state.meta.loadCase).toUpperCase()} · QUASI-STATIC LOADED GEOMETRY</text>
      <g transform="translate(650 18)"><rect width="220" height="58" rx="9" fill="#fffaf4" stroke="#d9b68d"/><text x="12" y="22" fill="#7f482d" font-size="10" font-weight="800">FRONT FORK SAG ${fmt(row.frontForkSag,1)} mm</text><text x="12" y="43" fill="#7f482d" font-size="10" font-weight="800">REAR SHOCK SAG ${fmt(row.rearShockSag,1)} mm</text></g>
      <text x="${f.tx(low.x)+8}" y="${(f.ty(low.z)+f.ty(groundZ))/2}" fill="#1f6b50" font-size="10" font-weight="800">CLEARANCE ${fmt(o.loadedClearance.value,1)} mm</text>
    </svg><p class="diagram-note">Solid is the active calculated load case; dashed is the unladen chassis reference. Reported sag is fork/shock stroke. Wheel displacement remains an internal geometry input and is not presented as sag.</p>`;
  }

  function powertrainDiagram() {
    const o=outputs.powertrain;if(!o?.ok)return invalidNotice(o,"Final-drive diagram");
    const rearTyre=o.rearTyre,drive=o.driveCentre,rear=o.rearCentre,groundZ=Number(state.stance.rearAxleZ)-rearTyre.radius,c=o.chain;
    const ux=(rear.x-drive.x)/c.centreDistance,uz=(rear.z-drive.z)/c.centreDistance;
    const along=d=>({x:rear.x+ux*d,z:rear.z+uz*d});
    const slotA=along(-Number(state.powertrain.axleAdjustForward)||0),slotB=along(Number(state.powertrain.axleAdjustRearward)||0),fitted=along(c.axleMove);
    const all=[{x:rear.x-rearTyre.radius,z:groundZ},{x:rear.x+rearTyre.radius,z:rear.z+rearTyre.radius},{x:drive.x-o.frontPitchRadius.value,z:drive.z-o.frontPitchRadius.value},{x:drive.x+o.frontPitchRadius.value+40,z:drive.z+o.frontPitchRadius.value},slotA,slotB];
    const f=diagramFrame(all,900,330,40),line=t=>t?`<line x1="${f.tx(t.drive.x)}" y1="${f.ty(t.drive.z)}" x2="${f.tx(t.wheel.x)}" y2="${f.ty(t.wheel.z)}" stroke="#d97706" stroke-width="4"/>`:"";
    const linkUnit=c.kind==="belt"?"teeth":"links";
    return `<svg class="diagram engineering-diagram" viewBox="0 0 900 330" role="img" aria-label="Final-drive geometry with sprocket pitch circles, chain tangents and axle adjuster window">
      ${diagramGrid("final-drive-grid",f,groundZ)}${diagramWheel(f,rear,rearTyre.radius,{opacity:.45})}
      <line x1="${f.tx(slotA.x)}" y1="${f.ty(slotA.z)}" x2="${f.tx(slotB.x)}" y2="${f.ty(slotB.z)}" stroke="#266b92" stroke-width="10" stroke-linecap="round" opacity=".25"/>
      <circle cx="${f.tx(fitted.x)}" cy="${f.ty(fitted.z)}" r="6" fill="${c.withinAdjuster?"#1f6b50":"#a43a37"}"/>
      <circle cx="${f.tx(drive.x)}" cy="${f.ty(drive.z)}" r="${o.frontPitchRadius.value*f.scale}" fill="none" stroke="#d97706" stroke-width="4"/><circle cx="${f.tx(rear.x)}" cy="${f.ty(rear.z)}" r="${o.rearPitchRadius.value*f.scale}" fill="none" stroke="#d97706" stroke-width="4"/>${line(o.upperChainTangent)}${line(o.lowerChainTangent)}
      <line x1="${f.tx(drive.x)}" y1="${f.ty(drive.z)}" x2="${f.tx(rear.x)}" y2="${f.ty(rear.z)}" stroke="#1f6b50" stroke-width="1.5" stroke-dasharray="6 5"/>
      <text x="22" y="40" fill="#1f6b50" font-size="11" font-weight="800">C ${fmt(c.centreDistance,1)} mm · ${c.recommended} ${linkUnit} · ${fmt(c.length,0)} mm · axle ${c.axleMove>=0?"+":"−"}${fmt(Math.abs(c.axleMove),1)} mm</text>
      <text x="${f.tx(drive.x)}" y="${f.ty(drive.z)-o.frontPitchRadius.value*f.scale-10}" text-anchor="middle" fill="#d97706" font-size="10" font-weight="800">${state.powertrain.frontTeeth}T · Ø${fmt(c.frontDiameters.pitch,1)}</text><text x="${f.tx(rear.x)}" y="${f.ty(rear.z)-o.rearPitchRadius.value*f.scale-10}" text-anchor="middle" fill="#d97706" font-size="10" font-weight="800">${state.powertrain.rearTeeth}T · Ø${fmt(c.rearDiameters.pitch,1)}</text>
      <text x="${f.tx(rear.x)}" y="${f.ty(rear.z)+o.rearPitchRadius.value*f.scale+18}" text-anchor="middle" fill="#266b92" font-size="10" font-weight="800">ADJUSTER −${fmt(state.powertrain.axleAdjustForward,0)} / +${fmt(state.powertrain.axleAdjustRearward,0)} mm</text>
      <text x="22" y="22" fill="#61717b" font-size="10" font-weight="800">FINAL DRIVE · MASTER FRAME · UNIFORM SCALE</text>
    </svg><p class="diagram-note">Pitch circles and tangents use the real drive-sprocket and axle hardpoints. The blue band is the adjuster window; the dot is where the axle sits with the recommended ${c.kind} (green inside the window, red outside).</p>`;
  }

  function canvasChart(id, aria, height = 320) { return `<canvas class="chart" id="${id}" height="${height}" style="height:${height}px" role="img" aria-label="${esc(aria)}"></canvas>`; }

  const markerColours = { sag: "#266b92", transition: "#6e56a0", bumpstop: "#d75f36", limit: "#61717b" };

  function loadDeflectionPanel() {
    const curves = outputs.sag?.loadCurves;
    if (!curves) return `<article class="panel"><h3>Load vs deflection</h3>${invalidNotice(outputs.sag,"Load vs deflection")}</article>`;
    const rows = ["front","rear"].flatMap(side => (curves[side].markers || []).map(marker => `<tr><td>${esc(curves[side].label)}</td><td>${esc(marker.label)}</td><td class="numeric">${fmt(marker.travel,1)} mm</td><td class="numeric">${fmt(marker.force,0)} N</td><td class="numeric">${fmt(marker.travel/Math.max(1e-9,curves[side].maxTravel)*100,1)} %</td></tr>`)).join("");
    const unreachable = [];
    if (!curves.rear.markers.some(marker => marker.kind === "transition")) unreachable.push(`the rear spring transition at ${fmt(state.sag.rearTransition,0)} mm shock stroke is never reached within usable travel, so the second rate never engages`);
    if (!curves.front.markers.some(marker => marker.kind === "transition")) unreachable.push(`the front spring transition at ${fmt(state.sag.frontTransition,0)} mm is at or beyond usable fork travel`);
    return `<article class="panel"><h3>Load vs deflection</h3><p class="panel-intro">Wheel-referred supporting force against wheel deflection, front and rear on common axes. Every suspension result below is located on these curves.</p>
      ${canvasChart("loadDeflectionChart","Front and rear wheel supporting force against wheel deflection with sag, transition, bump-stop and travel-limit markers",360)}
      <div class="chart-legend">${Object.entries({sag:"Load-case sag",transition:"Spring transition",bumpstop:"Bump stop",limit:"Usable travel limit"}).map(([kind,label])=>`<span><i style="background:${markerColours[kind]}"></i>${esc(label)}</span>`).join("")}<span><i style="background:#1f6b50"></i>Front wheel</span><span><i style="background:#a66516"></i>Rear wheel</span></div>
      <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Member</th><th>Point</th><th class="numeric">Deflection</th><th class="numeric">Supporting force</th><th class="numeric">Travel used</th></tr></thead><tbody>${rows}</tbody></table></div>
      ${unreachable.length?`<div class="notice warning" style="margin-top:12px"><strong>Not reached within usable travel.</strong> ${esc(unreachable.join("; "))}.</div>`:""}
      <div class="notice" style="margin-top:12px">${esc(curves.definition)}</div></article>`;
  }

  function drawLoadDeflection(canvas) {
    const curves = outputs.sag?.loadCurves;
    if (!canvas || !curves) return;
    const series = [
      { data: curves.front, colour: "#1f6b50" },
      { data: curves.rear, colour: "#a66516" }
    ].filter(item => item.data?.points?.length);
    if (!series.length) return;
    const maxTravel = Math.max(...series.map(item => item.data.maxTravel));
    const maxForce = Math.max(...series.flatMap(item => item.data.points.map(point => point.force)));
    const view = drawAxes(canvas, "Wheel deflection (mm)", "Supporting force at wheel (N)", 0, maxForce * 1.08);
    series.forEach(item => {
      view.ctx.strokeStyle = item.colour; view.ctx.lineWidth = 3; view.ctx.beginPath();
      item.data.points.forEach((point, index) => {
        const x = view.tx(point.travel, maxTravel), y = view.ty(point.force);
        index ? view.ctx.lineTo(x, y) : view.ctx.moveTo(x, y);
      });
      view.ctx.stroke();
      (item.data.markers || []).forEach(marker => {
        const x = view.tx(marker.travel, maxTravel), y = view.ty(marker.force);
        const colour = markerColours[marker.kind] || "#61717b";
        view.ctx.strokeStyle = colour; view.ctx.lineWidth = 1; view.ctx.setLineDash([3,3]);
        view.ctx.beginPath(); view.ctx.moveTo(x, y); view.ctx.lineTo(x, view.ty(0)); view.ctx.stroke();
        view.ctx.setLineDash([]);
        view.ctx.fillStyle = colour; view.ctx.beginPath(); view.ctx.arc(x, y, 4.5, 0, Math.PI*2); view.ctx.fill();
        view.ctx.fillStyle = "#fff"; view.ctx.beginPath(); view.ctx.arc(x, y, 1.8, 0, Math.PI*2); view.ctx.fill();
      });
    });
    // Labels drawn last so the curves never cover them.
    view.ctx.font = "600 10px Inter, system-ui";
    series.forEach(item => (item.data.markers || []).forEach(marker => {
      const x = view.tx(marker.travel, maxTravel), y = view.ty(marker.force);
      view.ctx.fillStyle = markerColours[marker.kind] || "#61717b";
      view.ctx.textAlign = x > view.W * 0.72 ? "right" : "left";
      view.ctx.fillText(`${marker.label} · ${fmt(marker.travel,0)} mm`, x + (x > view.W * 0.72 ? -8 : 8), y - 8);
    }));
    view.ctx.textAlign = "left";
    series.forEach((item, index) => {
      view.ctx.fillStyle = item.colour; view.ctx.font = "800 11px Inter, system-ui";
      view.ctx.fillText(item.data.label, view.pad.l + 10, view.pad.t + 14 + index * 15);
    });
  }

  function renderClosure() {
    const m = outputs.massProperties || {};
    const issueCount = collectIssues().length;
    const staleCount = stale.size;
    const electrical = outputs.electrical;
    const loaded = outputs.sag;
    return `<section class="view ${activeTab === "closure" ? "active" : ""}" id="view-closure">
      <header class="view-head"><p class="section-kicker">Architecture closure</p><h2>One governed motorcycle configuration</h2><p>Every result is tied to the active revision, coordinate frame, load case, duty case, electrical scenario and architecture variant. Central services aggregate derived results without stealing ownership from engineering tabs.</p></header>
      <div class="summary-strip">
        <div class="summary-card"><span>Total mass</span><strong>${fmt(m.totalMass,1)} kg</strong></div>
        <div class="summary-card"><span>Vehicle CG</span><strong>${fmt(m.cgX,0)}, ${fmt(m.cgZ,0)} mm</strong></div>
        <div class="summary-card"><span>Front / rear load</span><strong>${fmt(m.frontLoadKg,1)} / ${fmt(m.rearLoadKg,1)} kg</strong></div>
        <div class="summary-card"><span>Loaded trail</span><strong>${fmt(loaded?.loadedTrail?.value,1)} mm</strong></div>
        <div class="summary-card"><span>Open issues / stale</span><strong>${issueCount} / ${staleCount}</strong></div>
      </div>
      <div class="grid equal">
        <article class="panel"><h3>Central information</h3><p class="panel-intro">This context accompanies every producer-to-consumer exchange.</p><div class="table-wrap"><table><tbody>
          <tr><th>Configuration</th><td>${esc(state.meta.project)} · ${esc(state.meta.configuration)} · revision ${state.meta.revision}</td></tr>
          <tr><th>Physical context</th><td>${esc(state.meta.units)} · ${esc(state.meta.frame)} · ${esc(state.meta.loadCase)}</td></tr>
          <tr><th>Operating context</th><td>${esc(state.meta.dutyCase)} · ${esc(state.meta.electricalScenario)} · ${esc(state.meta.architectureVariant)}</td></tr>
          <tr><th>Ownership</th><td>One authoritative owner per selected/measured field; calculators propose only.</td></tr>
          <tr><th>Lifecycle</th><td>Calculation version core-1.0 · ${staleCount ? `${staleCount} stale consumer(s)` : "all evaluated consumers current"}</td></tr>
        </tbody></table></div></article>
        <article class="panel"><h3>Closure status</h3><p class="panel-intro">A valid equation is not automatically an accepted design.</p>
          ${collectIssues().length ? `<div class="notice warning"><strong>Review required.</strong><ul>${collectIssues().map(issue => `<li>${esc(issue)}</li>`).join("")}</ul></div>` : `<div class="notice success"><strong>Mathematical closure current.</strong> No implemented domain or cross-service conflicts were detected. External validation and compliance remain not evaluated.</div>`}
          <p class="panel-intro" style="margin-top:14px">Last change: ${esc(lastChange)}</p>
        </article>
      </div>
      <div class="grid equal">
        <article class="panel"><h3>Mechanical flow</h3><p class="panel-intro">Stance owns the master package; central Mass Properties and Loaded Geometry serve every load-dependent consumer.</p>${mechanicalFlow()}</article>
        <article class="panel"><h3>Electrical flow</h3><p class="panel-intro">Power and communications stay separate. The selected variant provides a functional one-line template preview.</p>${electricalFlow(electrical?.graph)}</article>
      </div>
      <article class="panel"><h3>Release gates</h3><div class="table-wrap"><table><thead><tr><th>Gate</th><th>Current interpretation</th><th>Status</th></tr></thead><tbody>${releaseGates().map(row => `<tr><td>${esc(row.name)}</td><td>${esc(row.detail)}</td><td><span class="badge ${row.status}">${esc(row.status.replace("_", " "))}</span></td></tr>`).join("")}</tbody></table></div></article>
    </section>`;
  }

  function mechanicalFlow() {
    return `<div class="flow-grid"><div class="flow-lane" style="border-color:#2f855a;background:#eef7f1"><div class="flow-nodes">${["Stance", "Steering", "Suspension", "Sag + loaded geometry", "Anti-squat"].map((label, i, arr) => `<div class="flow-node">${label}</div>${i < arr.length-1 ? `<div class="flow-arrow">→</div>` : ""}`).join("")}</div></div><div class="flow-lane" style="border-color:#266b92;background:#eef5f9"><div class="flow-nodes"><div class="flow-node">Component instances</div><div class="flow-arrow">→</div><div class="flow-node">Mass Properties</div><div class="flow-arrow">→</div><div class="flow-node">Axle loads + CG</div><div class="flow-arrow">→</div><div class="flow-node">Loaded consumers</div></div></div><div class="notice">Motor sizing owns the committed torque-speed envelope; Transmission owns the ratio stack and final drive. Sensitivity and calculators read a frozen revision and create proposals only.</div></div>`;
  }

  function electricalFlow(graph) {
    if (!graph) return `<div class="notice danger">Electrical graph unavailable.</div>`;
    const lane = (name, className, edges) => `<div class="flow-lane ${className}"><h3>${esc(name)}</h3><div class="edge-list">${edges.map(edge => `<div class="edge-row"><div class="flow-node">${esc(edge[0])}</div><div class="flow-arrow">${edge[2] === "CAN" || edge[2] === "signal" ? "⇄" : "→"}<small>${esc(edge[2])}</small>${edge[3] ? `<em>${esc(edge[3])}</em>` : ""}</div><div class="flow-node">${esc(edge[1])}</div></div>`).join("")}</div></div>`;
    return `<div class="flow-grid">${lane("HV energy", "hv", graph.hv)}${lane("LV distribution", "lv", graph.lv)}${lane("Control / communications", "control", graph.control)}</div>`;
  }

  function electricalNetwork(graph) {
    if (!graph?.nodes?.length) return `<div class="notice danger">Electrical graph unavailable.</div>`;
    const scenario = state.meta.electricalScenario;
    const componentById = new Map(state.components.map(component => [component.id, component]));
    const enabled = item => String(item?.enabledStates || "").split(",").map(value => value.trim()).includes(scenario);
    const active = node => enabled(node) && (!node.componentInstanceId || String(componentById.get(node.componentInstanceId)?.states || "").split(",").map(item => item.trim()).includes(scenario));
    const visibleEdge = edge => electricalViewLayer === "all" || (electricalViewLayer === "communications" ? edge.graph === "communication" : electricalViewLayer === "lv" ? edge.graph === "power" && edge.voltageDomain === "LV" : edge.graph === "power" && edge.voltageDomain !== "LV");
    const powerNodes = graph.nodes.filter(node => graph.edges.some(edge => visibleEdge(edge) && (edge.fromNodeId === node.id || edge.toNodeId === node.id)));
    if (!powerNodes.some(node => node.id === selectedElectricalNodeId)) selectedElectricalNodeId = powerNodes.find(node => node.componentInstanceId)?.id || powerNodes[0]?.id || selectedElectricalNodeId;
    const columns = 5, nodeW = 132, nodeH = 56, gapX = 38, gapY = 38, left = 38, top = 45;
    const allLayoutNodes = graph.nodes.filter(node => graph.edges.some(edge => edge.fromNodeId === node.id || edge.toNodeId === node.id));
    const layoutKey = nodeId => `${state.meta.architectureVariant}:${nodeId}`;
    const positions = new Map(allLayoutNodes.map((node,index) => {
      const base = { x:left+(index%columns)*(nodeW+gapX), y:top+Math.floor(index/columns)*(nodeH+gapY) };
      return [node.id, electricalNodePositions[layoutKey(node.id)] || base];
    }));
    const width = Math.max(850,left*2+columns*nodeW+(columns-1)*gapX), rows = Math.max(1,Math.ceil(allLayoutNodes.length/columns)), height = Math.max(360,top*2+rows*nodeH+(rows-1)*gapY);
    const edges = graph.edges.filter(visibleEdge).map(edge => {
      const a=positions.get(edge.fromNodeId),b=positions.get(edge.toNodeId); if(!a||!b)return "";
      const from=graph.nodes.find(node=>node.id===edge.fromNodeId),to=graph.nodes.find(node=>node.id===edge.toNodeId);
      const className=edge.graph==="communication"?"communication":edge.voltageDomain.toLowerCase()==="lv"?"lv":"hv";
      const inactive=!enabled(edge)||!active(from)||!active(to);
      const x1=a.x+nodeW/2,y1=a.y+nodeH/2,x2=b.x+nodeW/2,y2=b.y+nodeH/2,mid=(x1+x2)/2;
      return `<path class="network-edge ${className} ${inactive?"inactive":""}" data-network-edge data-from-node="${esc(edge.fromNodeId)}" data-to-node="${esc(edge.toNodeId)}" d="M${x1} ${y1} C${mid} ${y1},${mid} ${y2},${x2} ${y2}"><title>${esc(from.label)} to ${esc(to.label)} · ${esc(edge.voltageDomain)}${inactive?` · inactive in ${scenario}`:""}</title></path>`;
    }).join("");
    const subtitle = (node, component, isActive) => {
      if (!isActive) return `inactive · ${scenario}`;
      if (!component) return "path active";
      if (component.id === "battery") return scenario === "charge" ? `${fmt(outputs.electrical?.packChargePower?.value,1)} kW in` : `${fmt(outputs.electrical?.batteryPower?.value,1)} kW out`;
      if (component.id === "motor") return `${fmt(outputs.powertrain?.shaftPower?.value,1)} kW shaft`;
      if (component.id === "inverter") return `${fmt(outputs.electrical?.batteryPower?.value,1)} kW input`;
      if (component.id === "obc") return `${fmt(outputs.electrical?.packChargePower?.value,1)} kW pack`;
      if (component.id === "dcdc") return `${fmt(outputs.electrical?.lvContinuous?.value,0)} W LV`;
      if (["hvJunction","lvBattery"].includes(component.id)) return "path active";
      return `${fmt(component.continuous,0)} W · active`;
    };
    const nodes = powerNodes.map(node => {
      const p=positions.get(node.id),component=componentById.get(node.componentInstanceId),isActive=active(node);
      return `<g class="network-node ${node.id===selectedElectricalNodeId?"selected":""} ${isActive?"":"inactive"}" transform="translate(${p.x} ${p.y})" data-select-node="${esc(node.id)}" data-node-x="${p.x}" data-node-y="${p.y}" role="button" aria-label="Select or reposition ${esc(node.label)}" tabindex="0"><rect x="0" y="0" width="${nodeW}" height="${nodeH}" rx="9"/><text x="${nodeW/2}" y="22" text-anchor="middle" fill="#173b4d" font-size="11" font-weight="800">${esc(node.label)}</text><text x="${nodeW/2}" y="40" text-anchor="middle" fill="#61717b" font-size="9">${esc(subtitle(node,component,isActive))}</text></g>`;
    }).join("");
    return `<div class="electrical-network" role="region" aria-label="Interactive functional electrical component network"><svg data-electrical-network data-node-width="${nodeW}" data-node-height="${nodeH}" viewBox="0 0 ${width} ${height}" role="group" aria-label="Functional electrical component network for ${esc(scenario)}"><defs><marker id="network-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10Z" fill="context-stroke"/></marker></defs>${edges}${nodes}</svg></div><div class="network-tools"><button type="button" class="button ghost" data-action="reset-network-layout">Auto-arrange nodes</button><span id="networkMoveStatus" class="field-owner" aria-live="polite">Drag a card or use arrow keys to reposition it.</span></div><div class="network-legend"><span class="hv-key">HV / phase energy</span><span class="lv-key">LV energy</span><span class="comms-key">Communications</span><span>Dimmed = inactive in ${esc(scenario)}</span></div><p class="diagram-note">Functional connectivity only. Diagram positions are presentation-only and never change component X/Z, mass, CG, harness length or the engineering revision.</p>`;
  }

  function updateElectricalNetworkEdges(svg) {
    const nodeW=Number(svg.dataset.nodeWidth),nodeH=Number(svg.dataset.nodeHeight);
    const nodes=new Map([...svg.querySelectorAll("[data-select-node]")].map(node=>[node.dataset.selectNode,node]));
    svg.querySelectorAll("[data-network-edge]").forEach(edge=>{
      const from=nodes.get(edge.dataset.fromNode),to=nodes.get(edge.dataset.toNode);if(!from||!to)return;
      const x1=Number(from.dataset.nodeX)+nodeW/2,y1=Number(from.dataset.nodeY)+nodeH/2;
      const x2=Number(to.dataset.nodeX)+nodeW/2,y2=Number(to.dataset.nodeY)+nodeH/2,mid=(x1+x2)/2;
      edge.setAttribute("d",`M${x1} ${y1} C${mid} ${y1},${mid} ${y2},${x2} ${y2}`);
    });
  }

  function bindElectricalNetworkInteraction() {
    const svg=document.querySelector("[data-electrical-network]");if(!svg)return;
    const viewBox=svg.viewBox.baseVal,nodeW=Number(svg.dataset.nodeWidth),nodeH=Number(svg.dataset.nodeHeight);
    const toSvgPoint=event=>{const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;return point.matrixTransform(svg.getScreenCTM().inverse());};
    const moveNode=(node,x,y,persist=true)=>{
      const boundedX=Math.max(8,Math.min(viewBox.width-nodeW-8,x)),boundedY=Math.max(8,Math.min(viewBox.height-nodeH-8,y));
      node.dataset.nodeX=boundedX;node.dataset.nodeY=boundedY;node.setAttribute("transform",`translate(${boundedX} ${boundedY})`);
      updateElectricalNetworkEdges(svg);
      if(persist){electricalNodePositions[`${state.meta.architectureVariant}:${node.dataset.selectNode}`]={x:boundedX,y:boundedY};persistUiPreferences();}
      return {x:boundedX,y:boundedY};
    };
    let drag=null;
    svg.querySelectorAll("[data-select-node]").forEach(node=>{
      node.addEventListener("pointerdown",event=>{
        if(event.button!==0)return;
        const point=toSvgPoint(event);drag={node,pointerId:event.pointerId,start:point,origin:{x:Number(node.dataset.nodeX),y:Number(node.dataset.nodeY)},moved:false};
        node.classList.add("dragging");node.setPointerCapture?.(event.pointerId);event.preventDefault();
      });
      node.addEventListener("pointermove",event=>{
        if(!drag||drag.node!==node||drag.pointerId!==event.pointerId)return;
        const point=toSvgPoint(event),dx=point.x-drag.start.x,dy=point.y-drag.start.y;
        if(Math.hypot(dx,dy)>5)drag.moved=true;
        moveNode(node,drag.origin.x+dx,drag.origin.y+dy,false);
      });
      const finishDrag=event=>{
        if(!drag||drag.node!==node)return;
        node.classList.remove("dragging");
        if(drag.moved){moveNode(node,Number(node.dataset.nodeX),Number(node.dataset.nodeY),true);lastNetworkDragAt=Date.now();document.querySelector("#networkMoveStatus").textContent=`${node.getAttribute("aria-label").replace("Select or reposition ","")} position saved for this diagram.`;}
        drag=null;node.releasePointerCapture?.(event.pointerId);
      };
      node.addEventListener("pointerup",finishDrag);node.addEventListener("pointercancel",finishDrag);
      node.addEventListener("keydown",event=>{
        if(!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(event.key))return;
        event.preventDefault();const step=event.shiftKey?1:10,dx=event.key==="ArrowLeft"?-step:event.key==="ArrowRight"?step:0,dy=event.key==="ArrowUp"?-step:event.key==="ArrowDown"?step:0;
        moveNode(node,Number(node.dataset.nodeX)+dx,Number(node.dataset.nodeY)+dy,true);
        document.querySelector("#networkMoveStatus").textContent=`${node.getAttribute("aria-label").replace("Select or reposition ","")} moved. Diagram layout only.`;
      });
    });
  }

  function selectedComponentInspector(graph) {
    const node=graph?.nodes?.find(item=>item.id===selectedElectricalNodeId) || graph?.nodes?.find(item=>item.componentInstanceId);
    const component=node?.componentInstanceId ? state.components.find(item=>item.id===node.componentInstanceId) : null;
    if(!component)return `<div class="notice">Select a physical component node to edit its engineering properties.</div>`;
    const index=state.components.indexOf(component);
    const field=(key,label,unit="",type="number")=>`<div class="field"><label>${esc(label)}</label><div class="field-row"><input type="${type}" data-component="${index}" data-component-key="${key}" value="${esc(component[key])}" aria-label="${esc(component.label)} ${esc(label)}"><span class="unit-label">${esc(unit||"—")}</span></div></div>`;
    return `<div class="component-inspector"><h3>Selected component · ${esc(component.label)}</h3><p class="panel-intro">Edits update mass properties, package data and the active scenario budget immediately. Enabled scenarios use only drive, charge and off.</p><div class="fields">${field("category","Category","","text")}${field("mass","Mass","kg")}${field("x","Preferred X","mm")}${field("z","Preferred Z","mm")}${field("length","Envelope length","mm")}${field("width","Envelope width","mm")}${field("height","Envelope height","mm")}${field("continuous","Continuous power","W")}${field("peak","Peak power","W")}${field("inrush","Inrush power","W")}${field("standby","Standby power","W")}${field("sleep","Sleep power","W")}${field("states","Enabled scenarios","","text")}${field("provenance","Provenance","","text")}<div class="field"><label for="selected-essential-${index}">Essential load</label><select id="selected-essential-${index}" data-component="${index}" data-component-key="essential" aria-label="${esc(component.label)} Essential load"><option value="true" ${component.essential?"selected":""}>Yes</option><option value="false" ${component.essential?"":"selected"}>No</option></select></div></div></div>`;
  }

  function renderStanceExpanded(tab) {
    const m = outputs.massProperties;
    const e = outputs.ergonomics;
    const f = Core.tyre(state.stance.frontTyreWidth, state.stance.frontTyreAspect, state.stance.frontRim);
    const r = Core.tyre(state.stance.rearTyreWidth, state.stance.rearTyreAspect, state.stance.rearRim);
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab)}
      <div class="grid two"><article class="panel"><h3>Master package inputs</h3><p class="panel-intro">Authoritative Stance values. Coordinates use the active master frame.</p><div class="fields">
        ${input("stance.vehicleCategory","Vehicle category","",{type:"select",values:["Sport","Naked","Cruiser","Adventure","Touring"]})}
        ${input("stance.wheelbase","Target wheelbase","mm")}${input("stance.targetRake","Target rake","deg",{step:"0.1"})}${input("stance.targetTrail","Target trail","mm")}
        ${input("stance.groundClearance","Target ground clearance","mm")}${input("stance.frontTravel","Front travel target","mm")}${input("stance.rearTravel","Rear travel target","mm")}
      </div><h3 style="margin-top:20px">Tyre geometry</h3><div class="fields">${input("stance.frontTyreWidth","Front width","mm")}${input("stance.frontTyreAspect","Front aspect","%")}${input("stance.frontRim","Front rim","in")}${input("stance.rearTyreWidth","Rear width","mm")}${input("stance.rearTyreAspect","Rear aspect","%")}${input("stance.rearRim","Rear rim","in")}</div>
      <h3 style="margin-top:20px">Hardpoints</h3><div class="fields">${["rearAxleX","rearAxleZ","seatX","seatZ","gripX","gripZ","pegX","pegZ","lowestPointX","lowestPointZ"].map(key => input(`stance.${key}`, key.replace(/([A-Z])/g," $1"), "mm")).join("")}</div>
      <h3 style="margin-top:20px">Load case and rider</h3><div class="fields">${input("stance.gliderMass","Mechanical glider mass","kg")}${input("stance.gliderCGX","Glider CG X","mm")}${input("stance.gliderCGZ","Glider CG Z","mm")}${input("stance.riderMass","Rider mass","kg")}${input("stance.pillionMass","Pillion mass","kg")}${input("stance.luggageMass","Luggage mass","kg")}${input("stance.riderHeight","Rider height","mm")}${input("stance.riderInseam","Rider inseam","mm")}${input("stance.riderShoulderWidth","Shoulder width","mm")}${input("stance.torsoLength","Torso length","mm")}${input("stance.upperArmLength","Upper arm","mm")}${input("stance.forearmLength","Forearm","mm")}${input("stance.thighLength","Thigh","mm")}${input("stance.shinLength","Shin","mm")}${input("stance.torsoLean","Torso lean","deg")}${input("stance.handlebarWidth","Handlebar width","mm")}${input("stance.handlebarSweep","Handlebar sweep","deg")}${input("stance.targetWetMass","Project wet-mass target","kg")}</div><h3 style="margin-top:20px">Clearance and pillion envelopes</h3><div class="fields">${input("stance.pegLateral","Peg / knee lateral centre","mm")}${input("stance.tankHalfWidth","Tank half-width","mm")}${input("stance.exhaustX","Exhaust centre X","mm")}${input("stance.exhaustZ","Exhaust centre Z","mm")}${input("stance.exhaustRadius","Exhaust envelope radius","mm")}${input("stance.mirrorHalfSpan","Mirror half-span","mm")}${input("stance.pillionSeatX","Pillion seat X","mm")}${input("stance.pillionSeatZ","Pillion seat Z","mm")}${input("stance.pillionPegX","Pillion peg X","mm")}${input("stance.pillionPegZ","Pillion peg Z","mm")}</div></article>
      <div><article class="panel"><h3>Master-frame package view</h3><p class="panel-intro">Solver-scaled 2D coordinates and entered tyre diameters.</p>${svgVehicle()}</article>
      <article class="panel"><h3>Stance and rider outputs</h3>${invalidNotice(m,"Mass Properties")}${invalidNotice(e,"Rider package")}<div class="metric-grid">${metric("Front tyre radius",{value:f.radius,unit:"mm",definition:"Nominal geometric radius"},{owner:"stance"})}${metric("Rear tyre radius",{value:r.radius,unit:"mm",definition:"Nominal geometric radius"},{owner:"stance"})}${metric("Front circumference",{value:f.circumference,unit:"mm",definition:"Nominal unloaded circumference"},{owner:"stance"})}${metric("Wet vehicle mass",{value:m.wetMass,unit:"kg",definition:"Glider plus selected electrical component mass; occupants excluded"},{owner:"stance"})}${metric("Active load-case mass",{value:m.totalMass,unit:"kg",definition:"Central Mass Properties aggregate"},{owner:"stance"})}${metric("CG X",{value:m.cgX,unit:"mm",definition:"Mass-weighted master-frame coordinate"},{owner:"stance"})}${metric("CG Z",{value:m.cgZ,unit:"mm",definition:"Mass-weighted master-frame coordinate"},{owner:"stance"})}${metric("Elbow angle",e?.elbowAngle,{owner:"stance"})}${metric("Knee angle",e?.kneeAngle,{owner:"stance"})}${metric("Hip angle",e?.hipAngle,{owner:"stance"})}${metric("Arm reach",e?.armReachUtilisation,{owner:"stance"})}${metric("Ground reach margin",e?.groundReachMargin,{owner:"stance"})}${metric("Knee to tank",e?.kneeTankClearance,{owner:"stance"})}${metric("Heel to exhaust",e?.heelExhaustClearance,{owner:"stance"})}${metric("Mirror to shoulder",e?.mirrorShoulderClearance,{owner:"stance"})}${metric("Pillion knee",e?.pillionKneeAngle,{owner:"stance"})}</div><div class="notice" style="margin-top:14px">Rider results are geometric screens. Joint comfort, soft tissue, control forces, clothing, visibility and physical validation remain not evaluated.</div></article></div></div>
    </section>`;
  }

  function renderStance(tab) {
    const m=outputs.massProperties,e=outputs.ergonomics;
    const f=Core.tyre(state.stance.frontTyreWidth,state.stance.frontTyreAspect,state.stance.frontRim),r=Core.tyre(state.stance.rearTyreWidth,state.stance.rearTyreAspect,state.stance.rearRim);
    const advancedCount=26;
    return `<section class="view ${activeTab===tab.id?"active":""}" id="view-${tab.id}">${viewHead(tab)}
      <div class="grid two"><article class="panel"><h3>Core package inputs</h3><p class="panel-intro">Decision-driving Stance values remain visible. Less-frequent assumptions stay locked in the advanced editor.</p><div class="fields">
        ${input("stance.vehicleCategory","Vehicle category","",{type:"select",values:["Sport","Naked","Cruiser","Adventure","Touring"]})}
        ${input("stance.wheelbase","Target wheelbase","mm")}${input("stance.targetRake","Target rake","deg",{step:"0.1"})}${input("stance.targetTrail","Target trail","mm")}
        ${input("stance.groundClearance","Target ground clearance","mm")}${input("stance.frontTravel","Front travel target","mm")}${input("stance.rearTravel","Rear travel target","mm")}
      </div><h3 style="margin-top:20px">Tyre geometry</h3><div class="fields">${input("stance.frontTyreWidth","Front width","mm")}${input("stance.frontTyreAspect","Front aspect","%")}${input("stance.frontRim","Front rim","in")}${input("stance.rearTyreWidth","Rear width","mm")}${input("stance.rearTyreAspect","Rear aspect","%")}${input("stance.rearRim","Rear rim","in")}</div>
      <h3 style="margin-top:20px">Rider, hardpoints and mass drivers</h3><div class="fields">${input("stance.riderHeight","Rider height","mm")}${input("stance.riderInseam","Rider inseam","mm")}${input("stance.riderMass","Rider mass","kg")}${input("stance.seatX","Seat X","mm")}${input("stance.seatZ","Seat Z","mm")}${input("stance.gripX","Grip X","mm")}${input("stance.gripZ","Grip Z","mm")}${input("stance.pegX","Footpeg X","mm")}${input("stance.pegZ","Footpeg Z","mm")}${input("stance.gliderMass","Mechanical glider mass","kg")}${input("stance.gliderCGX","Glider CG X","mm")}${input("stance.gliderCGZ","Glider CG Z","mm")}</div>
      <details class="advanced-editor" data-stance-advanced ${stanceAdvancedOpen?"open":""}><summary><span>Edit advanced package</span><small>${stanceAdvancedOpen?"Editing":"Locked"} · ${advancedCount} governed values · revision ${state.meta.domainRevisions.stance}</small></summary><div class="advanced-editor-body"><p class="panel-intro">These parameters remain in the solver while locked. Open this editor only when hardpoints, rider anthropometry, pillion or clearance envelopes must change.</p><h3>Frame and lower envelope</h3><div class="fields">${input("stance.rearAxleX","Rear axle X","mm")}${input("stance.rearAxleZ","Rear axle Z","mm")}${input("stance.lowestPointX","Lowest chassis point X","mm")}${input("stance.lowestPointZ","Lowest chassis point Z","mm")}${input("stance.targetWetMass","Project wet-mass target","kg")}</div><h3 style="margin-top:20px">Rider and control detail</h3><div class="fields">${input("stance.riderShoulderWidth","Shoulder width","mm")}${input("stance.torsoLength","Torso length","mm")}${input("stance.upperArmLength","Upper arm","mm")}${input("stance.forearmLength","Forearm","mm")}${input("stance.thighLength","Thigh","mm")}${input("stance.shinLength","Shin","mm")}${input("stance.torsoLean","Torso lean","deg")}${input("stance.handlebarWidth","Handlebar width","mm")}${input("stance.handlebarSweep","Handlebar sweep","deg")}</div><h3 style="margin-top:20px">Pillion, luggage and clearance envelopes</h3><div class="fields">${input("stance.pillionMass","Pillion mass","kg")}${input("stance.luggageMass","Luggage mass","kg")}${input("stance.pegLateral","Peg / knee lateral centre","mm")}${input("stance.tankHalfWidth","Tank half-width","mm")}${input("stance.exhaustX","Exhaust centre X","mm")}${input("stance.exhaustZ","Exhaust centre Z","mm")}${input("stance.exhaustRadius","Exhaust envelope radius","mm")}${input("stance.mirrorHalfSpan","Mirror half-span","mm")}${input("stance.pillionSeatX","Pillion seat X","mm")}${input("stance.pillionSeatZ","Pillion seat Z","mm")}${input("stance.pillionPegX","Pillion peg X","mm")}${input("stance.pillionPegZ","Pillion peg Z","mm")}</div><button type="button" class="button" data-action="lock-stance-advanced" style="margin-top:16px">Apply and lock advanced package</button></div></details></article>
      <div><article class="panel"><h3>Master-frame package view</h3><p class="panel-intro">Solver-scaled 2D coordinates and entered tyre diameters.</p>${svgVehicle()}</article>
      <article class="panel"><h3>Stance and rider outputs</h3>${invalidNotice(m,"Mass Properties")}${invalidNotice(e,"Rider package")}<div class="metric-grid">${metric("Front tyre radius",{value:f.radius,unit:"mm",definition:"Nominal geometric radius"},{owner:"stance"})}${metric("Rear tyre radius",{value:r.radius,unit:"mm",definition:"Nominal geometric radius"},{owner:"stance"})}${metric("Front circumference",{value:f.circumference,unit:"mm",definition:"Nominal unloaded circumference"},{owner:"stance"})}${metric("Wet vehicle mass",{value:m.wetMass,unit:"kg",definition:"Glider plus selected electrical component mass; occupants excluded"},{owner:"stance"})}${metric("Active load-case mass",{value:m.totalMass,unit:"kg",definition:"Central Mass Properties aggregate"},{owner:"stance"})}${metric("CG X",{value:m.cgX,unit:"mm",definition:"Mass-weighted master-frame coordinate"},{owner:"stance"})}${metric("CG Z",{value:m.cgZ,unit:"mm",definition:"Mass-weighted master-frame coordinate"},{owner:"stance"})}${metric("Elbow angle",e?.elbowAngle,{owner:"stance"})}${metric("Knee angle",e?.kneeAngle,{owner:"stance"})}${metric("Hip angle",e?.hipAngle,{owner:"stance"})}${metric("Arm reach",e?.armReachUtilisation,{owner:"stance"})}${metric("Ground reach margin",e?.groundReachMargin,{owner:"stance"})}${metric("Knee to tank",e?.kneeTankClearance,{owner:"stance"})}${metric("Heel to exhaust",e?.heelExhaustClearance,{owner:"stance"})}${metric("Mirror to shoulder",e?.mirrorShoulderClearance,{owner:"stance"})}${metric("Pillion knee",e?.pillionKneeAngle,{owner:"stance"})}</div><div class="notice" style="margin-top:14px">Rider results are geometric screens. Joint comfort, soft tissue, control forces, clothing, visibility and physical validation remain not evaluated.</div></article></div></div>
    </section>`;
  }

  function renderSteering(tab) {
    const o = outputs.steering;
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab)}<div class="grid two"><article class="panel"><h3>Steering-owned inputs</h3><div class="fields">${input("steering.upperOffset","Upper offset","mm")}${input("steering.underBracketOffset","Under-bracket offset","mm")}${input("steering.bracketSpan","Bracket span","mm")}${input("steering.steeringAngle","Steering study angle","deg")}${input("steering.cornerSpeed","Corner study speed","km/h")}${input("steering.cornerRadius","Corner study radius","m")}${input("steering.brakingDecel","Braking deceleration","g",{step:"0.05"})}${input("steering.forkSpringRate","Per-leg fork spring rate","N/mm")}${input("steering.forkPreload","Installed fork preload","mm")}</div><h3 style="margin-top:20px">Linked inputs</h3><div class="fields">${linkedField("stance.targetRake","Rake","deg")}${linkedField("stance.targetTrail","Target trail","mm")}${linkedField("stance.wheelbase","Wheelbase","mm")}${linkedField("stance.frontTravel","Front travel","mm")}</div><div class="notice" style="margin-top:14px">Linked values are read-only here. Change them in Stance; load-case mass and CG come only from Mass Properties.</div></article><article class="panel"><h3>Unladen front-end outputs</h3>${invalidNotice(o,"Steering geometry")}<div class="metric-grid">${metric("Head tube to Fork C to C distance",o.headTubeToForkCC,{owner:"steering",digits:2})}${metric("Ground trail",o.groundTrail,{owner:"steering"})}${metric("Normal trail",o.normalTrail,{owner:"steering"})}${metric("Wheel flop",o.flop,{owner:"steering"})}${metric("Offset for target trail",o.requiredOffset,{owner:"steering"})}${metric("Turn radius",o.turnRadius,{owner:"steering"})}${metric("Offset delta",o.offsetDelta,{owner:"steering"})}${metric("Fork-axis delta",o.forkAxisDelta,{owner:"steering"})}${metric("Fork rake",o.forkRake,{owner:"steering"})}${metric("Normal-trail ratio",o.normalTrailRatio,{owner:"steering",digits:3})}${metric("Axle-load trail ratio",o.axleLoadCorrectedRatio,{owner:"steering",digits:3})}${metric("Braking load transfer",o.brakingTransfer,{owner:"steering"})}${metric("Spring-only fork dive",o.springDive,{owner:"steering"})}${metric("Vertical fork rate",o.verticalForkRate,{owner:"steering"})}${metric("Ideal lean",o.idealLean,{owner:"steering"})}${metric("Wheelie limit",o.wheelieLimit,{owner:"steering"})}${metric("Stoppie limit",o.stoppieLimit,{owner:"steering"})}</div><div class="notice warning" style="margin-top:14px">${esc(DATA.sourceNotes.trail)}</div></article></div></section>`;
  }

  function linkedField(path, label, unit) {
    const owner = path.split(".")[0];
    return `<div class="field"><label>${esc(label)} · linked</label><div class="field-row"><input value="${esc(get(path))}" readonly aria-readonly="true"><span class="unit-label">${esc(unit)}</span></div><small>Owner: ${esc(owner)} · source revision ${state.meta.domainRevisions?.[owner] || 1}</small></div>`;
  }

  function renderSuspension(tab) {
    const o = outputs.suspension;
    const linkageInputs = state.suspension.rearArchitecture === "linkage" ? `<h3 style="margin-top:20px">Linkage hardpoints</h3><div class="fields">${input("suspension.dogboneSwingX","Dogbone swingarm X","mm")}${input("suspension.dogboneSwingZ","Dogbone swingarm Z","mm")}${input("suspension.rockerPivotX","Rocker pivot X","mm")}${input("suspension.rockerPivotZ","Rocker pivot Z","mm")}${input("suspension.rockerDogboneX","Rocker dogbone X","mm")}${input("suspension.rockerDogboneZ","Rocker dogbone Z","mm")}${input("suspension.rockerShockX","Rocker shock X","mm")}${input("suspension.rockerShockZ","Rocker shock Z","mm")}</div>` : `<h3 style="margin-top:20px">Direct-mount hardpoints</h3><div class="fields">${input("suspension.shockSwingX","Shock swingarm mount X","mm")}${input("suspension.shockSwingZ","Shock swingarm mount Z","mm")}</div>`;
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab)}
      <div class="grid two"><article class="panel"><h3>Front fork and rear architecture</h3><div class="fields">
        ${input("suspension.rearArchitecture","Rear architecture","",{type:"select",values:[{value:"direct",label:"Direct mount"},{value:"linkage",label:"Linkage mount"}]})}
        ${input("suspension.forkLength","Fork length","mm")}${input("suspension.forkStanchion","Stanchion OD","mm")}${input("suspension.forkAirVolume","Initial air volume per leg","ml")}${input("suspension.forkAirPistonDiameter","Air piston diameter","mm")}${input("suspension.frontWheelToMetal","Front wheel-to-metal","mm")}${input("suspension.rearWheelToMetal","Rear wheel-to-metal","mm")}${input("suspension.shockFrameX","Shock frame mount X","mm")}${input("suspension.shockFrameZ","Shock frame mount Z","mm")}${input("suspension.bumpStopStart","Bump-stop engagement","mm wheel")}${input("suspension.bumpStopRate","Bump-stop wheel rate","N/mm")}${input("suspension.sweepSteps","Sweep stations","count")}
      </div>${linkageInputs}<h3 style="margin-top:20px">Linked geometry</h3><div class="fields">${linkedField("stance.rearAxleX","Rear axle X","mm")}${linkedField("stance.rearAxleZ","Rear axle Z","mm")}${linkedField("steering.upperOffset","Upper offset","mm")}${linkedField("steering.bracketSpan","Bracket span","mm")}${linkedField("sag.rearK1","Rear K1","N/mm")}</div></article>
      <div><article class="panel"><h3>Kinematics and fork outputs</h3>${invalidNotice(o,"Suspension geometry")}<div class="metric-grid">${metric("Initial shock length",o.initialShockLength,{owner:"suspension"})}${metric("Shock travel",o.shockTravel,{owner:"suspension"})}${metric("Usable wheel travel",o.usableWheelTravel,{owner:"suspension"})}${metric("Average motion ratio",o.averageMotionRatio,{owner:"suspension",digits:3})}${metric("MR extension",o.motionRatioStart,{owner:"suspension",digits:3})}${metric("MR mid",o.motionRatioMid,{owner:"suspension",digits:3})}${metric("MR bump",o.motionRatioEnd,{owner:"suspension",digits:3})}${metric("Leverage ratio",o.leverageRatio,{owner:"suspension",digits:2})}${metric("MR progression",o.progression,{owner:"suspension"})}${metric("Wheel rate extension",o.wheelRateStart,{owner:"suspension"})}${metric("Wheel rate mid",o.wheelRateMid,{owner:"suspension"})}${metric("Wheel rate bump",o.wheelRateEnd,{owner:"suspension"})}${metric("Air compression",o.forkAirCompression,{owner:"suspension",digits:2})}${metric("End air pressure",o.forkEndPressure,{owner:"suspension",digits:2})}</div></article>${loadDeflectionPanel()}<article class="panel"><h3>Motion ratio through travel</h3>${canvasChart("suspensionChart","Shock-to-wheel motion ratio through rear-wheel travel")}</article><article class="panel"><h3>Front-travel geometry sweep</h3><div class="table-wrap"><table><thead><tr><th>Front travel</th><th>Rake</th><th>Trail</th><th>Wheelbase</th><th>Clearance</th></tr></thead><tbody>${(o.frontTravelSweep || []).map(row=>`<tr><td>${fmt(row.frontTravel,1)} mm</td><td>${fmt(row.rake,2)} deg</td><td>${fmt(row.trail,1)} mm</td><td>${fmt(row.wheelbase,1)} mm</td><td>${fmt(row.clearance,1)} mm</td></tr>`).join("")}</tbody></table></div></article></div></div>
    </section>`;
  }

  function renderAntiSquat(tab) {
    const o = outputs.antiSquat;
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab)}<div class="grid two"><article class="panel"><h3>Study inputs</h3><div class="fields">${input("antiSquat.driveType","Final-drive type","",{type:"select",values:["chain","belt","shaft"]})}${input("antiSquat.analysisSteps","Analysis stations","count")}</div><h3 style="margin-top:20px">Linked final-drive geometry</h3><div class="fields">${linkedField("powertrain.frontTeeth","Front sprocket","teeth")}${linkedField("powertrain.rearTeeth","Rear sprocket","teeth")}${linkedField("powertrain.chainPitch","Chain pitch","mm")}${linkedField("powertrain.driveSprocketX","Drive centre X","mm")}${linkedField("powertrain.driveSprocketZ","Drive centre Z","mm")}${linkedField("stance.wheelbase","Wheelbase","mm")}</div><div class="notice warning" style="margin-top:14px">The shaft option is only a geometric swingarm-pivot baseline. Bevel-gear torque reaction and special link systems are not evaluated.</div></article><article class="panel"><h3>Drive anti-squat through travel</h3>${invalidNotice(o,"Anti-squat")}<div class="metric-grid">${metric("Extension",o.start,{owner:"antiSquat"})}${metric("Mid travel",o.mid,{owner:"antiSquat"})}${metric("Full usable travel",o.end,{owner:"antiSquat"})}${metric("Squat ratio",o.squatRatio,{owner:"antiSquat",digits:3})}${metric("Reciprocal identity",o.reciprocalCheck,{owner:"antiSquat",digits:3})}${metric("Through-travel range",o.range,{owner:"antiSquat"})}${metric("Average gradient",o.averageGradient,{owner:"antiSquat",digits:3})}${metric("Neutral crossover",o.neutralCrossover,{owner:"antiSquat"})}${metric("Force centre X",o.extensionForceCentreX,{owner:"antiSquat"})}${metric("Force centre Z",o.extensionForceCentreZ,{owner:"antiSquat"})}</div><div class="notice" style="margin-top:14px">${esc(DATA.sourceNotes.antiSquat)}</div>${canvasChart("antiSquatChart","Anti-squat percentage through rear suspension travel")}</article></div></section>`;
  }

  function renderSag(tab) {
    const o=outputs.sag;
    const loadRows=Object.entries(o.loadCases||{}).map(([name,row])=>`<tr><td>${esc(name)}</td><td>${fmt(row.frontForkSag,1)} mm</td><td>${fmt(row.rearShockSag,1)} mm</td><td>${fmt(row.rake,2)} deg</td><td>${fmt(row.trail,1)} mm</td><td>${fmt(row.wheelbase,1)} mm</td><td>${fmt(row.clearance,1)} mm</td><td><span class="badge ${row.ok?"review":"conflict_invalid"}">${row.ok?"calculated":"invalid"}</span></td></tr>`).join("");
    return `<section class="view ${activeTab===tab.id?"active":""}" id="view-${tab.id}">${viewHead(tab)}<div class="grid two"><article class="panel"><h3>Rear spring model</h3><div class="fields">${input("sag.rearK1","Rear K1","N/mm")}${input("sag.rearK2","Rear K2","N/mm")}${input("sag.rearTransition","Rear transition / COP","mm shock")}${input("sag.rearPreload","Rear preload","mm")}${input("sag.rearSpringCount","Rear spring count","count")}${input("sag.rearUnsprungMass","Rear unsprung mass","kg")}</div><h3 style="margin-top:20px">Front fork spring model</h3><div class="fields">${input("sag.frontK1","Front K1","N/mm")}${input("sag.frontK2","Front K2","N/mm")}${input("sag.frontTransition","Front transition / COP","mm")}${input("sag.frontPreload","Front preload","mm")}${input("sag.frontSpringCount","Fork spring count","count")}${input("sag.frontUnsprungMass","Front unsprung mass","kg")}</div><div class="notice" style="margin-top:16px"><strong>Suspension-member sag.</strong> Static means the Kerb case; rider means Solo rider. Front values are fork compression. Rear values are shock stroke interpolated from the linkage kinematics at the solved load equilibrium. Wheel movement is used only for loaded-geometry calculations.</div></article><div><article class="panel"><h3>Calculated member sag & loaded geometry</h3>${invalidNotice(o,"Sag and loaded geometry")}<div class="metric-grid">${metric(`Front fork sag · ${state.meta.loadCase}`,o.frontForkSag,{owner:"sag"})}${metric(`Rear shock sag · ${state.meta.loadCase}`,o.rearShockSag,{owner:"sag"})}${metric("Front fork static sag",o.expectedFrontForkStaticSag,{owner:"sag"})}${metric("Rear shock static sag",o.expectedRearShockStaticSag,{owner:"sag"})}${metric("Front fork rider sag",o.expectedFrontForkRiderSag,{owner:"sag"})}${metric("Rear shock rider sag",o.expectedRearShockRiderSag,{owner:"sag"})}${metric("Front fork static stroke used",o.expectedFrontForkStaticPercent,{owner:"sag"})}${metric("Rear shock static stroke used",o.expectedRearShockStaticPercent,{owner:"sag"})}${metric("Front fork rider stroke used",o.expectedFrontForkRiderPercent,{owner:"sag"})}${metric("Rear shock rider stroke used",o.expectedRearShockRiderPercent,{owner:"sag"})}${metric("Active front fork stroke used",o.frontForkTravelUsed,{owner:"sag"})}${metric("Active rear shock stroke used",o.rearShockTravelUsed,{owner:"sag"})}${metric("Loaded rake",o.loadedRake,{owner:"sag"})}${metric("Loaded trail",o.loadedTrail,{owner:"sag"})}${metric("Loaded wheelbase",o.loadedWheelbase,{owner:"sag"})}${metric("Ground clearance",o.loadedClearance,{owner:"sag"})}${metric("Front wheel rate",o.frontWheelRate,{owner:"sag"})}${metric("Rear wheel rate",o.rearWheelRate,{owner:"sag"})}${metric("Front frequency",o.frontFrequency,{owner:"sag"})}${metric("Rear frequency",o.rearFrequency,{owner:"sag"})}</div></article><article class="panel"><h3>Member sag and geometry through load cases</h3><div class="table-wrap"><table><thead><tr><th>Load case</th><th>Front fork sag</th><th>Rear shock sag</th><th>Rake</th><th>Trail</th><th>Wheelbase</th><th>Clearance</th><th>State</th></tr></thead><tbody>${loadRows}</tbody></table></div>${canvasChart("loadedGeometryChart","Calculated unladen and loaded rake, trail, wheelbase and ground clearance")}</article></div></div></section>`;
  }

  function renderSensitivity(tab) {
    const o = outputs.sensitivity;
    const options = ["steering.upperOffset","stance.rearAxleZ","suspension.shockFrameX","suspension.rockerPivotZ","sag.rearPreload","powertrain.driveSprocketZ","electrical.series"];
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab,true)}<div class="grid two"><article class="panel"><h3>Frozen study definition</h3><div class="fields">${input("sensitivity.parameter","Parameter","",{type:"select",values:options})}${input("sensitivity.step","Central-difference step","native units")}${input("sensitivity.tolerance","Manufacturing / adjustment tolerance","native units")}</div><div class="notice" style="margin-top:14px">Baseline revision ${state.meta.revision} is read-only for this run. Results are proposals and cannot overwrite an owning tab. The single-parameter tolerance effect is not a multi-variable statistical RSS.</div></article><article class="panel"><h3>Local response</h3>${invalidNotice(o,"Sensitivity study")}<div class="table-wrap"><table><thead><tr><th>Output</th><th class="numeric">Baseline</th><th class="numeric">− step</th><th class="numeric">+ step</th><th class="numeric">Central derivative</th><th class="numeric">Forward / backward</th><th>Response</th><th class="numeric">Tolerance effect</th><th class="numeric">Worst case</th></tr></thead><tbody>${(o.rows || []).map(row => `<tr><td>${esc(row.output)}</td><td class="numeric">${fmt(row.base,3)}</td><td class="numeric">${fmt(row.minus,3)}</td><td class="numeric">${fmt(row.plus,3)}</td><td class="numeric">${fmt(row.derivative,4)}</td><td class="numeric">${fmt(row.forward,4)} / ${fmt(row.backward,4)}</td><td><span class="badge ${row.valid ? "review" : "conflict_invalid"}">${esc(row.response)}</span><br>${fmt(row.asymmetry,1)}% asymmetry</td><td class="numeric">${fmt(row.rssAtTolerance,4)}</td><td class="numeric">${fmt(row.arithmeticWorstCase,4)}</td></tr>`).join("")}</tbody></table></div></article></div></section>`;
  }

  // ---- Compact helpers shared by Transmission, Motor sizing and Braking ------------------
  // These tabs report many numbers, so results use dense tiles and tables. Every value is still a
  // calculated, not-evaluated result; the definition lives in the tile tooltip.
  const SERIES_COLOURS = ["#1f6b50", "#266b92", "#6e56a0", "#a66516", "#b84d56", "#465b66"];
  function signed(value, digits = 1) { return Number.isFinite(Number(value)) ? `${Number(value) >= 0 ? "+" : "−"}${fmt(Math.abs(Number(value)), digits)}` : "—"; }
  function kpi(label, item, digits = 1, note = "") {
    const v = item && typeof item === "object" && "value" in item ? item : { value: item, unit: "" };
    const shown = typeof v.value === "string" ? esc(v.value) : fmt(v.value, digits);
    return `<div class="kpi" title="${esc(v.definition || "")}"><span>${esc(label)}</span><strong>${shown}${v.unit ? ` <small>${esc(v.unit)}</small>` : ""}</strong>${note ? `<em>${esc(note)}</em>` : ""}</div>`;
  }
  function kpiStrip(owner, tiles) {
    const result = outputs[owner];
    const state_ = result?.ok === false ? "failed" : stale.has(tabFor(owner)) ? "stale" : "current";
    return `<div class="kpi-strip" data-runtime="${state_}"><div class="kpi-status"><span class="badge ${state_}">${state_}</span><span class="badge not_evaluated">not evaluated</span></div>${tiles.join("")}</div>`;
  }
  function linkedList(rows) {
    return `<dl class="linked-list">${rows.map(([label, value, source]) => `<div><dt>${esc(label)}</dt><dd>${value}${source ? `<small>${esc(source)}</small>` : ""}</dd></div>`).join("")}</dl>`;
  }
  function sourceTag(owner) { return `${owner} · rev ${state.meta.domainRevisions?.[owner] || 1}`; }
  function legend(items) {
    return `<div class="chart-legend">${items.map(([label, colour, dashed]) => `<span><i class="${dashed ? "dashed" : ""}" style="${dashed ? `border-color:${colour}` : `background:${colour}`}"></i>${esc(label)}</span>`).join("")}</div>`;
  }
  // Dropdown of industry-standard values with a "Custom…" escape hatch that reveals a free entry box.
  function stdField(path, label, unit, values, options = {}) {
    const value = get(path);
    const items = values.map(item => typeof item === "object" ? item : { value: item, label: `${item}${unit ? ` ${unit}` : ""}` });
    const isStandard = items.some(item => String(item.value) === String(value)) && !customFields.has(path);
    const id = `std-${path.replace(/[^a-zA-Z0-9_-]+/g, "-")}-${++fieldSequence}`;
    const owner = options.owner || path.split(".")[0];
    const numeric = items.every(item => typeof item.value === "number");
    const select = `<select id="${id}" data-std-path="${esc(path)}" data-owner="${esc(owner)}" data-numeric="${numeric}">${items.map(item => `<option value="${esc(item.value)}" ${isStandard && String(item.value) === String(value) ? "selected" : ""}>${esc(item.label)}</option>`).join("")}${options.noCustom ? "" : `<option value="__custom" ${isStandard ? "" : "selected"}>Custom…</option>`}</select>`;
    const custom = isStandard || options.noCustom ? "" : `<div class="field-row std-custom"><input data-path="${esc(path)}" data-owner="${esc(owner)}" type="${numeric ? "number" : "text"}" value="${esc(value)}" ${options.step ? `step="${options.step}"` : ""} aria-label="${esc(label)} custom value"><span class="unit-label">${esc(unit || "—")}</span></div>`;
    return `<div class="field ${options.full ? "full" : ""}"><label for="${id}">${esc(label)}</label>${select}${custom}${options.help ? `<small>${esc(options.help)}</small>` : ""}</div>`;
  }

  // ---- Chart engine: multi-series XY plot with optional right axis ------------------------
  function niceCeilStep(raw) {
    if (!(raw > 0)) return 1;
    const mag = Math.pow(10, Math.floor(Math.log10(raw))), n = raw / mag;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
  }
  function axisLabel(value) {
    const abs = Math.abs(value);
    if (abs >= 1000) return Math.round(value).toLocaleString();
    if (abs >= 10) return String(Math.round(value * 10) / 10);
    return String(Math.round(value * 100) / 100);
  }
  function xyChart(canvas, cfg) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;
    canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
    const W = rect.width, H = rect.height;
    const series = cfg.series.filter(item => item.data?.length);
    const hasY2 = series.some(item => item.axis === "y2");
    const pad = { l: 60, r: hasY2 ? 60 : 20, t: 14, b: 46 };
    const finitePoints = list => list.filter(point => Number.isFinite(point?.[0]) && Number.isFinite(point?.[1]));
    const values = axis => series.filter(item => (item.axis || "y") === axis).flatMap(item => finitePoints(item.data).map(point => point[1]));
    const xs = series.flatMap(item => finitePoints(item.data).map(point => point[0]));
    if (!xs.length) return;
    const xMin = cfg.xMin ?? 0;
    const xStep = niceCeilStep(((cfg.xMax ?? Math.max(...xs)) - xMin) / 6);
    const xMax = cfg.xMax ?? Math.ceil(Math.max(...xs) / xStep) * xStep;
    const yMin = cfg.yMin ?? 0;
    const yRawMax = Math.max(...values("y"), ...(cfg.yExtra || []), yMin + 1e-6);
    const yStep = niceCeilStep((yRawMax - yMin) / 5);
    const yMax = cfg.yMax ?? yMin + Math.ceil((yRawMax - yMin) / yStep) * yStep;
    const lines = Math.max(1, Math.round((yMax - yMin) / yStep));
    const y2Step = hasY2 ? niceCeilStep(Math.max(...values("y2"), 1e-6) / lines) : 0;
    const y2Max = y2Step * lines;
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const tx = x => pad.l + (x - xMin) / Math.max(1e-9, xMax - xMin) * plotW;
    const ty = y => pad.t + (yMax - y) / Math.max(1e-9, yMax - yMin) * plotH;
    const ty2 = y => pad.t + (y2Max - y) / Math.max(1e-9, y2Max) * plotH;
    ctx.clearRect(0, 0, W, H);
    ctx.font = "11px Inter, system-ui"; ctx.lineWidth = 1; ctx.strokeStyle = "#e3e6e2"; ctx.fillStyle = "#61717b";
    for (let i = 0; i <= lines; i += 1) {
      const y = pad.t + plotH * i / lines;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(axisLabel(yMax - (yMax - yMin) * i / lines), pad.l - 8, y + 4);
      if (hasY2) { ctx.textAlign = "left"; ctx.fillText(axisLabel(y2Max - y2Max * i / lines), W - pad.r + 8, y + 4); }
    }
    ctx.textAlign = "center";
    for (let x = xMin; x <= xMax + 1e-9; x += xStep) {
      const px = tx(x);
      ctx.strokeStyle = "#eef0ed"; ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, H - pad.b); ctx.stroke();
      ctx.fillText(axisLabel(x), px, H - pad.b + 16);
    }
    ctx.strokeStyle = "#a6afa9"; ctx.beginPath(); ctx.moveTo(pad.l, pad.t); ctx.lineTo(pad.l, H - pad.b); ctx.lineTo(W - pad.r, H - pad.b); ctx.stroke();
    ctx.fillStyle = "#334650"; ctx.font = "600 11px Inter, system-ui";
    ctx.fillText(cfg.xLabel || "", pad.l + plotW / 2, H - 8);
    ctx.save(); ctx.translate(14, pad.t + plotH / 2); ctx.rotate(-Math.PI / 2); ctx.fillText(cfg.yLabel || "", 0, 0); ctx.restore();
    if (hasY2) { ctx.save(); ctx.translate(W - 12, pad.t + plotH / 2); ctx.rotate(Math.PI / 2); ctx.fillText(cfg.y2Label || "", 0, 0); ctx.restore(); }
    ctx.save(); ctx.beginPath(); ctx.rect(pad.l, pad.t - 2, plotW + 2, plotH + 4); ctx.clip();
    (cfg.hLines || []).forEach(line => {
      const y = (line.axis === "y2" ? ty2 : ty)(line.y);
      ctx.strokeStyle = line.colour || "#8f9b97"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke(); ctx.setLineDash([]);
      if (line.label) { ctx.fillStyle = line.colour || "#61717b"; ctx.font = "700 10px Inter, system-ui"; ctx.textAlign = "right"; ctx.fillText(line.label, W - pad.r - 6, y - 5); }
    });
    (cfg.vLines || []).forEach(line => {
      const x = tx(line.x);
      ctx.strokeStyle = line.colour || "#8f9b97"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke(); ctx.setLineDash([]);
      if (line.label) { ctx.fillStyle = line.colour || "#61717b"; ctx.font = "700 10px Inter, system-ui"; ctx.textAlign = "left"; ctx.fillText(line.label, x + 5, pad.t + 12); }
    });
    series.forEach(item => {
      const yOf = item.axis === "y2" ? ty2 : ty;
      ctx.strokeStyle = item.colour; ctx.lineWidth = item.width || 2.4; ctx.setLineDash(item.dash || []);
      ctx.beginPath(); let pen = false;
      item.data.forEach(point => {
        if (!Number.isFinite(point?.[0]) || !Number.isFinite(point?.[1])) { pen = false; return; }
        const x = tx(point[0]), y = yOf(point[1]);
        pen ? ctx.lineTo(x, y) : ctx.moveTo(x, y); pen = true;
      });
      ctx.stroke(); ctx.setLineDash([]);
      if (item.endLabel) {
        const last = finitePoints(item.data).at(-1);
        if (last) { ctx.fillStyle = item.colour; ctx.font = "700 10px Inter, system-ui"; ctx.textAlign = "right"; ctx.fillText(item.endLabel, tx(last[0]) - 4, yOf(last[1]) - 6); }
      }
    });
    ctx.restore();
    (cfg.points || []).forEach(point => {
      if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      const x = tx(point.x), y = (point.axis === "y2" ? ty2 : ty)(point.y);
      ctx.fillStyle = point.colour || "#d75f36"; ctx.strokeStyle = "#fffefb"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, point.r || 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (point.label) { ctx.font = "700 10px Inter, system-ui"; ctx.textAlign = point.align || "left"; ctx.fillText(point.label, x + (point.align === "right" ? -8 : 8), y - 8); }
    });
  }

  // ---- Transmission ------------------------------------------------------------------------
  const comboMetrics = [["topSpeed", "Top speed @ max RPM"], ["delta", "Top speed change vs current"], ["torque", "First-gear wheel torque"], ["ratio", "Final-drive ratio"], ["links", "Links for the hardpoints"]];
  function renderPowertrain(tab) {
    const o = outputs.powertrain, p = state.powertrain, ok = o?.ok === true;
    const gearCount = Math.max(1, Math.min(6, Math.round(Number(p.gearCount) || 6)));
    const kind = String(p.chainSize).startsWith("belt") ? "belt" : "chain";
    const linkUnit = kind === "belt" ? "teeth" : "links";
    const tyre = Core.tyre(state.stance.rearTyreWidth, state.stance.rearTyreAspect, state.stance.rearRim);
    const tiles = ok ? [
      kpi("Final drive", o.finalRatio, 3, `${p.frontTeeth} / ${p.rearTeeth} teeth`),
      kpi(gearCount > 1 ? "Overall ratio range" : "Overall ratio", { value: gearCount > 1 ? `${fmt(o.overallFirst.value, 2)} → ${fmt(o.overallTop.value, 2)}` : fmt(o.overallFirst.value, 3), definition: "Primary × gear × final drive" }, 2, gearCount > 1 ? `G1 → G${gearCount} · spread ${fmt(o.ratioSpread.value, 2)}` : "single speed"),
      kpi("Speed @ max RPM", o.kinematicTopSpeed, 1, `top gear, ${fmt(p.maxRpm, 0)} rpm`),
      kpi(kind === "belt" ? "Belt" : "Chain", { value: o.recommendedLinks.value, unit: linkUnit, definition: o.recommendedLinks.definition }, 0, `${fmt(o.chainLength.value, 0)} mm · axle ${signed(o.axleMove.value, 1)} mm`),
      kpi(`${kind === "belt" ? "Belt" : "Chain"} safety factor`, o.chainSafetyFactor, 1, `${fmt(o.chainTension.value, 2)} kN peak, G1`),
      kpi("Wrap, small sprocket", o.wrapAngle, 0, `${fmt(o.teethEngaged.value, 1)} teeth engaged`)
    ] : [];
    const gearInputs = Array.from({ length: gearCount }, (_, i) => input(`powertrain.gear${i + 1}`, gearCount === 1 ? "Reduction ratio" : `Gear ${i + 1}`, "ratio", { step: "0.001" })).join("");
    const catalogue = (DATA.finalDriveCatalogue || []).map(item => ({ value: item.id, label: item.id === "custom" ? "Custom" : `${item.label} · ${item.pitch} mm` }));
    const rows = ok ? o.rows.map(row => `<tr><td>${gearCount === 1 ? "Single" : `G${row.gear}`}</td><td class="numeric">${fmt(row.gearRatio, 3)}</td><td class="numeric"><strong>${fmt(row.overallRatio, 3)}</strong></td><td class="numeric">${row.stepPercent === null ? "—" : `${fmt(row.stepPercent, 1)}%`}</td><td class="numeric">${fmt(row.speedAtMaxRpm, 1)}</td><td class="numeric ${row.cruiseOverRedline ? "over" : ""}">${row.rpmAtCruise === null ? "—" : fmt(row.rpmAtCruise, 0)}</td><td class="numeric">${fmt(row.wheelTorqueAtPeak, 0)}</td><td class="numeric">${fmt(row.tractiveForceAtPeak, 0)}</td></tr>`).join("") : "";
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab)}
      ${kpiStrip("powertrain", tiles)}${invalidNotice(o, "Transmission")}
      <div class="grid two">
        <div>
          <article class="panel"><h3>Ratio stack</h3><div class="fields">
            ${input("powertrain.gearCount", "Gear count", "", { type: "select", values: [1, 2, 3, 4, 5, 6].map(n => ({ value: n, label: n === 1 ? "1 · single-speed reduction" : `${n} speeds` })) })}
            ${input("powertrain.primaryRatio", "Primary ratio", "ratio", { step: "0.001" })}
            ${gearInputs}
            ${input("powertrain.frontTeeth", "Front sprocket", "teeth")}
            ${input("powertrain.rearTeeth", "Rear sprocket", "teeth")}
            ${input("powertrain.drivelineEfficiency", "Driveline efficiency", "fraction", { step: "0.01" })}
          </div>
          <h4 class="subhead">Linked inputs</h4>
          ${linkedList([
            ["Motor max RPM", `${fmt(p.maxRpm, 0)} rpm`, sourceTag("powertrain") + " · Motor sizing"],
            ["Motor peak torque", `${fmt(p.maxTorque, 0)} N·m`, "Motor sizing"],
            ["Rear tyre", tyre.ok ? `${state.stance.rearTyreWidth}/${state.stance.rearTyreAspect} R${state.stance.rearRim} · ${fmt(tyre.circumference, 0)} mm` : "—", sourceTag("stance")]
          ])}</article>
          <article class="panel"><h3>Final drive & hardpoints</h3><div class="fields">
            ${input("powertrain.chainSize", "Chain / belt size", "", { type: "select", values: catalogue, full: true, help: "Selecting a size fills pitch, roller and typical breaking load. Editing any of them switches to Custom." })}
            ${input("powertrain.chainPitch", "Pitch", "mm", { step: "0.001" })}
            ${kind === "chain" ? input("powertrain.chainRollerDia", "Roller diameter", "mm", { step: "0.01" }) : ""}
            ${input("powertrain.chainBreakingLoad", "Breaking load", "kN", { step: "0.1", help: "Typical minimum tensile; confirm on the supplier datasheet." })}
            ${input("powertrain.driveSprocketX", "Drive sprocket X", "mm")}
            ${input("powertrain.driveSprocketZ", "Drive sprocket Z", "mm")}
            ${input("powertrain.axleAdjustForward", "Adjuster travel forward", "mm")}
            ${input("powertrain.axleAdjustRearward", "Adjuster travel rearward", "mm")}
          </div>
          ${linkedList([["Rear axle", `${fmt(state.stance.rearAxleX, 0)}, ${fmt(state.stance.rearAxleZ, 0)} mm`, sourceTag("stance")], ["Centre distance", ok ? `${fmt(o.chainCentreDistance.value, 1)} mm` : "—", "drive sprocket → axle"]])}</article>
          <article class="panel"><h3>Study points</h3><div class="fields">
            ${input("powertrain.cruiseSpeed", "Cruise speed", "km/h", { help: "RPM per gear at this speed." })}
            <div></div>
            ${input("powertrain.proposedFrontTeeth", "Proposed front", "teeth")}
            ${input("powertrain.proposedRearTeeth", "Proposed rear", "teeth")}
          </div></article>
        </div>
        <div>
          <article class="panel"><h3>Final-drive construction</h3>${powertrainDiagram()}</article>
          <article class="panel"><h3>Per-gear matrix</h3><div class="table-wrap"><table class="dense"><thead><tr><th>Gear</th><th class="numeric">Ratio</th><th class="numeric">Overall</th><th class="numeric">Step</th><th class="numeric">km/h @ max RPM</th><th class="numeric">RPM @ ${fmt(p.cruiseSpeed, 0)} km/h</th><th class="numeric">Wheel N·m @ peak</th><th class="numeric">Tractive N @ peak</th></tr></thead><tbody>${rows}</tbody></table></div>
            <p class="diagram-note">Wheel torque and tractive force use the committed peak motor torque and driveline efficiency. RPM in red exceeds max RPM.</p></article>
          <article class="panel"><h3>Road speed vs motor RPM</h3>${canvasChart("speedRpmChart", "Road speed against motor RPM for every gear", 300)}${legend(ok ? o.rows.map(row => [gearCount === 1 ? "Single speed" : `G${row.gear}`, SERIES_COLOURS[row.gear - 1]]).concat([[`Cruise ${fmt(p.cruiseSpeed, 0)} km/h`, "#8f9b97", true]]) : [])}</article>
        </div>
      </div>
      ${ok ? chainPanels(o, linkUnit) : ""}
      ${ok ? comboPanel(o, linkUnit) : ""}
      ${ok ? proposedPanel(o, linkUnit) : ""}
      ${transmissionComparisonPanel()}
    </section>`;
  }
  function chainPanels(o, linkUnit) {
    const c = o.chain, p = state.powertrain;
    const fits = c.validLinks.length ? c.validLinks.join(", ") : "none";
    return `<div class="grid equal">
      <article class="panel"><h3>${c.kind === "belt" ? "Belt length" : "Chain length & links"}</h3>
        <div class="table-wrap"><table class="dense kv"><tbody>
          <tr><th>Centre distance at hardpoints</th><td class="numeric">${fmt(c.centreDistance, 1)} mm</td></tr>
          <tr><th>Exact length for the hardpoints</th><td class="numeric">${fmt(c.exact, 2)} ${linkUnit}</td></tr>
          <tr><th>Recommended ${c.kind === "belt" ? "tooth count" : "link count (even)"}</th><td class="numeric"><strong>${c.recommended} ${linkUnit}</strong></td></tr>
          <tr><th>${c.kind === "belt" ? "Belt" : "Chain"} length</th><td class="numeric">${fmt(c.length, 1)} mm</td></tr>
          <tr><th>Centre distance with recommended length</th><td class="numeric">${fmt(c.recommendedCentre, 1)} mm</td></tr>
          <tr><th>Axle move from hardpoint</th><td class="numeric">${signed(c.axleMove, 1)} mm <small>${c.axleMove >= 0 ? "rearward" : "forward"}</small></td></tr>
          <tr><th>Adjuster window</th><td class="numeric">−${fmt(p.axleAdjustForward, 0)} / +${fmt(p.axleAdjustRearward, 0)} mm</td></tr>
          <tr><th>${c.kind === "belt" ? "Tooth counts" : "Link counts"} that fit the adjuster</th><td class="numeric">${esc(fits)}</td></tr>
        </tbody></table></div>
        ${c.withinAdjuster ? `<div class="notice success compact">The recommended ${c.kind} fits inside the adjuster window.</div>` : `<div class="notice danger compact">No ${c.kind === "belt" ? "whole tooth count" : "even link count"} fits inside the adjuster window. Move the drive sprocket or axle hardpoint, change sprockets or lengthen the adjuster slot.</div>`}
        <p class="diagram-note">${esc(DATA.sourceNotes.transmission)}</p></article>
      <article class="panel"><h3>Sprockets, loading & wear</h3>
        <div class="table-wrap"><table class="dense"><thead><tr><th></th><th class="numeric">Front</th><th class="numeric">Rear</th></tr></thead><tbody>
          <tr><th>Teeth</th><td class="numeric">${c.front}</td><td class="numeric">${c.rear}</td></tr>
          <tr><th>Pitch diameter</th><td class="numeric">${fmt(c.frontDiameters.pitch, 1)} mm</td><td class="numeric">${fmt(c.rearDiameters.pitch, 1)} mm</td></tr>
          <tr><th>Outside diameter</th><td class="numeric">${fmt(c.frontDiameters.outside, 1)} mm</td><td class="numeric">${fmt(c.rearDiameters.outside, 1)} mm</td></tr>
          ${c.kind === "chain" ? `<tr><th>Root diameter</th><td class="numeric">${fmt(c.frontDiameters.root, 1)} mm</td><td class="numeric">${fmt(c.rearDiameters.root, 1)} mm</td></tr>` : ""}
          <tr><th>Same tooth meets same ${c.kind === "belt" ? "belt tooth" : "link"} every</th><td class="numeric">${fmt(c.sameToothFront, 0)} rev</td><td class="numeric">${fmt(c.sameToothRear, 0)} rev</td></tr>
        </tbody></table></div>
        <div class="table-wrap" style="margin-top:12px"><table class="dense kv"><tbody>
          <tr><th>Wrap on small sprocket</th><td class="numeric">${fmt(o.wrapAngle.value, 1)}° · ${fmt(o.teethEngaged.value, 1)} teeth</td></tr>
          <tr><th>Peak tension (G1, peak torque)</th><td class="numeric">${fmt(o.chainTension.value, 2)} kN</td></tr>
          <tr><th>Breaking load</th><td class="numeric">${fmt(p.chainBreakingLoad, 1)} kN</td></tr>
          <tr><th>Static safety factor</th><td class="numeric"><strong>${fmt(o.chainSafetyFactor.value, 2)}×</strong></td></tr>
          <tr><th>${c.kind === "belt" ? "Belt" : "Chain"} speed at max RPM, top gear</th><td class="numeric">${fmt(o.chainSpeed.value, 1)} m/s</td></tr>
          <tr><th>Sprocket common factor</th><td class="numeric">${c.sprocketCommonFactor}${c.sprocketCommonFactor === 1 ? " · hunting pair" : " · same teeth re-mesh"}</td></tr>
        </tbody></table></div>
        <p class="diagram-note">A higher wear-recurrence count spreads contact across more tooth and link pairs. Safety factor is static against breaking load; fatigue, shock and wear allowance are not evaluated.</p></article>
    </div>`;
  }
  function comboPanel(o, linkUnit) {
    if (!["topSpeed", "delta", "torque", "ratio", "links"].includes(comboMetric)) comboMetric = "topSpeed";
    const rears = o.combos[0]?.map(cell => cell.rear) || [];
    const cellValue = cell => comboMetric === "topSpeed" ? fmt(cell.topSpeed, 1) : comboMetric === "delta" ? `${signed(cell.topSpeedDeltaPercent, 1)}%` : comboMetric === "torque" ? fmt(cell.firstGearWheelTorque, 0) : comboMetric === "ratio" ? fmt(cell.finalRatio, 3) : cell.links === null ? "—" : `${cell.links}${cell.withinAdjuster ? "" : "*"}`;
    const span = Math.max(1, ...o.combos.flat().map(cell => Math.abs(cell.topSpeedDeltaPercent)));
    const tint = cell => {
      const t = Math.min(1, Math.abs(cell.topSpeedDeltaPercent) / span);
      return cell.current ? "" : cell.topSpeedDeltaPercent > 0 ? `background:rgba(38,107,146,${0.08 + 0.32 * t})` : `background:rgba(166,101,22,${0.08 + 0.32 * t})`;
    };
    const unit = { topSpeed: "km/h", delta: "% vs current", torque: "N·m at the wheel", ratio: "rear / front", links: `${linkUnit} (* outside adjuster)` }[comboMetric];
    return `<article class="panel"><div class="panel-title-row"><div><h3>Sprocket combination matrix</h3><p class="panel-intro">Front ±3 by rear ±3 teeth around the current pair. Blue is taller gearing (more top speed), amber is shorter (more wheel torque). Values in ${esc(unit)}.</p></div>
      <div class="field benchmark-filter"><label for="combo-metric">Show</label><select id="combo-metric" data-combo-metric>${optionList(comboMetrics, comboMetric)}</select></div></div>
      <div class="table-wrap"><table class="combo-matrix"><thead><tr><th>Front ↓ / Rear →</th>${rears.map(rear => `<th class="numeric">${rear}</th>`).join("")}</tr></thead><tbody>
        ${o.combos.map(row => `<tr><th>${row[0].front}</th>${row.map(cell => `<td class="numeric ${cell.current ? "current-cell" : ""}" style="${tint(cell)}" title="${cell.front}/${cell.rear} · ratio ${fmt(cell.finalRatio, 3)} · ${fmt(cell.topSpeed, 1)} km/h · ${cell.links ?? "—"} ${linkUnit}">${cellValue(cell)}</td>`).join("")}</tr>`).join("")}
      </tbody></table></div></article>`;
  }
  function proposedPanel(o, linkUnit) {
    const p = state.powertrain, x = o.proposed, top = o.rows.at(-1);
    if (!x) return `<article class="panel"><h3>Current vs proposed sprockets</h3><div class="notice warning">Enter a proposed front and rear tooth count (whole numbers of at least 3) that fit at the hardpoints.</div></article>`;
    const row = (label, current, proposed, delta = "") => `<tr><th>${esc(label)}</th><td class="numeric">${current}</td><td class="numeric"><strong>${proposed}</strong></td><td class="numeric">${delta}</td></tr>`;
    return `<article class="panel"><h3>Current vs proposed sprockets</h3><div class="table-wrap"><table class="dense"><thead><tr><th></th><th class="numeric">Current</th><th class="numeric">Proposed</th><th class="numeric">Change</th></tr></thead><tbody>
      ${row("Sprockets", `${p.frontTeeth} / ${p.rearTeeth}`, `${x.front} / ${x.rear}`)}
      ${row("Final-drive ratio", fmt(o.finalRatio.value, 3), fmt(x.finalRatio, 3), `${signed(x.finalRatioDeltaPercent, 1)}%`)}
      ${row("Speed @ max RPM, top gear", `${fmt(top.speedAtMaxRpm, 1)} km/h`, `${fmt(x.topSpeed, 1)} km/h`, `${signed(x.topSpeedDeltaPercent, 1)}%`)}
      ${row("Wheel torque in G1 @ peak", `${fmt(o.rows[0].wheelTorqueAtPeak, 0)} N·m`, `${fmt(o.rows[0].wheelTorqueAtPeak * x.finalRatio / o.finalRatio.value, 0)} N·m`, `${signed(x.wheelTorqueDeltaPercent, 1)}%`)}
      ${row(`RPM at ${fmt(p.cruiseSpeed, 0)} km/h, top gear`, fmt(x.cruiseRpmTopBaseline, 0), fmt(x.cruiseRpmTop, 0), x.cruiseRpmTop && x.cruiseRpmTopBaseline ? `${signed(x.cruiseRpmTop - x.cruiseRpmTopBaseline, 0)} rpm` : "")}
      ${row(`Recommended ${linkUnit}`, String(o.recommendedLinks.value), String(x.recommendedLinks), `${signed(x.recommendedLinks - o.recommendedLinks.value, 0)}`)}
      ${row("Axle move from hardpoint", `${signed(o.axleMove.value, 1)} mm`, `${signed(x.axleMove, 1)} mm`, x.withinAdjuster ? "fits adjuster" : "outside adjuster")}
      ${row(`Axle move keeping the current ${o.recommendedLinks.value}-${linkUnit === "teeth" ? "tooth belt" : "link chain"}`, "—", x.sameChainAxleMove === null ? "will not fit" : `${signed(x.sameChainAxleMove, 1)} mm`)}
    </tbody></table></div><p class="diagram-note">Positive axle move is rearward along the drive-centre to axle line. Speed change ignores road load; see Motor sizing for achievable top speed.</p></article>`;
  }

  // Reference gearbox overlay: read-only, never writes to Transmission or the revision.
  function transmissionReference() {
    const records = window.TRANSMISSION_BENCHMARKS?.records || [];
    return records.find(record => record.id === transmissionReferenceId) || null;
  }
  function projectGearRatios() {
    const p = state.powertrain, count = Math.max(1, Math.min(6, Math.round(Number(p.gearCount) || 6)));
    return [p.gear1, p.gear2, p.gear3, p.gear4, p.gear5, p.gear6].slice(0, count).map(Number).filter(value => Number.isFinite(value) && value > 0);
  }
  function projectOverall(gearRatio) {
    return Number(state.powertrain.primaryRatio) * gearRatio * (Number(state.powertrain.rearTeeth) / Math.max(1e-9, Number(state.powertrain.frontTeeth)));
  }
  function referenceOverall(record, gearRatio) { return Number(record.primaryRatio) * gearRatio * Number(record.finalRatio); }
  function transmissionComparisonPanel() {
    const catalogue = window.TRANSMISSION_BENCHMARKS;
    if (!catalogue?.records?.length) return `<article class="panel"><h3>Reference gearbox</h3><div class="notice danger">No transmission reference catalogue is loaded.</div></article>`;
    const grouped = catalogue.categories.map(category => {
      const items = catalogue.records.filter(record => record.benchmarkCategory === category);
      return items.length ? `<optgroup label="${esc(category)}">${items.map(record => `<option value="${esc(record.id)}" ${record.id === transmissionReferenceId ? "selected" : ""}>${esc(record.label)}</option>`).join("")}</optgroup>` : "";
    }).join("");
    const record = transmissionReference(), mine = projectGearRatios();
    const count = Math.max(mine.length, record?.gearRatios?.length || 0);
    const rows = Array.from({ length: count }, (_, index) => {
      const a = mine[index], b = record?.gearRatios?.[index];
      return `<tr><td>G${index + 1}</td><td class="numeric">${Number.isFinite(a) ? fmt(projectOverall(a), 2) : "—"}</td><td class="numeric">${record && Number.isFinite(b) ? fmt(referenceOverall(record, b), 2) : "—"}</td></tr>`;
    }).join("");
    return `<article class="panel"><div class="panel-title-row"><div><h3>Reference gearbox</h3><p class="panel-intro">Overall ratio per gear against a curated production motorcycle. Read-only context: it never changes Transmission or the revision.</p></div>
      <div class="field benchmark-filter wide"><label for="transmission-reference">Compare against</label><select id="transmission-reference" data-transmission-reference><option value="">No reference</option>${grouped}</select></div></div>
      ${record ? `<div class="reference-chip"><strong>${esc(record.label)}</strong><span>${record.gearCount} gears</span><span>primary ${fmt(record.primaryRatio, 3)}</span><span>${record.frontTeeth}/${record.rearTeeth}T</span><span>${fmt(record.maxRpm, 0)} rpm</span></div>` : ""}
      <div class="grid two compact-grid"><div>${canvasChart("gearRatioChart", "Overall ratio per gear against the selected reference", 240)}${legend([["This design", "#1f6b50"], [record ? record.label : "No reference", "#d75f36"]])}</div>
      <div class="table-wrap"><table class="dense"><thead><tr><th>Gear</th><th class="numeric">This design</th><th class="numeric">Reference</th></tr></thead><tbody>${rows}</tbody></table></div></div></article>`;
  }
  function drawGearRatioComparison(canvas) {
    if (!canvas) return;
    const record = transmissionReference(), mine = projectGearRatios().map(projectOverall);
    const theirs = record ? record.gearRatios.map(ratio => referenceOverall(record, ratio)) : [];
    const count = Math.max(mine.length, theirs.length);
    if (!count) return;
    const rect = canvas.getBoundingClientRect(); if (!rect.width) return;
    const view = drawAxes(canvas, "Gear", "Overall ratio", 0, Math.max(...mine, ...theirs) * 1.15);
    const slot = (view.W - view.pad.l - view.pad.r) / count, barW = Math.min(26, slot / (record ? 2.6 : 1.8));
    const drawSet = (values, colour, offset) => values.forEach((value, index) => {
      const x = view.pad.l + slot * (index + 0.5) + offset - barW / 2, y = view.ty(value), base = view.ty(0);
      view.ctx.fillStyle = colour; view.ctx.fillRect(x, y, barW, base - y);
      view.ctx.font = "700 10px Inter, system-ui"; view.ctx.textAlign = "center"; view.ctx.fillText(fmt(value, 2), x + barW / 2, y - 5);
    });
    drawSet(mine, "#1f6b50", record ? -barW * 0.62 : 0);
    if (record) drawSet(theirs, "#d75f36", barW * 0.62);
    view.ctx.fillStyle = "#61717b"; view.ctx.font = "10px Inter, system-ui"; view.ctx.textAlign = "center";
    for (let index = 0; index < count; index += 1) view.ctx.fillText(`G${index + 1}`, view.pad.l + slot * (index + 0.5), view.H - view.pad.b + 16);
    view.ctx.textAlign = "left";
  }
  function drawSpeedRpm(canvas) {
    const o = outputs.powertrain; if (!o?.ok) return;
    const gearCount = o.rows.length, cruise = Number(state.powertrain.cruiseSpeed);
    xyChart(canvas, {
      xLabel: "Motor RPM", yLabel: "Road speed (km/h)", xMax: Number(state.powertrain.maxRpm),
      series: o.rows.map(row => ({ data: row.curve.map(point => [point.rpm, point.speed]), colour: SERIES_COLOURS[row.gear - 1], endLabel: gearCount === 1 ? "" : `G${row.gear}` })),
      hLines: cruise > 0 ? [{ y: cruise, label: `${fmt(cruise, 0)} km/h`, colour: "#8f9b97" }] : []
    });
  }

  // ---- Motor sizing ------------------------------------------------------------------------
  function renderMotor(tab) {
    const o = outputs.motor, m = state.motor, p = state.powertrain, pt = outputs.powertrain, ok = o?.ok === true;
    const masses = outputs.massProperties, rearTyre = Core.tyre(state.stance.rearTyreWidth, state.stance.rearTyreAspect, state.stance.rearRim);
    const linked = m.ratioSource !== "manual";
    const tiles = ok ? [
      kpi("Peak torque", o.peakTorque, 1, `set by ${o.governing.label}`),
      kpi("Peak power", o.peakPower, 1, `at ${fmt(o.baseRpm.value, 0)} rpm`),
      kpi("Base RPM", o.baseRpm, 0, `CPSR ${fmt(m.constantPowerRatio, 2)}`),
      kpi("Max RPM", o.maxRpm, 0, `${fmt(m.targetTopSpeed, 0)} km/h, tallest ratio`),
      kpi("Launch wheel torque", o.launchWheelTorque, 0, `${fmt(o.launchAccel.value, 2)} g uncapped`),
      kpi("Grade torque", o.gradeTorque, 1, o.gradePower.value === null ? "no grade target" : `${fmt(o.gradePower.value, 1)} kW continuous`)
    ] : [];
    const ratioRows = linked ? (pt?.ok ? pt.rows.map(row => [pt.rows.length === 1 ? "Overall ratio" : `G${row.gear} overall`, fmt(row.overallRatio, 3), ""]) : [["Overall ratios", "Transmission unavailable", ""]]) : [];
    const req = ok ? o.requirements.map(item => `<tr class="${item.id === o.governing.id ? "governs" : ""}"><td>${esc(item.label)}</td><td class="numeric">${fmt(item.torque, 1)} N·m</td><td class="numeric">${fmt(item.torque * o.baseRpm.value * 2 * Math.PI / 60 / 1000, 1)} kW</td><td>${item.id === o.governing.id ? "<strong>governs</strong>" : ""}</td></tr>`).join("") : "";
    const c = ok ? o.committed : null;
    const cmp = (label, target, achieved, unit, digits, better) => {
      const delta = Number.isFinite(target) && Number.isFinite(achieved) ? achieved - target : null;
      const meets = delta === null || !better ? null : better === "lower" ? delta <= 1e-9 : delta >= -1e-9;
      return `<tr><th>${esc(label)}</th><td class="numeric">${Number.isFinite(target) ? `${fmt(target, digits)} ${unit}` : "—"}</td><td class="numeric">${Number.isFinite(achieved) ? `${fmt(achieved, digits)} ${unit}` : "—"}</td><td class="numeric ${meets === false ? "over" : ""}">${delta === null ? "—" : `${signed(delta, digits)}`}</td></tr>`;
    };
    const comparison = ok && c ? `<div class="table-wrap"><table class="dense"><thead><tr><th></th><th class="numeric">Required / target</th><th class="numeric">Committed motor</th><th class="numeric">Δ</th></tr></thead><tbody>
      ${cmp("Peak torque", o.peakTorque.value, c.peakTorque, "N·m", 1)}
      ${cmp("Peak power", o.peakPower.value, c.peakPowerKw, "kW", 1)}
      ${cmp("Base RPM", o.baseRpm.value, c.baseRpm, "rpm", 0)}
      ${cmp("Max RPM", o.maxRpm.value, c.maxRpm, "rpm", 0)}
      ${cmp("0–60 km/h", Number(m.target0to60) || null, c.times[60], "s", 2, "lower")}
      ${cmp("0–100 km/h", Number(m.target0to100) || null, c.times[100], "s", 2, "lower")}
      ${cmp("Top speed (road load)", Number(m.targetTopSpeed), c.topSpeed, "km/h", 1, "higher")}
      ${cmp(`Gradeability at ${fmt(m.gradeSpeed, 0)} km/h`, Number(m.gradePercent) || null, c.gradeability, "%", 1, "higher")}
    </tbody></table></div><p class="diagram-note">Judge the committed motor by the performance rows: red Δ means it falls short of that target. Torque, power and RPM rows are informational, because a different envelope shape (base speed) can meet the same targets. Gradeability is tractive only; tyre grip and wheelie on steep grades are not evaluated.</p>` : (ok ? `<div class="notice warning">The committed envelope is incomplete; enter peak torque, base and max RPM below.</div>` : "");
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab)}
      ${kpiStrip("motor", tiles)}${invalidNotice(o, "Motor sizing")}
      <div class="grid two">
        <div>
          <article class="panel"><h3>Performance targets</h3><div class="fields">
            ${input("motor.targetTopSpeed", "Max speed", "km/h")}
            ${input("motor.gradePercent", "Inclination", "%", { help: `${fmt(Math.atan(Number(m.gradePercent) / 100) * 180 / Math.PI, 1)}°` })}
            ${input("motor.gradeSpeed", "Speed on inclination", "km/h")}
            ${input("motor.target0to60", "0–60 km/h", "s", { step: "0.1", help: "0 skips this target" })}
            ${input("motor.target0to100", "0–100 km/h", "s", { step: "0.1", help: "0 skips this target" })}
            ${input("motor.wheelieCap", "Cap launch at wheelie limit", "", { type: "select", values: [{ value: "yes", label: "Yes · anti-wheelie" }, { value: "no", label: "No · uncapped" }] })}
          </div>
          <h4 class="subhead">Motor model</h4><div class="fields">
            ${input("motor.constantPowerRatio", "Constant-power speed ratio", "max/base", { step: "0.1", help: "Typical PMSM 2–3.5" })}
            ${input("motor.inertiaFactor", "Rotating-mass factor", "×", { step: "0.01" })}
          </div></article>
          <article class="panel"><h3>Transmission ratio</h3><div class="fields">
            ${input("motor.ratioSource", "Ratio source", "", { type: "select", full: true, values: [{ value: "linked", label: "Linked · overall ratios from the Transmission tab" }, { value: "manual", label: "Manual · single overall ratio" }] })}
            ${linked ? "" : input("motor.manualRatio", "Overall ratio", "motor : wheel", { step: "0.01", full: true, help: "Single-speed overall reduction, e.g. 9.91" })}
          </div>
          ${linked ? linkedList(ratioRows.map(([label, value]) => [label, value, ""]).concat([["Source", sourceTag("powertrain"), ""]])) : ""}
          <h4 class="subhead">Linked vehicle</h4>
          ${linkedList([
            ["Mass", masses?.ok ? `${fmt(masses.totalMass, 1)} kg` : "—", `${state.meta.loadCase} · mass properties`],
            ["CdA / Crr / ρ", `${fmt(state.vehicle.dragCoefficientArea, 2)} m² · ${fmt(state.vehicle.rollingResistance, 3)} · ${fmt(state.vehicle.airDensity, 3)}`, "Vehicle calculators"],
            ["Rear tyre radius", rearTyre.ok ? `${fmt(rearTyre.radius, 1)} mm` : "—", sourceTag("stance")],
            ["Driveline efficiency", fmt(p.drivelineEfficiency, 2), "Transmission"],
            ["Wheelie limit", ok ? `${fmt(o.wheelieLimit.value, 2)} g` : "—", "linked CG"]
          ])}</article>
          <article class="panel"><h3>Committed motor envelope</h3><p class="panel-intro">The motor the rest of the model uses: Transmission, Anti-squat, Battery and Energy & E/E read these values.</p><div class="fields">
            ${input("powertrain.type", "Powertrain type", "", { type: "select", values: ["Electric", "ICE"] })}
            ${input("powertrain.maxTorque", "Peak torque", "N·m")}
            ${input("powertrain.baseRpm", "Base RPM", "rpm")}
            ${input("powertrain.maxRpm", "Max RPM", "rpm")}
            ${input("powertrain.motorEfficiency", "Motor efficiency", "fraction", { step: "0.01" })}
            ${input("powertrain.inverterEfficiency", "Inverter efficiency", "fraction", { step: "0.01" })}
            ${input("powertrain.provenance", "Provenance", "", { type: "text", full: true })}
          </div>
          ${ok ? `<button class="button primary" type="button" data-action="apply-motor" style="margin-top:14px">Apply required motor · ${fmt(o.proposal.maxTorque, 0)} N·m, ${fmt(o.proposal.baseRpm, 0)} / ${fmt(o.proposal.maxRpm, 0)} rpm</button><p class="diagram-note">Writes peak torque (rounded up), base and max RPM into the committed envelope and creates a new revision. If the named duty point would fall outside the new envelope it is clamped onto it, and the change log says so.</p>` : ""}</article>
          <article class="panel"><h3>Named duty case</h3>${dutyCaseControl(false)}<div class="fields" style="margin-top:12px">
            ${input("powertrain.dutyTorque", "Duty torque", "N·m")}
            ${input("powertrain.dutyRpm", "Duty RPM", "rpm")}
            ${input("powertrain.dutyDurationMinutes", "Duty duration", "min", { step: "0.5" })}
            ${input("powertrain.dutyGear", "Duty gear", "gear")}
          </div>
          <div class="kpi-mini">${pt?.ok ? [kpi("Duty shaft power", pt.shaftPower, 2), kpi("Duty energy", pt.dutyEnergy, 2), kpi("Duty road speed", pt.dutyRoadSpeed, 1), kpi("Committed peak power", pt.peakPower, 1)].join("") : invalidNotice(pt, "Duty case")}</div></article>
        </div>
        <div>
          <article class="panel"><h3>What sets the motor</h3>${ok ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Target</th><th class="numeric">Peak torque needed</th><th class="numeric">Peak power</th><th></th></tr></thead><tbody>${req}</tbody></table></div><p class="diagram-note">${esc(DATA.sourceNotes.motorSizing)}</p>` : ""}</article>
          <article class="panel"><h3>Required vs committed</h3>${comparison}</article>
          <article class="panel"><h3>Motor torque & power vs RPM</h3>${canvasChart("motorEnvelopeChart", "Required and committed motor torque and power against motor RPM", 300)}${legend([["Required torque", "#1f6b50"], ["Required power", "#1f6b50", true], ["Committed torque", "#d75f36"], ["Committed power", "#d75f36", true]])}</article>
          <article class="panel"><h3>Wheel torque vs road speed</h3><p class="panel-intro">Motor torque × overall ratio × efficiency for every gear, against the road-load torque it has to beat.</p>${canvasChart("wheelTorqueChart", "Wheel torque per gear against road speed with road-load torque", 320)}${legend(wheelLegend(o))}</article>
          <article class="panel"><h3>Wheel power vs road speed</h3>${canvasChart("wheelPowerChart", "Wheel power per gear against road speed with road-load power", 300)}${legend(wheelLegend(o))}</article>
          <article class="panel"><h3>Speed vs time</h3>${canvasChart("accelChart", "Road speed against time for required and committed motors", 280)}${legend([["Required motor", "#1f6b50"], ["Committed motor", "#d75f36"], ["Targets", "#6e56a0"]])}</article>
          <article class="panel"><h3>Torque vs power</h3><p class="panel-intro">The motor operating envelope traced from 0 to max RPM, with the grade and top-speed duty points it has to cover.</p>${canvasChart("torquePowerChart", "Motor torque against motor power along the envelope", 280)}${legend([["Required envelope", "#1f6b50"], ["Committed envelope", "#d75f36"], ["Duty points", "#6e56a0"]])}</article>
        </div>
      </div>
      ${powertrainBenchmarkPanel()}
    </section>`;
  }
  function wheelLegend(o) {
    const gears = o?.ok && o.committed ? o.ratios.map((_, index) => [o.ratios.length === 1 ? "Committed motor" : `G${index + 1} committed`, o.ratios.length === 1 ? "#d75f36" : SERIES_COLOURS[index]]) : [];
    return gears.concat([["Required envelope", "#1f6b50", true], ["Road load, level", "#8f9b97", true], [`Road load, ${fmt(state.motor.gradePercent, 0)}%`, "#b84d56", true]]);
  }
  function drawMotorCharts() {
    const o = outputs.motor; if (!o?.ok) return;
    const cv = o.curves;
    xyChart(document.querySelector("#motorEnvelopeChart"), {
      xLabel: "Motor RPM", yLabel: "Torque (N·m)", y2Label: "Power (kW)",
      series: [
        { data: cv.motor.map(p => [p.rpm, p.requiredTorque]), colour: "#1f6b50" },
        { data: cv.motor.map(p => [p.rpm, p.committedTorque]), colour: "#d75f36" },
        { data: cv.motor.map(p => [p.rpm, p.requiredPower]), colour: "#1f6b50", dash: [7, 5], axis: "y2" },
        { data: cv.motor.map(p => [p.rpm, p.committedPower]), colour: "#d75f36", dash: [7, 5], axis: "y2" }
      ],
      vLines: [{ x: o.baseRpm.value, label: "base", colour: "#1f6b50" }]
    });
    const gearColour = gear => cv.committedGears.length === 1 ? "#d75f36" : SERIES_COLOURS[gear - 1];
    const gearSeries = key => cv.committedGears.map(gear => ({ data: gear.points.map(p => [p.speed, p[key]]), colour: gearColour(gear.gear), width: 2.2 }));
    const xMax = cv.road.at(-1).speed;
    xyChart(document.querySelector("#wheelTorqueChart"), {
      xLabel: "Road speed (km/h)", yLabel: "Wheel torque (N·m)", xMax,
      series: [...gearSeries("wheelTorque"), { data: cv.requiredEnvelope.map(p => [p.speed, p.wheelTorque]), colour: "#1f6b50", dash: [7, 5], width: 2.6 }, { data: cv.road.map(p => [p.speed, p.levelTorque]), colour: "#8f9b97", dash: [4, 4] }, { data: cv.road.map(p => [p.speed, p.gradeTorque]), colour: "#b84d56", dash: [4, 4] }],
      vLines: [{ x: Number(state.motor.targetTopSpeed), label: "max speed", colour: "#6e56a0" }]
    });
    xyChart(document.querySelector("#wheelPowerChart"), {
      xLabel: "Road speed (km/h)", yLabel: "Wheel power (kW)", xMax,
      series: [...gearSeries("wheelPower"), { data: cv.requiredEnvelope.map(p => [p.speed, p.wheelPower]), colour: "#1f6b50", dash: [7, 5], width: 2.6 }, { data: cv.road.map(p => [p.speed, p.levelPower]), colour: "#8f9b97", dash: [4, 4] }, { data: cv.road.map(p => [p.speed, p.gradePower]), colour: "#b84d56", dash: [4, 4] }],
      vLines: [{ x: Number(state.motor.targetTopSpeed), label: "max speed", colour: "#6e56a0" }]
    });
    const targets = [[60, Number(state.motor.target0to60)], [100, Number(state.motor.target0to100)]].filter(([, t]) => t > 0);
    xyChart(document.querySelector("#accelChart"), {
      xLabel: "Time (s)", yLabel: "Road speed (km/h)",
      series: [{ data: cv.requiredRun.map(p => [p.t, p.v * 3.6]), colour: "#1f6b50" }, { data: cv.committedRun.map(p => [p.t, p.v * 3.6]), colour: "#d75f36" }],
      hLines: [{ y: 60, label: "60", colour: "#c3cbc6" }, { y: 100, label: "100", colour: "#c3cbc6" }],
      points: targets.map(([kmh, t]) => ({ x: t, y: kmh, colour: "#6e56a0", label: `${t} s target` }))
    });
    const trace = key => cv.motor.map(p => [p[`${key}Power`], p[`${key}Torque`]]);
    xyChart(document.querySelector("#torquePowerChart"), {
      xLabel: "Motor power (kW)", yLabel: "Motor torque (N·m)",
      series: [{ data: trace("required"), colour: "#1f6b50" }, { data: trace("committed"), colour: "#d75f36" }],
      points: [
        cv.gradePoint ? { x: cv.gradePoint.powerKw, y: cv.gradePoint.motorTorque, colour: "#6e56a0", label: "grade" } : null,
        { x: cv.vMaxPoint.powerKw, y: cv.vMaxPoint.torque, colour: "#6e56a0", label: "max speed", align: "right" }
      ].filter(Boolean)
    });
  }

  // ---- Braking -----------------------------------------------------------------------------
  function brakeHardwarePanel(side) {
    const cat = DATA.brakeCatalogue, o = outputs.braking, ok = o?.ok === true;
    const isFront = side === "front", hw = ok ? o[side] : null;
    return `<article class="panel"><h3>${isFront ? "Front brake" : "Rear brake"}</h3><div class="fields">
      ${input(`braking.${side}LeverRatio`, isFront ? "Hand-lever ratio" : "Foot-pedal ratio", "ratio", { step: "0.01" })}
      ${stdField(`braking.${side}McBore`, "Master cylinder bore", "mm", cat.mcBore, { step: "0.01" })}
      ${stdField(`braking.${side}PistonDia`, "Caliper piston diameter", "mm", cat.pistonDia)}
      ${stdField(`braking.${side}PistonCount`, "Pistons per caliper", "", cat.pistonCount)}
      ${stdField(`braking.${side}Architecture`, "Caliper architecture", "", cat.architecture.map(item => ({ value: item.value, label: item.label })), { noCustom: true })}
      ${stdField(`braking.${side}PadFriction`, "Pad compound", "μ", cat.padFriction, { step: "0.005" })}
      ${stdField(`braking.${side}DiscOd`, "Disc outer diameter", "mm", cat.discOd)}
      ${input(`braking.${side}PadHeight`, "Pad radial height", "mm", { step: "0.25" })}
      ${input(`braking.${side}HydraulicEfficiency`, "Hydraulic efficiency", "fraction", { step: "0.01" })}
    </div>
    ${linkedList([
      ["Effective disc radius", hw ? `${fmt(hw.effectiveRadius, 2)} mm` : "—", "OD/2 − pad height/2"],
      ["Piston area per pad face", hw ? `${fmt(hw.pistonArea, 1)} mm²` : "—", state.braking[`${side}Architecture`] === "floating" ? "floating: every piston pushes one face" : "opposed: half the pistons per face"],
      ["Master cylinder area", hw ? `${fmt(hw.mcArea, 1)} mm²` : "—", ""]
    ])}</article>`;
  }
  function renderBraking(tab) {
    const o = outputs.braking, b = state.braking, ok = o?.ok === true;
    const s = ok ? o.solo : null, d = ok ? o.duals : null;
    const tiles = ok ? [
      kpi("Front-only max decel", o.frontOnlyDecel, 3, s.frontOnlyStoppieLimited ? "stoppie-limited" : `rear-only ${fmt(s.rearOnly, 3)} g`),
      kpi(`Stop from ${fmt(b.testSpeed, 0)} km/h`, o.stopFront, 1, `front only · combined ${fmt(s.stopCombined, 1)} m`),
      kpi("Lever @ front lock-up", o.leverLockup, 2, `duals ${fmt(d.front.inputKg, 2)} kgf`),
      kpi("Pedal @ rear lock-up", o.pedalLockup, 2, `duals ${fmt(d.rear.inputKg, 2)} kgf`),
      kpi("Front line pressure", o.frontPressure, 1, `rear ${fmt(s.rear.pressureBar, 1)} bar`),
      kpi(`Lever @ ${fmt(b.targetDecel, 2)} g`, { value: s.targetFront.inputKg, unit: "kgf", definition: "Hand-lever force for the target deceleration with the ideal front/rear split" }, 2, `pedal ${fmt(s.targetRear.inputKg, 2)} kgf · ideal split`)
    ] : [];
    const row = (label, a, bb, unit = "", digits = 1) => `<tr><th>${esc(label)}</th><td class="numeric">${typeof a === "string" ? a : fmt(a, digits)}${unit ? ` <small>${unit}</small>` : ""}</td><td class="numeric">${typeof bb === "string" ? bb : fmt(bb, digits)}${unit ? ` <small>${unit}</small>` : ""}</td></tr>`;
    const section = label => `<tr class="section-row"><th colspan="3">${esc(label)}</th></tr>`;
    const results = ok ? `<div class="table-wrap"><table class="dense"><thead><tr><th></th><th class="numeric">Solo</th><th class="numeric">Rider + pillion</th></tr></thead><tbody>
      ${section(`Load transfer at ${fmt(b.targetDecel, 2)} g`)}
      ${row("Rear static share φ", s.phi, d.phi, "", 3)}
      ${row("CG height / wheelbase χ", s.x, d.x, "", 3)}
      ${row("Dynamic front load", s.dynamicFrontKg, d.dynamicFrontKg, "kg")}
      ${row("Dynamic rear load", s.dynamicRearKg, d.dynamicRearKg, "kg")}
      ${row("Stoppie threshold", s.stoppie, d.stoppie, "g", 3)}
      ${section(`Adhesion limits at μ ${fmt(b.roadFriction, 2)}`)}
      ${row("Front only", `${fmt(s.frontOnly, 3)} g · ${fmt(s.frontOnly * 9.80665, 2)}`, `${fmt(d.frontOnly, 3)} g · ${fmt(d.frontOnly * 9.80665, 2)}`, "m/s²")}
      ${row("Rear only", `${fmt(s.rearOnly, 3)} g · ${fmt(s.rearOnly * 9.80665, 2)}`, `${fmt(d.rearOnly, 3)} g · ${fmt(d.rearOnly * 9.80665, 2)}`, "m/s²")}
      ${section(`Stopping distance from ${fmt(b.testSpeed, 0)} km/h`)}
      ${row("Front only", s.stopFront, d.stopFront, "m", 2)}
      ${row("Rear only", s.stopRear, d.stopRear, "m", 2)}
      ${row("Both wheels at μ", s.stopCombined, d.stopCombined, "m", 2)}
      ${section("At the adhesion limit")}
      ${row("Front wheel torque", s.frontTorque, d.frontTorque, "N·m", 0)}
      ${row("Rear wheel torque", s.rearTorque, d.rearTorque, "N·m", 0)}
      ${row("Front clamp force", s.front.clamp, d.front.clamp, "N", 0)}
      ${row("Rear clamp force", s.rear.clamp, d.rear.clamp, "N", 0)}
      ${row("Front line pressure", s.front.pressureBar, d.front.pressureBar, "bar")}
      ${row("Rear line pressure", s.rear.pressureBar, d.rear.pressureBar, "bar")}
      ${row("Hand-lever force @ lock-up", s.front.inputKg, d.front.inputKg, "kgf", 2)}
      ${row("Foot-pedal force @ lock-up", s.rear.inputKg, d.rear.inputKg, "kgf", 2)}
      ${section(`Target ${fmt(b.targetDecel, 2)} g with the ideal split`)}
      ${row("Front share of braking", s.targetFrontShare * 100, d.targetFrontShare * 100, "%")}
      ${row("Hand-lever force", s.targetFront.inputKg, d.targetFront.inputKg, "kgf", 2)}
      ${row("Foot-pedal force", s.targetRear.inputKg, d.targetRear.inputKg, "kgf", 2)}
    </tbody></table></div>` : "";
    const slip = ok ? `<div class="table-wrap"><table class="dense"><thead><tr><th>μ</th><th class="numeric">Front, solo</th><th class="numeric">Rear, solo</th><th class="numeric">Front, duals</th><th class="numeric">Rear, duals</th></tr></thead><tbody>${s.slipTable.map((item, index) => `<tr><td>${fmt(item.mu, 1)}</td><td class="numeric">${fmt(item.front, 0)}</td><td class="numeric">${fmt(item.rear, 0)}</td><td class="numeric">${fmt(d.slipTable[index].front, 0)}</td><td class="numeric">${fmt(d.slipTable[index].rear, 0)}</td></tr>`).join("")}</tbody></table></div><p class="diagram-note">Maximum braking force (N) each wheel can carry when both wheels brake at the same μ.</p>` : "";
    const vehicleRows = ok ? `<div class="table-wrap"><table class="dense"><thead><tr><th></th><th class="numeric">Solo</th><th class="numeric">Rider + pillion</th></tr></thead><tbody>
      ${row("Total mass", s.mass, d.mass, "kg")}
      ${row("Front / rear static", `${fmt(s.frontKg, 1)} / ${fmt(s.rearKg, 1)}`, `${fmt(d.frontKg, 1)} / ${fmt(d.rearKg, 1)}`, "kg")}
      ${row("CG height above ground", s.cgHeight, d.cgHeight, "mm")}
      ${row("Wheelbase", s.wheelbase, d.wheelbase, "mm", 0)}
      ${row("Tyre radius F / R", `${fmt(s.frontRadius, 1)} / ${fmt(s.rearRadius, 1)}`, `${fmt(d.frontRadius, 1)} / ${fmt(d.rearRadius, 1)}`, "mm")}
    </tbody></table></div><p class="diagram-note">Linked from mass properties and Stance (${sourceTag("stance")}). Pillion mass is entered on Stance; with no pillion the two columns match.</p>` : "";
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab)}
      ${kpiStrip("braking", tiles)}${invalidNotice(o, "Braking")}
      <div class="grid two">
        <div>
          <article class="panel"><h3>Test conditions</h3><div class="fields">
            ${input("braking.roadFriction", "Tyre–road friction μ", "μ", { step: "0.05" })}
            ${input("braking.targetDecel", "Target deceleration", "g", { step: "0.05" })}
            ${input("braking.testSpeed", "Test speed", "km/h")}
            ${input("braking.freeRunCoefficient", "Free-run coefficient", "m per km/h", { step: "0.01", help: `${fmt(Number(b.freeRunCoefficient) * Number(b.testSpeed), 1)} m at ${fmt(b.testSpeed, 0)} km/h (homologation s = c·V + v²/2a)` })}
          </div></article>
          ${brakeHardwarePanel("front")}
          ${brakeHardwarePanel("rear")}
          <article class="panel"><h3>Linked vehicle</h3>${vehicleRows}</article>
        </div>
        <div>
          <article class="panel"><h3>Results</h3>${results}<p class="diagram-note">${esc(DATA.sourceNotes.braking)}</p></article>
          <article class="panel"><h3>Ideal brake-force distribution</h3><p class="panel-intro">Front vs rear braking force when both wheels are at the same μ (parabola), with the μ ${fmt(b.roadFriction, 2)} front-lock and rear-lock lines and the ${fmt(b.targetDecel, 2)} g iso-deceleration line.</p>${canvasChart("brakeDistributionChart", "Ideal front and rear braking force distribution", 340)}${legend([["Ideal, solo", "#1f6b50"], ["Ideal, rider + pillion", "#266b92"], ["Front lock (solo)", "#b84d56", true], ["Rear lock (solo)", "#a66516", true], ["Target deceleration", "#6e56a0", true]])}</article>
          <article class="panel"><h3>Lever & pedal effort vs deceleration</h3>${canvasChart("brakeEffortChart", "Hand-lever and foot-pedal force against deceleration", 280)}${legend([["Lever, front only, solo", "#1f6b50"], ["Lever, duals", "#1f6b50", true], ["Pedal, rear only, solo", "#a66516"], ["Pedal, duals", "#a66516", true]])}</article>
          <article class="panel"><h3>Line pressure vs deceleration</h3>${canvasChart("brakePressureChart", "Master-cylinder pressure against deceleration", 280)}${legend([["Front, solo", "#266b92"], ["Front, duals", "#266b92", true], ["Rear, solo", "#b84d56"], ["Rear, duals", "#b84d56", true]])}</article>
          <article class="panel"><h3>Stopping distance vs speed</h3>${canvasChart("brakeStopChart", "Stopping distance against initial speed", 280)}${legend([["Front only", "#266b92"], ["Rear only", "#b84d56"], ["Both at μ", "#1f6b50"], ["Rider + pillion", "#61717b", true]])}</article>
          <article class="panel"><h3>Maximum slip force by μ</h3>${slip}</article>
        </div>
      </div>
    </section>`;
  }
  function drawBrakingCharts() {
    const o = outputs.braking; if (!o?.ok) return;
    const s = o.solo, d = o.duals, b = state.braking;
    const rearLockLine = c => { const atZero = c.curves.rearLock.atZeroFront, slope = c.curves.rearLock.slope; const frontEnd = atZero / -slope; return [[0, atZero], [frontEnd, 0]]; };
    const fMax = Math.max(s.curves.ideal.at(-1).front, d.curves.ideal.at(-1).front, s.curves.isoDecel, d.curves.isoDecel) * 1.05;
    xyChart(document.querySelector("#brakeDistributionChart"), {
      xLabel: "Front braking force (N)", yLabel: "Rear braking force (N)", xMax: fMax,
      series: [
        { data: s.curves.ideal.map(p => [p.front, p.rear]), colour: "#1f6b50" },
        { data: d.curves.ideal.map(p => [p.front, p.rear]), colour: "#266b92" },
        { data: s.curves.frontLock.map(p => [p.front, p.rear]), colour: "#b84d56", dash: [6, 4] },
        { data: rearLockLine(s), colour: "#a66516", dash: [6, 4] },
        { data: [[0, s.curves.isoDecel], [s.curves.isoDecel, 0]], colour: "#6e56a0", dash: [3, 4] }
      ],
      yExtra: [Math.max(...s.curves.ideal.map(p => p.rear), ...d.curves.ideal.map(p => p.rear), s.curves.rearLock.atZeroFront) * 1.4],
      points: s.slipTable.filter(item => [0.3, 0.6, 0.9].includes(item.mu)).map(item => ({ x: item.front, y: item.rear, colour: "#1f6b50", r: 3.5, label: `μ ${item.mu}` }))
    });
    const e = c => c.curves.effort;
    xyChart(document.querySelector("#brakeEffortChart"), {
      xLabel: "Deceleration (g)", yLabel: "Input force (kgf)",
      series: [
        { data: e(s).map(p => [p.frontDecel, p.lever]), colour: "#1f6b50" }, { data: e(d).map(p => [p.frontDecel, p.lever]), colour: "#1f6b50", dash: [6, 4] },
        { data: e(s).map(p => [p.rearDecel, p.pedal]), colour: "#a66516" }, { data: e(d).map(p => [p.rearDecel, p.pedal]), colour: "#a66516", dash: [6, 4] }
      ]
    });
    xyChart(document.querySelector("#brakePressureChart"), {
      xLabel: "Deceleration (g)", yLabel: "Line pressure (bar)",
      series: [
        { data: e(s).map(p => [p.frontDecel, p.frontBar]), colour: "#266b92" }, { data: e(d).map(p => [p.frontDecel, p.frontBar]), colour: "#266b92", dash: [6, 4] },
        { data: e(s).map(p => [p.rearDecel, p.rearBar]), colour: "#b84d56" }, { data: e(d).map(p => [p.rearDecel, p.rearBar]), colour: "#b84d56", dash: [6, 4] }
      ]
    });
    const st = c => c.curves.stopping;
    xyChart(document.querySelector("#brakeStopChart"), {
      xLabel: "Initial speed (km/h)", yLabel: "Stopping distance (m)",
      series: [
        { data: st(s).map(p => [p.speed, p.front]), colour: "#266b92" }, { data: st(s).map(p => [p.speed, p.rear]), colour: "#b84d56" }, { data: st(s).map(p => [p.speed, p.combined]), colour: "#1f6b50" },
        { data: st(d).map(p => [p.speed, p.front]), colour: "#266b92", dash: [6, 4], width: 1.6 }, { data: st(d).map(p => [p.speed, p.rear]), colour: "#b84d56", dash: [6, 4], width: 1.6 }, { data: st(d).map(p => [p.speed, p.combined]), colour: "#1f6b50", dash: [6, 4], width: 1.6 }
      ],
      vLines: [{ x: Number(b.testSpeed), label: `${fmt(b.testSpeed, 0)} km/h`, colour: "#6e56a0" }]
    });
  }

  function powertrainBenchmarkPanel() {
    const catalogue=window.POWERTRAIN_BENCHMARKS;
    if(!catalogue?.records?.length)return `<article class="panel"><h3>Powertrain benchmarks</h3><div class="notice danger">No provenanced benchmark catalogue is loaded.</div></article>`;
    const categories=["All",...new Set(catalogue.records.map(record=>record.category))];
    if(!categories.includes(benchmarkCategory))benchmarkCategory="All";
    const records=benchmarkCategory==="All"?catalogue.records:catalogue.records.filter(record=>record.category===benchmarkCategory);
    const projectPower=Number(state.powertrain.maxTorque)*Number(state.powertrain.baseRpm)*2*Math.PI/60/1000;
    const projectTorque=Number(state.powertrain.maxTorque),projectFinal=Number(state.powertrain.rearTeeth)/Math.max(1e-9,Number(state.powertrain.frontTeeth));
    const delta=(reference,project,unit,digits=1)=>Number.isFinite(reference)&&Number.isFinite(project)?`${reference-project>=0?"+":""}${fmt(reference-project,digits)} ${unit}`:"—";
    const rows=records.map(record=>{
      const finalRatio=Number.isFinite(record.frontTeeth)&&Number.isFinite(record.rearTeeth)?record.rearTeeth/record.frontTeeth:null;
      return `<tr><td><strong>${esc(record.manufacturer)} ${esc(record.model)}</strong><br><small>${record.modelYear} · ${esc(record.category)}</small></td><td class="numeric">${fmt(record.peakPowerKw,1)}${record.peakPowerKw!==null?" kW":""}<br><small>${record.peakPowerRpm?`@ ${fmt(record.peakPowerRpm,0)} rpm`:"not published here"}</small></td><td class="numeric">${delta(record.peakPowerKw,projectPower,"kW",1)}</td><td class="numeric">${fmt(record.peakTorqueNm,1)}${record.peakTorqueNm!==null?" N·m":""}<br><small>${record.peakTorqueRpm?`@ ${fmt(record.peakTorqueRpm,0)} rpm`:"not published here"}</small></td><td class="numeric">${delta(record.peakTorqueNm,projectTorque,"N·m",1)}</td><td class="numeric">${finalRatio===null?"—":fmt(finalRatio,3)}${finalRatio===null?"":`<br><small>${record.frontTeeth} / ${record.rearTeeth} teeth</small>`}</td><td class="numeric">${delta(finalRatio,projectFinal,"ratio",3)}</td><td><span class="badge review">published</span><br><a href="${esc(record.provenance.url)}" target="_blank" rel="noopener noreferrer">Official source</a><br><small>${esc(record.provenance.note)}</small></td></tr>`;
    }).join("");
    return `<article class="panel benchmark-panel"><div class="panel-title-row"><div><h3>Powertrain benchmark comparison</h3><p class="panel-intro">Manufacturer-rated context against the project’s entered constant-torque / constant-power envelope.</p></div><div class="field benchmark-filter"><label for="benchmarkCategory">Category</label><select id="benchmarkCategory" data-benchmark-category>${categories.map(category=>`<option ${category===benchmarkCategory?"selected":""}>${esc(category)}</option>`).join("")}</select></div></div><div class="benchmark-project"><strong>Project reference</strong><span>${fmt(projectPower,1)} kW calculated peak</span><span>${fmt(projectTorque,1)} N·m entered maximum</span><span>${fmt(projectFinal,3)} final ratio</span></div><div class="table-wrap"><table><thead><tr><th>Reference motorcycle</th><th class="numeric">Rated peak power</th><th class="numeric">Δ vs project</th><th class="numeric">Rated peak torque</th><th class="numeric">Δ vs project</th><th class="numeric">Published final drive</th><th class="numeric">Δ vs project</th><th>Evidence</th></tr></thead><tbody>${rows}</tbody></table></div><div class="notice warning" style="margin-top:14px">Descriptive reference only. Manufacturer figures are rated claims, missing gearing is left blank, and no benchmark proximity creates a target pass. Project peak power is calculated from entered maximum torque × base RPM; kinematic redline speed is not real top speed.</div><p class="diagram-note">Catalogue v${esc(catalogue.schemaVersion)} · sources accessed ${esc(catalogue.accessedOn)}</p></article>`;
  }

  function renderVehicle(tab) {
    const o = outputs.vehicle;
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab,true)}<div class="grid two"><article class="panel"><h3>Study inputs</h3><div class="fields">${input("vehicle.studyGear","Selected gear","gear")}${input("vehicle.studyRpm","Study RPM","rpm")}${input("vehicle.studyTorque","Study torque","N·m")}${input("vehicle.targetSpeed","Target speed","km/h")}${input("vehicle.targetGrade","Target grade","%")}${input("vehicle.rollingResistance","Rolling resistance","coefficient",{step:"0.001"})}${input("vehicle.dragCoefficientArea","CdA","m²",{step:"0.01"})}${input("vehicle.airDensity","Air density","kg/m³",{step:"0.001"})}</div><div class="notice" style="margin-top:14px">Ratios, tyre and load-case mass are linked. This tab creates an explicit proposal and does not change Powertrain or Stance.</div></article><article class="panel"><h3>Study results</h3>${invalidNotice(o,"Vehicle study")}<div class="metric-grid">${metric("Road speed",o.speed,{owner:"vehicle"})}${metric("Wheel RPM",o.wheelRpm,{owner:"vehicle"})}${metric("Shaft power",o.shaftPower,{owner:"vehicle"})}${metric("Wheel torque",o.wheelTorque,{owner:"vehicle"})}${metric("Ideal tractive force",o.tractiveForce,{owner:"vehicle"})}${metric("Required road-load power",o.requiredPower,{owner:"vehicle"})}${metric("Required RPM",o.requiredRpm,{owner:"vehicle"})}${metric("Required shaft torque",o.requiredTorque,{owner:"vehicle"})}${metric("Power to weight",o.wattsPerKg,{owner:"vehicle"})}${metric("Power per tonne",o.kilowattsPerTonne,{owner:"vehicle"})}${metric("Horsepower per tonne",o.horsepowerPerTonne,{owner:"vehicle"})}${metric("Mass per kW",o.kilogramsPerKw,{owner:"vehicle"})}</div><button class="button" data-action="export-study" data-study="vehicle" style="margin-top:14px">Export proposal JSON</button></article></div></section>`;
  }

  function renderBattery(tab) {
    const o = outputs.battery;
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab,true)}<div class="grid two"><article class="panel"><h3>Capacity, topology and range inputs</h3><div class="fields">${input("battery.targetRange","Target range","km")}${input("battery.consumption","Named consumption","Wh/km")}${input("battery.reserve","Reserve above load energy","%")}${input("battery.capacityDerate","Capacity derate","fraction",{step:"0.01"})}${input("battery.dischargeEfficiency","Discharge-path efficiency","fraction",{step:"0.01"})}${input("battery.studyVoltage","Proposed nominal voltage","V")}${input("battery.studyCapacityAh","Minimum proposed capacity","Ah")}${input("battery.runtimeCurrent","Constant-current case","A")}${input("battery.runtimePower","Constant-power case","kW")}${input("battery.auxiliaryPower","Auxiliary power","kW")}${input("battery.averageSpeed","Average speed","km/h")}</div><h3 style="margin-top:20px">AC charge study</h3><div class="fields">${input("battery.chargerPower","AC OBC input rating","kW")}${input("battery.chargeEfficiency","Charge efficiency","fraction",{step:"0.01"})}${input("battery.chargeTaperFactor","Charge taper factor","ratio",{step:"0.01"})}${input("battery.chargeStartSoc","Charge start SOC","%")}${input("battery.chargeEndSoc","Charge end SOC","%")}${input("battery.desiredChargeHours","Desired charge time","h")}${input("battery.supplyPhases","AC phases","",{type:"select",values:[{value:1,label:"Single phase"},{value:3,label:"Three phase"}]})}${input("battery.supplyVoltage","AC line voltage","V")}${input("battery.supplyCurrent","AC current limit","A")}${input("battery.supplyPowerFactor","Power factor","fraction",{step:"0.01"})}</div><div class="notice" style="margin-top:14px">The committed pack is read from Energy & E/E Integration. This study may only create a reviewed proposal; it cannot commit pack or charger values.</div></article><article class="panel"><h3>Capacity, charging and runtime results</h3>${invalidNotice(o,"Battery study")}<div class="metric-grid">${metric("Required load energy",o.requiredLoadEnergy,{owner:"battery"})}${metric("Required usable energy",o.requiredUsable,{owner:"battery"})}${metric("Required gross energy",o.requiredNominal,{owner:"battery"})}${metric("Delivered pack energy",o.deliveredEnergy,{owner:"battery"})}${metric("Estimated range",o.estimatedRange,{owner:"battery"})}${metric("Available AC supply",o.supplyPower,{owner:"battery"})}${metric("Governing pack charge power",o.packChargePower,{owner:"battery"})}${metric("Charge time",o.chargeTime,{owner:"battery"})}${metric("Charge current",o.actualChargeCurrent,{owner:"battery"})}${metric("Charge C-rate",o.actualChargeCRate,{owner:"battery",digits:3})}${metric("Required AC OBC input",o.requiredObcPower,{owner:"battery"})}${metric("Required AC line current",o.requiredLineCurrent,{owner:"battery"})}${metric("Constant-current runtime",o.currentRuntime,{owner:"battery"})}${metric("Constant-power runtime",o.constantPowerRuntime,{owner:"battery"})}${metric("Runtime distance",o.runtimeDistance,{owner:"battery"})}${metric("Required discharge C-rate",o.requiredCRate,{owner:"battery",digits:3})}${metric("Permitted nominal power",o.permittedPower,{owner:"battery"})}${metric("Proposed series",{value:o.proposedSeries,unit:"S",definition:"Ceiling of target nominal voltage divided by cell nominal voltage"},{owner:"battery"})}${metric("Proposed parallel",{value:o.proposedParallel,unit:"P",definition:"Maximum of minimum Ah, energy and current requirements"},{owner:"battery"})}${metric("Proposed cell count",{value:o.proposedCells,unit:"cells",definition:"Series multiplied by parallel count"},{owner:"battery"})}${metric("Proposed min voltage",{value:o.proposedMinV,unit:"V",definition:"Series count multiplied by cell minimum voltage"},{owner:"battery"})}${metric("Proposed nominal voltage",{value:o.proposedNominalV,unit:"V",definition:"Series count multiplied by cell nominal voltage"},{owner:"battery"})}${metric("Proposed max voltage",{value:o.proposedMaxV,unit:"V",definition:"Series count multiplied by cell maximum voltage"},{owner:"battery"})}${metric("Proposed capacity",{value:o.proposedAh,unit:"Ah",definition:"Parallel count multiplied by cell capacity"},{owner:"battery"})}${metric("Proposed gross energy",{value:o.proposedEnergy,unit:"kWh",definition:"Proposed nominal voltage multiplied by Ah"},{owner:"battery"})}${metric("Voltage delta",{value:o.voltageDelta,unit:"V",definition:"Proposed nominal voltage minus study target"},{owner:"battery"})}${metric("Energy margin",{value:o.energyMargin,unit:"kWh",definition:"Proposed gross energy minus required gross energy"},{owner:"battery"})}</div><div class="notice warning" style="margin-top:14px">Range, runtime and charging are first-order screens using the displayed assumptions. Temperature, ageing, electrochemistry and thermal limits remain not evaluated. DC fast charging is intentionally separate from AC OBC sizing.</div><button class="button primary" data-action="propose-battery" style="margin-top:14px">Create pack proposal</button></article></div></section>`;
  }

  function renderElectrical(tab) {
    const o = outputs.electrical;
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab)}<div class="grid two"><article class="panel"><h3>Committed pack and electrical limits</h3><div class="fields">${input("electrical.cellMinV","Cell minimum","V",{step:"0.01"})}${input("electrical.cellNomV","Cell nominal","V",{step:"0.01"})}${input("electrical.cellMaxV","Cell maximum","V",{step:"0.01"})}${input("electrical.cellAh","Cell capacity","Ah",{step:"0.1"})}${input("electrical.cellResistanceMilliOhm","Cell resistance","mΩ",{step:"0.1"})}${input("electrical.series","Series count","S")}${input("electrical.parallel","Parallel count","P")}${input("electrical.interconnectResistanceMilliOhm","Pack interconnect resistance","mΩ",{step:"0.1"})}${input("electrical.socMin","Minimum SOC","%")}${input("electrical.socMax","Maximum SOC","%")}${input("electrical.dischargeCLimit","Discharge C limit","C",{step:"0.1"})}${input("electrical.chargeCLimit","Charge C limit","C",{step:"0.1"})}${input("electrical.obcPower","Committed OBC input rating","kW")}${input("electrical.obcEfficiency","OBC efficiency","fraction",{step:"0.01"})}${input("electrical.dcdcCapacity","DC-DC continuous capacity","W")}${input("electrical.dcdcPeakCapacity","DC-DC peak capacity","W")}${input("electrical.lvBusVoltage","LV bus voltage","V")}${input("electrical.lvBatteryAh","LV backup capacity","Ah")}${input("electrical.lvBackupUsableFraction","LV usable fraction","fraction",{step:"0.01"})}</div><h3 style="margin-top:20px">First-order supporting screens</h3><div class="fields">${input("electrical.cableLength","HV one-way cable length","m",{step:"0.1"})}${input("electrical.cableArea","Cable area","mm²")}${input("electrical.cableParallel","Parallel conductors","count")}${input("electrical.prechargeCapMicroF","DC-link capacitance","µF")}${input("electrical.prechargeInitialCurrent","Initial precharge current","A")}${input("electrical.prechargeTarget","Precharge target","%")}</div></article><div><article class="panel"><h3>Functional architecture template</h3><p class="panel-intro">The selected template is a functional one-line preview, not a detailed wiring schematic or proof of correctness.</p>${invalidNotice(o,"Energy and E/E closure")}${electricalFlow(o.graph)}${o.violations?.length ? `<div class="notice danger" style="margin-top:12px"><strong>Violations</strong><ul>${o.violations.map(issue=>`<li>${esc(issue)}</li>`).join("")}</ul></div>` : ""}</article><article class="panel"><h3>Electrical closure outputs</h3><div class="metric-grid">${metric("Pack minimum voltage",{value:o.pack?.minV,unit:"V",definition:"Series count x cell minimum voltage"},{owner:"electrical"})}${metric("Pack nominal voltage",{value:o.pack?.nominalV,unit:"V",definition:"Series count x cell nominal voltage"},{owner:"electrical"})}${metric("Pack maximum voltage",{value:o.pack?.maxV,unit:"V",definition:"Series count x cell maximum voltage"},{owner:"electrical"})}${metric("Pack capacity",{value:o.pack?.capacityAh,unit:"Ah",definition:"Parallel count x cell capacity"},{owner:"electrical"})}${metric("Usable energy",{value:o.pack?.usableEnergyKWh,unit:"kWh",definition:"Nominal pack energy over entered SOC window"},{owner:"electrical"})}${metric("Bus current",o.busCurrent,{owner:"electrical"})}${metric("Loaded voltage",o.terminalVoltage,{owner:"electrical"})}${metric("Pack loss",o.packLoss,{owner:"electrical"})}${metric("Pack charge power",o.packChargePower,{owner:"electrical"})}${metric("LV continuous",o.lvContinuous,{owner:"electrical"})}${metric("LV peak / inrush",o.lvPeak,{owner:"electrical"})}${metric("DC-DC continuous headroom",o.dcdcHeadroom,{owner:"electrical"})}${metric("DC-DC peak headroom",o.dcdcPeakHeadroom,{owner:"electrical"})}${metric("Essential-load backup",o.lvBackupRuntime,{owner:"electrical"})}${metric("Electrical mass",o.electricalMass,{owner:"electrical"})}${metric("Electrical CG X",o.electricalCgX,{owner:"electrical"})}${metric("Electrical CG Z",o.electricalCgZ,{owner:"electrical"})}${metric("Mass reconciliation",o.massReconciliation,{owner:"electrical",digits:3})}${metric("Cable drop",o.cableDrop,{owner:"electrical",digits:3})}${metric("Cable loss",o.cableLoss,{owner:"electrical"})}${metric("Precharge time",o.prechargeTime,{owner:"electrical",digits:3})}${metric("Precharge energy",o.prechargeEnergy,{owner:"electrical",digits:1})}</div><div class="notice warning" style="margin-top:14px">${esc(o.boundaryNote || DATA.sourceNotes.electricalBoundary)}</div></article></div></div><article class="panel"><h3>Electrical component instances</h3><p class="panel-intro">Energy & E/E owns component selection, ratings and preferred placement. The displayed X/Z coordinates are preliminary placement proposals; a concept release requires an explicit Stance-owned committed mount link.</p><div class="component-row component-head"><span>Component</span><span>Mass kg</span><span>Preferred X</span><span>Preferred Z</span><span>Continuous</span><span>Peak</span><span>Inrush</span><span>Standby</span><span>Sleep</span><span></span></div><div id="componentRows">${state.components.map((component,index) => componentRow(component,index)).join("")}</div><button class="button" data-action="add-component" style="margin-top:12px">Add custom component</button></article></section>`;
  }

  function componentRow(component, index) {
    const field = (key, type="number") => `<input type="${type}" data-component="${index}" data-component-key="${key}" value="${esc(component[key])}" aria-label="${esc(component.label)} ${key}">`;
    return `<div class="component-row">${field("label","text")}${field("mass")}${field("x")}${field("z")}${field("continuous")}${field("peak")}${field("inrush")}${field("standby")}${field("sleep")}<button class="icon-button" data-action="remove-component" data-index="${index}" aria-label="Remove ${esc(component.label)}">×</button></div>`;
  }

  function prependPanel(container, title, content, intro = "") {
    if (!container) return;
    const panel=document.createElement("article");panel.className="panel";
    panel.innerHTML=`<h3>${esc(title)}</h3>${intro?`<p class="panel-intro">${esc(intro)}</p>`:""}${content}`;
    container.prepend(panel);
  }

  function wrapSecondGridPanel(viewId) {
    const grid=document.querySelector(`#view-${viewId} .grid.two`);if(!grid)return null;
    const children=[...grid.children];if(children.length<2)return null;
    if(children[1].tagName==="DIV")return children[1];
    const right=document.createElement("div");grid.insertBefore(right,children[1]);right.appendChild(children[1]);return right;
  }

  function enhanceRenderedViews() {
    const steeringRight=wrapSecondGridPanel("steering");
    prependPanel(steeringRight,"Steering construction",steeringDiagram(),"Live tyre, rake, fork-axis and trail geometry in the master frame.");
    const suspensionRight=document.querySelector("#view-suspension .grid.two > div");
    prependPanel(suspensionRight,"Combined suspension construction",suspensionDiagram(),"Front fork and rear kinematics use the active hardpoints and travel solution.");
    const antiRight=wrapSecondGridPanel("anti_squat");
    prependPanel(antiRight,"Anti-squat construction",antiSquatDiagram(),"Drive line, sprocket pitch circles, swingarm, loaded CG and 100% reference.");
    const sagRight=document.querySelector("#view-sag .grid.two > div");
    prependPanel(sagRight,"Loaded motorcycle construction",sagDiagram(),"Active load case shown against the unladen reference.");
    const batteryHead=document.querySelector("#view-battery_calculators .view-head");
    batteryHead?.insertAdjacentHTML("afterend",electricalContextControls(false,"battery"));
    const electricalHead=document.querySelector("#view-electrical .view-head");
    electricalHead?.insertAdjacentHTML("afterend",electricalContextControls(true,"electrical"));
    const electricalArchitecture=document.querySelector("#view-electrical .grid.two > div > .panel:first-child");
    if(electricalArchitecture) electricalArchitecture.innerHTML=`<h3>Connected component architecture</h3><p class="panel-intro">Select a node to edit the underlying component. Power and communications remain separate graphs.</p>${invalidNotice(outputs.electrical,"Energy and E/E closure")}${electricalNetwork(outputs.electrical?.graph)}${selectedComponentInspector(outputs.electrical?.graph)}${outputs.electrical?.violations?.length?`<div class="notice danger" style="margin-top:12px"><strong>Violations</strong><ul>${outputs.electrical.violations.map(issue=>`<li>${esc(issue)}</li>`).join("")}</ul></div>`:""}`;
    const electricalMetrics=document.querySelector("#view-electrical .metric-grid");
    electricalMetrics?.insertAdjacentHTML("afterbegin",metric("Duty battery energy",outputs.electrical?.dutyBatteryEnergy,{owner:"electrical",digits:2}));
  }

  function renderApp() {
    recalculate();
    fieldSequence = 0;
    window.MotoGeometryState = state;
    window.MotoGeometryOutputs = outputs;
    const html = [renderClosure(), ...DATA.tabs.map(tab => {
      const renderer = { stance: renderStance, steering: renderSteering, suspension: renderSuspension, anti_squat: renderAntiSquat, sensitivity: renderSensitivity, sag: renderSag, powertrain: renderPowertrain, motor_sizing: renderMotor, braking: renderBraking, vehicle_calculators: renderVehicle, battery_calculators: renderBattery, electrical: renderElectrical }[tab.id];
      return renderer(tab);
    })].join("");
    document.querySelector("#main").innerHTML = html;
    enhanceRenderedViews();
    bindInputs();
    bindElectricalNetworkInteraction();
    updateChrome();
    requestAnimationFrame(drawCharts);
  }

  // One commit path for every owner field: write, bump revisions, mark consumers stale, then apply
  // the few explicit cross-field rules (catalogue presets, gear-count clamps) and record them.
  function commitPath(path, value, owner) {
    set(path, value);
    state.meta.revision += 1;
    state.meta.domainRevisions[owner] = (state.meta.domainRevisions[owner] || 0) + 1;
    const notes = [];
    const p = state.powertrain;
    if (path === "powertrain.chainSize") {
      const entry = (DATA.finalDriveCatalogue || []).find(item => item.id === value);
      if (entry && entry.pitch) { p.chainPitch = entry.pitch; p.chainRollerDia = entry.roller; p.chainBreakingLoad = entry.breakingLoad; notes.push(`${entry.label} pitch, roller and breaking load applied`); }
    }
    if (["powertrain.chainPitch", "powertrain.chainRollerDia", "powertrain.chainBreakingLoad"].includes(path) && p.chainSize !== "custom") {
      const entry = (DATA.finalDriveCatalogue || []).find(item => item.id === p.chainSize);
      const key = { "powertrain.chainPitch": "pitch", "powertrain.chainRollerDia": "roller", "powertrain.chainBreakingLoad": "breakingLoad" }[path];
      if (!entry || Number(entry[key]) !== Number(value)) { p.chainSize = "custom"; notes.push("final drive switched to Custom"); }
    }
    if (path === "powertrain.gearCount") {
      const count = Math.max(1, Math.min(6, Math.round(Number(value) || 6)));
      if (Number(p.dutyGear) > count) { p.dutyGear = count; notes.push(`duty gear clamped to ${count}`); }
      if (Number(state.vehicle.studyGear) > count) { state.vehicle.studyGear = count; notes.push(`study gear clamped to ${count}`); }
    }
    lastChange = `${path} changed by ${owner}${notes.length ? ` (${notes.join("; ")})` : ""}`;
    stale = new Set(dependencies[owner] || []);
    renderApp();
  }

  function bindInputs() {
    document.querySelectorAll("[data-path]").forEach(element => element.addEventListener(element.tagName === "SELECT" ? "change" : "input", event => {
      const path = event.currentTarget.dataset.path;
      const owner = event.currentTarget.dataset.owner || path.split(".")[0];
      const raw = event.currentTarget.value;
      const numericSelect = element.tagName === "SELECT" && raw !== "" && typeof get(path) === "number" && Number.isFinite(Number(raw));
      const value = event.currentTarget.type === "number" || numericSelect ? Number(raw) : raw;
      commitPath(path, value, owner);
    }));
    document.querySelectorAll("[data-std-path]").forEach(element => element.addEventListener("change", event => {
      const path = event.currentTarget.dataset.stdPath, owner = event.currentTarget.dataset.owner || path.split(".")[0];
      const raw = event.currentTarget.value;
      if (raw === "__custom") { customFields.add(path); persistUiPreferences(); renderApp(); return; }
      customFields.delete(path); persistUiPreferences();
      commitPath(path, event.currentTarget.dataset.numeric === "true" ? Number(raw) : raw, owner);
    }));
    document.querySelectorAll("[data-combo-metric]").forEach(element => element.addEventListener("change", event => { comboMetric = event.currentTarget.value; persistUiPreferences(); renderApp(); }));
    document.querySelectorAll("[data-component]").forEach(element => element.addEventListener(element.tagName === "SELECT" ? "change" : "input", event => {
      const index = Number(event.currentTarget.dataset.component);
      const key = event.currentTarget.dataset.componentKey;
      state.components[index][key] = key === "essential" ? event.currentTarget.value === "true" : event.currentTarget.type === "number" ? Number(event.currentTarget.value) : event.currentTarget.value;
      state.meta.revision += 1;
      state.meta.domainRevisions.electrical = (state.meta.domainRevisions.electrical || 0) + 1;
      lastChange = `Electrical component ${state.components[index].label} changed`;
      stale = new Set(dependencies.electrical);
      renderApp();
    }));
    document.querySelectorAll("[data-local-meta]").forEach(element => element.addEventListener("change", event => {
      const key=event.currentTarget.dataset.localMeta;
      state.meta[key]=event.currentTarget.value;
      state.meta.revision+=1;
      state.meta.domainRevisions.electrical=(state.meta.domainRevisions.electrical||0)+1;
      lastChange=`Electrical context ${key} changed`;
      stale=new Set(["electrical","battery_calculators"]);
      renderApp();
    }));
    document.querySelectorAll("[data-electrical-view]").forEach(element => element.addEventListener("change", event => {
      electricalViewLayer=event.currentTarget.value;
      persistUiPreferences();
      renderApp();
    }));
    document.querySelectorAll("[data-benchmark-category]").forEach(element=>element.addEventListener("change",event=>{benchmarkCategory=event.currentTarget.value;persistUiPreferences();renderApp();}));
    // Presentation-only: a reference vehicle changes what the charts draw, never the configuration or revision.
    document.querySelectorAll("[data-transmission-reference]").forEach(element=>element.addEventListener("change",event=>{transmissionReferenceId=event.currentTarget.value;persistUiPreferences();renderApp();}));
    const advancedEditor=document.querySelector("[data-stance-advanced]");
    advancedEditor?.addEventListener("toggle",event=>{stanceAdvancedOpen=event.currentTarget.open;persistUiPreferences();});
    document.querySelectorAll("[data-duty-case]").forEach(element => element.addEventListener("change", event => {
      state.meta.dutyCase=event.currentTarget.value;
      state.meta.revision+=1;
      state.meta.domainRevisions.powertrain=(state.meta.domainRevisions.powertrain||0)+1;
      lastChange=`Mechanical duty case changed to ${state.meta.dutyCase}`;
      stale=new Set(["powertrain","vehicle_calculators","battery_calculators","electrical","sensitivity"]);
      renderApp();
    }));
  }

  function collectIssues() {
    const issues = [];
    ["massProperties","ergonomics","steering","suspension","sag","antiSquat","sensitivity","braking","powertrain","motor","vehicle","battery","electrical"].forEach(key => {
      const item = outputs[key];
      if (item?.ok === false) issues.push(`${tabFor(key)}: ${item.error || "invalid inputs"}`);
    });
    const frontAxleX = Number(state.stance.rearAxleX) + Number(state.stance.wheelbase);
    if (!Number.isFinite(frontAxleX) || Number(state.stance.wheelbase) <= 0) issues.push("Axle-spacing closure conflict.");
    return issues;
  }

  function releaseGates() {
    const issues = collectIssues();
    return [
      { name: "Context", detail: "Project, configuration, revision, frame, units and active cases are explicit; immutable release handling is not implemented.", status: "review" },
      { name: "Ownership / provenance", detail: "Owners are explicit; component provenance remains project-assumption where entered.", status: state.components.every(c => c.provenance) ? "review" : "conflict_invalid" },
      { name: "Mathematical validity", detail: issues.length ? `${issues.length} implemented calculation issue(s).` : "Implemented equations return finite domain-valid results; integrated golden fixtures remain pending.", status: issues.length ? "conflict_invalid" : "review" },
      { name: "Coordinate closure", detail: "2D package uses the master frame; full CAD/physical correlation is not evaluated.", status: "review" },
      { name: "Cross-domain closure", detail: "Electrical component mass flows once through Mass Properties into sag, loaded geometry and demand; a retained relocation fixture remains pending.", status: issues.length ? "conflict_invalid" : "review" },
      { name: "Target / plausibility", detail: "No anonymous benchmark or category band creates approval.", status: "not_evaluated" },
      { name: "Independent verification", detail: "Core PRD fixtures are retained; new integrated solvers require frozen regression fixtures.", status: "review" },
      { name: "Concept release", detail: "Physical validation, specialist electrical design and compliance remain outside this site.", status: "not_evaluated" }
    ];
  }

  function updateChrome() {
    document.querySelectorAll(".nav-button").forEach(button => {
      const selected = button.dataset.tab === activeTab;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", selected ? "true" : "false");
      const dot = button.querySelector(".nav-state");
      if (dot) dot.className = `nav-state ${stale.has(button.dataset.tab) ? "stale" : collectIssues().some(issue => issue.startsWith(button.dataset.tab)) ? "failed" : ""}`;
    });
    const pill = document.querySelector("#closurePill");
    const issues = collectIssues();
    pill.className = `closure-pill ${issues.length ? "runtime-failed" : stale.size ? "runtime-stale" : "runtime-current"}`;
    pill.textContent = issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"}` : stale.size ? `${stale.size} stale` : "Current";
    ["project","configuration","loadCase"].forEach(key => {
      const element = document.querySelector(`[data-meta="${key}"]`);
      if (element) element.value = state.meta[key];
    });
    const revision = document.querySelector("#revisionLabel");
    if (revision) revision.textContent = `Working revision ${state.meta.revision}`;
  }

  function drawAxes(canvas, xLabel, yLabel, yMin, yMax) {
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.max(500, rect.width * ratio);
    canvas.height = Math.max(260, rect.height * ratio);
    const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
    const W = rect.width, H = rect.height, pad = { l: 55, r: 20, t: 24, b: 42 };
    ctx.clearRect(0,0,W,H); ctx.font = "11px Inter, system-ui"; ctx.fillStyle = "#61717b"; ctx.strokeStyle = "#dfe3df";
    for (let i=0;i<=4;i++){const y=pad.t+(H-pad.t-pad.b)*i/4;ctx.beginPath();ctx.moveTo(pad.l,y);ctx.lineTo(W-pad.r,y);ctx.stroke();ctx.textAlign="right";ctx.fillText(fmt(yMax-(yMax-yMin)*i/4,1),pad.l-8,y+4);}
    ctx.textAlign="center"; ctx.fillText(xLabel,(pad.l+W-pad.r)/2,H-8); ctx.save();ctx.translate(14,(pad.t+H-pad.b)/2);ctx.rotate(-Math.PI/2);ctx.fillText(yLabel,0,0);ctx.restore();
    return { ctx, W, H, pad, tx:(x,max)=>pad.l+x/Math.max(1e-9,max)*(W-pad.l-pad.r), ty:y=>pad.t+(yMax-y)/Math.max(1e-9,yMax-yMin)*(H-pad.t-pad.b) };
  }

  function plot(canvas, points, xKey, yKey, color, xLabel, yLabel) {
    if (!canvas || !points?.length) return;
    const xs=points.map(p=>p[xKey]).filter(Number.isFinite), ys=points.map(p=>p[yKey]).filter(Number.isFinite); if(!xs.length||!ys.length)return;
    let min=Math.min(...ys),max=Math.max(...ys);const margin=Math.max((max-min)*.12,.05);min-=margin;max+=margin;
    const v=drawAxes(canvas,xLabel,yLabel,min,max),xmax=Math.max(...xs,1);v.ctx.strokeStyle=color;v.ctx.lineWidth=3;v.ctx.beginPath();points.forEach((p,i)=>{const x=v.tx(p[xKey],xmax),y=v.ty(p[yKey]);i?v.ctx.lineTo(x,y):v.ctx.moveTo(x,y)});v.ctx.stroke();
  }

  function drawCharts() {
    if (activeTab === "suspension" && outputs.suspension?.points) plot(document.querySelector("#suspensionChart"), outputs.suspension.points, "wheelTravel", "motionRatio", "#266b92", "Wheel travel (mm)", "MR shock / wheel");
    if (activeTab === "suspension") drawLoadDeflection(document.querySelector("#loadDeflectionChart"));
    if (activeTab === "powertrain") { drawGearRatioComparison(document.querySelector("#gearRatioChart")); drawSpeedRpm(document.querySelector("#speedRpmChart")); }
    if (activeTab === "motor_sizing") drawMotorCharts();
    if (activeTab === "braking") drawBrakingCharts();
    if (activeTab === "anti_squat" && outputs.antiSquat?.samples) plot(document.querySelector("#antiSquatChart"), outputs.antiSquat.samples, "wheelTravel", "anti", "#1f6b50", "Rear wheel travel (mm)", "Anti-squat (%)");
    if (activeTab === "sag" && outputs.sag?.loadedRake) {
      const canvas=document.querySelector("#loadedGeometryChart"); if(canvas){const rect=canvas.getBoundingClientRect(),ratio=window.devicePixelRatio||1;canvas.width=rect.width*ratio;canvas.height=rect.height*ratio;const c=canvas.getContext("2d");c.scale(ratio,ratio);const W=rect.width,H=rect.height;c.clearRect(0,0,W,H);const rows=[["UNLADEN",state.stance.targetRake,outputs.steering.groundTrail.value,state.stance.wheelbase,state.stance.groundClearance],["LOADED",outputs.sag.loadedRake.value,outputs.sag.loadedTrail.value,outputs.sag.loadedWheelbase.value,outputs.sag.loadedClearance.value]];const labels=["Rake (deg)","Trail (mm)","Wheelbase / 10", "Clearance (mm)"];rows.forEach((row,ri)=>{const color=ri?"#1f6b50":"#266b92";c.fillStyle=color;c.font="800 12px Inter";c.fillText(row[0],20,35+ri*130);row.slice(1).forEach((value,i)=>{const norm=i===2?value/10:value;const y=60+ri*130+i*25;c.fillStyle="#61717b";c.font="11px Inter";c.fillText(labels[i],20,y);c.fillStyle=color;c.fillRect(130,y-10,Math.max(2,Math.min(W-170,norm/160*(W-170))),12);c.fillText(fmt(value,1),W-55,y);});});}}
  }

  function initChrome() {
    document.querySelector("#nav").innerHTML = `<div class="nav-group"><div class="nav-label">System</div><button class="nav-button" data-tab="closure" role="tab"><span class="nav-number">◉</span><span>Architecture closure</span><span class="nav-state"></span></button></div>` + groups.map(([label, ids]) => `<div class="nav-group"><div class="nav-label">${esc(label)}</div>${ids.map(id => {const tab=DATA.tabs.find(t=>t.id===id);return `<button class="nav-button" data-tab="${id}" role="tab"><span class="nav-number">${tab.ordinal}</span><span>${esc(tab.label)}</span><span class="nav-state"></span></button>`}).join("")}</div>`).join("");
    document.querySelector("#nav").addEventListener("click", event => {const button=event.target.closest("[data-tab]");if(!button)return;activeTab=button.dataset.tab;location.hash=activeTab;renderApp();window.scrollTo({top:0,behavior:"smooth"});});
    document.querySelectorAll("[data-meta]").forEach(element => element.addEventListener("change", event => {state.meta[event.currentTarget.dataset.meta]=event.currentTarget.value;state.meta.revision+=1;lastChange=`Context ${event.currentTarget.dataset.meta} changed`;stale=new Set(DATA.tabs.map(t=>t.id));persist();renderApp();}));
    document.body.addEventListener("click", event => {
      const networkNode=event.target.closest("[data-select-node]");if(networkNode){if(Date.now()-lastNetworkDragAt<250)return;selectedElectricalNodeId=networkNode.dataset.selectNode;renderApp();return;}
      const action=event.target.closest("[data-action]");if(!action)return;
      if(action.dataset.action==="reset"){if(confirm("Reset the working configuration to the PRD defaults?")){state=clone(DATA.defaults);state.components=clone(DATA.componentDefaults);stale.clear();lastChange="Configuration reset";persist();renderApp();}}
      if(action.dataset.action==="export"){download(`${slug(state.meta.configuration)}-revision-${state.meta.revision}.json`,JSON.stringify({contractVersion:DATA.version,tabIds:DATA.tabs.map(tab=>tab.id),configuration:contractState(),results:contractOutputs()},null,2));}
      if(action.dataset.action==="export-study"){download(`${action.dataset.study}-proposal-r${state.meta.revision}.json`,JSON.stringify(outputs[action.dataset.study]?.proposal||{},null,2));}
      if(action.dataset.action==="propose-battery"){download(`battery-proposal-r${state.meta.revision}.json`,JSON.stringify({sourceElectricalRevision:state.meta.revision,proposal:outputs.battery.proposal,downstreamConsumers:dependencies.electrical},null,2));}
      if(action.dataset.action==="add-component"){state.components.push({id:`custom-${Date.now()}`,category:"Custom",label:"Custom component",mass:1,x:0,z:0,length:100,width:100,height:100,continuous:0,peak:0,inrush:0,standby:0,sleep:0,essential:false,states:state.meta.electricalScenario,provenance:"User entry"});state.meta.revision++;state.meta.domainRevisions.electrical++;lastChange="Custom electrical component added";stale=new Set(dependencies.electrical);persist();renderApp();}
      if(action.dataset.action==="remove-component"){state.components.splice(Number(action.dataset.index),1);state.meta.revision++;state.meta.domainRevisions.electrical++;lastChange="Electrical component removed";stale=new Set(dependencies.electrical);persist();renderApp();}
      if(action.dataset.action==="apply-motor"&&outputs.motor?.ok){
        const proposal=outputs.motor.proposal,p=state.powertrain,notes=[];
        Object.assign(p,{maxTorque:proposal.maxTorque,baseRpm:proposal.baseRpm,maxRpm:proposal.maxRpm});
        // Keep the named duty point inside the new envelope so downstream energy studies stay solvable.
        if(Number(p.dutyRpm)>p.maxRpm){p.dutyRpm=p.maxRpm;notes.push(`duty RPM clamped to ${p.maxRpm}`);}
        const available=Number(p.dutyRpm)<=p.baseRpm?p.maxTorque:Math.floor(p.maxTorque*p.baseRpm/Math.max(1,Number(p.dutyRpm)));
        if(Number(p.dutyTorque)>available){p.dutyTorque=available;notes.push(`duty torque clamped to ${available} N·m`);}
        state.meta.revision++;state.meta.domainRevisions.powertrain=(state.meta.domainRevisions.powertrain||0)+1;
        lastChange=`Required motor applied: ${proposal.maxTorque} N·m, ${proposal.baseRpm} / ${proposal.maxRpm} rpm${notes.length?` (${notes.join("; ")})`:""}`;
        stale=new Set(dependencies.powertrain);persist();renderApp();
      }
      if(action.dataset.action==="lock-stance-advanced"){stanceAdvancedOpen=false;persistUiPreferences();renderApp();}
      if(action.dataset.action==="reset-network-layout"){Object.keys(electricalNodePositions).filter(key=>key.startsWith(`${state.meta.architectureVariant}:`)).forEach(key=>delete electricalNodePositions[key]);persistUiPreferences();renderApp();}
    });
    document.body.addEventListener("keydown",event=>{const node=event.target.closest?.("[data-select-node]");if(node&&(event.key==="Enter"||event.key===" ")){event.preventDefault();selectedElectricalNodeId=node.dataset.selectNode;renderApp();}});
    window.addEventListener("hashchange",()=>{const requested=location.hash.replace("#","")||"closure";activeTab=requested==="closure"||DATA.tabs.some(tab=>tab.id===requested)?requested:"closure";renderApp();});
    window.addEventListener("resize",()=>requestAnimationFrame(drawCharts));
  }

  function slug(value){return String(value).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")||"configuration";}
  function download(name,text){const blob=new Blob([text],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}

  document.addEventListener("DOMContentLoaded",()=>{initChrome();renderApp();});
})();
