(function () {
  "use strict";

  const DATA = window.PRD_DATA;
  const Core = window.EngineeringCore;
  const STORAGE_KEY = "moto-geometry-prd-v1.3";
  const UI_STORAGE_KEY = "moto-geometry-ui-v1.3";
  const groups = [
    ["Package", ["stance"]],
    ["Chassis", ["steering", "suspension", "anti_squat", "sensitivity", "sag"]],
    ["Propulsion and studies", ["powertrain", "vehicle_calculators", "battery_calculators"]],
    ["Energy and E/E", ["electrical"]]
  ];
  const ownerTab = { antiSquat: "anti_squat", vehicle: "vehicle_calculators", battery: "battery_calculators" };
  const tabFor = owner => ownerTab[owner] || owner;
  const dependencies = {
    stance: ["steering", "suspension", "sag", "powertrain", "electrical", "sensitivity", "vehicle_calculators", "battery_calculators", "anti_squat"],
    steering: ["suspension", "sag", "sensitivity"],
    suspension: ["sag", "anti_squat", "sensitivity"],
    antiSquat: ["sensitivity"],
    sag: ["anti_squat", "sensitivity", "electrical"],
    powertrain: ["vehicle_calculators", "anti_squat", "electrical", "battery_calculators"],
    electrical: ["stance", "sag", "anti_squat", "vehicle_calculators", "battery_calculators", "sensitivity"],
    battery: [],
    vehicle: [],
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
  let stanceAdvancedOpen = false;
  let lastNetworkDragAt = 0;
  const uiPreferences = loadUiPreferences();
  const electricalNodePositions = uiPreferences.electricalNodePositions || {};
  electricalViewLayer = ["all","hv","lv","communications"].includes(uiPreferences.electricalViewLayer) ? uiPreferences.electricalViewLayer : "all";
  benchmarkCategory = uiPreferences.benchmarkCategory || "All";
  transmissionReferenceId = uiPreferences.transmissionReferenceId || "";
  stanceAdvancedOpen = Boolean(uiPreferences.stanceAdvancedOpen);

  function loadUiPreferences() {
    try { return JSON.parse(localStorage.getItem(UI_STORAGE_KEY)) || {}; } catch (_) { return {}; }
  }
  function persistUiPreferences() {
    uiPreferences.electricalNodePositions = electricalNodePositions;
    uiPreferences.electricalViewLayer = electricalViewLayer;
    uiPreferences.benchmarkCategory = benchmarkCategory;
    uiPreferences.transmissionReferenceId = transmissionReferenceId;
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
        powertrain: clone(state.powertrain), vehicle_calculators: clone(state.vehicle),
        battery_calculators: clone(state.battery), electrical: clone(state.electrical)
      }
    };
  }
  function contractOutputs() {
    return {
      central_services: { mass_properties: outputs.massProperties, mass_cases: outputs.massCases, ergonomics: outputs.ergonomics },
      tabs: {
        steering: outputs.steering, suspension: outputs.suspension, anti_squat: outputs.antiSquat,
        sensitivity: outputs.sensitivity, sag: outputs.sag, powertrain: outputs.powertrain,
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
    const o=outputs.powertrain;if(!o?.ok)return invalidNotice(o,"Powertrain diagram");
    const rearTyre=o.rearTyre,drive=o.driveCentre,rear=o.rearCentre,groundZ=Number(state.stance.rearAxleZ)-rearTyre.radius;
    const all=[{x:rear.x-rearTyre.radius,z:groundZ},{x:rear.x+rearTyre.radius,z:rear.z+rearTyre.radius},{x:drive.x-o.frontPitchRadius.value,z:drive.z-o.frontPitchRadius.value},{x:drive.x+o.frontPitchRadius.value,z:drive.z+o.frontPitchRadius.value}],f=diagramFrame(all,900,285,42),line=t=>t?`<line x1="${f.tx(t.drive.x)}" y1="${f.ty(t.drive.z)}" x2="${f.tx(t.wheel.x)}" y2="${f.ty(t.wheel.z)}" stroke="#d97706" stroke-width="4"/>`:"";
    return `<svg class="diagram engineering-diagram" viewBox="0 0 900 430" role="img" aria-label="Powertrain functional path and final-drive geometry">
      <defs><marker id="power-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10Z" fill="#266b92"/></marker></defs>
      <text x="28" y="24" fill="#61717b" font-size="10" font-weight="800">FUNCTIONAL TORQUE PATH</text>
      ${["Motor / engine","Primary","Selected gear","Front sprocket","Rear wheel"].map((label,index)=>`<g><rect x="${28+index*170}" y="40" width="140" height="48" rx="8" fill="#fffefb" stroke="#266b92" stroke-width="2"/><text x="${98+index*170}" y="69" text-anchor="middle" fill="#173b4d" font-size="11" font-weight="800">${label}</text>${index<4?`<line x1="${168+index*170}" y1="64" x2="${193+index*170}" y2="64" stroke="#266b92" stroke-width="3" marker-end="url(#power-arrow)"/>`:""}</g>`).join("")}
      <text x="28" y="120" fill="#61717b" font-size="10" font-weight="800">FINAL DRIVE · MASTER FRAME · UNIFORM SCALE</text>
      <g transform="translate(0 125)"><line x1="18" y1="${f.ty(groundZ)}" x2="882" y2="${f.ty(groundZ)}" stroke="#8f9b97" stroke-width="2"/>${diagramWheel(f,rear,rearTyre.radius)}
      <circle cx="${f.tx(drive.x)}" cy="${f.ty(drive.z)}" r="${o.frontPitchRadius.value*f.scale}" fill="none" stroke="#d97706" stroke-width="4"/><circle cx="${f.tx(rear.x)}" cy="${f.ty(rear.z)}" r="${o.rearPitchRadius.value*f.scale}" fill="none" stroke="#d97706" stroke-width="4"/>${line(o.upperChainTangent)}${line(o.lowerChainTangent)}
      <line x1="${f.tx(drive.x)}" y1="${f.ty(drive.z)+28}" x2="${f.tx(rear.x)}" y2="${f.ty(rear.z)+28}" stroke="#1f6b50" stroke-width="3"/><text x="${(f.tx(drive.x)+f.tx(rear.x))/2}" y="${(f.ty(drive.z)+f.ty(rear.z))/2+48}" text-anchor="middle" fill="#1f6b50" font-size="10" font-weight="800">CENTRES ${fmt(o.chainCentreDistance.value,1)} mm · ${fmt(o.chainLinks.value,2)} PITCHES</text>
      <text x="${f.tx(drive.x)}" y="${f.ty(drive.z)-o.frontPitchRadius.value*f.scale-10}" text-anchor="middle" fill="#d97706" font-size="10" font-weight="800">${state.powertrain.frontTeeth}T · r ${fmt(o.frontPitchRadius.value,1)}</text><text x="${f.tx(rear.x)}" y="${f.ty(rear.z)-o.rearPitchRadius.value*f.scale-10}" text-anchor="middle" fill="#d97706" font-size="10" font-weight="800">${state.powertrain.rearTeeth}T · r ${fmt(o.rearPitchRadius.value,1)}</text></g>
    </svg><p class="diagram-note">Pitch circles and chain tangencies are calculated from entered tooth counts, pitch and master-frame centres. The ideal pitch count still requires selection of a feasible production chain length.</p>`;
  }

  function canvasChart(id, aria, height = 320) { return `<canvas class="chart" id="${id}" height="${height}" aria-label="${esc(aria)}"></canvas>`; }

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
    return `<div class="flow-grid"><div class="flow-lane" style="border-color:#2f855a;background:#eef7f1"><div class="flow-nodes">${["Stance", "Steering", "Suspension", "Sag + loaded geometry", "Anti-squat"].map((label, i, arr) => `<div class="flow-node">${label}</div>${i < arr.length-1 ? `<div class="flow-arrow">→</div>` : ""}`).join("")}</div></div><div class="flow-lane" style="border-color:#266b92;background:#eef5f9"><div class="flow-nodes"><div class="flow-node">Component instances</div><div class="flow-arrow">→</div><div class="flow-node">Mass Properties</div><div class="flow-arrow">→</div><div class="flow-node">Axle loads + CG</div><div class="flow-arrow">→</div><div class="flow-node">Loaded consumers</div></div></div><div class="notice">Powertrain owns torque-speed and final-drive definitions. Sensitivity and calculators read a frozen revision and create proposals only.</div></div>`;
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

  function renderPowertrain(tab) {
    const o = outputs.powertrain;
    return `<section class="view ${activeTab === tab.id ? "active" : ""}" id="view-${tab.id}">${viewHead(tab)}<div class="grid two"><article class="panel"><h3>Committed torque-speed and final drive</h3><div class="fields">${input("powertrain.type","Powertrain type","",{type:"select",values:["Electric","ICE"]})}${input("powertrain.maxTorque","Maximum torque","N·m")}${input("powertrain.baseRpm","Base RPM","rpm")}${input("powertrain.maxRpm","Maximum RPM","rpm")}${input("powertrain.dutyTorque","Named-duty torque","N·m")}${input("powertrain.dutyRpm","Named-duty RPM","rpm")}${input("powertrain.primaryRatio","Primary ratio","ratio",{step:"0.001"})}${[1,2,3,4,5,6].map(i => input(`powertrain.gear${i}`,`Gear ${i} ratio`,"ratio",{step:"0.001"})).join("")}${input("powertrain.frontTeeth","Front sprocket","teeth")}${input("powertrain.rearTeeth","Rear sprocket","teeth")}${input("powertrain.chainPitch","Chain pitch","mm")}${input("powertrain.driveSprocketX","Drive sprocket X","mm")}${input("powertrain.driveSprocketZ","Drive sprocket Z","mm")}${input("powertrain.drivelineEfficiency","Driveline efficiency","fraction",{step:"0.01"})}${input("powertrain.motorEfficiency","Motor efficiency","fraction",{step:"0.01"})}${input("powertrain.inverterEfficiency","Inverter efficiency","fraction",{step:"0.01"})}${input("powertrain.provenance","Torque-speed provenance","",{type:"text",full:true})}</div></article><div><article class="panel"><h3>Kinematic and final-drive outputs</h3>${invalidNotice(o,"Powertrain")}<div class="metric-grid">${metric("Final ratio",o.finalRatio,{owner:"powertrain",digits:3})}${metric("Duty shaft power",o.shaftPower,{owner:"powertrain",digits:2})}${metric("Kinematic top speed",o.kinematicTopSpeed,{owner:"powertrain"})}${metric("Power to mass",o.powerToWeight,{owner:"powertrain",digits:3})}${metric("Front pitch radius",o.frontPitchRadius,{owner:"powertrain"})}${metric("Rear pitch radius",o.rearPitchRadius,{owner:"powertrain"})}${metric("Chain centre distance",o.chainCentreDistance,{owner:"powertrain"})}${metric("Ideal chain pitches",o.chainLinks,{owner:"powertrain",digits:2})}</div></article><article class="panel"><h3>Per-gear matrix</h3><div class="table-wrap"><table><thead><tr><th>Gear</th><th class="numeric">Ratio</th><th class="numeric">Overall</th><th class="numeric">Speed @ max RPM</th><th class="numeric">Duty speed</th><th class="numeric">Duty wheel torque</th></tr></thead><tbody>${(o.rows || []).map(row => `<tr><td>${row.gear}</td><td class="numeric">${fmt(row.gearRatio,3)}</td><td class="numeric">${fmt(row.overallRatio,3)}</td><td class="numeric">${fmt(row.speedAtMaxRpm,1)} km/h</td><td class="numeric">${fmt(row.speedAtDutyRpm,1)} km/h</td><td class="numeric">${fmt(row.wheelTorqueAtDuty,0)} N·m</td></tr>`).join("")}</tbody></table></div></article>${canvasChart("powertrainChart","Per-gear speed curves through motor RPM")}</div></div></section>`;
  }

  // ---- Transmission comparison -------------------------------------------------
  // The reference vehicle is a read-only overlay. Selecting one never writes to Powertrain
  // and never creates a design revision; it only changes what the two charts draw alongside.
  function transmissionReference() {
    const records = window.TRANSMISSION_BENCHMARKS?.records || [];
    return records.find(record => record.id === transmissionReferenceId) || null;
  }
  function projectGearRatios() {
    const p = state.powertrain;
    return [p.gear1,p.gear2,p.gear3,p.gear4,p.gear5,p.gear6].map(Number).filter(value => Number.isFinite(value) && value > 0);
  }
  function projectOverall(gearRatio) {
    return Number(state.powertrain.primaryRatio) * gearRatio * (Number(state.powertrain.rearTeeth) / Math.max(1e-9, Number(state.powertrain.frontTeeth)));
  }
  function referenceOverall(record, gearRatio) {
    return Number(record.primaryRatio) * gearRatio * Number(record.finalRatio);
  }
  function transmissionSelector() {
    const catalogue = window.TRANSMISSION_BENCHMARKS;
    if (!catalogue?.records?.length) return `<div class="notice danger">No transmission reference catalogue is loaded.</div>`;
    const grouped = catalogue.categories.map(category => {
      const items = catalogue.records.filter(record => record.benchmarkCategory === category);
      if (!items.length) return "";
      return `<optgroup label="${esc(category)}">${items.map(record => `<option value="${esc(record.id)}" ${record.id === transmissionReferenceId ? "selected" : ""}>${esc(record.label)}</option>`).join("")}</optgroup>`;
    }).join("");
    const record = transmissionReference();
    return `<div class="local-context" aria-label="Transmission comparison context">
      <div class="field full"><label for="transmission-reference">Compare transmission against</label>
        <select id="transmission-reference" data-transmission-reference><option value="">No reference vehicle</option>${grouped}</select>
        <small>Read-only overlay for the two charts below. Selecting a reference never changes Powertrain values, the duty case or the revision.</small></div>
      ${record ? `<div class="reference-chip"><strong>${esc(record.label)}</strong><span>${esc(record.benchmarkCategory)}</span><span>${record.gearCount} gears</span><span>primary ${fmt(record.primaryRatio,3)}</span><span>final ${fmt(record.finalRatio,3)}</span><span>${record.frontTeeth}/${record.rearTeeth}T</span><span>${fmt(record.maxRpm,0)} rpm max</span></div>` : ""}
    </div>`;
  }
  function transmissionComparisonPanel() {
    const record = transmissionReference();
    const mine = projectGearRatios();
    const rows = mine.map((gearRatio, index) => {
      const theirs = record?.gearRatios?.[index];
      const mineOverall = projectOverall(gearRatio);
      const theirsOverall = Number.isFinite(theirs) ? referenceOverall(record, theirs) : null;
      return `<tr><td>${index+1}</td><td class="numeric">${fmt(gearRatio,3)}</td><td class="numeric">${Number.isFinite(theirs)?fmt(theirs,3):"—"}</td><td class="numeric">${Number.isFinite(theirs)?`${theirs-gearRatio>=0?"+":""}${fmt(theirs-gearRatio,3)}`:"—"}</td><td class="numeric">${fmt(mineOverall,3)}</td><td class="numeric">${theirsOverall===null?"—":fmt(theirsOverall,3)}</td></tr>`;
    }).join("");
    const spread = values => values.length > 1 ? values[0] / values.at(-1) : null;
    const mineSpread = spread(mine), theirsSpread = record ? spread(record.gearRatios) : null;
    return `<article class="panel"><h3>Transmission comparison</h3>
      <p class="panel-intro">Your entered ratio stack against the selected reference vehicle. Gear count, primary ratio and final drive all differ between machines, so overall ratio is shown as well as raw gear ratio.</p>
      ${canvasChart("gearRatioChart","Gear ratio per gear, current model against the selected reference vehicle",300)}
      <div class="chart-legend"><span><i style="background:#1f6b50"></i>This model</span><span><i style="background:#d75f36"></i>${esc(record?record.label:"No reference selected")}</span></div>
      <div class="table-wrap" style="margin-top:14px"><table><thead><tr><th>Gear</th><th class="numeric">This model</th><th class="numeric">Reference</th><th class="numeric">Δ ratio</th><th class="numeric">This overall</th><th class="numeric">Reference overall</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="benchmark-project" style="margin-top:12px"><strong>Ratio spread</strong><span>This model ${mineSpread?fmt(mineSpread,3):"—"}</span><span>Reference ${theirsSpread?fmt(theirsSpread,3):"—"}</span>${record?`<span>${mine.length} vs ${record.gearRatios.length} gears</span>`:""}</div>
      <div class="notice warning" style="margin-top:14px">Descriptive context only. A reference machine is a different vehicle with its own mass, tyre, engine envelope and intended use; ratio proximity never creates an engineering pass.</div></article>`;
  }
  function wheelRpmPanel() {
    const record = transmissionReference();
    const tyreOut = Core.tyre(state.stance.rearTyreWidth, state.stance.rearTyreAspect, state.stance.rearRim);
    return `<article class="panel"><h3>Shaft RPM to wheel RPM</h3>
      <p class="panel-intro">Wheel speed produced per unit of motor or engine speed, through each gear. The slope of every line is the reciprocal of that gear's overall ratio, so a steeper line is a taller gear.</p>
      ${canvasChart("wheelRpmChart","Wheel RPM against motor or engine RPM for every gear, current model against the selected reference vehicle",340)}
      <div class="chart-legend"><span><i style="background:#1f6b50"></i>This model — solid</span><span><i style="background:#d75f36"></i>${esc(record?record.label:"No reference selected")} — dashed</span></div>
      <div class="benchmark-project" style="margin-top:12px"><strong>Tyre reference</strong><span>This model ${tyreOut.ok?fmt(tyreOut.circumference,0):"—"} mm circumference</span>${record?`<span>Reference ${fmt(record.tyre.nominalCircumferenceMm,0)} mm</span>`:""}</div>
      <div class="notice" style="margin-top:14px">Kinematic only: no slip, no tyre growth, no clutch or torque-converter loss. Reference tyre circumference is nominal and geometric, so real rolling radius will differ.</div></article>`;
  }
  function drawGearRatioComparison(canvas) {
    if (!canvas) return;
    const record = transmissionReference();
    const mine = projectGearRatios();
    if (!mine.length) return;
    const theirs = record?.gearRatios || [];
    const maxGear = Math.max(mine.length, theirs.length);
    const all = [...mine, ...theirs];
    const view = drawAxes(canvas, "Gear", "Gear ratio", 0, Math.max(...all) * 1.12);
    const slot = (view.W - view.pad.l - view.pad.r) / maxGear;
    const barW = Math.min(26, slot / (record ? 2.6 : 1.8));
    const drawSet = (values, colour, offset) => values.forEach((value, index) => {
      const centre = view.pad.l + slot * (index + 0.5);
      const x = centre + offset - barW / 2, y = view.ty(value), base = view.ty(0);
      view.ctx.fillStyle = colour; view.ctx.fillRect(x, y, barW, base - y);
      view.ctx.fillStyle = colour; view.ctx.font = "700 10px Inter, system-ui"; view.ctx.textAlign = "center";
      view.ctx.fillText(fmt(value,2), x + barW/2, y - 5);
    });
    drawSet(mine, "#1f6b50", record ? -barW*0.62 : 0);
    if (record) drawSet(theirs, "#d75f36", barW*0.62);
    view.ctx.fillStyle = "#61717b"; view.ctx.font = "10px Inter, system-ui"; view.ctx.textAlign = "center";
    for (let index = 0; index < maxGear; index += 1) view.ctx.fillText(String(index+1), view.pad.l + slot*(index+0.5), view.H - view.pad.b + 16);
    view.ctx.textAlign = "left";
  }
  function drawWheelRpmComparison(canvas) {
    if (!canvas) return;
    const powertrain = outputs.powertrain;
    if (!powertrain?.ok) return;
    const record = transmissionReference();
    const mineMaxRpm = Number(state.powertrain.maxRpm);
    const maxRpm = Math.max(mineMaxRpm, record ? Number(record.maxRpm) : 0);
    const mineSeries = powertrain.rows.map(row => ({ ratio: row.overallRatio, gear: row.gear }));
    const theirsSeries = record ? record.gearRatios.map((gearRatio, index) => ({ ratio: referenceOverall(record, gearRatio), gear: index+1 })) : [];
    const wheelRpmAt = (rpm, ratio) => rpm / ratio;
    const peak = Math.max(
      ...mineSeries.map(item => wheelRpmAt(mineMaxRpm, item.ratio)),
      ...theirsSeries.map(item => wheelRpmAt(Number(record.maxRpm), item.ratio))
    );
    const view = drawAxes(canvas, "Motor / engine RPM", "Wheel RPM", 0, peak * 1.08);
    const line = (series, limitRpm, colour, dashed) => series.forEach(item => {
      view.ctx.strokeStyle = colour; view.ctx.lineWidth = dashed ? 1.8 : 2.6;
      view.ctx.setLineDash(dashed ? [6,4] : []);
      view.ctx.beginPath();
      view.ctx.moveTo(view.tx(0, maxRpm), view.ty(0));
      view.ctx.lineTo(view.tx(limitRpm, maxRpm), view.ty(wheelRpmAt(limitRpm, item.ratio)));
      view.ctx.stroke();
      view.ctx.setLineDash([]);
      view.ctx.fillStyle = colour; view.ctx.font = "700 9px Inter, system-ui"; view.ctx.textAlign = "right";
      view.ctx.fillText(`G${item.gear}`, view.tx(limitRpm, maxRpm) - 3, view.ty(wheelRpmAt(limitRpm, item.ratio)) - 4);
    });
    if (record) line(theirsSeries, Number(record.maxRpm), "#d75f36", true);
    line(mineSeries, mineMaxRpm, "#1f6b50", false);
    view.ctx.textAlign = "left";
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
    const powertrainRight=document.querySelector("#view-powertrain .grid.two > div");
    prependPanel(powertrainRight,"Torque path and final drive",powertrainDiagram(),"Functional torque flow above; sprocket and chain construction below.");
    powertrainRight?.insertAdjacentHTML("beforeend",powertrainBenchmarkPanel());

    powertrainRight?.insertAdjacentHTML("beforeend",transmissionComparisonPanel()+wheelRpmPanel());
    const powertrainHead=document.querySelector("#view-powertrain .view-head");
    powertrainHead?.insertAdjacentHTML("afterend",transmissionSelector()+`<div class="local-context">${dutyCaseControl(false)}</div>`);
    const powertrainInputs=document.querySelector("#view-powertrain .grid.two > .panel .fields");
    powertrainInputs?.insertAdjacentHTML("beforeend",`${input("powertrain.dutyDurationMinutes","Duty duration","min",{step:"0.5"})}${input("powertrain.dutyGear","Duty gear","gear")}`);
    const powertrainMetrics=document.querySelector("#view-powertrain .metric-grid");
    powertrainMetrics?.insertAdjacentHTML("afterbegin",metric("Peak envelope power",outputs.powertrain?.peakPower,{owner:"powertrain",digits:2}));
    powertrainMetrics?.insertAdjacentHTML("beforeend",`${metric("Duty mechanical energy",outputs.powertrain?.dutyEnergy,{owner:"powertrain",digits:2})}${metric("Duty road speed",outputs.powertrain?.dutyRoadSpeed,{owner:"powertrain",digits:1})}`);
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
      const renderer = { stance: renderStance, steering: renderSteering, suspension: renderSuspension, anti_squat: renderAntiSquat, sensitivity: renderSensitivity, sag: renderSag, powertrain: renderPowertrain, vehicle_calculators: renderVehicle, battery_calculators: renderBattery, electrical: renderElectrical }[tab.id];
      return renderer(tab);
    })].join("");
    document.querySelector("#main").innerHTML = html;
    enhanceRenderedViews();
    bindInputs();
    bindElectricalNetworkInteraction();
    updateChrome();
    requestAnimationFrame(drawCharts);
  }

  function bindInputs() {
    document.querySelectorAll("[data-path]").forEach(element => element.addEventListener(element.tagName === "SELECT" ? "change" : "input", event => {
      const path = event.currentTarget.dataset.path;
      const owner = event.currentTarget.dataset.owner || path.split(".")[0];
      const raw = event.currentTarget.value;
      const value = event.currentTarget.type === "number" ? Number(raw) : raw;
      set(path, value);
      state.meta.revision += 1;
      state.meta.domainRevisions[owner] = (state.meta.domainRevisions[owner] || 0) + 1;
      lastChange = `${path} changed by ${owner}`;
      stale = new Set(dependencies[owner] || []);
      renderApp();
    }));
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
    ["massProperties","ergonomics","steering","suspension","sag","antiSquat","sensitivity","powertrain","vehicle","battery","electrical"].forEach(key => {
      const item = outputs[key];
      if (item?.ok === false) issues.push(`${key}: ${item.error || "invalid inputs"}`);
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
    if (activeTab === "powertrain") { drawGearRatioComparison(document.querySelector("#gearRatioChart")); drawWheelRpmComparison(document.querySelector("#wheelRpmChart")); }
    if (activeTab === "anti_squat" && outputs.antiSquat?.samples) plot(document.querySelector("#antiSquatChart"), outputs.antiSquat.samples, "wheelTravel", "anti", "#1f6b50", "Rear wheel travel (mm)", "Anti-squat (%)");
    if (activeTab === "powertrain" && outputs.powertrain?.rows) {
      const points=[];outputs.powertrain.rows.forEach(row=>{for(let rpm=0;rpm<=state.powertrain.maxRpm;rpm+=state.powertrain.maxRpm/40)points.push({rpm,speed:rpm/row.overallRatio*outputs.powertrain.rearTyre.circumference/1e6*60,gear:row.gear})});
      const canvas=document.querySelector("#powertrainChart"); if(canvas){const ys=points.map(p=>p.speed),v=drawAxes(canvas,"Motor RPM","Road speed (km/h)",0,Math.max(...ys)*1.08),colors=["#1f6b50","#266b92","#6e56a0","#a66516","#b84d56","#465b66"];outputs.powertrain.rows.forEach(row=>{const group=points.filter(p=>p.gear===row.gear);v.ctx.strokeStyle=colors[row.gear-1];v.ctx.lineWidth=2;v.ctx.beginPath();group.forEach((p,i)=>{const x=v.tx(p.rpm,state.powertrain.maxRpm),y=v.ty(p.speed);i?v.ctx.lineTo(x,y):v.ctx.moveTo(x,y)});v.ctx.stroke();});}
    }
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
