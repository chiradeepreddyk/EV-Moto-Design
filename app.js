(function () {
  "use strict";

  const DATA = window.PRD_DATA;
  const Core = window.EngineeringCore;
  const STORAGE_KEY = "moto-geometry-prd-v1.3";
  const UI_STORAGE_KEY = "moto-geometry-ui-v1.3";
  const groups = [
    ["Package", ["stance"]],
    ["Chassis", ["steering", "suspension", "anti_squat", "sensitivity", "sag", "braking"]],
    ["Propulsion and studies", ["powertrain", "motor_sizing", "battery_calculators"]],
    ["Energy and E/E", ["electrical"]]
  ];
  const ownerTab = { antiSquat: "anti_squat", vehicle: "motor_sizing", battery: "battery_calculators", motor: "motor_sizing" };
  const tabFor = owner => ownerTab[owner] || owner;
  const dependencies = {
    stance: ["steering", "suspension", "sag", "powertrain", "motor_sizing", "braking", "electrical", "sensitivity", "battery_calculators", "anti_squat"],
    steering: ["suspension", "sag", "sensitivity"],
    suspension: ["sag", "anti_squat", "sensitivity"],
    antiSquat: ["sensitivity"],
    sag: ["anti_squat", "sensitivity", "electrical"],
    powertrain: ["motor_sizing", "anti_squat", "electrical", "battery_calculators"],
    electrical: ["stance", "sag", "steering", "anti_squat", "motor_sizing", "braking", "battery_calculators", "sensitivity"],
    motor: ["battery_calculators"],
    braking: ["steering", "sag"],
    battery: [],
    vehicle: ["motor_sizing", "battery_calculators"],
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
        braking: clone(state.braking), powertrain: clone(state.powertrain), motor_sizing: { ...clone(state.motor), roadLoad: clone(state.vehicle) },
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
        battery_calculators: outputs.battery, electrical: outputs.electrical
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
        <div class="summary-card"><span>CG height · front share</span><strong>${fmt(m.cgHeight,0)} mm · ${fmt(m.frontShare,1)}%</strong></div>
        <div class="summary-card"><span>Front / rear load</span><strong>${fmt(m.frontLoadKg,1)} / ${fmt(m.rearLoadKg,1)} kg</strong></div>
        <div class="summary-card"><span>Loaded trail</span><strong>${fmt(loaded?.loadedTrail?.value,1)} mm</strong></div>
        <div class="summary-card"><span>Open issues / stale</span><strong>${issueCount} / ${staleCount}</strong></div>
      </div>
      <article class="panel" style="margin-bottom:14px"><h3>Chief-engineer watch-list</h3><p class="panel-intro">Every result outside its typical ${esc(category().toLowerCase())} range, across all tabs. Context, not pass/fail.</p>${(() => { const out = allChecks().filter(row => row.status === "low" || row.status === "high"); return out.length ? `<div class="table-wrap"><table class="checks"><thead><tr><th>Check</th><th class="numeric">Value</th><th class="numeric">Typical</th><th></th></tr></thead><tbody>${out.map(row => `<tr><th><a href="#${row.tab}">${esc(row.label)}</a> <small>${esc(DATA.tabs.find(t => t.id === row.tab)?.label || "")}</small></th><td class="numeric">${fmt(row.value, row.digits)} <small>${esc(row.unit)}</small></td><td class="numeric">${bandText(row.band, row.digits)}</td><td><span class="chip chip-${row.status}">${statusText[row.status]}</span></td></tr>`).join("")}</tbody></table></div>` : `<div class="notice success">Every checked result sits inside its typical range.</div>`; })()}</article>
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

  // ---- Three-column page: inputs | results | engineering notes ----------------------------
  // Every tab uses the same frame so an engineer always finds inputs on the left, the numbers
  // and charts in the middle, and the "is this sensible?" context on the right.
  function category() { return state.stance.vehicleCategory || "Naked"; }
  function bandFor(key) {
    const entry = DATA.benchmarkBands?.[key];
    if (!entry) return null;
    return Array.isArray(entry) ? entry : entry[category()] || null;
  }
  function checkRow(tab, label, value, unit, key, digits = 1, hint = "") {
    const band = Array.isArray(key) ? key : bandFor(key);
    const v = value === null || value === undefined || value === "" ? NaN : Number(value);
    const status = !Number.isFinite(v) || !band ? "na" : v < band[0] - 1e-9 ? "low" : v > band[1] + 1e-9 ? "high" : "in";
    return { tab, label, value: Number.isFinite(v) ? v : null, unit, band, digits, status, hint };
  }
  function bandText(band, digits) {
    if (!band) return "—";
    const f = value => fmt(value, digits);
    if (!Number.isFinite(band[1])) return `≥ ${f(band[0])}`;
    if (!Number.isFinite(band[0])) return `≤ ${f(band[1])}`;
    return `${f(band[0])} – ${f(band[1])}`;
  }
  const statusText = { in: "in range", low: "below", high: "above", na: "—" };
  function checksTable(rows) {
    return `<div class="table-wrap"><table class="checks"><thead><tr><th>Check</th><th class="numeric">Value</th><th class="numeric">Typical</th><th></th></tr></thead><tbody>${rows.map(row => `<tr title="${esc(row.hint)}"><th>${esc(row.label)}</th><td class="numeric">${row.value === null ? "—" : `${fmt(row.value, row.digits)}${row.unit ? ` <small>${esc(row.unit)}</small>` : ""}`}</td><td class="numeric">${bandText(row.band, row.digits)}</td><td><span class="chip chip-${row.status}">${statusText[row.status]}</span></td></tr>`).join("")}</tbody></table></div>`;
  }
  function notesRail(tabId, { why = "", how = [], extra = "", checksTitle = "" } = {}) {
    const checks = tabChecks[tabId] ? tabChecks[tabId]() : [];
    return `<article class="panel notes-panel"><h3>Engineering notes</h3>
      ${why ? `<p class="notes-why">${why}</p>` : ""}
      ${checks.length ? `<h4 class="subhead">${esc(checksTitle || `Typical range · ${category()}`)}</h4>${checksTable(checks)}<p class="notes-foot">Indicative production ranges (Foale; Cossalter; published specifications). Outside a range is a prompt to confirm intent, not a failure. Category is set on Stance.</p>` : ""}
      ${how.length ? `<h4 class="subhead">How it is calculated</h4><ul class="notes-list">${how.map(item => `<li>${item}</li>`).join("")}</ul>` : ""}
    </article>${extra}`;
  }
  function panel(title, body, intro = "", attrs = "") {
    return `<article class="panel" ${attrs}><h3>${esc(title)}</h3>${intro ? `<p class="panel-intro">${intro}</p>` : ""}${body}</article>`;
  }
  function page(tab, { inputs, results, notes, kpis = "", study = false, top = "", after = "" }) {
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab, study)}${top}
      <div class="layout3"><div class="col col-inputs">${inputs}</div><div class="col col-results">${kpis}${results}</div><aside class="col col-notes" aria-label="Engineering notes">${notes}</aside></div>${after}</section>`;
  }
  function dataTable(head, rows, cls = "dense") {
    return `<div class="table-wrap"><table class="${cls}"><thead><tr>${head.map((h, i) => `<th class="${i ? "numeric" : ""}">${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map((c, i) => i ? `<td class="numeric">${c}</td>` : `<th>${c}</th>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }
  const withUnit = (value, unit, digits = 1) => value === null || value === undefined || !Number.isFinite(Number(value)) ? "—" : `${fmt(value, digits)} <small>${unit}</small>`;

  // Typical-range checks per tab. The closure page aggregates every row that falls outside.
  const tabChecks = {
    stance() {
      const cases = outputs.massCases || {}, e = outputs.ergonomics;
      return [
        checkRow("stance", "Wheelbase", state.stance.wheelbase, "mm", "wheelbase", 0),
        checkRow("stance", "Front weight, kerb", cases.Kerb?.frontShare, "%", "kerbFrontShare", 1, "Front axle share of kerb mass; sets steering feel and braking split"),
        checkRow("stance", "Ground reach margin", e?.groundReachMargin?.value, "mm", "groundReach", 0, "Inseam minus seat height; negative means tip-toe")
      ];
    },
    steering() {
      const o = outputs.steering, g = outputs.sag?.brakingGeometry;
      return [
        checkRow("steering", "Rake", state.stance.targetRake, "°", "rake", 1),
        checkRow("steering", "Ground trail", o?.groundTrail?.value, "mm", "trail", 1),
        checkRow("steering", `Trail at ${fmt(state.braking.targetDecel, 2)} g braking`, g?.trail, "mm", "trailUnderBraking", 1, "Trail with the front compressed by braking load transfer"),
        checkRow("steering", "Lean clearance", o?.leanClearance?.value, "°", "leanClearance", 1)
      ];
    },
    suspension() {
      const o = outputs.suspension;
      return [checkRow("suspension", "Rear progression", o?.progression?.value, "%", state.suspension.rearArchitecture === "linkage" ? "linkageProgression" : "directProgression", 1, "Change in motion ratio from extension to full travel")];
    },
    anti_squat() { return [checkRow("anti_squat", "Anti-squat at rider sag", outputs.antiSquat?.atSag?.value, "%", "antiSquatAtSag", 0)]; },
    sag() {
      const o = outputs.sag, pill = o?.loadCases?.["Rider + pillion"], avail = o?.rearShockTravelAvailable?.value;
      return [
        checkRow("sag", "Front static sag", o?.expectedFrontForkStaticPercent?.value, "%", "staticSagFront", 0),
        checkRow("sag", "Rear static sag", o?.expectedRearShockStaticPercent?.value, "%", "staticSagRear", 0),
        checkRow("sag", "Front rider sag", o?.expectedFrontForkRiderPercent?.value, "%", "riderSag", 0),
        checkRow("sag", "Rear rider sag", o?.expectedRearShockRiderPercent?.value, "%", "riderSag", 0),
        checkRow("sag", "Rear sag, rider + pillion", pill && avail ? pill.rearShockSag / avail * 100 : null, "%", "pillionSag", 0),
        checkRow("sag", "Front ride frequency", o?.frontFrequency?.value, "Hz", "frontFrequency", 2),
        checkRow("sag", "Rear ride frequency", o?.rearFrequency?.value, "Hz", "rearFrequency", 2),
        checkRow("sag", "Rear / front frequency", o?.frequencyRatio?.value, "", "frequencyRatio", 2, "Flat-ride guidance: rear slightly above front")
      ];
    },
    braking() {
      const o = outputs.braking;
      return o?.ok ? [
        checkRow("braking", "Lever force, front lock-up", o.solo.front.inputKg, "kgf", "leverForce", 1),
        checkRow("braking", "Pedal force, rear lock-up", o.solo.rear.inputKg, "kgf", "pedalForce", 1),
        checkRow("braking", `Lever force, ${fmt(state.braking.targetDecel, 2)} g`, o.solo.targetFront.inputKg, "kgf", "leverForce", 1)
      ] : [];
    },
    powertrain() {
      const o = outputs.powertrain, p = state.powertrain;
      return o?.ok ? [
        checkRow("powertrain", "Front sprocket", p.frontTeeth, "T", "frontSprocketTeeth", 0, "Below ~14 teeth chordal action and wear rise quickly"),
        checkRow("powertrain", "Wrap, small sprocket", o.wrapAngle.value, "°", "wrapAngle", 0),
        checkRow("powertrain", "Teeth engaged", o.teethEngaged.value, "", "teethEngaged", 1),
        checkRow("powertrain", "Chain safety factor", o.chainSafetyFactor.value, "×", "chainSafetyFactor", 1),
        checkRow("powertrain", "Chain speed", o.chainSpeed.value, "m/s", "chainSpeed", 1),
        checkRow("powertrain", "Top gear over-tall by", outputs.motor?.committed?.topSpeed ? (o.kinematicTopSpeed.value / outputs.motor.committed.topSpeed - 1) * 100 : null, "%", "topGearOvertall", 0, "Speed at max RPM in top gear versus the road-load top speed of the committed motor")
      ] : [];
    },
    motor_sizing() {
      const pt = outputs.powertrain, m = outputs.massProperties;
      return [
        checkRow("motor_sizing", "Constant-power ratio", state.motor.constantPowerRatio, "", "constantPowerRatio", 2),
        checkRow("motor_sizing", "Power-to-weight, committed", pt?.ok && m?.ok ? pt.peakPower.value / m.totalMass * 1000 : null, "kW/t", "powerToWeight", 0, `Committed peak power over the ${state.meta.loadCase} mass`)
      ];
    },
    battery_calculators() { return [checkRow("battery_calculators", "AC charge C-rate", outputs.battery?.actualChargeCRate?.value, "C", "acChargeCRate", 2)]; },
    electrical() {
      const o = outputs.electrical, e = state.electrical;
      const drive = state.meta.electricalScenario === "drive" && o?.pack;
      return o?.ok ? [
        checkRow("electrical", "DC-DC continuous headroom", Number(e.dcdcCapacity) > 0 ? o.dcdcHeadroom.value / Number(e.dcdcCapacity) * 100 : null, "%", "dcdcHeadroomPercent", 0),
        checkRow("electrical", "Pack voltage drop at duty", drive && o.terminalVoltage.value ? (o.pack.nominalV - o.terminalVoltage.value) / o.pack.nominalV * 100 : null, "%", "terminalSagPercent", 1),
        checkRow("electrical", "HV cable current density", o.currentDensity?.value, "A/mm²", "cableCurrentDensity", 2),
        checkRow("electrical", "Precharge time", o.prechargeTime?.value, "s", "prechargeTime", 2)
      ] : [];
    }
  };
  function allChecks() { return Object.values(tabChecks).flatMap(fn => { try { return fn(); } catch (_) { return []; } }); }

  // Horizontal bar chart: one row per label, one or more bars per row, optional reference band.
  function barChart(canvas, cfg) {
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect(), ratio = window.devicePixelRatio || 1;
    if (!rect.width || !rect.height) return;
    canvas.width = rect.width * ratio; canvas.height = rect.height * ratio;
    const ctx = canvas.getContext("2d"); ctx.scale(ratio, ratio);
    const W = rect.width, H = rect.height, rows = cfg.rows || [];
    if (!rows.length) return;
    ctx.font = "700 10px Inter, system-ui";
    const labelRoom = Math.max(30, ...rows.flatMap(row => row.bars.map(bar => ctx.measureText(bar.text ?? axisLabel(bar.value)).width))) + 12;
    const pad = { l: cfg.labelWidth || 150, r: Math.min(W * 0.35, labelRoom), t: 10, b: 34 };
    const values = rows.flatMap(row => row.bars.map(bar => bar.value)).filter(Number.isFinite);
    const lo = Math.min(0, cfg.xMin ?? 0, ...values), rawHi = Math.max(...values, ...(cfg.band || []).filter(Number.isFinite), ...(cfg.refs || []).map(ref => ref.x), 1e-6);
    if (cfg.band) cfg.band = cfg.band.map(value => Math.max(lo, Math.min(cfg.xMax ?? rawHi, value)));
    const step = niceCeilStep((rawHi - lo) / 5), hi = cfg.xMax ?? Math.ceil(rawHi / step) * step;
    const tx = x => pad.l + (x - lo) / Math.max(1e-9, hi - lo) * (W - pad.l - pad.r);
    const slot = (H - pad.t - pad.b) / rows.length, barH = Math.min(18, slot * 0.7 / Math.max(1, rows[0].bars.length));
    ctx.clearRect(0, 0, W, H); ctx.font = "11px Inter, system-ui";
    if (cfg.band) { ctx.fillStyle = "rgba(31,107,80,.10)"; ctx.fillRect(tx(cfg.band[0]), pad.t, tx(cfg.band[1]) - tx(cfg.band[0]), H - pad.t - pad.b); }
    ctx.strokeStyle = "#e3e6e2"; ctx.fillStyle = "#61717b"; ctx.textAlign = "center";
    for (let x = Math.ceil(lo / step) * step; x <= hi + 1e-9; x += step) { const px = tx(x); ctx.beginPath(); ctx.moveTo(px, pad.t); ctx.lineTo(px, H - pad.b); ctx.stroke(); ctx.fillText(axisLabel(x), px, H - pad.b + 14); }
    ctx.fillStyle = "#334650"; ctx.font = "600 11px Inter, system-ui"; ctx.fillText(cfg.xLabel || "", pad.l + (W - pad.l - pad.r) / 2, H - 6);
    (cfg.refs || []).forEach(ref => { ctx.strokeStyle = ref.colour || "#6e56a0"; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(tx(ref.x), pad.t); ctx.lineTo(tx(ref.x), H - pad.b); ctx.stroke(); ctx.setLineDash([]); ctx.lineWidth = 1; if (ref.label) { ctx.fillStyle = ref.colour || "#6e56a0"; ctx.font = "700 10px Inter, system-ui"; ctx.textAlign = "left"; ctx.fillText(ref.label, tx(ref.x) + 4, pad.t + 10); } });
    rows.forEach((row, index) => {
      const y0 = pad.t + slot * index + (slot - barH * row.bars.length) / 2;
      ctx.fillStyle = "#334650"; ctx.font = "600 11px Inter, system-ui"; ctx.textAlign = "right";
      ctx.fillText(row.label, pad.l - 8, pad.t + slot * (index + 0.5) + 4);
      row.bars.forEach((bar, b) => {
        if (!Number.isFinite(bar.value)) return;
        const x0 = tx(Math.min(0, bar.value)), x1 = tx(Math.max(0, bar.value)), y = y0 + b * barH;
        ctx.fillStyle = bar.colour; ctx.fillRect(x0, y + 1, Math.max(1, x1 - x0), barH - 2);
        ctx.fillStyle = "#334650"; ctx.font = "700 10px Inter, system-ui"; ctx.textAlign = "left";
        ctx.fillText(bar.text ?? axisLabel(bar.value), x1 + 4, y + barH / 2 + 3);
      });
    });
  }
  // Rear-wheel rate (N/mm) from the sag load curve, so it includes both spring rates, the linkage and the bump stop.
  function rateCurve(curve) {
    const pts = curve?.points || [];
    return pts.slice(1).map((point, index) => ({ travel: (point.travel + pts[index].travel) / 2, rate: (point.force - pts[index].force) / Math.max(1e-9, point.travel - pts[index].travel) }));
  }
  function trailAt(rakeDeg, offset) { const R = outputs.steering?.tyre?.radius || 0, a = rakeDeg * Math.PI / 180; return (R * Math.sin(a) - offset) / Math.cos(a); }

  // ---- Stance --------------------------------------------------------------------------------
  function renderStance(tab) {
    const m = outputs.massProperties, e = outputs.ergonomics, cases = outputs.massCases || {};
    const ice = state.powertrain.type === "ICE";
    const kpis = m?.ok ? kpiStrip("stance", [
      kpi(`Mass · ${state.meta.loadCase}`, { value: m.totalMass, unit: "kg" }, 1, `wet ${fmt(m.wetMass, 1)} kg (${signed(m.targetDelta, 1)} vs target)`),
      kpi("Front / rear", { value: `${fmt(m.frontShare, 1)} / ${fmt(100 - m.frontShare, 1)}`, unit: "%" }, 1, `${fmt(m.frontLoadKg, 0)} / ${fmt(m.rearLoadKg, 0)} kg`),
      kpi("CG height", { value: m.cgHeight, unit: "mm", definition: "CG height above the ground plane" }, 0, `${fmt(m.cgX - Number(state.stance.rearAxleX), 0)} mm ahead of rear axle`),
      kpi("Ground reach", e?.groundReachMargin, 0, Number(e?.groundReachMargin?.value) < 0 ? "tip-toe at seat" : "feet reach ground"),
      kpi("Knee / hip angle", { value: `${fmt(e?.kneeAngle?.value, 0)} / ${fmt(e?.hipAngle?.value, 0)}`, unit: "°" }, 0, `elbow ${fmt(e?.elbowAngle?.value, 0)}°`)
    ]) : invalidNotice(m, "Mass Properties");
    const caseRows = Object.entries(cases).map(([name, c]) => c?.ok ? [esc(name), withUnit(c.totalMass, "kg"), withUnit(c.frontShare, "%"), `${fmt(c.frontLoadKg, 0)} / ${fmt(c.rearLoadKg, 0)} <small>kg</small>`, withUnit(c.cgHeight, "mm", 0)] : [esc(name), "invalid", "", "", ""]);
    const ergo = e?.ok === false ? invalidNotice(e, "Rider package") : dataTable(["Rider package", "Value"], [
      ["Elbow angle", withUnit(e.elbowAngle?.value, "°", 0)], ["Knee angle", withUnit(e.kneeAngle?.value, "°", 0)], ["Hip angle", withUnit(e.hipAngle?.value, "°", 0)],
      ["Arm reach used", withUnit(e.armReachUtilisation?.value, "%", 0)], ["Ground reach margin", withUnit(e.groundReachMargin?.value, "mm", 0)],
      ["Knee to tank", withUnit(e.kneeTankClearance?.value, "mm", 0)], ...(ice ? [["Heel to exhaust", withUnit(e.heelExhaustClearance?.value, "mm", 0)]] : []),
      ["Mirror to shoulder", withUnit(e.mirrorShoulderClearance?.value, "mm", 0)], ["Pillion knee angle", withUnit(e.pillionKneeAngle?.value, "°", 0)]
    ]);
    const inputs = `${panel("Package", `<div class="fields">
        ${input("stance.vehicleCategory", "Vehicle category", "", { type: "select", values: ["Sport", "Naked", "Cruiser", "Adventure", "Touring"], full: true, help: "Sets the typical ranges used in every tab's notes." })}
        ${input("stance.wheelbase", "Wheelbase", "mm")}${input("stance.targetRake", "Rake", "deg", { step: "0.1" })}${input("stance.targetTrail", "Target trail", "mm")}
        ${input("stance.groundClearance", "Ground clearance", "mm")}${input("stance.frontTravel", "Front travel", "mm")}${input("stance.rearTravel", "Rear travel", "mm")}
      </div><h4 class="subhead">Tyres</h4><div class="fields">${input("stance.frontTyreWidth", "Front width", "mm")}${input("stance.frontTyreAspect", "Front aspect", "%")}${input("stance.frontRim", "Front rim", "in")}${input("stance.rearTyreWidth", "Rear width", "mm")}${input("stance.rearTyreAspect", "Rear aspect", "%")}${input("stance.rearRim", "Rear rim", "in")}</div>`)}
      ${panel("Mass and rider", `<div class="fields">${input("stance.gliderMass", "Glider mass", "kg")}${input("stance.gliderCGX", "Glider CG X", "mm")}${input("stance.gliderCGZ", "Glider CG Z", "mm")}${input("stance.riderMass", "Rider mass", "kg")}${input("stance.pillionMass", "Pillion mass", "kg")}${input("stance.luggageMass", "Luggage mass", "kg")}${input("stance.riderHeight", "Rider height", "mm")}${input("stance.riderInseam", "Rider inseam", "mm")}</div>
        <h4 class="subhead">Rider hardpoints</h4><div class="fields">${input("stance.seatX", "Seat X", "mm")}${input("stance.seatZ", "Seat Z", "mm")}${input("stance.gripX", "Grip X", "mm")}${input("stance.gripZ", "Grip Z", "mm")}${input("stance.pegX", "Footpeg X", "mm")}${input("stance.pegZ", "Footpeg Z", "mm")}</div>`)}
      <details class="advanced-editor" data-stance-advanced ${stanceAdvancedOpen ? "open" : ""}><summary><span>Advanced package</span><small>${stanceAdvancedOpen ? "Editing" : "Locked"} · revision ${state.meta.domainRevisions.stance}</small></summary><div class="advanced-editor-body">
        <h4 class="subhead">Frame and lean envelope</h4><div class="fields">${input("stance.rearAxleX", "Rear axle X", "mm")}${input("stance.rearAxleZ", "Rear axle Z", "mm")}${input("stance.lowestPointX", "Lowest point X", "mm")}${input("stance.lowestPointZ", "Lowest point Z", "mm")}${input("stance.bellyHalfWidth", "Lowest point half-width", "mm", { help: "Lateral half-width at the lowest point; sets belly lean clearance." })}${input("stance.pegTipLateral", "Footpeg tip lateral", "mm", { help: "Peg tip distance from centreline; sets peg lean clearance." })}${input("stance.targetWetMass", "Wet-mass target", "kg")}</div>
        <h4 class="subhead">Rider detail</h4><div class="fields">${input("stance.riderShoulderWidth", "Shoulder width", "mm")}${input("stance.torsoLength", "Torso length", "mm")}${input("stance.upperArmLength", "Upper arm", "mm")}${input("stance.forearmLength", "Forearm", "mm")}${input("stance.thighLength", "Thigh", "mm")}${input("stance.shinLength", "Shin", "mm")}${input("stance.torsoLean", "Torso lean", "deg")}${input("stance.handlebarWidth", "Bar width", "mm")}${input("stance.handlebarSweep", "Bar sweep", "deg")}</div>
        <h4 class="subhead">Pillion and envelopes</h4><div class="fields">${input("stance.pegLateral", "Foot / knee lateral", "mm")}${input("stance.tankHalfWidth", "Tank half-width", "mm")}${input("stance.mirrorHalfSpan", "Mirror half-span", "mm")}${input("stance.pillionSeatX", "Pillion seat X", "mm")}${input("stance.pillionSeatZ", "Pillion seat Z", "mm")}${input("stance.pillionPegX", "Pillion peg X", "mm")}${input("stance.pillionPegZ", "Pillion peg Z", "mm")}${ice ? `${input("stance.exhaustX", "Exhaust X", "mm")}${input("stance.exhaustZ", "Exhaust Z", "mm")}${input("stance.exhaustRadius", "Exhaust radius", "mm")}` : ""}</div>
        <button type="button" class="button" data-action="lock-stance-advanced" style="margin-top:14px">Apply and lock</button></div></details>`;
    const results = `${panel("Master-frame package", svgVehicle(), "Solver-scaled hardpoints and tyre diameters.")}
      ${panel("Load cases", `${dataTable(["Case", "Mass", "Front share", "Front / rear", "CG height"], caseRows)}${canvasChart("axleLoadChart", "Front and rear axle load for each load case", 170)}${legend([["Front axle", "#266b92"], ["Rear axle", "#a66516"]])}`, "Every load-dependent tab reads these. The active case is chosen in the bar at the top.")}
      ${panel("Where the mass is", canvasChart("massBreakdownChart", `Mass by group for the ${state.meta.loadCase} case`, 190), `Grouped contributions for ${esc(state.meta.loadCase)}.`)}
      ${panel("Rider package", `${ergo}<p class="diagram-note">Geometric screens only: comfort, control forces and clothing are not evaluated.</p>`)}`;
    const notes = notesRail("stance", {
      why: "Mass, its split between the axles and CG height drive every downstream result: sag, trail under load, braking limits, wheelie limit and anti-squat. Front share is the single biggest lever on steering feel.",
      how: ["CG is the mass-weighted mean of the glider, occupants and every E/E component.", "Axle loads come from moments about the rear contact patch over the wheelbase.", "CG height is measured from the ground plane under the rear tyre.", "Tyre sizes are nominal (width × aspect + rim); loaded radius is not modelled."]
    });
    return page(tab, { inputs, results, notes, kpis });
  }
  function drawStanceCharts() {
    const cases = outputs.massCases || {};
    barChart(document.querySelector("#axleLoadChart"), {
      xLabel: "Axle load (kg)", labelWidth: 120,
      rows: Object.entries(cases).filter(([, c]) => c?.ok).map(([name, c]) => ({ label: name, bars: [{ value: c.frontLoadKg, colour: "#266b92", text: `${fmt(c.frontLoadKg, 0)} kg · ${fmt(c.frontShare, 1)}%` }, { value: c.rearLoadKg, colour: "#a66516", text: `${fmt(c.rearLoadKg, 0)} kg` }] }))
    });
    const m = outputs.massProperties;
    if (!m?.ok) return;
    const groups = { "Glider": 0, "Battery pack": 0, "Motor & inverter": 0, "Other E/E": 0, "Rider": 0, "Pillion & luggage": 0 };
    m.instances.forEach(item => {
      const key = item.id === "glider" ? "Glider" : item.id === "rider" ? "Rider" : ["pillion", "luggage"].includes(item.id) ? "Pillion & luggage" : item.category === "HV storage" ? "Battery pack" : ["Traction machine", "HV converter"].includes(item.category) ? "Motor & inverter" : "Other E/E";
      groups[key] += Number(item.mass) || 0;
    });
    barChart(document.querySelector("#massBreakdownChart"), {
      xLabel: "Mass (kg)", labelWidth: 130,
      rows: Object.entries(groups).filter(([, value]) => value > 0).map(([label, value], index) => ({ label, bars: [{ value, colour: SERIES_COLOURS[index % SERIES_COLOURS.length], text: `${fmt(value, 1)} kg · ${fmt(value / m.totalMass * 100, 0)}%` }] }))
    });
  }

  // ---- Steering ------------------------------------------------------------------------------
  function renderSteering(tab) {
    const o = outputs.steering, g = outputs.sag?.brakingGeometry, ok = o?.ok === true;
    const solo = outputs.sag?.loadCases?.["Solo rider"];
    const kpis = ok ? kpiStrip("steering", [
      kpi("Ground trail", o.groundTrail, 1, `normal trail ${fmt(o.normalTrail.value, 1)} mm`),
      kpi("Trail, solo rider", { value: solo?.ok ? solo.trail : null, unit: "mm" }, 1, solo?.ok ? `rake ${fmt(solo.rake, 2)}°` : "sag unavailable"),
      kpi(`Trail at ${fmt(state.braking.targetDecel, 2)} g`, { value: g?.trail ?? null, unit: "mm" }, 1, g ? `dive ${fmt(g.dive, 0)} mm · rake ${fmt(g.rake, 1)}°` : "sag unavailable"),
      kpi("Offset for target", o.requiredOffset, 1, `entered ${fmt(state.steering.upperOffset, 1)} mm`),
      kpi("Lean clearance", o.leanClearance, 1, o.leanLimitedBy ? `${o.leanLimitedBy === "Footpeg tip" ? "peg" : "belly"} touches first` : ""),
      kpi("Lean margin", o.leanMargin, 1, `needs ${fmt(o.requiredLean.value, 1)}° in corner study`)
    ]) : invalidNotice(o, "Steering geometry");
    const inputs = `${panel("Triple clamp", `<div class="fields">${input("steering.upperOffset", "Upper offset", "mm")}${input("steering.underBracketOffset", "Lower offset", "mm")}${input("steering.bracketSpan", "Bracket span", "mm")}${input("steering.steeringAngle", "Steering angle study", "deg")}</div>`)}
      ${panel("Corner study", `<div class="fields">${input("steering.cornerSpeed", "Corner speed", "km/h")}${input("steering.cornerRadius", "Corner radius", "m")}</div>`)}
      ${panel("Linked inputs", linkedList([["Rake", `${fmt(state.stance.targetRake, 1)}°`, sourceTag("stance")], ["Target trail", `${fmt(state.stance.targetTrail, 0)} mm`, "Stance"], ["Wheelbase", `${fmt(state.stance.wheelbase, 0)} mm`, "Stance"], ["Front tyre radius", ok ? `${fmt(o.tyre.radius, 1)} mm` : "—", "Stance"], ["Braking deceleration", `${fmt(state.braking.targetDecel, 2)} g`, "Braking"], ["Fork springs", `${fmt(state.sag.frontK1, 1)} N/mm × ${state.sag.frontSpringCount}`, "Sag & outputs"]]))}`;
    const results = ok ? `${panel("Steering construction", steeringDiagram(), "Tyre, rake, fork axis and trail in the master frame.")}
      ${panel("Trail through fork travel", `${canvasChart("trailTravelChart", "Ground trail against front fork travel, with load-case and braking points", 290)}${legend([["Rear at rider sag", "#1f6b50"], ["Rear fully extended", "#1f6b50", true], ["Typical trail", "rgba(31,107,80,.25)"], ["Load cases", "#6e56a0"], ["Braking", "#d75f36"]])}`, "Trail shrinks as the fork compresses, and again as the rear extends under braking — the braking point sits on the dashed line when the rear tops out.")}
      ${panel("Trail vs clamp offset", `${canvasChart("offsetChart", "Ground trail against triple-clamp offset for rake around the current value", 270)}${legend([...[-2, -1, 0, 1, 2].map((d, i) => [`${fmt(Number(state.stance.targetRake) + d, 1)}°`, ["#b9c7c0", "#7aa595", "#1f6b50", "#6f93ad", "#a9bccb"][i]]), ["Typical trail", "rgba(31,107,80,.25)"]])}`, "Design chart for picking offset: each line is one rake. The dot is the current design.")}
      <div class="grid equal">${panel("Clamp construction", dataTable(["", "Value"], [["Offset delta (lower − upper)", withUnit(o.offsetDelta.value, "mm")], ["Fork-axis angle change", withUnit(o.forkAxisDelta.value, "°", 2)], ["Fork rake", withUnit(o.forkRake.value, "°", 2)], ["Head tube to fork C-C at grips", withUnit(o.headTubeToForkCC.value, "mm", 2)], [`Head drop at ${fmt(state.steering.steeringAngle, 0)}° steer`, withUnit(o.flop.value, "mm")], [`Turn radius at ${fmt(state.steering.steeringAngle, 0)}° steer`, withUnit(o.turnRadius.value, "m", 2)]]))}
      ${panel("Lean", dataTable(["", "Value"], [["Point-mass lean at corner study", withUnit(o.idealLean.value, "°")], ["With tyre-crown correction", withUnit(o.requiredLean.value, "°")], ["Footpeg tip touches at", withUnit(o.pegLean, "°")], ["Lowest point touches at", withUnit(o.bellyLean, "°")], ["Margin", withUnit(o.leanMargin.value, "°")]]) + `<p class="diagram-note">Unladen, crown radius ${fmt(o.crownRadius, 0)} mm. Sag lowers both contact points.</p>`)}</div>` : "";
    const notes = notesRail("steering", {
      why: "Trail sets self-centring and steering effort; rake and offset set how trail changes as the fork compresses. The braking number matters most: trail collapses exactly when the rider is busiest.",
      how: ["Ground trail = (R·sin rake − offset) / cos rake, R = front tyre radius.", "Fork travel pitches the chassis by atan((rear − front travel) / wheelbase); rake changes by that angle.", `Braking: load transfer m·a·h/wb onto the Sag spring models, solo rider, spring only (no damping).`, "Lean clearance: the bike rolls on a round crown of radius r; a point (y, h) touches when (h − r)cosθ − y·sinθ + r = 0.", "Required lean adds the Cossalter crown correction asin(r·sinθ/(h_cg − r))."]
    });
    return page(tab, { inputs, results, notes, kpis });
  }
  function drawSteeringCharts() {
    const o = outputs.steering, sag = outputs.sag;
    if (!o?.ok) return;
    const wb = Number(state.stance.wheelbase), rake0 = Number(state.stance.targetRake), offset = Number(state.steering.upperOffset);
    const rearSag = sag?.loadCases?.["Solo rider"]?.ok ? sag.loadCases["Solo rider"].rearWheelDisplacement : 0;
    const maxF = Math.min(Number(state.stance.frontTravel), Number(state.suspension.frontWheelToMetal));
    const line = rear => Array.from({ length: 41 }, (_, i) => { const f = maxF * i / 40; return [f, trailAt(rake0 + Math.atan2(rear - f, wb) * 180 / Math.PI, offset)]; });
    const points = Object.entries(sag?.loadCases || {}).filter(([, c]) => c?.ok).map(([name, c]) => ({ x: c.frontWheelDisplacement, y: c.trail, colour: "#6e56a0", r: 4, label: name === "Solo rider" ? "solo" : name === "Kerb" ? "kerb" : "duals", align: name === "Kerb" ? "right" : "left" }));
    if (sag?.brakingGeometry) points.push({ x: sag.brakingGeometry.frontTravel, y: sag.brakingGeometry.trail, colour: "#d75f36", label: `${fmt(sag.brakingGeometry.decel, 2)} g braking` });
    const trailBand = bandFor("trail");
    const sagLine = line(rearSag), extendedLine = line(0);
    xyChart(document.querySelector("#trailTravelChart"), {
      xLabel: "Front fork travel (mm)", yLabel: "Ground trail (mm)", xMax: maxF,
      yMin: Math.floor(Math.min(...sagLine.map(p => p[1]), ...extendedLine.map(p => p[1]), trailBand ? trailBand[0] : 1e9) / 10) * 10 - 10,
      bands: trailBand ? [{ y0: trailBand[0], y1: trailBand[1] }] : [],
      series: [{ data: sagLine, colour: "#1f6b50" }, { data: extendedLine, colour: "#1f6b50", dash: [7, 5], width: 1.8 }],
      points
    });
    const shades = ["#b9c7c0", "#7aa595", "#1f6b50", "#6f93ad", "#a9bccb"];
    const series = [-2, -1, 0, 1, 2].map((d, i) => ({ data: Array.from({ length: 31 }, (_, k) => [k * 2, trailAt(rake0 + d, k * 2)]), colour: shades[i], width: d === 0 ? 2.6 : 1.6 }));
    xyChart(document.querySelector("#offsetChart"), {
      xLabel: "Clamp offset (mm)", yLabel: "Ground trail (mm)", xMax: 60,
      yMin: Math.floor(Math.min(...series.flatMap(s => s.data.map(p => p[1]))) / 10) * 10,
      bands: trailBand ? [{ y0: trailBand[0], y1: trailBand[1] }] : [],
      series, points: [{ x: offset, y: o.groundTrail.value, colour: "#d75f36", label: `${fmt(offset, 0)} mm → ${fmt(o.groundTrail.value, 0)} mm` }],
      hLines: [{ y: Number(state.stance.targetTrail), label: "target", colour: "#6e56a0" }]
    });
  }

  // ---- Suspension geometry --------------------------------------------------------------------
  function renderSuspension(tab) {
    const o = outputs.suspension, ok = o?.ok === true, linkage = state.suspension.rearArchitecture === "linkage";
    const sagTravel = outputs.sag?.loadedGeometryInput?.rearWheelDisplacement;
    const pts = ok ? o.points : [];
    const at = travel => { if (!pts.length) return null; const t = Math.max(pts[0].wheelTravel, Math.min(pts.at(-1).wheelTravel, travel)); const i = Math.max(1, pts.findIndex(p => p.wheelTravel >= t)); const a = pts[i - 1], b = pts[i] || a; const f = b.wheelTravel > a.wheelTravel ? (t - a.wheelTravel) / (b.wheelTravel - a.wheelTravel) : 0; return { travel: t, shock: a.shockTravel + (b.shockTravel - a.shockTravel) * f, mr: a.motionRatio + (b.motionRatio - a.motionRatio) * f }; };
    const rates = rateCurve(outputs.sag?.loadCurves?.rear);
    const rateAt = travel => { if (!rates.length) return null; const near = rates.reduce((best, r) => Math.abs(r.travel - travel) < Math.abs(best.travel - travel) ? r : best, rates[0]); return near.rate; };
    const stations = ok ? [["Extension", 0], ...(Number.isFinite(sagTravel) ? [[`Rider sag (${state.meta.loadCase})`, sagTravel]] : []), ["Mid travel", o.usableWheelTravel.value / 2], ["Full travel", o.usableWheelTravel.value]].map(([label, t]) => { const s = at(t); return [esc(label), withUnit(s.travel, "mm", 0), withUnit(s.shock, "mm"), fmt(1 / Math.max(1e-9, s.mr), 2), withUnit(rateAt(s.travel), "N/mm")]; }) : [];
    const kpis = ok ? kpiStrip("suspension", [
      kpi("Rear wheel travel", o.usableWheelTravel, 0, `shock stroke ${fmt(o.shockTravel.value, 1)} mm`),
      kpi("Leverage ratio", o.leverageRatio, 2, "wheel / shock, average"),
      kpi("Progression", o.progression, 1, linkage ? "linkage" : "direct mount"),
      kpi("Static shock length", o.initialShockLength, 1, "eye to eye"),
      kpi("Front stroke margin", o.frontStrokeMargin, 0, "wheel-to-metal − travel"),
      kpi("Fork air at full stroke", o.forkEndPressure, 2, "from 1 bar abs")
    ]) : invalidNotice(o, "Suspension geometry");
    const hardpoints = linkage ? `<h4 class="subhead">Linkage</h4><div class="fields">${input("suspension.dogboneSwingX", "Dogbone swingarm X", "mm")}${input("suspension.dogboneSwingZ", "Dogbone swingarm Z", "mm")}${input("suspension.rockerPivotX", "Rocker pivot X", "mm")}${input("suspension.rockerPivotZ", "Rocker pivot Z", "mm")}${input("suspension.rockerDogboneX", "Rocker dogbone X", "mm")}${input("suspension.rockerDogboneZ", "Rocker dogbone Z", "mm")}${input("suspension.rockerShockX", "Rocker shock X", "mm")}${input("suspension.rockerShockZ", "Rocker shock Z", "mm")}</div>` : `<h4 class="subhead">Direct mount</h4><div class="fields">${input("suspension.shockSwingX", "Shock swingarm X", "mm")}${input("suspension.shockSwingZ", "Shock swingarm Z", "mm")}</div>`;
    const inputs = `${panel("Rear", `<div class="fields">${input("suspension.rearArchitecture", "Architecture", "", { type: "select", full: true, values: [{ value: "direct", label: "Direct mount" }, { value: "linkage", label: "Linkage" }] })}${input("suspension.shockFrameX", "Shock frame X", "mm")}${input("suspension.shockFrameZ", "Shock frame Z", "mm")}${input("suspension.rearWheelToMetal", "Rear wheel-to-metal", "mm")}${input("suspension.bumpStopStart", "Bump stop starts", "mm wheel")}${input("suspension.bumpStopRate", "Bump-stop rate", "N/mm")}${input("suspension.sweepSteps", "Sweep stations", "count")}</div>${hardpoints}`)}
      ${panel("Front fork", `<div class="fields">${input("suspension.forkLength", "Fork length", "mm")}${input("suspension.forkStanchion", "Stanchion OD", "mm")}${input("suspension.forkAirVolume", "Air volume / leg", "ml")}${input("suspension.forkAirPistonDiameter", "Air piston Ø", "mm")}${input("suspension.frontWheelToMetal", "Front wheel-to-metal", "mm")}</div>`)}
      ${panel("Linked inputs", linkedList([["Rear axle", `${fmt(state.stance.rearAxleX, 0)}, ${fmt(state.stance.rearAxleZ, 0)} mm`, sourceTag("stance")], ["Rear travel target", `${fmt(state.stance.rearTravel, 0)} mm`, "Stance"], ["Rear spring", `${fmt(state.sag.rearK1, 0)} / ${fmt(state.sag.rearK2, 0)} N/mm`, "Sag & outputs"]]))}`;
    const results = ok ? `${panel("Suspension construction", suspensionDiagram(), "Fork and rear kinematics on the active hardpoints.")}
      ${panel("Leverage ratio and wheel rate through travel", `${canvasChart("suspensionChart", "Rear leverage ratio and wheel rate against wheel travel", 290)}${legend([["Leverage ratio (wheel / shock)", "#266b92"], ["Wheel rate (right axis)", "#a66516"], ["Rider sag", "#6e56a0", true]])}`, "Falling leverage ratio = progressive. Wheel rate comes from the Sag spring model, so it includes the second spring rate and the bump stop.")}
      ${panel("Rear stations", dataTable(["Station", "Wheel travel", "Shock stroke", "Leverage", "Wheel rate"], stations))}` : "";
    const notes = notesRail("suspension", {
      why: "The linkage turns a spring into a wheel rate. Progression decides whether the rear resists bottoming without being harsh at sag; leverage ratio decides how hard the shock works.",
      how: [esc(DATA.sourceNotes.motionRatio), "Leverage ratio = 1 / motion ratio (wheel travel per unit shock stroke).", "Wheel rate is the slope of the Sag tab's rear load–deflection curve.", "Fork air: isothermal compression of the entered air volume by the air-piston swept volume."]
    });
    return page(tab, { inputs, results, notes, kpis });
  }
  function drawSuspensionChart() {
    const o = outputs.suspension; if (!o?.ok) return;
    const rates = rateCurve(outputs.sag?.loadCurves?.rear), sagTravel = outputs.sag?.loadedGeometryInput?.rearWheelDisplacement;
    xyChart(document.querySelector("#suspensionChart"), {
      xLabel: "Rear wheel travel (mm)", yLabel: "Leverage ratio", y2Label: "Wheel rate (N/mm)", xMax: o.usableWheelTravel.value,
      yMin: Math.floor(Math.min(...o.points.map(p => 1 / p.motionRatio)) * 2) / 2 - 0.5,
      series: [{ data: o.points.map(p => [p.wheelTravel, 1 / p.motionRatio]), colour: "#266b92" }, { data: rates.map(r => [r.travel, r.rate]), colour: "#a66516", axis: "y2" }],
      vLines: Number.isFinite(sagTravel) ? [{ x: sagTravel, label: "sag", colour: "#6e56a0" }] : []
    });
  }

  // ---- Anti-squat ---------------------------------------------------------------------------------
  function renderAntiSquat(tab) {
    const o = outputs.antiSquat, ok = o?.ok === true;
    const kpis = ok ? kpiStrip("antiSquat", [
      kpi("At rider sag", o.atSag, 0, `${fmt(o.sagTravel.value, 0)} mm wheel travel`),
      kpi("At extension", o.start, 0, "topped out"),
      kpi("At full travel", o.end, 0, "bottomed"),
      kpi("Range through travel", o.range, 0, `${fmt(o.averageGradient.value, 2)} %/mm average`),
      kpi("Crosses 100% at", o.neutralCrossover, 0, o.neutralCrossover.value === null ? "never crosses" : "wheel travel")
    ]) : invalidNotice(o, "Anti-squat");
    const p = state.powertrain;
    const inputs = `${panel("Study", `<div class="fields">${input("antiSquat.driveType", "Final-drive type", "", { type: "select", values: ["chain", "belt", "shaft"] })}${input("antiSquat.analysisSteps", "Stations", "count")}</div>${state.antiSquat.driveType === "shaft" ? `<div class="notice warning compact">Shaft is a swingarm-pivot baseline only; bevel-gear reaction is not modelled.</div>` : ""}`)}
      ${panel("Linked inputs", linkedList([["Sprockets", `${p.frontTeeth} / ${p.rearTeeth} T · ${fmt(p.chainPitch, 3)} mm`, sourceTag("powertrain")], ["Drive sprocket", `${fmt(p.driveSprocketX, 0)}, ${fmt(p.driveSprocketZ, 0)} mm`, "Transmission"], ["Wheelbase", `${fmt(state.stance.wheelbase, 0)} mm`, "Stance"], ["CG height", `${fmt(outputs.massProperties?.cgHeight, 0)} mm`, state.meta.loadCase], ["Sag point", ok ? `${fmt(o.sagTravel.value, 1)} mm wheel` : "—", "Sag & outputs"]]))}`;
    const results = ok ? `${panel("Anti-squat construction", antiSquatDiagram(), "Chain line, swingarm, force centre, loaded CG and the 100% line.")}
      ${panel("Anti-squat through rear travel", `${canvasChart("antiSquatChart", "Anti-squat percentage against rear wheel travel", 290)}${legend([["Anti-squat", "#1f6b50"], ["Typical at sag", "rgba(31,107,80,.25)"], ["Rider sag", "#6e56a0", true]])}`, "Above 100% the rear extends under drive; below 100% it squats. The value at sag is what the rider feels.")}` : "";
    const notes = notesRail("anti_squat", {
      why: "Anti-squat sets how the chassis pitches when drive torque is applied: too low and the rear squats and the steering goes light; too high and the rear jacks up, unloading the tyre on exit.",
      how: [esc(DATA.sourceNotes.antiSquat), ok ? `Extension force centre at ${fmt(o.extensionForceCentreX.value, 0)}, ${fmt(o.extensionForceCentreZ.value, 0)} mm.` : "", "Read at the active load-case rear sag solved on the Sag tab."].filter(Boolean)
    });
    return page(tab, { inputs, results, notes, kpis });
  }
  function drawAntiSquatChart() {
    const o = outputs.antiSquat; if (!o?.ok) return;
    const b = bandFor("antiSquatAtSag");
    xyChart(document.querySelector("#antiSquatChart"), {
      xLabel: "Rear wheel travel (mm)", yLabel: "Anti-squat (%)", xMax: o.samples.at(-1).wheelTravel,
      yMin: Math.min(0, Math.floor(Math.min(...o.samples.map(s => s.anti)) / 20) * 20),
      bands: b ? [{ y0: b[0], y1: b[1] }] : [],
      series: [{ data: o.samples.map(s => [s.wheelTravel, s.anti]), colour: "#1f6b50" }],
      hLines: [{ y: 100, label: "100% neutral", colour: "#8f9b97" }],
      vLines: Number.isFinite(o.sagTravel.value) ? [{ x: o.sagTravel.value, label: "sag", colour: "#6e56a0" }] : [],
      points: Number.isFinite(o.atSag.value) ? [{ x: o.sagTravel.value, y: o.atSag.value, colour: "#6e56a0", label: `${fmt(o.atSag.value, 0)}%` }] : []
    });
  }

  // ---- Sensitivity ----------------------------------------------------------------------------------
  const sensitivityLabels = { trail: "Ground trail", loadedRake: "Loaded rake", loadedTrail: "Loaded trail", groundClearance: "Loaded clearance", antiSquatAtSag: "Anti-squat at sag", totalMass: "Total mass", range: "Estimated range", lvHeadroom: "DC-DC headroom" };
  function renderSensitivity(tab) {
    const o = outputs.sensitivity, ok = o?.ok === true;
    const options = [["steering.upperOffset", "Upper clamp offset · Steering"], ["stance.rearAxleZ", "Rear axle height · Stance"], ["suspension.shockFrameX", "Shock frame mount X · Suspension"], ["suspension.rockerPivotZ", "Rocker pivot Z · Suspension"], ["sag.rearPreload", "Rear spring preload · Sag"], ["powertrain.driveSprocketZ", "Drive sprocket Z · Transmission"], ["electrical.series", "Cells in series · Energy & E/E"]].map(([value, label]) => ({ value, label }));
    const rows = ok ? o.rows.map(row => [esc(sensitivityLabels[row.output] || row.output), fmt(row.base, 2), row.derivative === null ? "—" : fmt(row.derivative, 3), row.rssAtTolerance === null ? "—" : `± ${fmt(row.rssAtTolerance, 3)}`, row.rssAtTolerance === null || !row.base ? "—" : `${fmt(Math.abs(row.rssAtTolerance / row.base) * 100, 2)}%`, `<span class="badge ${row.valid ? "review" : "conflict_invalid"}">${esc(row.response)}</span>`]) : [];
    const top = ok ? o.rows.filter(r => r.rssAtTolerance !== null && r.base).sort((a, b) => Math.abs(b.rssAtTolerance / b.base) - Math.abs(a.rssAtTolerance / a.base))[0] : null;
    const kpis = ok && top ? kpiStrip("sensitivity", [kpi("Most affected output", { value: sensitivityLabels[top.output] || top.output }, 0, `± ${fmt(Math.abs(top.rssAtTolerance / top.base) * 100, 2)}% at ± ${fmt(state.sensitivity.tolerance, 2)}`), kpi("Parameter", { value: (options.find(item => item.value === state.sensitivity.parameter)?.label || state.sensitivity.parameter).split(" · ")[0] }, 0, `± ${fmt(state.sensitivity.tolerance, 2)} tolerance`)]) : invalidNotice(o, "Sensitivity study");
    const inputs = `${panel("Study", `<div class="fields">${input("sensitivity.parameter", "Parameter", "", { type: "select", values: options, full: true })}${input("sensitivity.step", "Difference step", "units")}${input("sensitivity.tolerance", "Tolerance ±", "units")}</div><p class="diagram-note">Baseline revision ${state.meta.revision} is read-only. Results never overwrite an owning tab.</p>`)}`;
    const results = ok ? `${panel("Tolerance effect by output", canvasChart("tornadoChart", "Each output's change at the entered tolerance, as a percentage of its baseline", 260), "Which outputs move most, relative to their own size, when this parameter sits at its tolerance limit.")}
      ${panel("Local response", dataTable(["Output", "Baseline", "Per unit", "At tolerance", "% of baseline", "Response"], rows))}` : "";
    const notes = notesRail("sensitivity", {
      why: "Tells you which drawing tolerances matter. A hardpoint whose tolerance moves anti-squat or trail by a few percent needs a tighter tolerance or an adjuster.",
      how: ["Central difference: (f(x + h) − f(x − h)) / 2h around the baseline.", "Tolerance effect = derivative × tolerance (single parameter, not a multi-variable RSS).", "Response flags asymmetry between forward and backward differences as non-linear."]
    });
    return page(tab, { inputs, results, notes, kpis, study: true });
  }
  function drawTornado() {
    const o = outputs.sensitivity; if (!o?.ok) return;
    const rows = o.rows.filter(r => r.rssAtTolerance !== null && r.base).map(r => ({ label: sensitivityLabels[r.output] || r.output, pct: Math.abs(r.rssAtTolerance / r.base) * 100 })).sort((a, b) => b.pct - a.pct);
    barChart(document.querySelector("#tornadoChart"), { xLabel: "Change at tolerance (% of baseline)", labelWidth: 140, rows: rows.map(r => ({ label: r.label, bars: [{ value: r.pct, colour: "#266b92", text: `${fmt(r.pct, 2)}%` }] })) });
  }

  // ---- Sag & outputs ------------------------------------------------------------------------------------
  function renderSag(tab) {
    const o = outputs.sag, ok = o?.ok === true || (o && o.loadCases);
    const avail = o?.rearShockTravelAvailable?.value, maxFront = Math.min(Number(state.stance.frontTravel), Number(state.suspension.frontWheelToMetal));
    const pill = o?.loadCases?.["Rider + pillion"];
    const kpis = o?.loadCases ? kpiStrip("sag", [
      kpi("Rider sag, front", o.expectedFrontForkRiderPercent, 0, `${fmt(o.expectedFrontForkRiderSag.value, 1)} mm fork`),
      kpi("Rider sag, rear", o.expectedRearShockRiderPercent, 0, `${fmt(o.expectedRearShockRiderSag.value, 1)} mm shock`),
      kpi("Rear sag, duals", { value: pill && avail ? pill.rearShockSag / avail * 100 : null, unit: "%" }, 0, pill?.ok ? `${fmt(pill.rearShockSag, 1)} mm shock` : "bottomed"),
      kpi("Ride frequency", { value: `${fmt(o.frontFrequency.value, 2)} / ${fmt(o.rearFrequency.value, 2)}`, unit: "Hz" }, 2, `front / rear · ratio ${fmt(o.frequencyRatio.value, 2)}`),
      kpi("Loaded trail", o.loadedTrail, 1, `${state.meta.loadCase} · rake ${fmt(o.loadedRake.value, 2)}°`),
      kpi("Loaded clearance", o.loadedClearance, 0, state.meta.loadCase)
    ]) : invalidNotice(o, "Sag and loaded geometry");
    const caseRows = Object.entries(o?.loadCases || {}).map(([name, row]) => [`${esc(name)}${row.ok ? "" : ' <span class="chip chip-high">bottomed</span>'}`, `${fmt(row.frontForkSag, 1)} <small>mm · ${fmt(row.frontForkSag / maxFront * 100, 0)}%</small>`, `${fmt(row.rearShockSag, 1)} <small>mm · ${fmt(avail ? row.rearShockSag / avail * 100 : null, 0)}%</small>`, withUnit(row.rake, "°", 2), withUnit(row.trail, "mm"), withUnit(row.wheelbase, "mm", 0), withUnit(row.clearance, "mm", 0)]);
    const curves = o?.loadCurves;
    const unreachable = [];
    if (curves && !curves.rear.markers.some(m => m.kind === "transition")) unreachable.push(`rear second rate (transition ${fmt(state.sag.rearTransition, 0)} mm shock) never engages`);
    if (curves && !curves.front.markers.some(m => m.kind === "transition")) unreachable.push(`front second rate (transition ${fmt(state.sag.frontTransition, 0)} mm) never engages`);
    const inputs = `${panel("Rear spring", `<div class="fields">${input("sag.rearK1", "Rate K1", "N/mm")}${input("sag.rearK2", "Rate K2", "N/mm")}${input("sag.rearTransition", "K1→K2 at", "mm shock")}${input("sag.rearPreload", "Preload", "mm")}${input("sag.rearSpringCount", "Springs", "count")}${input("sag.rearUnsprungMass", "Unsprung mass", "kg")}</div>`)}
      ${panel("Front fork springs", `<div class="fields">${input("sag.frontK1", "Rate K1", "N/mm")}${input("sag.frontK2", "Rate K2", "N/mm")}${input("sag.frontTransition", "K1→K2 at", "mm")}${input("sag.frontPreload", "Preload", "mm")}${input("sag.frontSpringCount", "Springs", "count")}${input("sag.frontUnsprungMass", "Unsprung mass", "kg")}</div>`)}
      ${panel("Linked inputs", linkedList([["Axle loads", `${state.meta.loadCase}`, "Stance mass properties"], ["Rear leverage", outputs.suspension?.ok ? fmt(outputs.suspension.leverageRatio.value, 2) : "—", "Suspension geometry"], ["Fork air", `${fmt(state.suspension.forkAirVolume, 0)} ml · Ø${fmt(state.suspension.forkAirPistonDiameter, 0)} mm`, "Suspension geometry"]]))}`;
    const results = o?.loadCases ? `${panel("Loaded motorcycle", sagDiagram(), `${esc(state.meta.loadCase)} against the unladen reference.`)}
      ${panel("Sag by load case", `${canvasChart("sagChart", "Front and rear sag as a percentage of usable stroke for each load case", 180)}${legend([["Front fork", "#266b92"], ["Rear shock", "#a66516"], ["Typical rider sag", "rgba(31,107,80,.25)"]])}${dataTable(["Case", "Front sag", "Rear sag", "Rake", "Trail", "Wheelbase", "Clearance"], caseRows)}`, "Sag is member stroke: fork compression and shock stroke, as % of usable stroke.")}
      ${panel("Load vs deflection", `${canvasChart("loadDeflectionChart", "Front and rear wheel supporting force against wheel deflection with sag, transition, bump-stop and travel-limit markers", 300)}<div class="chart-legend">${Object.entries({ sag: "Load-case sag", transition: "Spring transition", bumpstop: "Bump stop", limit: "Travel limit" }).map(([kind, label]) => `<span><i style="background:${markerColours[kind]}"></i>${esc(label)}</span>`).join("")}<span><i style="background:#1f6b50"></i>Front wheel</span><span><i style="background:#a66516"></i>Rear wheel</span></div>${unreachable.length ? `<div class="notice warning compact"><strong>Not reached in usable travel:</strong> ${esc(unreachable.join("; "))}.</div>` : ""}`, "Wheel-referred force against wheel travel. Every sag above sits on these curves.")}
      ${panel("Wheel rate through travel", `${canvasChart("wheelRateChart", "Front and rear wheel rate against wheel travel", 240)}${legend([["Front", "#1f6b50"], ["Rear", "#a66516"]])}`, "Slope of the curves above. Steps are spring transitions, the bump stop and fork air.")}` : "";
    const notes = notesRail("sag", {
      why: "Sag puts the bike in the middle of its travel and sets the ride height that every loaded-geometry number depends on. Ride frequency is the best single measure of how stiff the bike feels.",
      checksTitle: "Typical range · road set-up",
      how: ["Each axle load (minus unsprung mass) is solved against the spring force law at the wheel.", "Rear: spring force × local motion ratio + bump stop. Front: fork coils + isothermal fork air.", "Ride frequency f = √(k/m)/2π with k the local wheel rate at sag and m the sprung axle mass.", "Static = Kerb case, rider = Solo rider case, duals = Rider + pillion."]
    });
    return page(tab, { inputs, results, notes, kpis });
  }
  function drawSagCharts() {
    const o = outputs.sag; if (!o?.loadCases) return;
    const avail = o.rearShockTravelAvailable?.value, maxFront = Math.min(Number(state.stance.frontTravel), Number(state.suspension.frontWheelToMetal));
    barChart(document.querySelector("#sagChart"), {
      xLabel: "Sag (% of usable stroke)", labelWidth: 120, band: bandFor("riderSag"), xMax: 100,
      rows: Object.entries(o.loadCases).map(([name, row]) => ({ label: name, bars: [{ value: row.frontForkSag / maxFront * 100, colour: "#266b92", text: `${fmt(row.frontForkSag / maxFront * 100, 0)}%` }, { value: avail ? row.rearShockSag / avail * 100 : NaN, colour: "#a66516", text: `${fmt(row.rearShockSag / avail * 100, 0)}%` }] }))
    });
    drawLoadDeflection(document.querySelector("#loadDeflectionChart"));
    const front = rateCurve(o.loadCurves?.front), rear = rateCurve(o.loadCurves?.rear);
    xyChart(document.querySelector("#wheelRateChart"), {
      xLabel: "Wheel travel (mm)", yLabel: "Wheel rate (N/mm)",
      yMax: (() => { const r = [...front, ...rear].map(x => x.rate).filter(Number.isFinite).sort((a, b) => a - b); return r.length > 6 ? r[Math.floor(r.length * 0.9)] * 1.4 : undefined; })(),
      series: [{ data: front.map(r => [r.travel, r.rate]), colour: "#1f6b50" }, { data: rear.map(r => [r.travel, r.rate]), colour: "#a66516" }]
    });
  }

  function linkedField(path, label, unit) {
    const owner = path.split(".")[0];
    return `<div class="field"><label>${esc(label)} · linked</label><div class="field-row"><input value="${esc(get(path))}" readonly aria-readonly="true"><span class="unit-label">${esc(unit)}</span></div><small>Owner: ${esc(owner)} · source revision ${state.meta.domainRevisions?.[owner] || 1}</small></div>`;
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
    const y2Min = cfg.y2Min ?? 0;
    const y2Step = hasY2 ? niceCeilStep((Math.max(...values("y2"), y2Min + 1e-6) - y2Min) / lines) : 0;
    const y2Max = y2Min + y2Step * lines;
    const plotW = W - pad.l - pad.r, plotH = H - pad.t - pad.b;
    const tx = x => pad.l + (x - xMin) / Math.max(1e-9, xMax - xMin) * plotW;
    const ty = y => pad.t + (yMax - y) / Math.max(1e-9, yMax - yMin) * plotH;
    const ty2 = y => pad.t + (y2Max - y) / Math.max(1e-9, y2Max - y2Min) * plotH;
    ctx.clearRect(0, 0, W, H);
    ctx.font = "11px Inter, system-ui"; ctx.lineWidth = 1; ctx.strokeStyle = "#e3e6e2"; ctx.fillStyle = "#61717b";
    for (let i = 0; i <= lines; i += 1) {
      const y = pad.t + plotH * i / lines;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
      ctx.textAlign = "right"; ctx.fillText(axisLabel(yMax - (yMax - yMin) * i / lines), pad.l - 8, y + 4);
      if (hasY2) { ctx.textAlign = "left"; ctx.fillText(axisLabel(y2Max - (y2Max - y2Min) * i / lines), W - pad.r + 8, y + 4); }
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
    (cfg.bands || []).forEach(band => {
      const yOf = band.axis === "y2" ? ty2 : ty, top = yOf(Math.max(band.y0, band.y1)), bottom = yOf(Math.min(band.y0, band.y1));
      ctx.fillStyle = band.colour || "rgba(31,107,80,.10)"; ctx.fillRect(pad.l, top, plotW, bottom - top);
    });
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
    const inputs = `
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
`;
    const results = `
          <article class="panel"><h3>Final-drive construction</h3>${powertrainDiagram()}</article>
          <article class="panel"><h3>Per-gear matrix</h3><div class="table-wrap"><table class="dense"><thead><tr><th>Gear</th><th class="numeric">Ratio</th><th class="numeric">Overall</th><th class="numeric">Step</th><th class="numeric">km/h @ max RPM</th><th class="numeric">RPM @ ${fmt(p.cruiseSpeed, 0)} km/h</th><th class="numeric">Wheel N·m @ peak</th><th class="numeric">Tractive N @ peak</th></tr></thead><tbody>${rows}</tbody></table></div>
            <p class="diagram-note">Wheel torque and tractive force use the committed peak motor torque and driveline efficiency. RPM in red exceeds max RPM.</p></article>
          <article class="panel"><h3>Road speed vs motor RPM</h3>${canvasChart("speedRpmChart", "Road speed against motor RPM for every gear", 300)}${legend(ok ? o.rows.map(row => [gearCount === 1 ? "Single speed" : `G${row.gear}`, SERIES_COLOURS[row.gear - 1]]).concat([[`Cruise ${fmt(p.cruiseSpeed, 0)} km/h`, "#8f9b97", true]]) : [])}</article>
      ${ok ? chainPanels(o, linkUnit) : ""}
      ${ok ? comboPanel(o, linkUnit) : ""}
      ${ok ? proposedPanel(o, linkUnit) : ""}
      ${transmissionComparisonPanel()}
`;
    const notes = notesRail("powertrain", {
      why: "The overall ratio trades launch and grade torque against top speed and motor RPM. The chain has to fit the real hardpoints with adjuster to spare and survive peak first-gear torque.",
      how: [esc(DATA.sourceNotes.transmission), "Overall ratio = primary × gear × rear/front teeth; road speed = RPM / ratio × tyre circumference.", "Peak tension = peak motor torque × primary × first gear / front pitch radius (no efficiency credit).", "Wear recurrence: the same tooth meets the same link every teeth / gcd(teeth, links) revolutions."]
    });
    return page(tab, { inputs, results, notes, kpis: `${kpiStrip("powertrain", tiles)}${invalidNotice(o, "Transmission")}` });
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
      kpi("Grade torque", o.gradeTorque, 1, o.gradePower.value === null ? "no grade target" : `${fmt(o.gradePower.value, 1)} kW continuous`),
      kpi("Power-to-weight", { value: pt?.ok && masses?.ok ? pt.peakPower.value / masses.totalMass * 1000 : null, unit: "kW/t", definition: "Committed peak power over the active load-case mass" }, 0, `committed · ${state.meta.loadCase}`)
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
    const inputs = `
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
          <article class="panel"><h3>Road load</h3><div class="fields">
            ${input("vehicle.rollingResistance", "Rolling resistance Crr", "", { step: "0.001" })}
            ${input("vehicle.dragCoefficientArea", "Drag area CdA", "m²", { step: "0.01" })}
            ${input("vehicle.airDensity", "Air density", "kg/m³", { step: "0.001" })}
          </div><p class="diagram-note">Also drives the Battery consumption-vs-speed curve.</p></article>
          <article class="panel"><h3>Transmission ratio</h3><div class="fields">
            ${input("motor.ratioSource", "Ratio source", "", { type: "select", full: true, values: [{ value: "linked", label: "Linked · overall ratios from the Transmission tab" }, { value: "manual", label: "Manual · single overall ratio" }] })}
            ${linked ? "" : input("motor.manualRatio", "Overall ratio", "motor : wheel", { step: "0.01", full: true, help: "Single-speed overall reduction, e.g. 9.91" })}
          </div>
          ${linked ? linkedList(ratioRows.map(([label, value]) => [label, value, ""]).concat([["Source", sourceTag("powertrain"), ""]])) : ""}
          <h4 class="subhead">Linked vehicle</h4>
          ${linkedList([
            ["Mass", masses?.ok ? `${fmt(masses.totalMass, 1)} kg` : "—", `${state.meta.loadCase} · mass properties`],
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
`;
    const results = `
          <article class="panel"><h3>What sets the motor</h3>${ok ? `<div class="table-wrap"><table class="dense"><thead><tr><th>Target</th><th class="numeric">Peak torque needed</th><th class="numeric">Peak power</th><th></th></tr></thead><tbody>${req}</tbody></table></div><p class="diagram-note">${esc(DATA.sourceNotes.motorSizing)}</p>` : ""}</article>
          <article class="panel"><h3>Required vs committed</h3>${comparison}</article>
          <article class="panel"><h3>Motor torque & power vs RPM</h3>${canvasChart("motorEnvelopeChart", "Required and committed motor torque and power against motor RPM", 300)}${legend([["Required torque", "#1f6b50"], ["Required power", "#1f6b50", true], ["Committed torque", "#d75f36"], ["Committed power", "#d75f36", true]])}</article>
          <article class="panel"><h3>Wheel torque vs road speed</h3><p class="panel-intro">Motor torque × overall ratio × efficiency for every gear, against the road-load torque it has to beat.</p>${canvasChart("wheelTorqueChart", "Wheel torque per gear against road speed with road-load torque", 320)}${legend(wheelLegend(o))}</article>
          <article class="panel"><h3>Wheel power vs road speed</h3>${canvasChart("wheelPowerChart", "Wheel power per gear against road speed with road-load power", 300)}${legend(wheelLegend(o))}</article>
          <article class="panel"><h3>Speed vs time</h3>${canvasChart("accelChart", "Road speed against time for required and committed motors", 280)}${legend([["Required motor", "#1f6b50"], ["Committed motor", "#d75f36"], ["Targets", "#6e56a0"]])}</article>
          <article class="panel"><h3>Torque vs power</h3><p class="panel-intro">The motor operating envelope traced from 0 to max RPM, with the grade and top-speed duty points it has to cover.</p>${canvasChart("torquePowerChart", "Motor torque against motor power along the envelope", 280)}${legend([["Required envelope", "#1f6b50"], ["Committed envelope", "#d75f36"], ["Duty points", "#6e56a0"]])}</article>
`;
    const notes = notesRail("motor_sizing", {
      why: "Turns the product promise (top speed, hill start, 0–100) into a motor specification, through the real ratios, mass and road load, so the motor, inverter and pack are sized against the same numbers.",
      checksTitle: "Typical range",
      how: [esc(DATA.sourceNotes.motorSizing), "Road load = m·g·(Crr·cosθ + sinθ) + ½·ρ·CdA·v².", "Launch is capped at the rigid-body wheelie limit (CG ahead of the rear axle / CG height) unless switched off."]
    });
    return page(tab, { inputs, results, notes, kpis: `${kpiStrip("motor", tiles)}${invalidNotice(o, "Motor sizing")}`, after: `      ${powertrainBenchmarkPanel()}
` });
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
    const resultsTable = ok ? `<div class="table-wrap"><table class="dense"><thead><tr><th></th><th class="numeric">Solo</th><th class="numeric">Rider + pillion</th></tr></thead><tbody>
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
    const inputs = `
          <article class="panel"><h3>Test conditions</h3><div class="fields">
            ${input("braking.roadFriction", "Tyre–road friction μ", "μ", { step: "0.05" })}
            ${input("braking.targetDecel", "Target deceleration", "g", { step: "0.05" })}
            ${input("braking.testSpeed", "Test speed", "km/h")}
            ${input("braking.freeRunCoefficient", "Free-run coefficient", "m per km/h", { step: "0.01", help: `${fmt(Number(b.freeRunCoefficient) * Number(b.testSpeed), 1)} m at ${fmt(b.testSpeed, 0)} km/h (homologation s = c·V + v²/2a)` })}
          </div></article>
          ${brakeHardwarePanel("front")}
          ${brakeHardwarePanel("rear")}
          <article class="panel"><h3>Linked vehicle</h3>${vehicleRows}</article>
`;
    const results = `
          <article class="panel"><h3>Results</h3>${resultsTable}</article>
          <article class="panel"><h3>Ideal brake-force distribution</h3><p class="panel-intro">Front vs rear braking force when both wheels are at the same μ (parabola), with the μ ${fmt(b.roadFriction, 2)} front-lock and rear-lock lines and the ${fmt(b.targetDecel, 2)} g iso-deceleration line.</p>${canvasChart("brakeDistributionChart", "Ideal front and rear braking force distribution", 340)}${legend([["Ideal, solo", "#1f6b50"], ["Ideal, rider + pillion", "#266b92"], ["Front lock (solo)", "#b84d56", true], ["Rear lock (solo)", "#a66516", true], ["Target deceleration", "#6e56a0", true]])}</article>
          <article class="panel"><h3>Lever & pedal effort vs deceleration</h3>${canvasChart("brakeEffortChart", "Hand-lever and foot-pedal force against deceleration", 280)}${legend([["Lever, front only, solo", "#1f6b50"], ["Lever, duals", "#1f6b50", true], ["Pedal, rear only, solo", "#a66516"], ["Pedal, duals", "#a66516", true]])}</article>
          <article class="panel"><h3>Line pressure vs deceleration</h3>${canvasChart("brakePressureChart", "Master-cylinder pressure against deceleration", 280)}${legend([["Front, solo", "#266b92"], ["Front, duals", "#266b92", true], ["Rear, solo", "#b84d56"], ["Rear, duals", "#b84d56", true]])}</article>
          <article class="panel"><h3>Stopping distance vs speed</h3>${canvasChart("brakeStopChart", "Stopping distance against initial speed", 280)}${legend([["Front only", "#266b92"], ["Rear only", "#b84d56"], ["Both at μ", "#1f6b50"], ["Rider + pillion", "#61717b", true]])}</article>
          <article class="panel"><h3>Maximum slip force by μ</h3>${slip}</article>
`;
    const notes = notesRail("braking", {
      why: "Front brake hardware has to reach the adhesion limit with a comfortable lever force at every load case, without line pressures or clamp loads the caliper and master cylinder cannot take.",
      how: [esc(DATA.sourceNotes.braking), "Clamp = wheel torque / (2·μpad·r_eff); line pressure = clamp / piston area per pad face.", "Lever force = pressure × master-cylinder area / (lever ratio × hydraulic efficiency)."]
    });
    return page(tab, { inputs, results, notes, kpis: `${kpiStrip("braking", tiles)}${invalidNotice(o, "Braking")}` });
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

  // ---- Battery calculators --------------------------------------------------------------------------
  function renderBattery(tab) {
    const o = outputs.battery, ok = o?.ok === true, pack = outputs.electrical?.pack;
    const c = ok ? o.consumptionCurve : null;
    const kpis = ok ? kpiStrip("battery", [
      kpi("Estimated range", o.estimatedRange, 0, `at ${fmt(state.battery.consumption, 0)} Wh/km named`),
      kpi("Gross energy needed", o.requiredNominal, 1, pack ? `committed ${fmt(pack.nominalEnergyKWh, 1)} kWh` : ""),
      kpi("Named consumption ≈", { value: c?.matchSpeed ?? null, unit: "km/h" }, 0, "steady speed with that use"),
      kpi("Charge time", o.chargeTime, 1, `${fmt(state.battery.chargeStartSoc, 0)}→${fmt(state.battery.chargeEndSoc, 0)}% at ${fmt(o.packChargePower.value, 1)} kW`),
      kpi("Charge C-rate", o.actualChargeCRate, 2, `${fmt(o.actualChargeCurrent.value, 0)} A`),
      kpi("Pack proposal", { value: `${o.proposedSeries}S${o.proposedParallel}P` }, 0, `${fmt(o.proposedEnergy, 1)} kWh · ${fmt(o.proposedNominalV, 0)} V`)
    ]) : invalidNotice(o, "Battery study");
    const b = state.battery;
    const inputs = `${panel("Range and energy", `<div class="fields">${input("battery.targetRange", "Target range", "km")}${input("battery.consumption", "Named consumption", "Wh/km")}${input("battery.averageSpeed", "Average speed", "km/h")}${input("battery.reserve", "Reserve", "%")}${input("battery.capacityDerate", "Capacity derate", "fraction", { step: "0.01" })}${input("battery.dischargeEfficiency", "Discharge efficiency", "fraction", { step: "0.01" })}</div>`)}
      ${panel("AC charging", `<div class="fields">${input("battery.chargerPower", "OBC input rating", "kW")}${input("battery.chargeEfficiency", "Charge efficiency", "fraction", { step: "0.01" })}${input("battery.chargeTaperFactor", "CV taper factor", "×", { step: "0.01" })}${input("battery.desiredChargeHours", "Desired time", "h")}${input("battery.chargeStartSoc", "Start SOC", "%")}${input("battery.chargeEndSoc", "End SOC", "%")}${input("battery.supplyPhases", "AC phases", "", { type: "select", values: [{ value: 1, label: "Single" }, { value: 3, label: "Three" }] })}${input("battery.supplyVoltage", "Line voltage", "V")}${input("battery.supplyCurrent", "Line current limit", "A")}${input("battery.supplyPowerFactor", "Power factor", "fraction", { step: "0.01" })}</div>`)}
      ${panel("Runtime and pack proposal", `<div class="fields">${input("battery.runtimePower", "Constant-power case", "kW")}${input("battery.runtimeCurrent", "Constant-current case", "A")}${input("battery.auxiliaryPower", "Auxiliary power", "kW")}${input("battery.studyVoltage", "Target nominal voltage", "V")}${input("battery.studyCapacityAh", "Minimum capacity", "Ah")}</div>`)}
      ${panel("Linked inputs", linkedList([["Committed pack", pack ? `${state.electrical.series}S${state.electrical.parallel}P · ${fmt(pack.nominalV, 0)} V · ${fmt(pack.nominalEnergyKWh, 1)} kWh` : "—", "Energy & E/E"], ["Road load", `CdA ${fmt(state.vehicle.dragCoefficientArea, 2)} · Crr ${fmt(state.vehicle.rollingResistance, 3)}`, "Motor sizing"], ["Drive efficiency", c ? `${fmt(c.efficiency * 100, 1)}% (driveline × motor × inverter)` : "—", "Transmission · Motor sizing"], ["LV continuous", `${fmt(o?.lvContinuousDemand?.value, 2)} kW`, "Energy & E/E"]]))}`;
    const results = ok ? `${c ? panel("Consumption and range vs steady speed", `${canvasChart("consumptionChart", "Traction consumption and range against steady road speed", 290)}${legend([["Traction Wh/km", "#a66516"], ["Range incl. LV (right axis)", "#1f6b50"], [`Named ${fmt(b.consumption, 0)} Wh/km`, "#6e56a0", true]])}`, `Level road, constant speed, ${fmt(c.mass, 0)} kg (${esc(state.meta.loadCase)}). Stop-go, regen, wind and gradients are not modelled — treat as an upper bound on range.`) : ""}
      ${panel("Charge time vs charger power", `${canvasChart("chargeChart", "Charge time against on-board charger input power", 240)}${legend([["Charge time", "#266b92"], ["Current OBC", "#6e56a0", true]])}`, `Flattens where the AC supply (${fmt(o.supplyLimitKw, 1)} kW) or the pack charge limit (${fmt(o.packChargeLimitKw, 1)} kW) takes over — a bigger OBC buys nothing past that point.`)}
      <div class="grid equal">${panel("Energy and range", dataTable(["", "Value"], [["Traction energy for target", withUnit(o.tractionLoadEnergy.value, "kWh", 2)], ["LV energy over the range", withUnit(o.lvEnergyOverRange.value, "kWh", 2)], ["Usable energy needed", withUnit(o.requiredUsable.value, "kWh", 2)], ["Gross energy needed", withUnit(o.requiredNominal.value, "kWh", 2)], ["Committed pack delivers", withUnit(o.deliveredEnergy.value, "kWh", 2)], ["Estimated range", withUnit(o.estimatedRange.value, "km", 0)]]))}
      ${panel("Charging", dataTable(["", "Value"], [["AC supply available", withUnit(o.supplyPower.value, "kW", 2)], ["Power into pack", withUnit(o.packChargePower.value, "kW", 2)], ["Charge time", withUnit(o.chargeTime.value, "h", 2)], ["Charge current", withUnit(o.actualChargeCurrent.value, "A", 1)], [`OBC needed for ${fmt(b.desiredChargeHours, 1)} h`, withUnit(o.requiredObcPower.value, "kW", 2)], ["Line current needed", withUnit(o.requiredLineCurrent.value, "A", 1)]]))}
      ${panel("Runtime", dataTable(["", "Value"], [[`At ${fmt(b.runtimePower, 0)} kW constant`, withUnit(o.constantPowerRuntime.value, "h", 2)], ["Distance at average speed", withUnit(o.runtimeDistance.value, "km", 0)], [`At ${fmt(b.runtimeCurrent, 0)} A constant`, withUnit(o.currentRuntime.value, "h", 2)], ["Discharge C-rate needed", withUnit(o.requiredCRate.value, "C", 2)], ["Pack power allowed", withUnit(o.permittedPower.value, "kW", 0)]]))}
      ${panel("Pack proposal", dataTable(["", "Value"], [["Configuration", `${o.proposedSeries}S${o.proposedParallel}P · ${fmt(o.proposedCells, 0)} cells`], ["Voltage min / nom / max", `${fmt(o.proposedMinV, 0)} / ${fmt(o.proposedNominalV, 0)} / ${fmt(o.proposedMaxV, 0)} <small>V</small>`], ["Capacity", withUnit(o.proposedAh, "Ah", 0)], ["Gross energy", withUnit(o.proposedEnergy, "kWh", 1)], ["Margin over need", withUnit(o.energyMargin, "kWh", 1)]]) + `<button class="button primary" data-action="propose-battery" style="margin-top:12px">Download pack proposal</button>`)}</div>` : "";
    const notes = notesRail("battery_calculators", {
      why: "Range and charge time are what customers buy. The consumption curve shows how fast range falls with speed — aero dominates above about 60 km/h — and whether the named Wh/km is realistic.",
      checksTitle: "Typical range",
      how: ["Required gross energy = (range × Wh/km + LV energy) × (1 + reserve) / (SOC window × efficiency × derate).", "Consumption = road-load power / (driveline × motor × inverter) / speed; range adds LV power.", "Charge time = pack energy over the SOC window / min(AC supply, OBC) × efficiency, limited by the pack charge C-rate, × taper.", "First-order screens: temperature, ageing and thermal limits are not evaluated."]
    });
    return page(tab, { inputs, results, notes, kpis, study: true, top: electricalContextControls(false, "battery") });
  }
  function drawBatteryCharts() {
    const o = outputs.battery; if (!o?.ok) return;
    const c = o.consumptionCurve;
    if (c) xyChart(document.querySelector("#consumptionChart"), {
      xLabel: "Steady speed (km/h)", yLabel: "Traction consumption (Wh/km)", y2Label: "Range (km)", xMax: c.points.at(-1).speed,
      series: [{ data: c.points.map(p => [p.speed, p.traction]), colour: "#a66516" }, { data: c.points.map(p => [p.speed, p.range]), colour: "#1f6b50", axis: "y2" }],
      hLines: [{ y: Number(state.battery.consumption), label: `${fmt(state.battery.consumption, 0)} Wh/km named`, colour: "#6e56a0" }],
      vLines: c.matchSpeed ? [{ x: c.matchSpeed, label: `${fmt(c.matchSpeed, 0)} km/h`, colour: "#6e56a0" }] : []
    });
    xyChart(document.querySelector("#chargeChart"), {
      xLabel: "OBC input rating (kW)", yLabel: "Charge time (h)", xMin: 2, xMax: 23,
      series: [{ data: o.chargeCurve.filter(p => p.obcKw >= 2).map(p => [p.obcKw, p.hours]), colour: "#266b92" }],
      vLines: [{ x: Number(state.battery.chargerPower), label: "current OBC", colour: "#6e56a0" }],
      hLines: Number(state.battery.desiredChargeHours) > 0 ? [{ y: Number(state.battery.desiredChargeHours), label: "desired", colour: "#8f9b97" }] : []
    });
  }

  // ---- Energy & E/E integration ------------------------------------------------------------------------
  function renderElectrical(tab) {
    const o = outputs.electrical, ok = o?.ok === true || Boolean(o?.pack), pack = o?.pack, e = state.electrical;
    const kpis = pack ? kpiStrip("electrical", [
      kpi("Pack", { value: `${e.series}S${e.parallel}P` }, 0, `${fmt(pack.minV, 0)}–${fmt(pack.maxV, 0)} V · ${fmt(pack.capacityAh, 0)} Ah`),
      kpi("Usable energy", { value: pack.usableEnergyKWh, unit: "kWh" }, 1, `SOC ${fmt(e.socMin, 0)}–${fmt(e.socMax, 0)}%`),
      kpi("Loaded voltage", o.terminalVoltage, 0, state.meta.electricalScenario === "drive" ? `${fmt(o.busCurrent.value, 0)} A at duty` : state.meta.electricalScenario),
      kpi("DC-DC headroom", o.dcdcHeadroom, 0, `of ${fmt(e.dcdcCapacity, 0)} W continuous`),
      kpi("LV backup", o.lvBackupRuntime, 0, "essential loads"),
      kpi("E/E mass", o.electricalMass, 1, `CG ${fmt(o.electricalCgX.value, 0)}, ${fmt(o.electricalCgZ.value, 0)} mm`)
    ]) : invalidNotice(o, "Energy and E/E closure");
    const inputs = `${panel("Cell and pack", `<div class="fields">${input("electrical.cellMinV", "Cell min", "V", { step: "0.01" })}${input("electrical.cellNomV", "Cell nominal", "V", { step: "0.01" })}${input("electrical.cellMaxV", "Cell max", "V", { step: "0.01" })}${input("electrical.cellAh", "Cell capacity", "Ah", { step: "0.1" })}${input("electrical.cellResistanceMilliOhm", "Cell resistance", "mΩ", { step: "0.1" })}${input("electrical.interconnectResistanceMilliOhm", "Interconnect", "mΩ", { step: "0.1" })}${input("electrical.series", "Series", "S")}${input("electrical.parallel", "Parallel", "P")}${input("electrical.socMin", "SOC min", "%")}${input("electrical.socMax", "SOC max", "%")}${input("electrical.dischargeCLimit", "Discharge limit", "C", { step: "0.1" })}${input("electrical.chargeCLimit", "Charge limit", "C", { step: "0.1" })}</div>`)}
      ${panel("Charger and LV", `<div class="fields">${input("electrical.obcPower", "OBC input rating", "kW")}${input("electrical.obcEfficiency", "OBC efficiency", "fraction", { step: "0.01" })}${input("electrical.dcdcCapacity", "DC-DC continuous", "W")}${input("electrical.dcdcPeakCapacity", "DC-DC peak", "W")}${input("electrical.lvBusVoltage", "LV bus", "V")}${input("electrical.lvBatteryAh", "LV backup", "Ah")}${input("electrical.lvBackupUsableFraction", "LV usable", "fraction", { step: "0.01" })}</div>`)}
      ${panel("HV cable and precharge", `<div class="fields">${input("electrical.cableLength", "Cable one-way", "m", { step: "0.1" })}${input("electrical.cableArea", "Cable area", "mm²")}${input("electrical.cableParallel", "Parallel conductors", "count")}${input("electrical.prechargeCapMicroF", "DC-link C", "µF")}${input("electrical.prechargeInitialCurrent", "Initial precharge", "A")}${input("electrical.prechargeTarget", "Precharge target", "%")}</div>`)}`;
    const results = pack ? `${panel("Connected architecture", `${electricalNetwork(o.graph)}${selectedComponentInspector(o.graph)}${o.violations?.length ? `<div class="notice danger" style="margin-top:12px"><strong>Violations</strong><ul>${o.violations.map(issue => `<li>${esc(issue)}</li>`).join("")}</ul></div>` : ""}`, "Select a node to edit that component. Power and communications are separate graphs.")}
      ${panel("Pack voltage under load", `${canvasChart("packVoltageChart", "Pack terminal voltage against discharge current at nominal and minimum state of charge", 270)}${legend([["Nominal OCV", "#266b92"], ["At min SOC", "#b84d56"], ["Cut-off", "#8f9b97", true], ["Duty point", "#6e56a0"]])}`, "Where the low-SOC line meets cut-off is where the controller must start derating power.")}
      ${o.lvBudget?.length ? panel("LV power budget", `${canvasChart("lvBudgetChart", "Continuous and peak LV power by component against DC-DC capacity", Math.max(180, 30 * o.lvBudget.length + 50))}${legend([["Continuous", "#266b92"], ["Peak / inrush", "#d75f36"]])}`, `${esc(state.meta.electricalScenario)} scenario. Total ${fmt(o.lvContinuous.value, 0)} W continuous / ${fmt(o.lvPeak.value, 0)} W peak against ${fmt(e.dcdcCapacity, 0)} / ${fmt(e.dcdcPeakCapacity, 0)} W DC-DC.`) : ""}
      <div class="grid equal">${panel("HV system", dataTable(["", "Value"], [["Nominal / loaded voltage", `${fmt(pack.nominalV, 0)} / ${fmt(o.terminalVoltage.value, 0)} <small>V</small>`], ["Bus current", withUnit(o.busCurrent.value, "A", 0)], ["Pack I²R loss", withUnit(o.packLoss.value, "kW", 2)], ["Duty battery energy", withUnit(o.dutyBatteryEnergy?.value, "kWh", 2)], ["Pack charge power", withUnit(o.packChargePower.value, "kW", 2)], ["Cable drop / loss", `${fmt(o.cableDrop.value, 2)} V · ${fmt(o.cableLoss.value, 0)} W`], ["Cable current density", withUnit(o.currentDensity?.value, "A/mm²", 2)], ["Precharge", `${fmt(o.prechargeTime.value, 2)} s · ${fmt(o.prechargeEnergy.value, 0)} J`]]))}
      ${panel("LV system", dataTable(["", "Value"], [["Continuous load", withUnit(o.lvContinuous.value, "W", 0)], ["Peak / inrush load", withUnit(o.lvPeak.value, "W", 0)], ["DC-DC continuous headroom", withUnit(o.dcdcHeadroom.value, "W", 0)], ["DC-DC peak headroom", withUnit(o.dcdcPeakHeadroom.value, "W", 0)], ["Essential-load backup", withUnit(o.lvBackupRuntime.value, "min", 0)]]))}</div>` : "";
    const after = panel("Electrical component instances", `<p class="panel-intro">Energy & E/E owns selection, ratings and preferred placement. X/Z are placement proposals until Stance commits a mount.</p><div class="component-row component-head"><span>Component</span><span>Mass kg</span><span>Preferred X</span><span>Preferred Z</span><span>Continuous</span><span>Peak</span><span>Inrush</span><span>Standby</span><span>Sleep</span><span></span></div><div id="componentRows">${state.components.map((component, index) => componentRow(component, index)).join("")}</div><button class="button" data-action="add-component" style="margin-top:12px">Add custom component</button>`);
    const notes = notesRail("electrical", {
      why: "Closes the electrical side against the mechanical package: can the pack hold voltage at the duty current, can the DC-DC carry the LV load with margin, and where does the E/E mass sit.",
      checksTitle: "Typical range",
      how: ["Pack R = S × R_cell / P + interconnect; terminal V = OCV − I·R, solved at the duty battery power.", "Min-SOC OCV is a linear interpolation between cell min and max voltage (indicative).", "LV budget counts only components reachable from the DC-DC or LV battery in the selected scenario.", `${esc(o?.boundaryNote || DATA.sourceNotes.electricalBoundary)}`, o?.massReconciliation ? `Mass reconciliation with Stance: ${fmt(o.massReconciliation.value, 3)} kg.` : ""].filter(Boolean)
    });
    return page(tab, { inputs, results, notes, kpis, after, top: electricalContextControls(true, "electrical") });
  }
  function drawElectricalCharts() {
    const o = outputs.electrical; if (!o?.pack) return;
    const v = o.voltageCurve;
    if (v) xyChart(document.querySelector("#packVoltageChart"), {
      xLabel: "Discharge current (A)", yLabel: "Terminal voltage (V)", xMax: v.points.at(-1).current,
      yMin: Math.floor(Math.min(v.cutoff, ...v.points.map(p => p.lowSoc)) / 20) * 20 - 20,
      series: [{ data: v.points.map(p => [p.current, p.nominal]), colour: "#266b92" }, { data: v.points.map(p => [p.current, p.lowSoc]), colour: "#b84d56" }],
      hLines: [{ y: v.cutoff, label: "cut-off", colour: "#8f9b97" }],
      vLines: v.limitA ? [{ x: v.limitA, label: "C-limit", colour: "#8f9b97" }] : [],
      points: state.meta.electricalScenario === "drive" && Number.isFinite(o.busCurrent.value) && Number.isFinite(o.terminalVoltage.value) ? [{ x: o.busCurrent.value, y: o.terminalVoltage.value, colour: "#6e56a0", label: "duty" }] : []
    });
    if (o.lvBudget?.length) barChart(document.querySelector("#lvBudgetChart"), {
      xLabel: "Power (W)", labelWidth: 170,
      rows: [...o.lvBudget].sort((a, b) => b.peak - a.peak).map(item => ({ label: item.label.length > 26 ? `${item.label.slice(0, 25)}…` : item.label, bars: [{ value: item.continuous, colour: "#266b92" }, { value: item.peak, colour: "#d75f36" }] }))
    });
  }

  function componentRow(component, index) {
    const field = (key, type="number") => `<input type="${type}" data-component="${index}" data-component-key="${key}" value="${esc(component[key])}" aria-label="${esc(component.label)} ${key}">`;
    return `<div class="component-row">${field("label","text")}${field("mass")}${field("x")}${field("z")}${field("continuous")}${field("peak")}${field("inrush")}${field("standby")}${field("sleep")}<button class="icon-button" data-action="remove-component" data-index="${index}" aria-label="Remove ${esc(component.label)}">×</button></div>`;
  }

  function renderApp() {
    recalculate();
    fieldSequence = 0;
    window.MotoGeometryState = state;
    window.MotoGeometryOutputs = outputs;
    const html = [renderClosure(), ...DATA.tabs.map(tab => {
      const renderer = { stance: renderStance, steering: renderSteering, suspension: renderSuspension, anti_squat: renderAntiSquat, sensitivity: renderSensitivity, sag: renderSag, powertrain: renderPowertrain, motor_sizing: renderMotor, braking: renderBraking, battery_calculators: renderBattery, electrical: renderElectrical }[tab.id];
      return renderer(tab);
    })].join("");
    document.querySelector("#main").innerHTML = html;
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
      stale=new Set(["powertrain","motor_sizing","battery_calculators","electrical","sensitivity"]);
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
    const drawers = {
      stance: drawStanceCharts, steering: drawSteeringCharts, suspension: drawSuspensionChart, anti_squat: drawAntiSquatChart,
      sensitivity: drawTornado, sag: drawSagCharts, braking: drawBrakingCharts, motor_sizing: drawMotorCharts,
      powertrain: () => { drawGearRatioComparison(document.querySelector("#gearRatioChart")); drawSpeedRpm(document.querySelector("#speedRpmChart")); },
      battery_calculators: drawBatteryCharts, electrical: drawElectricalCharts
    };
    try { drawers[activeTab]?.(); } catch (error) { console.error(error); }
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
