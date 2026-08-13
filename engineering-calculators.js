(function () {
  "use strict";

  const byId = (id) => document.getElementById(id);
  const value = (id, fallback = 0) => {
    const parsed = Number.parseFloat(byId(id)?.value);
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const setValue = (id, next, digits = null) => {
    const element = byId(id);
    if (!element || !Number.isFinite(next)) return;
    element.value = digits === null ? String(next) : next.toFixed(digits);
  };
  const put = (id, text) => {
    const element = byId(id);
    if (element) element.textContent = text;
  };
  const putHtml = (id, html) => {
    const element = byId(id);
    if (element) element.innerHTML = html;
  };
  const finitePositive = (...numbers) => numbers.every((number) => Number.isFinite(number) && number > 0);
  const format = (number, digits = 1) => Number.isFinite(number)
    ? number.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    : "-";
  const signed = (number, digits = 1, unit = "") => Number.isFinite(number)
    ? `${number >= 0 ? "+" : ""}${format(number, digits)}${unit}`
    : "-";
  const timeText = (hours) => {
    if (!Number.isFinite(hours) || hours < 0) return "-";
    if (hours < 1 / 60) return `${format(hours * 3600, 0)} s`;
    if (hours < 1) return `${format(hours * 60, 1)} min`;
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    return minutes >= 60 ? `${wholeHours + 1} h` : `${wholeHours} h ${minutes} min`;
  };
  const setStatus = (id, text, type = "") => {
    const element = byId(id);
    if (!element) return;
    element.textContent = text;
    element.classList.remove("good", "warn", "bad");
    if (type) element.classList.add(type);
  };
  const setWarnings = (id, messages) => {
    const element = byId(id);
    if (!element) return;
    element.replaceChildren(...messages.map(({ text, level = "" }) => {
      const item = document.createElement("li");
      item.textContent = text;
      if (level) item.className = level;
      return item;
    }));
  };

  function setLinkedState(selector, linked) {
    document.querySelectorAll(selector).forEach((element) => {
      if (element.tagName === "SELECT") element.disabled = linked;
      else element.readOnly = linked;
      element.setAttribute("aria-readonly", String(linked));
    });
  }

  function syncVehicleInputs() {
    if (byId("vcSource")?.value !== "linked") return;
    const gearCount = Math.max(1, Math.round(value("ptGearCount", 6)));
    const gearSelector = byId("vcGearIndex");
    if (gearSelector && value("vcGearIndex", gearCount) > gearCount) gearSelector.value = String(gearCount);
    const gearIndex = Math.max(1, Math.min(gearCount, Math.round(value("vcGearIndex", gearCount))));
    const frontTeeth = value("ptFrontSprocket");
    const rearTeeth = value("ptRearSprocket");

    setValue("vcPrimaryRatio", value("ptPrimaryRatio"), 4);
    setValue("vcGearRatio", value(`ptGear${gearIndex}`), 4);
    setValue("vcFinalRatio", frontTeeth > 0 ? rearTeeth / frontTeeth : 0, 4);
    setValue("vcEfficiency", value("ptEfficiency"), 2);
    setValue("vcRollingCirc", value("ptRollingCirc"), 1);
    setValue("vcShaftRpm", value("ptMaxRpm"), 0);
    setValue("vcShaftTorque", value("ptEngineTorque"), 2);
    setValue("vcVehicleMass", value("vehicleMass"), 1);
    put("vcLinkNote", `Live Powertrain gear ${gearIndex} of ${gearCount}; mass is linked from Stance.`);
  }

  function updateVehicleCalculators() {
    if (!byId("panel-vehicle-calculators")) return;
    const linked = byId("vcSource")?.value === "linked";
    setLinkedState(".vc-linkable", linked);
    syncVehicleInputs();

    const primary = value("vcPrimaryRatio");
    const gear = value("vcGearRatio");
    const finalDrive = value("vcFinalRatio");
    const efficiency = value("vcEfficiency") / 100;
    const circumferenceMm = value("vcRollingCirc");
    const shaftRpm = value("vcShaftRpm");
    const shaftTorque = value("vcShaftTorque");
    const targetSpeed = value("vcTargetSpeed");
    const targetPower = value("vcTargetPower");
    const mass = value("vcVehicleMass");
    const overall = primary * gear * finalDrive;
    const validDriveline = finitePositive(primary, gear, finalDrive, circumferenceMm, shaftRpm) && efficiency > 0;

    const wheelRpm = validDriveline ? shaftRpm / overall : NaN;
    const speedKmh = validDriveline ? wheelRpm * circumferenceMm * 60 / 1e6 : NaN;
    const speedMph = speedKmh * 0.621371;
    const powerKw = finitePositive(shaftRpm) && Number.isFinite(shaftTorque)
      ? shaftTorque * 2 * Math.PI * shaftRpm / 60 / 1000
      : NaN;
    const powerHp = powerKw * 1.34102209;
    const requiredRpm = finitePositive(targetSpeed, overall, circumferenceMm)
      ? targetSpeed * 1e6 * overall / (circumferenceMm * 60)
      : NaN;
    const requiredTorque = finitePositive(targetPower, shaftRpm)
      ? targetPower * 1000 / (2 * Math.PI * shaftRpm / 60)
      : NaN;
    const wheelTorque = validDriveline && Number.isFinite(shaftTorque)
      ? shaftTorque * overall * efficiency
      : NaN;
    const rollingRadiusM = circumferenceMm / (2 * Math.PI * 1000);
    const tractiveForce = finitePositive(rollingRadiusM) ? wheelTorque / rollingRadiusM : NaN;
    const wattsPerKg = finitePositive(powerKw, mass) ? powerKw * 1000 / mass : NaN;
    const kwPerTonne = wattsPerKg;
    const hpPerTonne = finitePositive(powerHp, mass) ? powerHp / (mass / 1000) : NaN;
    const kgPerKw = finitePositive(powerKw, mass) ? mass / powerKw : NaN;

    putHtml("vcSpeedOut", `${format(speedKmh, 1)}<small> km/h</small>`);
    putHtml("vcPowerOut", `${format(powerKw, 1)}<small> kW</small>`);
    putHtml("vcRpmOut", `${format(requiredRpm, 0)}<small> rpm</small>`);
    putHtml("vcTorqueOut", `${format(requiredTorque, 1)}<small> Nm</small>`);
    putHtml("vcPtwOut", `${format(wattsPerKg, 1)}<small> W/kg</small>`);
    putHtml("vcWheelRpmOut", `${format(wheelRpm, 0)}<small> rpm</small>`);
    putHtml("vcWheelTorqueOut", `${format(wheelTorque, 0)}<small> Nm</small>`);
    putHtml("vcTractiveForceOut", `${format(tractiveForce, 0)}<small> N</small>`);

    putHtml("vcSpeedAnswer", `${format(speedKmh, 2)} km/h<small>${format(speedMph, 2)} mph at ${format(shaftRpm, 0)} rpm; overall reduction ${format(overall, 4)}:1.</small>`);
    putHtml("vcPowerAnswer", `${format(powerKw, 2)} kW<small>${format(powerHp, 2)} mechanical hp from ${format(shaftTorque, 1)} Nm at ${format(shaftRpm, 0)} rpm.</small>`);
    putHtml("vcRpmAnswer", `${format(requiredRpm, 0)} rpm<small>Required for ${format(targetSpeed, 1)} km/h in the selected ratio.</small>`);
    putHtml("vcTorqueAnswer", `${format(requiredTorque, 2)} Nm<small>Required to make ${format(targetPower, 1)} kW at ${format(shaftRpm, 0)} rpm.</small>`);
    putHtml("vcPtwAnswer", `${format(wattsPerKg, 2)} W/kg<small>Uses calculated shaft power and complete vehicle mass; it does not include rider mass.</small>`);
    put("vcWattsPerKg", `${format(wattsPerKg, 2)} W/kg`);
    put("vcKwPerTonne", `${format(kwPerTonne, 2)} kW/t`);
    put("vcHpPerTonne", `${format(hpPerTonne, 2)} hp/t`);
    put("vcKgPerKw", `${format(kgPerKw, 3)} kg/kW`);

    const warnings = [];
    if (!finitePositive(primary, gear, finalDrive)) warnings.push({ text: "Primary, selected-gear and final-drive ratios must all be greater than zero.", level: "bad" });
    if (!finitePositive(circumferenceMm)) warnings.push({ text: "Loaded rolling circumference must be greater than zero.", level: "bad" });
    if (!finitePositive(shaftRpm)) warnings.push({ text: "Shaft RPM must be greater than zero for speed, power and inverse torque calculations.", level: "bad" });
    if (!(efficiency > 0 && efficiency <= 1)) warnings.push({ text: "Driveline efficiency must be between 0 and 100 percent.", level: "bad" });
    if (!finitePositive(mass)) warnings.push({ text: "Vehicle mass must be greater than zero for power-to-weight calculations.", level: "bad" });
    if (validDriveline && requiredRpm > shaftRpm) warnings.push({ text: `Target speed needs ${format(requiredRpm - shaftRpm, 0)} rpm above the entered operating speed in this ratio.`, level: "warn" });
    if (validDriveline && speedKmh > 350) warnings.push({ text: "The kinematic road speed is very high. Check circumference, ratios and units; it is not a drag-limited top speed.", level: "warn" });
    if (!warnings.length) warnings.push({ text: "All required inputs are valid. Use a loaded circumference and measured torque curve for correlation.", level: "good" });
    setWarnings("vcWarnings", warnings);
    const hasBad = warnings.some((warning) => warning.level === "bad");
    const hasWarn = warnings.some((warning) => warning.level === "warn");
    setStatus("vcStatus", hasBad ? "Input error" : hasWarn ? "Review" : "Valid", hasBad ? "bad" : hasWarn ? "warn" : "good");
    renderGearMatrix({ linked, primary, finalDrive, efficiency, circumferenceMm, shaftRpm, shaftTorque });
  }

  function renderGearMatrix(inputs) {
    const body = byId("vcGearRows");
    if (!body) return;
    const gearCount = inputs.linked ? Math.max(1, Math.min(7, Math.round(value("ptGearCount", 6)))) : 1;
    const selectedGear = Math.round(value("vcGearIndex", 1));
    const ratios = inputs.linked
      ? Array.from({ length: gearCount }, (_, index) => value(`ptGear${index + 1}`))
      : [value("vcGearRatio")];
    const radiusM = inputs.circumferenceMm / (2 * Math.PI * 1000);
    body.replaceChildren(...ratios.map((ratio, index) => {
      const overall = inputs.primary * ratio * inputs.finalDrive;
      const wheelRpm = finitePositive(overall) ? inputs.shaftRpm / overall : NaN;
      const speed = finitePositive(inputs.circumferenceMm) ? wheelRpm * inputs.circumferenceMm * 60 / 1e6 : NaN;
      const wheelTorque = inputs.shaftTorque * overall * inputs.efficiency;
      const force = finitePositive(radiusM) ? wheelTorque / radiusM : NaN;
      const row = document.createElement("tr");
      const gearLabel = inputs.linked ? `${index + 1}${index + 1 === selectedGear ? " (selected)" : ""}` : "Selected";
      [gearLabel, format(ratio, 4), format(overall, 4), `${format(wheelRpm, 0)} rpm`, `${format(speed, 1)} km/h`, `${format(wheelTorque, 0)} Nm`, `${format(force, 0)} N`]
        .forEach((cellText) => {
          const cell = document.createElement("td");
          cell.textContent = cellText;
          row.appendChild(cell);
        });
      return row;
    }));
  }

  function syncBatteryInputs() {
    if (byId("bcSource")?.value !== "linked") return;
    const series = Math.max(1, Math.round(value("elecSeriesCells", 1)));
    const parallel = Math.max(1, Math.round(value("elecParallelCells", 1)));
    const cellNominal = value("elecCellNominalV");
    const cellAh = value("elecCellCapacityAh");
    const linkedValues = {
      bcPackVoltage: series * cellNominal,
      bcPackAh: parallel * cellAh,
      bcSocMin: value("elecSocMin"),
      bcSocMax: value("elecSocMax"),
      bcConsumption: value("elecConsumption"),
      bcCellNominalV: cellNominal,
      bcCellMinV: value("elecCellMinV"),
      bcCellMaxV: value("elecCellMaxV"),
      bcCellAh: cellAh,
      bcChargeStartSoc: value("elecChargeStartSoc"),
      bcChargeEndSoc: value("elecChargeEndSoc"),
      bcChargerRating: value("elecObcRating"),
      bcChargeEfficiency: value("elecObcEfficiency"),
      bcChargeTaper: value("elecChargeTaperFactor"),
      bcCellChargeC: value("elecCellChargeC"),
      bcSupplyPhases: value("elecAcPhases", 1),
      bcSupplyVoltage: value("elecAcVoltage"),
      bcSupplyCurrent: value("elecAcCurrent"),
      bcSupplyPowerFactor: value("elecAcPowerFactor", 1),
    };
    Object.entries(linkedValues).forEach(([id, next]) => setValue(id, next, id === "bcSupplyPhases" ? null : 2));
    put("bcLinkNote", `${series}S${parallel}P live link: ${format(series * cellNominal, 1)} V nominal, ${format(parallel * cellAh, 1)} Ah.`);
  }

  function updateBatteryCalculators() {
    if (!byId("panel-battery-calculators")) return;
    const linked = byId("bcSource")?.value === "linked";
    setLinkedState(".bc-linkable", linked);
    syncBatteryInputs();

    const packVoltage = value("bcPackVoltage");
    const packAh = value("bcPackAh");
    const socMin = value("bcSocMin");
    const socMax = value("bcSocMax");
    const dischargeEfficiency = value("bcDischargeEfficiency") / 100;
    const consumption = value("bcConsumption");
    const loadPower = value("bcRequiredLoadPower");
    const requiredRuntime = value("bcRequiredRuntime");
    const reserveFactor = 1 + value("bcReservePercent") / 100;
    const socFraction = Math.max(0, (socMax - socMin) / 100);
    const grossEnergy = packVoltage * packAh / 1000;
    const usableStoredEnergy = grossEnergy * socFraction;
    const deliveredEnergy = usableStoredEnergy * dischargeEfficiency;
    const requirementAtLoad = loadPower * requiredRuntime;
    const requiredGrossEnergy = finitePositive(dischargeEfficiency, socFraction)
      ? requirementAtLoad * reserveFactor / (dischargeEfficiency * socFraction)
      : NaN;
    const requiredAh = finitePositive(requiredGrossEnergy, packVoltage) ? requiredGrossEnergy * 1000 / packVoltage : NaN;
    const rangeKm = finitePositive(deliveredEnergy, consumption) ? deliveredEnergy * 1000 / consumption : NaN;

    const cellNominal = value("bcCellNominalV");
    const cellMin = value("bcCellMinV");
    const cellMax = value("bcCellMaxV");
    const cellAh = value("bcCellAh");
    const targetVoltage = value("bcTargetVoltage");
    const targetEnergy = value("bcTargetEnergy");
    const rawSeries = targetVoltage / cellNominal;
    const rounding = byId("bcSeriesMethod")?.value || "ceil";
    const seriesCells = Math.max(1, rounding === "floor" ? Math.floor(rawSeries) : rounding === "nearest" ? Math.round(rawSeries) : Math.ceil(rawSeries));
    const stringEnergy = seriesCells * cellNominal * cellAh / 1000;
    const parallelCells = Math.max(1, Math.ceil(targetEnergy / stringEnergy));
    const totalCells = seriesCells * parallelCells;
    const designedAh = parallelCells * cellAh;
    const designedNominalVoltage = seriesCells * cellNominal;
    const designedMinVoltage = seriesCells * cellMin;
    const designedMaxVoltage = seriesCells * cellMax;
    const designedEnergy = designedNominalVoltage * designedAh / 1000;
    const voltageDelta = designedNominalVoltage - targetVoltage;
    const energyMargin = designedEnergy - targetEnergy;

    const chargeStart = value("bcChargeStartSoc");
    const chargeEnd = value("bcChargeEndSoc");
    const chargeFraction = Math.max(0, (chargeEnd - chargeStart) / 100);
    const chargerRating = value("bcChargerRating");
    const chargeEfficiency = value("bcChargeEfficiency") / 100;
    const taperFactor = value("bcChargeTaper");
    const cellChargeC = value("bcCellChargeC");
    const phases = Math.round(value("bcSupplyPhases", 1));
    const supplyVoltage = value("bcSupplyVoltage");
    const supplyCurrent = value("bcSupplyCurrent");
    const powerFactor = value("bcSupplyPowerFactor");
    const supplyFactor = phases === 3 ? Math.sqrt(3) : 1;
    const supplyPower = supplyFactor * supplyVoltage * supplyCurrent * powerFactor / 1000;
    const packChargeLimit = packVoltage * packAh * cellChargeC / 1000;
    const acLimitedPower = Math.min(chargerRating, supplyPower);
    const effectivePackChargePower = Math.min(acLimitedPower * chargeEfficiency, packChargeLimit);
    const chargeEnergy = grossEnergy * chargeFraction;
    const chargeTime = finitePositive(chargeEnergy, effectivePackChargePower) ? chargeEnergy / effectivePackChargePower * taperFactor : NaN;
    const chargeCurrent = finitePositive(packVoltage) ? effectivePackChargePower * 1000 / packVoltage : NaN;
    const actualChargeC = finitePositive(packAh) ? chargeCurrent / packAh : NaN;

    const desiredChargeTime = value("bcDesiredChargeTime");
    const requiredPackChargePower = finitePositive(desiredChargeTime) ? chargeEnergy * taperFactor / desiredChargeTime : NaN;
    const requiredWallPower = finitePositive(chargeEfficiency) ? requiredPackChargePower / chargeEfficiency : NaN;
    const requiredSupplyCurrent = finitePositive(supplyVoltage, powerFactor)
      ? requiredWallPower * 1000 / (supplyFactor * supplyVoltage * powerFactor)
      : NaN;
    const standardChargers = [1.8, 2.3, 3.3, 3.6, 7.2, 7.4, 11, 22, 30, 50, 60, 100, 150, 200, 250, 350];
    const recommendedStandard = standardChargers.find((rating) => rating >= requiredWallPower);
    const availablePackFromSupply = supplyPower * chargeEfficiency;
    const availablePackFromCharger = chargerRating * chargeEfficiency;
    const chargeLimits = [
      { name: "AC supply", value: availablePackFromSupply },
      { name: "charger rating", value: availablePackFromCharger },
      { name: "pack charge C-rate", value: packChargeLimit },
    ];
    const governingChargeLimit = chargeLimits.reduce((lowest, candidate) => candidate.value < lowest.value ? candidate : lowest, chargeLimits[0]);
    const bestAchievablePackPower = governingChargeLimit.value;
    const bestChargeTime = finitePositive(chargeEnergy, bestAchievablePackPower) ? chargeEnergy / bestAchievablePackPower * taperFactor : NaN;
    const desiredChargeAchievable = Number.isFinite(requiredPackChargePower) && requiredPackChargePower <= bestAchievablePackPower + 1e-9;

    const dischargeCurrent = value("bcDischargeCurrent");
    const dischargePower = value("bcDischargePower");
    const averageSpeed = value("bcAverageSpeed");
    const auxiliaryPower = value("bcAuxiliaryLoad") / 1000;
    const usableAh = packAh * socFraction * dischargeEfficiency;
    const currentRuntime = finitePositive(usableAh, dischargeCurrent) ? usableAh / dischargeCurrent : NaN;
    const powerRuntime = finitePositive(deliveredEnergy, dischargePower) ? deliveredEnergy / dischargePower : NaN;
    const tractionPower = consumption * averageSpeed / 1000;
    const totalEvPower = tractionPower + auxiliaryPower;
    const evRuntime = finitePositive(deliveredEnergy, totalEvPower) ? deliveredEnergy / totalEvPower : NaN;
    const evDistance = evRuntime * averageSpeed;

    const enteredCRating = value("bcEnteredCRating");
    const requiredCRating = finitePositive(packAh) ? dischargeCurrent / packAh : NaN;
    const allowedCurrent = enteredCRating * packAh;
    const allowedPower = packVoltage * allowedCurrent / 1000;
    const currentMargin = allowedCurrent - dischargeCurrent;

    putHtml("bcRequiredCapacityOut", `${format(requiredAh, 1)}<small> Ah</small>`);
    putHtml("bcRangeOut", `${format(rangeKm, 0)}<small> km</small>`);
    putHtml("bcPackDesignOut", `${format(seriesCells, 0)}S${format(parallelCells, 0)}P<small> ${format(totalCells, 0)} cells</small>`);
    putHtml("bcChargeTimeOut", `${timeText(chargeTime)}<small> ${format(chargeStart, 0)}-${format(chargeEnd, 0)}% SOC</small>`);
    putHtml("bcDischargeTimeOut", `${timeText(currentRuntime)}<small> at ${format(dischargeCurrent, 1)} A</small>`);
    putHtml("bcEvRuntimeOut", `${timeText(evRuntime)}<small> ${format(evDistance, 0)} km</small>`);
    putHtml("bcRequiredCOut", `${format(requiredCRating, 2)}<small> C</small>`);
    putHtml("bcChargerSelectionOut", `${recommendedStandard ? `${format(recommendedStandard, 1)} kW` : ">350 kW custom"}<small> AC input rating</small>`);

    put("bcGrossEnergyOut", `${format(grossEnergy, 2)} kWh`);
    put("bcUsableEnergyOut", `${format(usableStoredEnergy, 2)} kWh (${format(socFraction * 100, 1)}% SOC window)`);
    put("bcDeliveredEnergyOut", `${format(deliveredEnergy, 2)} kWh at ${format(dischargeEfficiency * 100, 1)}% efficiency`);
    put("bcRequiredEnergyOut", `${format(requiredGrossEnergy, 2)} kWh gross`);
    put("bcRequiredAhOut", `${format(requiredAh, 2)} Ah at ${format(packVoltage, 1)} V`);
    put("bcRangeDetailOut", `${format(rangeKm, 1)} km (${format(rangeKm * 0.621371, 1)} mi)`);
    setStatus("bcCapacityStatus", grossEnergy >= requiredGrossEnergy ? "Capacity met" : "Capacity shortfall", grossEnergy >= requiredGrossEnergy ? "good" : "warn");

    put("bcCellTopologyOut", `${seriesCells}S / ${parallelCells}P / ${totalCells} cells`);
    put("bcDesignedVoltageOut", `${format(designedMinVoltage, 1)} / ${format(designedNominalVoltage, 1)} / ${format(designedMaxVoltage, 1)} V`);
    put("bcDesignedAhOut", `${format(designedAh, 2)} Ah`);
    put("bcDesignedEnergyOut", `${format(designedEnergy, 2)} kWh`);
    put("bcVoltageDeltaOut", signed(voltageDelta, 2, " V"));
    put("bcEnergyMarginOut", signed(energyMargin, 2, " kWh"));
    setStatus("bcPackStatus", designedEnergy + 1e-9 >= targetEnergy ? "Target met" : "Check topology", designedEnergy + 1e-9 >= targetEnergy ? "good" : "bad");

    put("bcChargeEnergyOut", `${format(chargeEnergy, 2)} kWh stored`);
    put("bcSupplyPowerOut", `${format(supplyPower, 2)} kW`);
    put("bcPackChargeLimitOut", `${format(packChargeLimit, 2)} kW`);
    put("bcEffectiveChargePowerOut", `${format(effectivePackChargePower, 2)} kW`);
    put("bcChargeTimeDetailOut", `${timeText(chargeTime)} (${format(chargeTime, 2)} h)`);
    put("bcChargeCurrentOut", `${format(chargeCurrent, 1)} A / ${format(actualChargeC, 2)} C`);
    setStatus("bcChargeStatus", Number.isFinite(chargeTime) ? "Calculated" : "Input error", Number.isFinite(chargeTime) ? "good" : "bad");

    put("bcRequiredPackChargePowerOut", `${format(requiredPackChargePower, 2)} kW`);
    put("bcRequiredWallPowerOut", `${format(requiredWallPower, 2)} kW`);
    put("bcRequiredSupplyCurrentOut", `${format(requiredSupplyCurrent, 1)} A ${phases === 3 ? "per phase" : "line"}`);
    put("bcRecommendedChargerOut", recommendedStandard ? `${format(recommendedStandard, 1)} kW standard step` : `${format(requiredWallPower, 1)} kW minimum; custom >350 kW`);
    put("bcChargerLimitOut", `${governingChargeLimit.name} (${format(governingChargeLimit.value, 2)} kW to pack)`);
    put("bcBestChargeTimeOut", `${timeText(bestChargeTime)} (${format(bestChargeTime, 2)} h)`);
    setStatus("bcChargerStatus", desiredChargeAchievable ? "Time achievable" : "Entered system too small", desiredChargeAchievable ? "good" : "warn");

    put("bcCurrentRuntimeOut", `${timeText(currentRuntime)} (${format(currentRuntime, 3)} h)`);
    put("bcPowerRuntimeOut", `${timeText(powerRuntime)} (${format(powerRuntime, 3)} h)`);
    put("bcEvTractionPowerOut", `${format(tractionPower, 2)} kW + ${format(auxiliaryPower, 2)} kW auxiliaries`);
    put("bcEvRuntimeDetailOut", `${timeText(evRuntime)} (${format(evRuntime, 3)} h)`);
    put("bcEvDistanceOut", `${format(evDistance, 1)} km`);
    setStatus("bcDischargeStatus", Number.isFinite(currentRuntime) && Number.isFinite(evRuntime) ? "Calculated" : "Input error", Number.isFinite(currentRuntime) && Number.isFinite(evRuntime) ? "good" : "bad");

    put("bcRequiredCRateOut", `${format(requiredCRating, 3)} C`);
    put("bcAllowedCurrentOut", `${format(allowedCurrent, 1)} A`);
    put("bcAllowedPowerOut", `${format(allowedPower, 2)} kW at nominal voltage`);
    put("bcCurrentMarginOut", `${signed(currentMargin, 1, " A")}`);
    setStatus("bcCRatingStatus", requiredCRating <= enteredCRating ? "Within limit" : "C-rate exceeded", requiredCRating <= enteredCRating ? "good" : "bad");

    const warnings = [];
    if (!finitePositive(packVoltage, packAh)) warnings.push({ text: "Pack nominal voltage and capacity must be greater than zero.", level: "bad" });
    if (!(socMax > socMin && socMin >= 0 && socMax <= 100)) warnings.push({ text: "Operating SOC maximum must exceed SOC minimum and remain within 0-100 percent.", level: "bad" });
    if (!(dischargeEfficiency > 0 && dischargeEfficiency <= 1)) warnings.push({ text: "Discharge-path efficiency must be between 0 and 100 percent.", level: "bad" });
    if (!finitePositive(consumption)) warnings.push({ text: "Vehicle consumption must be greater than zero for range and EV runtime.", level: "bad" });
    if (!(cellMin > 0 && cellMin < cellNominal && cellNominal < cellMax)) warnings.push({ text: "Cell voltages should satisfy minimum < nominal < maximum.", level: "bad" });
    if (!(chargeEnd > chargeStart && chargeStart >= 0 && chargeEnd <= 100)) warnings.push({ text: "Charge end SOC must exceed start SOC and remain within 0-100 percent.", level: "bad" });
    if (grossEnergy < requiredGrossEnergy) warnings.push({ text: `Current pack is ${format(requiredGrossEnergy - grossEnergy, 2)} kWh below the entered capacity requirement.`, level: "warn" });
    if (!desiredChargeAchievable) warnings.push({ text: `Desired charge time needs ${format(requiredPackChargePower, 2)} kW to the pack, above the ${governingChargeLimit.name} limit.`, level: "warn" });
    if (requiredCRating > enteredCRating) warnings.push({ text: `Entered discharge case exceeds the allowable C-rate by ${format(requiredCRating - enteredCRating, 2)} C.`, level: "bad" });
    if (linked && !byId("elecSeriesCells")) warnings.push({ text: "Electrical Architecture inputs were not found; switch to manual mode.", level: "bad" });
    if (!warnings.length) warnings.push({ text: "All arithmetic and entered screening limits pass. Validate with cell maps, BMS limits, thermal analysis and ageing cases before design release.", level: "good" });
    setWarnings("bcWarnings", warnings);
    const hasBad = warnings.some((warning) => warning.level === "bad");
    const hasWarn = warnings.some((warning) => warning.level === "warn");
    setStatus("bcOverallStatus", hasBad ? "Failed checks" : hasWarn ? "Review margins" : "Inputs consistent", hasBad ? "bad" : hasWarn ? "warn" : "good");
  }

  function updateAll() {
    updateVehicleCalculators();
    updateBatteryCalculators();
  }

  function bind() {
    if (!byId("panel-vehicle-calculators") || !byId("panel-battery-calculators")) return;
    document.querySelectorAll(".vc-input").forEach((element) => {
      element.addEventListener(element.tagName === "SELECT" ? "change" : "input", updateVehicleCalculators);
    });
    document.querySelectorAll(".bc-input").forEach((element) => {
      element.addEventListener(element.tagName === "SELECT" ? "change" : "input", updateBatteryCalculators);
    });
    byId("vcLoadLinked")?.addEventListener("click", () => {
      byId("vcSource").value = "linked";
      updateVehicleCalculators();
    });
    byId("vcUseTopGear")?.addEventListener("click", () => {
      byId("vcGearIndex").value = String(Math.max(1, Math.min(7, Math.round(value("ptGearCount", 6)))));
      updateVehicleCalculators();
    });
    byId("bcLoadElectrical")?.addEventListener("click", () => {
      byId("bcSource").value = "linked";
      updateBatteryCalculators();
    });
    byId("bcManualMode")?.addEventListener("click", () => {
      byId("bcSource").value = "manual";
      updateBatteryCalculators();
    });
    const linkedVehicleIds = new Set(["ptPrimaryRatio", "ptGearCount", "ptFrontSprocket", "ptRearSprocket", "ptEfficiency", "ptRollingCirc", "ptMaxRpm", "ptEngineTorque", "vehicleMass", "ptGear1", "ptGear2", "ptGear3", "ptGear4", "ptGear5", "ptGear6", "ptGear7"]);
    document.addEventListener("input", (event) => {
      if (linkedVehicleIds.has(event.target?.id) && byId("vcSource")?.value === "linked") updateVehicleCalculators();
      if (event.target?.id?.startsWith("elec") && byId("bcSource")?.value === "linked") updateBatteryCalculators();
    }, true);
    document.addEventListener("change", (event) => {
      if (linkedVehicleIds.has(event.target?.id) && byId("vcSource")?.value === "linked") updateVehicleCalculators();
      if (event.target?.id?.startsWith("elec") && byId("bcSource")?.value === "linked") updateBatteryCalculators();
    }, true);
    window.updateEngineeringCalculators = updateAll;
    updateAll();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", bind, { once: true });
  else bind();
})();
