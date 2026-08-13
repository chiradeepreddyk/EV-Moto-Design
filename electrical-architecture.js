(function () {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const all = (selector) => [...document.querySelectorAll(selector)];
  const value = (id) => {
    const parsed = Number.parseFloat(byId(id)?.value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const clamp = (number, minimum, maximum) => Math.max(minimum, Math.min(maximum, number));
  const fixed = (number, digits = 1) => Number.isFinite(number) ? number.toFixed(digits) : "-";
  const signed = (number, digits = 1) => `${number >= 0 ? "+" : ""}${fixed(number, digits)}`;
  const put = (id, content) => {
    const node = byId(id);
    if (node) node.textContent = content;
  };
  const putHtml = (id, content) => {
    const node = byId(id);
    if (node) node.innerHTML = content;
  };
  const setStatus = (id, content, level = "ok") => {
    const node = byId(id);
    if (!node) return;
    node.textContent = content;
    node.className = `status${level === "warn" ? " warn" : level === "alert" ? " alert" : ""}`;
  };
  const roundUp = (number, step = 5) => Math.ceil(number / step) * step;

  const architecturePresets = {
    urban: {
      elecPowertrainSource: "manual", elecSeriesCells: 20, elecParallelCells: 12,
      elecMotorPeakTorque: 55, elecMotorBaseRpm: 3500, elecMotorMaxRpm: 8000,
      elecMotorContinuousPower: 9, elecCruisePower: 4, elecRegenPower: 8,
      elecCellNominalV: 3.6, elecCellMinV: 3.0, elecCellMaxV: 4.2,
      elecCellCapacityAh: 5, elecCellContinuousC: 4, elecCellPeakC: 8,
      elecCellChargeC: 1, elecCellResistance: 3, elecInterconnectResistance: 5,
      elecCableArea: 60, elecCableLength: 1.2, elecObcRating: 3.3,
      elecDcChargeRating: 15, elecDcdcRating: 650, elecCoolingLoad: 160,
      elecConsumption: 75, elecGliderMass: 76, elecPackMass: 28,
      elecPackX: -210, elecPackY: 20, elecPackLength: 440,
      elecPackHeight: 260, elecPackWidth: 260, elecMotorMass: 17,
      elecMotorX: 70, elecMotorY: -75, elecMotorDiameter: 180,
      elecInverterMass: 5, elecInverterX: -260, elecInverterY: 250,
      elecAncillaryMass: 8, elecAncillaryX: 150, elecAncillaryY: 250
    },
    mid: {
      elecPowertrainSource: "manual", elecSeriesCells: 40, elecParallelCells: 18,
      elecMotorPeakTorque: 90, elecMotorBaseRpm: 5000, elecMotorMaxRpm: 10000,
      elecMotorContinuousPower: 25, elecCruisePower: 7, elecRegenPower: 18,
      elecCellNominalV: 3.6, elecCellMinV: 3.0, elecCellMaxV: 4.2,
      elecCellCapacityAh: 5, elecCellContinuousC: 4, elecCellPeakC: 8,
      elecCellChargeC: 1.2, elecCellResistance: 3, elecInterconnectResistance: 7,
      elecCableArea: 70, elecCableLength: 1.5, elecObcRating: 6.6,
      elecDcChargeRating: 35, elecDcdcRating: 850, elecCoolingLoad: 250,
      elecConsumption: 100, elecGliderMass: 80, elecPackMass: 72,
      elecPackX: -240, elecPackY: 30, elecPackLength: 540,
      elecPackHeight: 360, elecPackWidth: 300, elecMotorMass: 25,
      elecMotorX: 75, elecMotorY: -80, elecMotorDiameter: 220,
      elecInverterMass: 7, elecInverterX: -300, elecInverterY: 300,
      elecAncillaryMass: 10, elecAncillaryX: 170, elecAncillaryY: 280
    },
    performance: {
      elecPowertrainSource: "manual", elecSeriesCells: 108, elecParallelCells: 20,
      elecMotorPeakTorque: 120, elecMotorBaseRpm: 8500, elecMotorMaxRpm: 12000,
      elecMotorContinuousPower: 55, elecCruisePower: 12, elecRegenPower: 35,
      elecCellNominalV: 3.65, elecCellMinV: 3.0, elecCellMaxV: 4.2,
      elecCellCapacityAh: 5, elecCellContinuousC: 4, elecCellPeakC: 8,
      elecCellChargeC: 1.5, elecCellResistance: 3, elecInterconnectResistance: 8,
      elecCableArea: 70, elecCableLength: 1.8, elecObcRating: 6.6,
      elecDcChargeRating: 60, elecDcdcRating: 1000, elecCoolingLoad: 350,
      elecConsumption: 130, elecGliderMass: 82, elecPackMass: 135,
      elecPackX: -260, elecPackY: 40, elecPackLength: 620,
      elecPackHeight: 460, elecPackWidth: 320, elecMotorMass: 32,
      elecMotorX: 80, elecMotorY: -80, elecMotorDiameter: 260,
      elecInverterMass: 9, elecInverterX: -320, elecInverterY: 340,
      elecAncillaryMass: 13, elecAncillaryX: 180, elecAncillaryY: 300
    }
  };

  function applyPreset(name) {
    const preset = architecturePresets[name];
    if (!preset) return;
    Object.entries(preset).forEach(([id, nextValue]) => {
      const input = byId(id);
      if (input) input.value = nextValue;
    });
    all(".electrical-preset").forEach((button) => button.classList.toggle("active", button.dataset.electrical === name));
    updateElectricalArchitecture();
  }

  function applyChemistryDefaults() {
    const chemistry = byId("elecCellChemistry")?.value;
    const defaults = chemistry === "lfp"
      ? { elecCellNominalV: 3.2, elecCellMinV: 2.5, elecCellMaxV: 3.65 }
      : chemistry === "nmc"
        ? { elecCellNominalV: 3.65, elecCellMinV: 3.0, elecCellMaxV: 4.2 }
        : null;
    if (!defaults) return;
    Object.entries(defaults).forEach(([id, nextValue]) => { byId(id).value = nextValue; });
  }

  function syncPowertrainInputs() {
    const linked = byId("elecPowertrainSource")?.value === "linked";
    all(".elec-motor-manual").forEach((input) => { input.readOnly = linked; });
    if (!linked) {
      put("elecPowertrainLinkNote", "Manual electric motor definition. Select linked mode to reuse torque and speed from the Powertrain tab.");
      return { linked, model: "manual" };
    }
    if (byId("ptEngineTorque")) byId("elecMotorPeakTorque").value = value("ptEngineTorque");
    if (byId("ptPeakTorqueRpm")) byId("elecMotorBaseRpm").value = value("ptPeakTorqueRpm");
    if (byId("ptMaxRpm")) byId("elecMotorMaxRpm").value = value("ptMaxRpm");
    const model = byId("ptPowerUnitModel")?.value || "unknown";
    put("elecPowertrainLinkNote", `Linked to Powertrain: ${fixed(value("ptEngineTorque"), 1)} Nm, ${fixed(value("ptPeakTorqueRpm"), 0)} rpm base point and ${fixed(value("ptMaxRpm"), 0)} rpm maximum. Selected Powertrain model: ${model}.`);
    return { linked, model };
  }

  function solveDischarge(powerKw, openCircuitVoltage, resistance) {
    const power = Math.max(0, powerKw) * 1000;
    if (!power || !openCircuitVoltage) return { current: 0, terminalVoltage: openCircuitVoltage, lossKw: 0, impossible: false };
    if (resistance <= 1e-9) {
      const current = power / openCircuitVoltage;
      return { current, terminalVoltage: openCircuitVoltage, lossKw: 0, impossible: false };
    }
    const discriminant = openCircuitVoltage ** 2 - 4 * resistance * power;
    if (discriminant <= 0) {
      const current = openCircuitVoltage / (2 * resistance);
      return { current, terminalVoltage: openCircuitVoltage / 2, lossKw: current ** 2 * resistance / 1000, impossible: true };
    }
    const current = (openCircuitVoltage - Math.sqrt(discriminant)) / (2 * resistance);
    const terminalVoltage = openCircuitVoltage - current * resistance;
    return { current, terminalVoltage, lossKw: current ** 2 * resistance / 1000, impossible: false };
  }

  function solveCharge(powerKw, openCircuitVoltage, resistance) {
    const power = Math.max(0, powerKw) * 1000;
    if (!power || !openCircuitVoltage) return { current: 0, terminalVoltage: openCircuitVoltage, lossKw: 0, impossible: false };
    const current = resistance > 1e-9
      ? (-openCircuitVoltage + Math.sqrt(openCircuitVoltage ** 2 + 4 * resistance * power)) / (2 * resistance)
      : power / openCircuitVoltage;
    const terminalVoltage = openCircuitVoltage + current * resistance;
    return { current, terminalVoltage, lossKw: current ** 2 * resistance / 1000, impossible: false };
  }

  function prepareCanvas(canvas, fallbackHeight) {
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width < 10) return null;
    const width = bounds.width;
    const height = Math.max(bounds.height || fallbackHeight, fallbackHeight);
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    const context = canvas.getContext("2d");
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, width, height);
    return { context, width, height };
  }

  function palette() {
    const style = getComputedStyle(document.documentElement);
    return {
      ink: style.getPropertyValue("--ink").trim(),
      muted: style.getPropertyValue("--muted").trim(),
      panel: style.getPropertyValue("--panel").trim(),
      line: style.getPropertyValue("--line").trim(),
      orange: style.getPropertyValue("--orange").trim(),
      green: style.getPropertyValue("--green").trim(),
      blue: style.getPropertyValue("--blue").trim(),
      amber: style.getPropertyValue("--amber").trim(),
      red: style.getPropertyValue("--red").trim()
    };
  }

  function drawArchitecture(state) {
    const prepared = prepareCanvas(byId("electricalArchitectureCanvas"), 430);
    if (!prepared) return;
    const { context: ctx, width, height } = prepared;
    const colors = palette();
    const sx = width / 1000;
    const sy = height / 430;
    ctx.save();
    ctx.scale(sx, sy);
    ctx.lineWidth = 1;
    ctx.strokeStyle = colors.line;
    ctx.globalAlpha = 0.42;
    for (let x = 20; x < 1000; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 430); ctx.stroke();
    }
    for (let y = 16; y < 430; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1000, y); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    const connector = (x1, y1, x2, y2, color, widthPx = 4, dashed = false) => {
      ctx.save();
      ctx.strokeStyle = color; ctx.lineWidth = widthPx; ctx.lineCap = "round";
      ctx.setLineDash(dashed ? [8, 6] : []);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      ctx.restore();
    };
    const node = (x, y, w, h, title, lines, accent) => {
      ctx.save();
      ctx.fillStyle = colors.panel; ctx.strokeStyle = accent; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(x, y, w, h, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colors.ink; ctx.font = "700 12px Inter, system-ui, sans-serif";
      ctx.fillText(title, x + 12, y + 21);
      ctx.fillStyle = colors.muted; ctx.font = "600 10px Inter, system-ui, sans-serif";
      lines.forEach((line, index) => ctx.fillText(line, x + 12, y + 42 + index * 15));
      ctx.restore();
    };

    connector(205, 62, 255, 62, colors.blue, 3);
    connector(385, 62, 455, 168, colors.orange, 4);
    connector(210, 210, 250, 210, colors.orange, 6);
    connector(350, 210, 405, 210, colors.orange, 6);
    connector(555, 210, 610, 210, colors.orange, 6);
    connector(760, 210, 820, 210, colors.green, 6);
    connector(500, 265, 500, 327, colors.orange, 4);
    connector(555, 350, 610, 350, colors.blue, 4);
    connector(750, 350, 805, 350, colors.blue, 4);
    connector(125, 260, 125, 330, colors.blue, 3, true);

    node(45, 155, 165, 110, "TRACTION BATTERY", [
      `${state.ns}S x ${state.np}P | ${fixed(state.vNom, 0)} V`,
      `${fixed(state.grossEnergy, 1)} kWh gross`,
      `${fixed(state.packAh, 0)} Ah | ${fixed(state.packResistance * 1000, 1)} mOhm`
    ], colors.orange);
    node(250, 168, 100, 84, "HV SAFETY", [
      `${fixed(state.fuseDesign, 0)} A design`,
      "MSD | fuse | contactors"
    ], colors.orange);
    node(405, 155, 150, 110, "INVERTER", [
      `${fixed(value("elecInverterEfficiency"), 1)}% entered eta`,
      `${fixed(state.peak.current, 0)} A peak DC`,
      `${fixed(state.peak.terminalVoltage, 0)} V loaded`
    ], colors.orange);
    node(610, 155, 150, 110, "TRACTION MOTOR", [
      `${fixed(state.motorPeakPower, 1)} kW peak point`,
      `${fixed(value("elecMotorPeakTorque"), 0)} Nm`,
      `${fixed(value("elecMotorMaxRpm"), 0)} rpm maximum`
    ], colors.green);
    node(820, 165, 135, 90, "FINAL DRIVE", [
      `${byId("ptDriveType")?.value || "drive"}`,
      "Linked to Powertrain tab"
    ], colors.green);
    node(45, 25, 160, 75, "CHARGE INLET / EVSE", [
      `${state.acPhases === 3 ? "3-phase" : "1-phase"} ${fixed(value("elecAcVoltage"), 0)} V`,
      `${fixed(value("elecAcCurrent"), 0)} A supply limit`
    ], colors.blue);
    node(255, 25, 130, 75, "ON-BOARD CHARGER", [
      `${fixed(state.acWallPower, 1)} kW wall`,
      `${fixed(state.acPackPower, 1)} kW to pack`
    ], colors.blue);
    node(425, 310, 130, 75, "HV TO LV DC/DC", [
      `${fixed(value("elecDcdcRating"), 0)} W rating`,
      `${fixed(state.lvContinuous, 0)} W continuous`
    ], colors.blue);
    node(610, 310, 140, 75, "12 V BATTERY", [
      `${fixed(value("elecLvVoltage"), 1)} V`,
      `${fixed(value("elecLvBatteryAh"), 1)} Ah backup`
    ], colors.blue);
    node(805, 310, 150, 75, "LV LOADS", [
      `${fixed(state.lvContinuous, 0)} W continuous`,
      `${fixed(state.lvPeak, 0)} W peak case`
    ], colors.blue);
    node(45, 330, 165, 65, "BMS / HV INTERLOCK", [
      `isolation ${fixed(state.isolationRatio, 0)} ohm/V`, "contactors | interlock"
    ], colors.blue);

    ctx.fillStyle = colors.muted;
    ctx.font = "700 10px Inter, system-ui, sans-serif";
    ctx.fillText("ORANGE: HIGH VOLTAGE", 45, 420);
    ctx.fillText("BLUE: CHARGING / LOW VOLTAGE", 230, 420);
    ctx.fillText("GREEN: MECHANICAL POWER", 470, 420);
    ctx.restore();
  }

  function drawPackaging(state) {
    const prepared = prepareCanvas(byId("electricalPackagingCanvas"), 420);
    if (!prepared) return;
    const { context: ctx, width, height } = prepared;
    const colors = palette();
    const wheelbase = value("vehicleWheelbase") || 1430;
    const rearRadius = value("rearTyreRadius") || 315;
    const frontRadius = value("frontTyreRadius") || 300;
    const rearAxle = { x: value("wcx") || 343, y: value("wcy") || -67 };
    const groundY = rearAxle.y - rearRadius;
    const frontAxle = { x: rearAxle.x - wheelbase, y: groundY + frontRadius };
    const seat = { x: value("seatPivotX") || 70, y: groundY + (value("seatHeight") || 826) };
    const xMin = frontAxle.x - frontRadius - 110;
    const xMax = rearAxle.x + rearRadius + 110;
    const yMin = groundY - 55;
    const yMax = Math.max(seat.y + 180, state.packY + state.packHeight / 2 + 160, state.inverterY + 220);
    const scale = Math.min((width - 80) / (xMax - xMin), (height - 70) / (yMax - yMin));
    const map = (point) => ({ x: 40 + (point.x - xMin) * scale, y: height - 35 - (point.y - yMin) * scale });
    const drawWheel = (centre, radius, label) => {
      const mapped = map(centre);
      ctx.save();
      ctx.strokeStyle = colors.muted; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
      ctx.beginPath(); ctx.arc(mapped.x, mapped.y, radius * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = colors.muted; ctx.font = "700 9px Inter, system-ui, sans-serif";
      ctx.fillText(label, mapped.x - 28, mapped.y + 4);
      ctx.restore();
    };
    const box = (centreX, centreY, length, boxHeight, label, fill, stroke) => {
      const topLeft = map({ x: centreX - length / 2, y: centreY + boxHeight / 2 });
      const w = Math.max(8, length * scale);
      const h = Math.max(8, boxHeight * scale);
      ctx.save();
      ctx.fillStyle = fill; ctx.strokeStyle = stroke; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(topLeft.x, topLeft.y, w, h, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = colors.ink; ctx.font = "700 9px Inter, system-ui, sans-serif";
      ctx.fillText(label, topLeft.x + 7, topLeft.y + 15);
      ctx.restore();
    };
    const marker = (point, label, color) => {
      const mapped = map(point);
      ctx.save(); ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(mapped.x - 8, mapped.y); ctx.lineTo(mapped.x + 8, mapped.y); ctx.moveTo(mapped.x, mapped.y - 8); ctx.lineTo(mapped.x, mapped.y + 8); ctx.stroke();
      ctx.font = "700 9px Inter, system-ui, sans-serif"; ctx.fillText(label, mapped.x + 11, mapped.y - 7); ctx.restore();
    };

    ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
    for (let x = Math.ceil(xMin / 100) * 100; x < xMax; x += 100) {
      const px = map({ x, y: yMin }).x; ctx.beginPath(); ctx.moveTo(px, 10); ctx.lineTo(px, height - 20); ctx.stroke();
    }
    for (let y = Math.ceil(yMin / 100) * 100; y < yMax; y += 100) {
      const py = map({ x: xMin, y }).y; ctx.beginPath(); ctx.moveTo(20, py); ctx.lineTo(width - 20, py); ctx.stroke();
    }
    const groundA = map({ x: xMin, y: groundY });
    const groundB = map({ x: xMax, y: groundY });
    ctx.strokeStyle = colors.ink; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(groundA.x, groundA.y); ctx.lineTo(groundB.x, groundB.y); ctx.stroke();
    drawWheel(frontAxle, frontRadius, "FRONT");
    drawWheel(rearAxle, rearRadius, "REAR");

    const pivot = map({ x: 0, y: 0 });
    const seatPoint = map(seat);
    const head = map({ x: frontAxle.x + 250, y: seat.y + 110 });
    ctx.save(); ctx.strokeStyle = colors.muted; ctx.lineWidth = 2; ctx.setLineDash([7, 6]);
    ctx.beginPath(); ctx.moveTo(rearAxle.x ? map(rearAxle).x : 0, map(rearAxle).y); ctx.lineTo(pivot.x, pivot.y); ctx.lineTo(head.x, head.y); ctx.lineTo(seatPoint.x, seatPoint.y); ctx.lineTo(map(rearAxle).x, map(rearAxle).y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(head.x, head.y); ctx.lineTo(map(frontAxle).x, map(frontAxle).y); ctx.stroke(); ctx.restore();

    box(state.packX, state.packY, state.packLength, state.packHeight, "BATTERY PACK", "rgba(227,95,45,.16)", colors.orange);
    const motor = map({ x: state.motorX, y: state.motorY });
    ctx.fillStyle = "rgba(36,77,61,.16)"; ctx.strokeStyle = colors.green; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(motor.x, motor.y, Math.max(8, state.motorDiameter / 2 * scale), 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = colors.ink; ctx.font = "700 9px Inter, system-ui, sans-serif"; ctx.fillText("MOTOR", motor.x - 19, motor.y + 3);
    box(state.inverterX, state.inverterY, 230, 115, "INVERTER", "rgba(60,110,134,.14)", colors.blue);
    box(state.ancillaryX, state.ancillaryY, 235, 105, "OBC / DC-DC / LV", "rgba(241,197,108,.20)", colors.amber);
    marker({ x: state.gliderCgX, y: state.gliderCgY }, "GLIDER CG", colors.muted);
    marker({ x: state.electricalCgX, y: state.electricalCgY }, "ELECTRICAL CG", colors.orange);
    marker({ x: state.vehicleCgX, y: state.vehicleCgY }, "TOTAL CG", colors.green);
    marker({ x: 0, y: 0 }, "PIVOT (0,0)", colors.ink);

    putHtml("elecCoordinateReadout", `<strong>Electrical coordinate table (mm)</strong>
      <div><span>Front axle</span><b>${fixed(frontAxle.x, 1)}, ${fixed(frontAxle.y, 1)}</b></div>
      <div><span>Rear axle</span><b>${fixed(rearAxle.x, 1)}, ${fixed(rearAxle.y, 1)}</b></div>
      <div><span>Battery centre</span><b>${fixed(state.packX, 1)}, ${fixed(state.packY, 1)}</b></div>
      <div><span>Motor centre</span><b>${fixed(state.motorX, 1)}, ${fixed(state.motorY, 1)}</b></div>
      <div><span>Inverter centre</span><b>${fixed(state.inverterX, 1)}, ${fixed(state.inverterY, 1)}</b></div>
      <div><span>Ancillary centre</span><b>${fixed(state.ancillaryX, 1)}, ${fixed(state.ancillaryY, 1)}</b></div>
      <div><span>Electrical CG</span><b>${fixed(state.electricalCgX, 1)}, ${fixed(state.electricalCgY, 1)}</b></div>
      <div><span>Complete-vehicle CG</span><b>${fixed(state.vehicleCgX, 1)}, ${fixed(state.vehicleCgY, 1)}</b></div>`);
  }

  function loadCaseRow(label, direction, displayPower, batteryPower, solved, packAh, limit, limitLabel) {
    const cRate = packAh > 0 ? solved.current / packAh : 0;
    const within = solved.current <= limit + 1e-6 && !solved.impossible;
    const statusClass = within ? "status" : "status alert";
    return `<tr><td>${label}</td><td>${fixed(displayPower, 1)} kW</td><td>${direction === "charge" ? "-" : ""}${fixed(batteryPower, 1)} kW</td><td>${fixed(solved.current, 1)} A ${direction === "charge" ? "charge" : "draw"}</td><td>${fixed(cRate, 2)} C</td><td>${fixed(solved.lossKw, 2)} kW</td><td>${fixed(solved.terminalVoltage, 1)} V</td><td><span class="${statusClass}">${within ? "within" : "exceeds"} ${fixed(limit, 0)} A ${limitLabel}</span></td></tr>`;
  }

  function updateElectricalArchitecture() {
    if (!byId("panel-electrical")) return;
    const powertrainLink = syncPowertrainInputs();
    const ns = Math.max(1, Math.round(value("elecSeriesCells")));
    const np = Math.max(1, Math.round(value("elecParallelCells")));
    const cellNominal = value("elecCellNominalV");
    const cellMinimum = value("elecCellMinV");
    const cellMaximum = value("elecCellMaxV");
    const cellCapacity = value("elecCellCapacityAh");
    const packAh = cellCapacity * np;
    const vNom = cellNominal * ns;
    const vMin = cellMinimum * ns;
    const vMax = cellMaximum * ns;
    const grossEnergy = vNom * packAh / 1000;
    const socWindow = clamp(value("elecSocMax") - value("elecSocMin"), 0, 100) / 100;
    const usableEnergy = grossEnergy * socWindow;
    const cellResistance = value("elecCellResistance") / 1000;
    const packResistance = cellResistance * ns / np + value("elecInterconnectResistance") / 1000;
    const continuousCurrentLimit = packAh * value("elecCellContinuousC");
    const peakCurrentLimit = packAh * value("elecCellPeakC");
    const chargeCurrentLimit = packAh * value("elecCellChargeC");
    const motorPeakPower = value("elecMotorPeakTorque") * value("elecMotorBaseRpm") * 2 * Math.PI / 60 / 1000;
    const tractionEfficiency = clamp(value("elecMotorEfficiency") / 100, .01, 1) * clamp(value("elecInverterEfficiency") / 100, .01, 1);
    const peakBatteryPower = motorPeakPower / tractionEfficiency;
    const continuousBatteryPower = value("elecMotorContinuousPower") / tractionEfficiency;
    const cruiseBatteryPower = value("elecCruisePower") / tractionEfficiency;
    const regenBatteryPower = value("elecRegenPower") * tractionEfficiency;
    const peak = solveDischarge(peakBatteryPower, vNom, packResistance);
    const continuous = solveDischarge(continuousBatteryPower, vNom, packResistance);
    const cruise = solveDischarge(cruiseBatteryPower, vNom, packResistance);
    const regen = solveCharge(regenBatteryPower, vNom, packResistance);

    const acPhases = Math.round(value("elecAcPhases")) === 3 ? 3 : 1;
    const acSupplyPower = value("elecAcVoltage") * value("elecAcCurrent") * value("elecAcPowerFactor") * (acPhases === 3 ? Math.sqrt(3) : 1) / 1000;
    const acWallPower = Math.min(value("elecObcRating"), acSupplyPower);
    const acPackPower = acWallPower * value("elecObcEfficiency") / 100;
    const acCharge = solveCharge(acPackPower, vNom, packResistance);
    const dcPowerAtPack = Math.min(value("elecDcChargeRating") * value("elecDcChargeEfficiency") / 100, vNom * chargeCurrentLimit / 1000);
    const dcCharge = solveCharge(dcPowerAtPack, vNom, packResistance);
    const chargeEnergy = grossEnergy * clamp(value("elecChargeEndSoc") - value("elecChargeStartSoc"), 0, 100) / 100;
    const taperFactor = Math.max(1, value("elecChargeTaperFactor"));
    const acChargeTime = acPackPower > 0 ? chargeEnergy / acPackPower * taperFactor : Infinity;
    const dcChargeTime = dcPowerAtPack > 0 ? chargeEnergy / dcPowerAtPack * taperFactor : Infinity;
    const calculatedRange = value("elecConsumption") > 0 ? usableEnergy * 1000 / value("elecConsumption") : 0;

    const lvContinuous = value("elecLightingLoad") + value("elecControlLoad") + value("elecCoolingLoad") + value("elecAccessoryLoad");
    const lvPeak = lvContinuous + value("elecTransientLvLoad");
    const dcdcHeadroom = value("elecDcdcRating") - lvContinuous;
    const lvBackupHours = lvContinuous > 0 ? value("elecLvVoltage") * value("elecLvBatteryAh") * .8 / lvContinuous : Infinity;

    const material = byId("elecCableMaterial")?.value || "copper";
    const resistivity20 = material === "aluminium" ? .0282 : .01724;
    const temperatureCoefficient = material === "aluminium" ? .00403 : .00393;
    const resistivityAtTemperature = resistivity20 * (1 + temperatureCoefficient * (value("elecCableTemperature") - 20));
    const conductorArea = Math.max(.01, value("elecCableArea") * Math.max(1, value("elecCableParallel")));
    const cableResistance = resistivityAtTemperature * 2 * value("elecCableLength") / conductorArea;
    const cableDesignCurrent = Math.max(peak.current, dcCharge.current);
    const cableDrop = cableDesignCurrent * cableResistance;
    const cableLoss = cableDesignCurrent ** 2 * cableResistance / 1000;
    const cableDropPercent = vNom > 0 ? cableDrop / vNom * 100 : 0;
    const currentDensity = cableDesignCurrent / conductorArea;
    const isolationRatio = vMax > 0 ? value("elecMeasuredIsolation") * 1000 / vMax : 0;
    const continuousDesignCurrent = Math.max(continuous.current, cruise.current, acCharge.current, dcCharge.current);
    const fuseDesign = roundUp(continuousDesignCurrent * value("elecFuseMargin"), 5);
    const contactorDesign = roundUp(Math.max(peak.current, dcCharge.current) * value("elecContactorMargin"), 5);

    const busCapacitance = value("elecBusCapacitance") * 1e-6;
    const prechargeCurrent = Math.max(.001, value("elecPrechargeCurrent"));
    const prechargeResistance = vMax / prechargeCurrent;
    const prechargeFraction = clamp(value("elecPrechargeTarget") / 100, .01, .999);
    const prechargeTime = -prechargeResistance * busCapacitance * Math.log(1 - prechargeFraction);
    const prechargeInitialPower = vMax * prechargeCurrent;
    const prechargeEnergy = .5 * busCapacitance * vMax ** 2;

    const gliderMass = value("elecGliderMass");
    const packMass = value("elecPackMass");
    const motorMass = value("elecMotorMass");
    const inverterMass = value("elecInverterMass");
    const ancillaryMass = value("elecAncillaryMass");
    const electricalMass = packMass + motorMass + inverterMass + ancillaryMass;
    const vehicleMass = gliderMass + electricalMass;
    const electricalCgX = electricalMass > 0 ? (packMass * value("elecPackX") + motorMass * value("elecMotorX") + inverterMass * value("elecInverterX") + ancillaryMass * value("elecAncillaryX")) / electricalMass : 0;
    const electricalCgY = electricalMass > 0 ? (packMass * value("elecPackY") + motorMass * value("elecMotorY") + inverterMass * value("elecInverterY") + ancillaryMass * value("elecAncillaryY")) / electricalMass : 0;
    const vehicleCgX = vehicleMass > 0 ? (gliderMass * value("elecGliderCgX") + electricalMass * electricalCgX) / vehicleMass : 0;
    const vehicleCgY = vehicleMass > 0 ? (gliderMass * value("elecGliderCgY") + electricalMass * electricalCgY) / vehicleMass : 0;
    const packVolumeLitres = value("elecPackLength") * value("elecPackHeight") * value("elecPackWidth") / 1e6;
    const gravimetricEnergy = packMass > 0 ? grossEnergy * 1000 / packMass : 0;
    const volumetricEnergy = packVolumeLitres > 0 ? grossEnergy * 1000 / packVolumeLitres : 0;
    const stanceTargetMass = value("vehicleMass");

    const warnings = [];
    const severe = [];
    if (value("elecSocMax") <= value("elecSocMin")) severe.push("Normal maximum SOC must be higher than normal minimum SOC.");
    if (!(cellMinimum < cellNominal && cellNominal < cellMaximum)) severe.push("Cell voltage ordering must satisfy minimum < nominal < maximum.");
    if (peak.impossible) severe.push("Peak power exceeds the maximum deliverable power of the entered open-circuit voltage and lumped pack resistance.");
    if (peak.current > peakCurrentLimit) severe.push(`Peak traction needs ${fixed(peak.current, 0)} A, above the entered ${fixed(peakCurrentLimit, 0)} A cell-limited peak.`);
    if (continuous.current > continuousCurrentLimit) severe.push(`Continuous traction needs ${fixed(continuous.current, 0)} A, above the entered ${fixed(continuousCurrentLimit, 0)} A continuous discharge limit.`);
    if (peak.terminalVoltage < vMin) severe.push(`Peak loaded bus voltage falls below the entered pack minimum of ${fixed(vMin, 0)} V.`);
    if (dcCharge.current > chargeCurrentLimit + 1e-6) severe.push(`DC charging exceeds the entered cell charge-current limit of ${fixed(chargeCurrentLimit, 0)} A.`);
    if (currentDensity > value("elecCurrentDensityScreen")) warnings.push(`Peak conductor current density is ${fixed(currentDensity, 1)} A/mm2, above the entered ${fixed(value("elecCurrentDensityScreen"), 1)} A/mm2 screen.`);
    if (isolationRatio < value("elecIsolationTarget")) severe.push(`Isolation is ${fixed(isolationRatio, 0)} ohm/V, below the entered project target of ${fixed(value("elecIsolationTarget"), 0)} ohm/V.`);
    if (lvPeak > value("elecDcdcRating")) warnings.push(`Peak LV load exceeds the DC/DC continuous rating by ${fixed(lvPeak - value("elecDcdcRating"), 0)} W; check transient capability and LV battery support.`);
    if (value("elecMotorContinuousPower") > motorPeakPower) warnings.push("Entered continuous motor power is above the torque-at-base-speed peak-power point.");
    if (powertrainLink.linked && powertrainLink.model !== "electric") warnings.push("Powertrain linkage is active, but the Powertrain tab is not using its electric torque model.");
    if (vMax > 60) warnings.push(`The maximum pack voltage is ${fixed(vMax, 0)} V DC. Treat the design as a high-voltage electric powertrain and apply the required shock-protection, interlock and service procedures.`);
    if (!warnings.length && !severe.length) warnings.push("All calculated operating points are within the limits entered in this module. Compliance and component qualification still require test evidence.");

    putHtml("elecVoltageOut", `${fixed(vNom, 0)} / ${fixed(vMax, 0)}<small>V</small>`);
    putHtml("elecEnergyOut", `${fixed(grossEnergy, 1)} / ${fixed(usableEnergy, 1)}<small>kWh</small>`);
    putHtml("elecPeakCurrentOut", `${fixed(peak.current, 0)}<small>A</small>`);
    putHtml("elecLoadedVoltageOut", `${fixed(peak.terminalVoltage, 0)}<small>V</small>`);
    putHtml("elecBatteryHeatOut", `${fixed(peak.lossKw, 1)}<small>kW</small>`);
    putHtml("elecRangeOut", `${fixed(calculatedRange, 0)}<small>km</small>`);
    putHtml("elecAcChargeTimeOut", `${Number.isFinite(acChargeTime) ? fixed(acChargeTime, 1) : "-"}<small>h</small>`);
    putHtml("elecVehicleMassOut", `${fixed(vehicleMass, 0)}<small>kg</small>`);

    put("elecCellCountOut", `${ns}S x ${np}P / ${ns * np} cells`);
    put("elecCapacityOut", `${fixed(packAh, 1)} Ah`);
    put("elecVoltageRangeOut", `${fixed(vMin, 1)} / ${fixed(vNom, 1)} / ${fixed(vMax, 1)} V`);
    put("elecPackResistanceOut", `${fixed(packResistance * 1000, 2)} mOhm`);
    put("elecDischargeLimitOut", `${fixed(continuousCurrentLimit, 0)} / ${fixed(peakCurrentLimit, 0)} A`);
    put("elecChargeLimitOut", `${fixed(chargeCurrentLimit, 0)} A (${fixed(value("elecCellChargeC"), 2)} C)`);
    put("elecEnergyDensityOut", `${fixed(gravimetricEnergy, 0)} Wh/kg / ${fixed(volumetricEnergy, 0)} Wh/L`);
    setStatus("elecPackStatus", severe.length ? "Limit exceeded" : "Entered limits", severe.length ? "alert" : "ok");

    const alertList = byId("elecAlertList");
    if (alertList) {
      alertList.innerHTML = [
        ...severe.map((message) => `<li class="alert">${message}</li>`),
        ...warnings.map((message) => `<li class="${message.startsWith("All calculated") ? "" : "warn"}">${message}</li>`)
      ].join("");
    }
    setStatus("elecSystemStatus", severe.length ? `${severe.length} limit${severe.length === 1 ? "" : "s"}` : warnings.length > 1 || !warnings[0]?.startsWith("All calculated") ? "Review notes" : "Within inputs", severe.length ? "alert" : warnings.length > 1 || !warnings[0]?.startsWith("All calculated") ? "warn" : "ok");

    const loadRows = byId("elecLoadCaseRows");
    if (loadRows) {
      loadRows.innerHTML = [
        loadCaseRow("Peak traction", "discharge", motorPeakPower, peakBatteryPower, peak, packAh, peakCurrentLimit, "peak"),
        loadCaseRow("Continuous traction", "discharge", value("elecMotorContinuousPower"), continuousBatteryPower, continuous, packAh, continuousCurrentLimit, "continuous"),
        loadCaseRow("Cruise", "discharge", value("elecCruisePower"), cruiseBatteryPower, cruise, packAh, continuousCurrentLimit, "continuous"),
        loadCaseRow("Maximum regen", "charge", value("elecRegenPower"), regenBatteryPower, regen, packAh, chargeCurrentLimit, "charge"),
        loadCaseRow("AC charging", "charge", acWallPower, acPackPower, acCharge, packAh, chargeCurrentLimit, "charge"),
        loadCaseRow("DC charging", "charge", value("elecDcChargeRating"), dcPowerAtPack, dcCharge, packAh, chargeCurrentLimit, "charge")
      ].join("");
    }

    put("elecCableResistanceOut", `${fixed(cableResistance * 1000, 3)} mOhm`);
    put("elecCableDropOut", `${fixed(cableDrop, 2)} V / ${fixed(cableDropPercent, 2)}%`);
    put("elecCableLossOut", `${fixed(cableLoss, 2)} kW at ${fixed(cableDesignCurrent, 0)} A`);
    put("elecCurrentDensityOut", `${fixed(currentDensity, 2)} A/mm2`);
    put("elecIsolationOut", `${fixed(value("elecMeasuredIsolation"), 0)} kOhm / ${fixed(isolationRatio, 0)} ohm/V versus ${fixed(value("elecIsolationTarget"), 0)} ohm/V`);
    put("elecFuseOut", `>= ${fixed(fuseDesign, 0)} A continuous design point`);
    put("elecContactorOut", `>= ${fixed(contactorDesign, 0)} A peak design point`);
    setStatus("elecCableStatus", currentDensity > value("elecCurrentDensityScreen") ? "Above screen" : "Resistive screen", currentDensity > value("elecCurrentDensityScreen") ? "warn" : "ok");

    put("elecPrechargeResistanceOut", `${fixed(prechargeResistance, 1)} ohm`);
    put("elecPrechargeTimeOut", `${fixed(prechargeTime, 3)} s to ${fixed(prechargeFraction * 100, 1)}%`);
    put("elecPrechargePowerOut", `${fixed(prechargeInitialPower, 0)} W at connection`);
    put("elecPrechargeEnergyOut", `${fixed(prechargeEnergy, 1)} J per event`);

    put("elecAcPowerOut", `${fixed(acWallPower, 2)} kW wall / ${fixed(acPackPower, 2)} kW pack`);
    put("elecAcTimeDetailOut", `${Number.isFinite(acChargeTime) ? fixed(acChargeTime, 2) : "-"} h (${fixed(value("elecChargeStartSoc"), 0)}-${fixed(value("elecChargeEndSoc"), 0)}% SOC)`);
    put("elecDcChargeOut", `${fixed(dcPowerAtPack, 1)} kW / ${Number.isFinite(dcChargeTime) ? fixed(dcChargeTime, 2) : "-"} h`);
    put("elecLvLoadOut", `${fixed(lvContinuous, 0)} / ${fixed(lvPeak, 0)} W`);
    put("elecDcdcHeadroomOut", `${signed(dcdcHeadroom, 0)} W / ${fixed(value("elecDcdcRating") > 0 ? dcdcHeadroom / value("elecDcdcRating") * 100 : 0, 1)}%`);
    put("elecLvBackupOut", `${Number.isFinite(lvBackupHours) ? fixed(lvBackupHours, 2) : "-"} h at 80% usable`);
    setStatus("elecLvStatus", lvPeak > value("elecDcdcRating") ? "Peak support needed" : dcdcHeadroom < value("elecDcdcRating") * .2 ? "Low headroom" : "Load budget", lvPeak > value("elecDcdcRating") ? "warn" : dcdcHeadroom < value("elecDcdcRating") * .2 ? "warn" : "ok");

    put("elecSystemMassOut", `${fixed(electricalMass, 1)} kg`);
    put("elecSystemCgOut", `${fixed(electricalCgX, 1)}, ${fixed(electricalCgY, 1)} mm`);
    put("elecVehicleCgOut", `${fixed(vehicleCgX, 1)}, ${fixed(vehicleCgY, 1)} mm`);
    put("elecMassDeltaOut", `${signed(vehicleMass - stanceTargetMass, 1)} kg versus ${fixed(stanceTargetMass, 1)} kg target`);
    put("elecPackVolumeOut", `${fixed(packVolumeLitres, 1)} L`);

    const state = {
      ns, np, packAh, vNom, vMin, vMax, grossEnergy, usableEnergy, packResistance,
      peakCurrentLimit, continuousCurrentLimit, chargeCurrentLimit, motorPeakPower,
      peak, continuous, cruise, regen, acPhases, acWallPower, acPackPower,
      dcPowerAtPack, lvContinuous, lvPeak, fuseDesign, contactorDesign, isolationRatio,
      gliderMass, gliderCgX: value("elecGliderCgX"), gliderCgY: value("elecGliderCgY"),
      packMass, packX: value("elecPackX"), packY: value("elecPackY"),
      packLength: value("elecPackLength"), packHeight: value("elecPackHeight"), packWidth: value("elecPackWidth"),
      motorMass, motorX: value("elecMotorX"), motorY: value("elecMotorY"), motorDiameter: value("elecMotorDiameter"),
      inverterMass, inverterX: value("elecInverterX"), inverterY: value("elecInverterY"),
      ancillaryMass, ancillaryX: value("elecAncillaryX"), ancillaryY: value("elecAncillaryY"),
      electricalMass, electricalCgX, electricalCgY, vehicleMass, vehicleCgX, vehicleCgY
    };
    window.__motoElectricalState = state;
    drawArchitecture(state);
    drawPackaging(state);
  }

  all(".elec-input").forEach((input) => input.addEventListener(input.tagName === "SELECT" ? "change" : "input", updateElectricalArchitecture));
  all(".electrical-preset").forEach((button) => button.addEventListener("click", () => applyPreset(button.dataset.electrical)));
  byId("elecCellChemistry")?.addEventListener("change", () => { applyChemistryDefaults(); updateElectricalArchitecture(); });
  byId("tab-electrical")?.addEventListener("click", () => requestAnimationFrame(updateElectricalArchitecture));
  ["ptEngineTorque", "ptPeakTorqueRpm", "ptMaxRpm", "ptPowerUnitModel", "vehicleWheelbase", "vehicleMass", "seatHeight", "seatPivotX", "wcx", "wcy", "frontTyreRadius", "rearTyreRadius"].forEach((id) => {
    const input = byId(id);
    if (input) input.addEventListener(input.tagName === "SELECT" ? "change" : "input", updateElectricalArchitecture);
  });
  all(".stance-preset,.steer-preset").forEach((button) => button.addEventListener("click", () => setTimeout(updateElectricalArchitecture, 0)));
  window.addEventListener("resize", updateElectricalArchitecture);
  window.updateElectricalArchitecture = updateElectricalArchitecture;
  updateElectricalArchitecture();
})();
