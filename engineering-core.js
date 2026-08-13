(function (global) {
  "use strict";

  const G = 9.80665;
  const RHO_COPPER = 1.724e-8;
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const rad = degrees => degrees * Math.PI / 180;
  const deg = radians => radians * 180 / Math.PI;
  const finite = (...values) => values.every(Number.isFinite);
  const round = (value, digits = 3) => Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

  function result(value, unit, definition, extra = {}) {
    const valid = value !== null && value !== undefined && (typeof value !== "number" || Number.isFinite(value));
    return {
      value: valid ? value : null,
      unit,
      definition,
      runtime: valid ? "current" : "failed",
      assessment: valid ? "not_evaluated" : "conflict_invalid",
      evidence: extra.evidence || [],
      ...extra
    };
  }

  function invalid(message, fields = []) {
    return { ok: false, error: message, fields };
  }

  function tyre(widthMm, aspectPercent, rimInches) {
    if (![widthMm, aspectPercent, rimInches].every(v => v > 0)) return invalid("Tyre dimensions must be positive.");
    const sidewall = widthMm * aspectPercent / 100;
    const diameter = rimInches * 25.4 + 2 * sidewall;
    return { ok: true, width: widthMm, sidewall, rimDiameter: rimInches * 25.4, diameter, radius: diameter / 2, circumference: Math.PI * diameter };
  }

  function angleBetween(a, b) {
    const denominator = Math.hypot(a.x, a.z) * Math.hypot(b.x, b.z);
    if (denominator <= 1e-9) return null;
    return deg(Math.acos(clamp((a.x * b.x + a.z * b.z) / denominator, -1, 1)));
  }

  function circleIntersections(a, radiusA, b, radiusB) {
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= 1e-9 || distance > radiusA + radiusB || distance < Math.abs(radiusA - radiusB)) return [];
    const along = (radiusA * radiusA - radiusB * radiusB + distance * distance) / (2 * distance);
    const height = Math.sqrt(Math.max(0, radiusA * radiusA - along * along));
    const base = { x: a.x + along * dx / distance, z: a.z + along * dz / distance };
    const perpendicular = { x: -dz / distance, z: dx / distance };
    return [
      { x: base.x + height * perpendicular.x, z: base.z + height * perpendicular.z },
      { x: base.x - height * perpendicular.x, z: base.z - height * perpendicular.z }
    ];
  }

  function ergonomics(state) {
    const s = state.stance;
    const hip = { x: Number(s.seatX), z: Number(s.seatZ) };
    const grip = { x: Number(s.gripX), z: Number(s.gripZ) };
    const peg = { x: Number(s.pegX), z: Number(s.pegZ) };
    const lean = rad(Number(s.torsoLean));
    const shoulder = {
      x: hip.x + Number(s.torsoLength) * Math.sin(lean),
      z: hip.z + Number(s.torsoLength) * Math.cos(lean)
    };
    const elbows = circleIntersections(shoulder, Number(s.upperArmLength), grip, Number(s.forearmLength));
    const knees = circleIntersections(hip, Number(s.thighLength), peg, Number(s.shinLength));
    if (!elbows.length || !knees.length) return invalid("The entered rider segments cannot reach the grip or footpeg hardpoints.");
    const elbow = elbows.sort((a, b) => a.z - b.z)[0];
    const knee = knees.sort((a, b) => b.x - a.x)[0];
    const elbowAngle = angleBetween({ x: shoulder.x - elbow.x, z: shoulder.z - elbow.z }, { x: grip.x - elbow.x, z: grip.z - elbow.z });
    const kneeAngle = angleBetween({ x: hip.x - knee.x, z: hip.z - knee.z }, { x: peg.x - knee.x, z: peg.z - knee.z });
    const hipAngle = angleBetween({ x: shoulder.x - hip.x, z: shoulder.z - hip.z }, { x: knee.x - hip.x, z: knee.z - hip.z });
    const groundZ = Number(s.rearAxleZ) - tyre(s.rearTyreWidth, s.rearTyreAspect, s.rearRim).radius;
    const heel = { x: peg.x - 120, z: peg.z + 25 };
    const exhaustDistance = Math.hypot(heel.x - Number(s.exhaustX), heel.z - Number(s.exhaustZ));
    const pillionKnee = circleIntersections(
      { x: Number(s.pillionSeatX), z: Number(s.pillionSeatZ) },
      Number(s.thighLength) * 0.9,
      { x: Number(s.pillionPegX), z: Number(s.pillionPegZ) },
      Number(s.shinLength) * 0.9
    ).sort((a, b) => b.x - a.x)[0];
    const pillionKneeAngle = pillionKnee ? angleBetween(
      { x: Number(s.pillionSeatX) - pillionKnee.x, z: Number(s.pillionSeatZ) - pillionKnee.z },
      { x: Number(s.pillionPegX) - pillionKnee.x, z: Number(s.pillionPegZ) - pillionKnee.z }
    ) : null;
    return {
      ok: true,
      joints: { hip, shoulder, elbow, grip, knee, peg },
      torsoAngle: result(Number(s.torsoLean), "deg", "Entered torso lean forward from vertical"),
      elbowAngle: result(elbowAngle, "deg", "Included elbow angle; the selected IK solution keeps the elbow below the arm line"),
      kneeAngle: result(kneeAngle, "deg", "Included rider knee angle"),
      hipAngle: result(hipAngle, "deg", "Included torso-to-thigh angle"),
      seatToGrip: result(Math.hypot(grip.x - hip.x, grip.z - hip.z), "mm", "Master-frame distance from seat/hip to grip"),
      armReachUtilisation: result(Math.hypot(grip.x - shoulder.x, grip.z - shoulder.z) / (Number(s.upperArmLength) + Number(s.forearmLength)) * 100, "%", "Shoulder-to-grip reach divided by available arm length"),
      groundReachMargin: result(Number(s.riderInseam) - (hip.z - groundZ), "mm", "Rider inseam minus seat-to-ground height; seat width and boot compression are not modelled"),
      kneeTankClearance: result(Number(s.pegLateral) - Number(s.tankHalfWidth), "mm", "Entered knee/peg lateral centre minus tank half-width"),
      heelExhaustClearance: result(exhaustDistance - Number(s.exhaustRadius) - 45, "mm", "2D heel envelope to exhaust envelope clearance"),
      mirrorShoulderClearance: result(Number(s.mirrorHalfSpan) - Number(s.riderShoulderWidth) / 2, "mm", "Mirror half-span minus rider shoulder half-width"),
      pillionKneeAngle: result(pillionKneeAngle, "deg", "Pillion knee angle using 90% of entered rider leg segments")
    };
  }

  function steering(state) {
    const rake = Number(state.stance.targetRake);
    const offset = Number(state.steering.upperOffset);
    const wheel = tyre(state.stance.frontTyreWidth, state.stance.frontTyreAspect, state.stance.frontRim);
    if (!wheel.ok || !finite(rake, offset) || rake <= 0 || rake >= 89) return invalid("Rake must be between 0 and 89 degrees and tyre inputs must be valid.");
    const a = rad(rake);
    const groundTrail = (wheel.radius * Math.sin(a) - offset) / Math.cos(a);
    const normalTrail = groundTrail * Math.cos(a);
    const steer = rad(Number(state.steering.steeringAngle));
    const flop = groundTrail * Math.sin(a) * (1 - Math.cos(steer));
    const targetTrail = Number(state.stance.targetTrail);
    const requiredOffset = wheel.radius * Math.sin(a) - targetTrail * Math.cos(a);
    const roadSteer = Math.atan(Math.cos(a) * Math.tan(steer));
    const turnRadius = Number(state.stance.wheelbase) / Math.max(1e-9, Math.tan(roadSteer)) / 1000;
    const mass = Number(state.derived?.massProperties?.totalMass || state.stance.gliderMass + state.stance.riderMass);
    const cgHeight = Number(state.derived?.massProperties?.cgZ || 400);
    const brakingTransferKg = mass * Number(state.steering.brakingDecel) * cgHeight / Math.max(1, state.stance.wheelbase);
    const frontSpringTotal = Math.max(1e-9, Number(state.steering.forkSpringRate) * 2);
    const springDive = Math.max(0, (brakingTransferKg * G - Number(state.steering.forkPreload) * frontSpringTotal) / frontSpringTotal);
    const offsetDelta = Number(state.steering.underBracketOffset) - offset;
    const forkAxisDelta = deg(Math.atan2(offsetDelta, Number(state.steering.bracketSpan)));
    const verticalForkRate = frontSpringTotal * Math.pow(Math.cos(a), 2);
    const rearX = Number(state.stance.rearAxleX);
    const frontX = rearX + Number(state.stance.wheelbase);
    const cgX = Number(state.derived?.massProperties?.cgX || 0);
    const wheelieLimit = (cgX - rearX) / Math.max(1e-9, cgHeight);
    const stoppieLimit = (frontX - cgX) / Math.max(1e-9, cgHeight);
    const speedMs = Number(state.steering.cornerSpeed) / 3.6;
    const idealLean = deg(Math.atan2(speedMs * speedMs, G * Math.max(1e-9, Number(state.steering.cornerRadius))));
    // Head tube (steering) axis and fork-tube axis are only parallel when the two clamp offsets are equal.
    // Both lines are evaluated at the handlebar-grip height so the reported C-C distance is a solved value
    // rather than a restatement of the entered upper offset.
    const rearTyreForGround = tyre(state.stance.rearTyreWidth, state.stance.rearTyreAspect, state.stance.rearRim);
    const groundZ = Number(state.stance.rearAxleZ) - (rearTyreForGround.ok ? rearTyreForGround.radius : 0);
    const frontAxle = { x: frontX, z: groundZ + wheel.radius };
    const gripZ = Number(state.stance.gripZ);
    const forkRakeRad = rad(rake + forkAxisDelta);
    const gripRise = gripZ - frontAxle.z;
    // The clamp offset places the axle ahead of the steering axis, so at axle height the steering axis
    // sits behind the axle by offset / cos(rake). Both axes are then projected up to the grip plane.
    const steeringAxisXAtGrip = frontAxle.x - offset / Math.cos(a) - Math.tan(a) * gripRise;
    const forkAxisXAtGrip = frontAxle.x - Math.tan(forkRakeRad) * gripRise;
    const headTubeToForkCC = (forkAxisXAtGrip - steeringAxisXAtGrip) * Math.cos(a);
    return {
      ok: true,
      tyre: wheel,
      headTubeToForkCC: result(headTubeToForkCC, "mm", "Perpendicular centre-to-centre distance from the head-tube (steering) axis to the fork-tube axis, measured in the handlebar-grip plane", { note: "Equal to the upper offset only when upper and under-bracket offsets match; otherwise the axes converge and this value changes with grip height.", inputs: ["steering.upperOffset", "steering.underBracketOffset", "steering.bracketSpan", "stance.targetRake", "stance.gripZ"] }),
      groundTrail: result(groundTrail, "mm", "Ground-plane mechanical trail", { note: global.PRD_DATA?.sourceNotes.trail, inputs: ["stance.targetRake", "steering.upperOffset", "stance.frontTyre*"] }),
      normalTrail: result(normalTrail, "mm", "Perpendicular lever from steering axis to contact patch"),
      flop: result(flop, "mm", "Steering-head lowering at the entered steering angle"),
      requiredOffset: result(requiredOffset, "mm", "Upper offset required to meet target ground trail"),
      turnRadius: result(turnRadius, "m", "Kinematic low-speed turn radius; tyre slip is not modelled"),
      brakingTransfer: result(brakingTransferKg, "kg eq.", "Quasi-static braking load transfer screen"),
      springDive: result(springDive, "mm", "Spring-only fork dive screen", { note: "Damping, bump stop, tyre compliance and chassis flexibility are not evaluated." }),
      offsetDelta: result(offsetDelta, "mm", "Under-bracket offset minus upper offset"),
      forkAxisDelta: result(forkAxisDelta, "deg", "Construction angle implied by offset delta over bracket span; it does not silently alter trail convention"),
      forkRake: result(rake + forkAxisDelta, "deg", "Fork-axis angle from vertical implied by the entered clamp construction"),
      normalTrailRatio: result(normalTrail / wheel.radius, "ratio", "Normal trail divided by front tyre radius"),
      axleLoadCorrectedRatio: result(normalTrail / wheel.radius * (state.derived?.massProperties?.frontLoadKg || 0) / Math.max(1e-9, mass), "ratio", "Normal-trail ratio weighted by current front axle-load fraction"),
      verticalForkRate: result(verticalForkRate, "N/mm vertical", "Two-leg spring rate reduced by rake cosine squared"),
      wheelieLimit: result(wheelieLimit, "g", "Rigid-body front-lift acceleration screen from current CG and rear contact"),
      stoppieLimit: result(stoppieLimit, "g", "Rigid-body rear-lift deceleration screen from current CG and front contact"),
      idealLean: result(idealLean, "deg", "Point-mass ideal lean at entered speed and turn radius")
    };
  }

  function rearKinematicsAt(state, wheelTravel) {
    const s = state.suspension;
    const axle0 = { x: state.stance.rearAxleX, z: state.stance.rearAxleZ };
    const radius = Math.hypot(axle0.x, axle0.z);
    const z = axle0.z + wheelTravel;
    if (radius <= 0 || Math.abs(z) > radius) return invalid("Rear axle travel is outside the swingarm-circle domain.");
    const sign = axle0.x < 0 ? -1 : 1;
    const axle = { x: sign * Math.sqrt(Math.max(0, radius * radius - z * z)), z };
    const initialAngle = Math.atan2(axle0.z, axle0.x);
    const angle = Math.atan2(axle.z, axle.x);
    const delta = angle - initialAngle;
    const rotate = point => ({ x: point.x * Math.cos(delta) - point.z * Math.sin(delta), z: point.x * Math.sin(delta) + point.z * Math.cos(delta) });
    if (s.rearArchitecture === "linkage") {
      const dogboneSwing = rotate({ x: Number(s.dogboneSwingX), z: Number(s.dogboneSwingZ) });
      const rockerPivot = { x: Number(s.rockerPivotX), z: Number(s.rockerPivotZ) };
      const rockerDogbone0 = { x: Number(s.rockerDogboneX), z: Number(s.rockerDogboneZ) };
      const rockerShock0 = { x: Number(s.rockerShockX), z: Number(s.rockerShockZ) };
      const dogboneSwing0 = { x: Number(s.dogboneSwingX), z: Number(s.dogboneSwingZ) };
      const rockerRadius = Math.hypot(rockerDogbone0.x - rockerPivot.x, rockerDogbone0.z - rockerPivot.z);
      const dogboneLength = Math.hypot(rockerDogbone0.x - dogboneSwing0.x, rockerDogbone0.z - dogboneSwing0.z);
      const candidates = circleIntersections(rockerPivot, rockerRadius, dogboneSwing, dogboneLength);
      if (!candidates.length) return invalid("The linkage circles do not intersect at this wheel-travel station.");
      const rockerDogbone = candidates.sort((a, b) => {
        const da = Math.hypot(a.x - rockerDogbone0.x, a.z - rockerDogbone0.z);
        const db = Math.hypot(b.x - rockerDogbone0.x, b.z - rockerDogbone0.z);
        return da - db;
      })[0];
      const baseAngle = Math.atan2(rockerDogbone0.z - rockerPivot.z, rockerDogbone0.x - rockerPivot.x);
      const currentAngle = Math.atan2(rockerDogbone.z - rockerPivot.z, rockerDogbone.x - rockerPivot.x);
      const rockerDelta = currentAngle - baseAngle;
      const shockVector = { x: rockerShock0.x - rockerPivot.x, z: rockerShock0.z - rockerPivot.z };
      const rockerShock = {
        x: rockerPivot.x + shockVector.x * Math.cos(rockerDelta) - shockVector.z * Math.sin(rockerDelta),
        z: rockerPivot.z + shockVector.x * Math.sin(rockerDelta) + shockVector.z * Math.cos(rockerDelta)
      };
      const shockLength = Math.hypot(Number(s.shockFrameX) - rockerShock.x, Number(s.shockFrameZ) - rockerShock.z);
      return { ok: true, axle, swingMount: rockerShock, dogboneSwing, rockerDogbone, shockLength, rockerAngle: deg(rockerDelta) };
    }
    const swingMount = rotate({ x: Number(s.shockSwingX), z: Number(s.shockSwingZ) });
    const shockLength = Math.hypot(Number(s.shockFrameX) - swingMount.x, Number(s.shockFrameZ) - swingMount.z);
    return { ok: true, axle, swingMount, shockLength, rockerAngle: null };
  }

  function suspension(state) {
    const travel = Math.max(1, Number(state.stance.rearTravel));
    const steps = clamp(Number(state.suspension.sweepSteps) || 12, 4, 40);
    const initial = rearKinematicsAt(state, 0);
    if (!initial.ok) return initial;
    const points = [];
    for (let i = 0; i <= steps; i += 1) {
      const wheelTravel = travel * i / steps;
      const current = rearKinematicsAt(state, wheelTravel);
      if (!current.ok) return current;
      const shockTravel = Math.abs(initial.shockLength - current.shockLength);
      points.push({ wheelTravel, shockTravel, shockLength: current.shockLength, axle: current.axle, swingMount: current.swingMount, dogboneSwing: current.dogboneSwing || null, rockerDogbone: current.rockerDogbone || null, rockerAngle: current.rockerAngle });
    }
    points.forEach((point, index) => {
      const before = points[Math.max(0, index - 1)];
      const after = points[Math.min(points.length - 1, index + 1)];
      point.motionRatio = Math.abs(after.shockTravel - before.shockTravel) / Math.max(1e-9, after.wheelTravel - before.wheelTravel);
    });
    const usableWheelTravel = Math.min(travel, Number(state.suspension.rearWheelToMetal));
    const endIndex = Math.round(usableWheelTravel / travel * steps);
    const shockTravel = points[endIndex]?.shockTravel ?? points.at(-1).shockTravel;
    const averageMotionRatio = shockTravel / Math.max(1e-9, usableWheelTravel);
    const frontStroke = Math.min(Number(state.stance.frontTravel), Number(state.suspension.frontWheelToMetal));
    const pistonArea = Math.PI * Math.pow(Number(state.suspension.forkAirPistonDiameter) / 2, 2);
    const initialAirVolume = Number(state.suspension.forkAirVolume) * 1000;
    const finalAirVolume = initialAirVolume - pistonArea * frontStroke;
    const airCompressionRatio = finalAirVolume > 0 ? initialAirVolume / finalAirVolume : null;
    const endPressureBar = airCompressionRatio;
    const springRate = Number(state.sag.rearK1);
    const startMR = points[0].motionRatio;
    const midMR = points[Math.round(endIndex / 2)]?.motionRatio;
    const endMR = points[endIndex]?.motionRatio;
    const frontTravelSweep = [];
    for (let i = 0; i <= steps; i += 1) {
      const front = Number(state.stance.frontTravel) * i / steps;
      const pitch = Math.atan2(-front, Number(state.stance.wheelbase));
      const rake = Number(state.stance.targetRake) + deg(pitch);
      const frontTyre = tyre(state.stance.frontTyreWidth, state.stance.frontTyreAspect, state.stance.frontRim);
      const trail = (frontTyre.radius * Math.sin(rad(rake)) - Number(state.steering.upperOffset)) / Math.cos(rad(rake));
      frontTravelSweep.push({ frontTravel: front, rake, trail, wheelbase: Number(state.stance.wheelbase) * Math.cos(pitch), clearance: Number(state.stance.groundClearance) - front / 2 });
    }
    const valid = finite(averageMotionRatio, shockTravel) && averageMotionRatio > 0 && finalAirVolume > 0;
    return valid ? {
      ok: true,
      points,
      initialShockLength: result(initial.shockLength, "mm", "Static eye-to-eye shock length"),
      shockTravel: result(shockTravel, "mm", "Shock displacement at usable wheel travel"),
      usableWheelTravel: result(usableWheelTravel, "mm", "Wheel travel limited by wheel-to-metal input"),
      averageMotionRatio: result(averageMotionRatio, "shock / wheel", "Average shock displacement divided by wheel displacement", { note: global.PRD_DATA?.sourceNotes.motionRatio }),
      leverageRatio: result(1 / averageMotionRatio, "wheel / shock", "Reciprocal average leverage ratio"),
      progression: result((points[endIndex].motionRatio - points[0].motionRatio) / Math.max(1e-9, points[0].motionRatio) * 100, "%", "End versus extension motion-ratio change"),
      motionRatioStart: result(startMR, "shock / wheel", "Local motion ratio at extension"),
      motionRatioMid: result(midMR, "shock / wheel", "Local motion ratio at half usable travel"),
      motionRatioEnd: result(endMR, "shock / wheel", "Local motion ratio at usable-travel limit"),
      wheelRateStart: result(springRate * startMR * startMR, "N/mm", "Linked rear K1 multiplied by local motion ratio squared"),
      wheelRateMid: result(springRate * midMR * midMR, "N/mm", "Linked rear K1 multiplied by local motion ratio squared"),
      wheelRateEnd: result(springRate * endMR * endMR, "N/mm", "Linked rear K1 multiplied by local motion ratio squared"),
      frontStrokeMargin: result(Number(state.suspension.frontWheelToMetal) - Number(state.stance.frontTravel), "mm", "Front wheel-to-metal travel minus target front travel"),
      forkAirCompression: result(airCompressionRatio, "ratio", "Initial fork-air volume divided by end-stroke volume"),
      forkEndPressure: result(endPressureBar, "bar abs", "Ideal isothermal fork-air pressure at usable stroke from a 1 bar absolute start"),
      frontTravelSweep
    } : invalid(finalAirVolume <= 0 ? "Fork swept volume consumes the entered air volume before full stroke." : "Shock motion is zero or non-finite for the entered rear construction.");
  }

  function componentMassProperties(state, loadCase = state.meta?.loadCase || "Solo rider") {
    const s = state.stance;
    const components = Array.isArray(state.components) ? state.components : [];
    const includeRider = loadCase === "Solo rider" || loadCase === "Rider + pillion";
    const includePillion = loadCase === "Rider + pillion";
    const rawInstances = [
      { id: "glider", label: "Mechanical glider", mass: Number(s.gliderMass), x: Number(s.gliderCGX), z: Number(s.gliderCGZ), owner: "Mechanical domains" },
      { id: "rider", label: "Rider", mass: includeRider ? Number(s.riderMass) : 0, x: Number(s.seatX), z: Number(s.seatZ) + 150, owner: "Stance load case" },
      { id: "pillion", label: "Pillion", mass: includePillion ? Number(s.pillionMass) : 0, x: Number(s.pillionSeatX), z: Number(s.pillionSeatZ) + 120, owner: "Stance load case" },
      { id: "luggage", label: "Luggage", mass: includePillion ? Number(s.luggageMass) : 0, x: Number(s.pillionSeatX) - 100, z: Number(s.pillionSeatZ) + 80, owner: "Stance load case" },
      ...components.map(item => ({ ...item, owner: "Energy & E/E properties; Stance committed mount" }))
    ];
    const invalidInstances = rawInstances.filter(item => Number(item.mass) < 0 || (Number(item.mass) > 0 && !finite(Number(item.mass), Number(item.x), Number(item.z))));
    if (invalidInstances.length) return invalid(`Mass or master-frame coordinates are invalid for: ${invalidInstances.map(item => item.label).join(", ")}.`);
    const instances = rawInstances.filter(item => Number(item.mass) > 0);
    const totalMass = instances.reduce((sum, item) => sum + item.mass, 0);
    if (totalMass <= 0) return invalid("Mass Properties requires at least one positive mass contribution.");
    const cgX = instances.reduce((sum, item) => sum + item.mass * item.x, 0) / totalMass;
    const cgZ = instances.reduce((sum, item) => sum + item.mass * item.z, 0) / totalMass;
    const rearX = Number(s.rearAxleX);
    const frontX = rearX + Number(s.wheelbase);
    if (frontX <= rearX) return invalid("Wheelbase and axle coordinates do not form a valid support span.");
    const frontLoadKg = totalMass * (cgX - rearX) / (frontX - rearX);
    const rearLoadKg = totalMass - frontLoadKg;
    const reconciled = frontLoadKg >= 0 && rearLoadKg >= 0;
    return {
      ok: reconciled,
      error: reconciled ? null : "Calculated CG lies outside the tyre-contact support span.",
      instances,
      totalMass,
      cgX,
      cgZ,
      frontLoadKg,
      rearLoadKg,
      wetMass: Number(s.gliderMass) + components.reduce((sum, item) => sum + Number(item.mass || 0), 0),
      targetDelta: Number(s.gliderMass) + components.reduce((sum, item) => sum + Number(item.mass || 0), 0) - Number(s.targetWetMass),
      electricalMass: components.reduce((sum, item) => sum + Number(item.mass || 0), 0),
      loadCase
    };
  }

  function springForce(x, k1, k2, transition, preload) {
    if (x <= transition) return Math.max(0, k1 * (preload + x));
    return Math.max(0, k1 * (preload + transition) + k2 * (x - transition));
  }

  function solveSagForce(forceAtWheel, maxTravel, targetForce) {
    const f0 = forceAtWheel(0);
    if (targetForce <= f0) return { travel: 0, bottomed: false, supported: f0 };
    let low = 0;
    let high = maxTravel;
    if (forceAtWheel(high) < targetForce) return { travel: high, bottomed: true, supported: forceAtWheel(high) };
    for (let i = 0; i < 64; i += 1) {
      const mid = (low + high) / 2;
      if (forceAtWheel(mid) >= targetForce) high = mid; else low = mid;
    }
    return { travel: (low + high) / 2, bottomed: false, supported: targetForce };
  }

  function sag(state, kinematics, masses, steeringResult, massCases = {}) {
    if (!kinematics?.ok || !masses?.ok || !steeringResult?.ok) return invalid("Sag requires current Suspension, Mass Properties and Steering results.");
    const rearLoadN = Math.max(0, masses.rearLoadKg - Number(state.sag.rearUnsprungMass)) * G;
    const frontLoadN = Math.max(0, masses.frontLoadKg - Number(state.sag.frontUnsprungMass)) * G;
    const maxRear = kinematics.usableWheelTravel.value;
    const maxFront = Math.min(Number(state.stance.frontTravel), Number(state.suspension.frontWheelToMetal));
    const rearKinematicsAtTravel = travel => {
      const points = kinematics.points;
      const first = points[0];
      const last = points.at(-1);
      const target = clamp(Number(travel), Number(first.wheelTravel), Number(last.wheelTravel));
      let upperIndex = points.findIndex(point => Number(point.wheelTravel) >= target);
      if (upperIndex <= 0) return { shockTravel: Number(first.shockTravel), motionRatio: Number(first.motionRatio) };
      if (upperIndex < 0) upperIndex = points.length - 1;
      const lower = points[upperIndex - 1];
      const upper = points[upperIndex];
      const span = Number(upper.wheelTravel) - Number(lower.wheelTravel);
      const fraction = span > 0 ? (target - Number(lower.wheelTravel)) / span : 0;
      return {
        shockTravel: Number(lower.shockTravel) + (Number(upper.shockTravel) - Number(lower.shockTravel)) * fraction,
        motionRatio: Number(lower.motionRatio) + (Number(upper.motionRatio) - Number(lower.motionRatio)) * fraction
      };
    };
    const rearForce = travel => {
      const sample = rearKinematicsAtTravel(travel);
      const mr = Math.max(1e-4, sample.motionRatio);
      const shockTravel = sample.shockTravel;
      const spring = springForce(shockTravel, Number(state.sag.rearK1), Number(state.sag.rearK2), Number(state.sag.rearTransition), Number(state.sag.rearPreload)) * Number(state.sag.rearSpringCount);
      const bump = travel > Number(state.suspension.bumpStopStart) ? (travel - Number(state.suspension.bumpStopStart)) * Number(state.suspension.bumpStopRate) : 0;
      return spring * mr + bump;
    };
    const pistonArea = Math.PI * Math.pow(Number(state.suspension.forkAirPistonDiameter) / 2, 2);
    const airVolume = Number(state.suspension.forkAirVolume) * 1000;
    const atmosphericMpa = 0.1;
    const frontForce = travel => {
      const coil = springForce(travel, Number(state.sag.frontK1), Number(state.sag.frontK2), Number(state.sag.frontTransition), Number(state.sag.frontPreload)) * Number(state.sag.frontSpringCount);
      const remainingVolume = airVolume - pistonArea * travel;
      if (remainingVolume <= 0) return Number.POSITIVE_INFINITY;
      const airGaugeMpa = atmosphericMpa * (airVolume / remainingVolume - 1);
      return coil + airGaugeMpa * pistonArea * Number(state.sag.frontSpringCount);
    };
    const rearSag = solveSagForce(rearForce, maxRear, rearLoadN);
    const frontSag = solveSagForce(frontForce, maxFront, frontLoadN);
    const rearShockSag = rearKinematicsAtTravel(rearSag.travel).shockTravel;
    const rearShockTravelAvailable = rearKinematicsAtTravel(maxRear).shockTravel;
    const wheelbase = Number(state.stance.wheelbase);
    const pitch = Math.atan2(rearSag.travel - frontSag.travel, wheelbase);
    const loadedRake = Number(state.stance.targetRake) + deg(pitch);
    const frontTyre = steeringResult.tyre;
    const loadedTrail = (frontTyre.radius * Math.sin(rad(loadedRake)) - Number(state.steering.upperOffset)) / Math.cos(rad(loadedRake));
    const loadedWheelbase = wheelbase * Math.cos(pitch);
    const loadedClearance = Number(state.stance.groundClearance) - (frontSag.travel + rearSag.travel) / 2;
    const gradient = (fn, x, max) => {
      const dx = Math.max(0.1, max / 500);
      return (fn(Math.min(max, x + dx)) - fn(Math.max(0, x - dx))) / Math.max(1e-9, Math.min(max, x + dx) - Math.max(0, x - dx));
    };
    const rearSprungMass = Math.max(1, masses.rearLoadKg - Number(state.sag.rearUnsprungMass));
    const frontSprungMass = Math.max(1, masses.frontLoadKg - Number(state.sag.frontUnsprungMass));
    const rearRate = gradient(rearForce, rearSag.travel, maxRear);
    const frontRate = gradient(frontForce, frontSag.travel, maxFront);
    const solveNamedCase = massRecord => {
      if (!massRecord?.ok) return { ok: false, error: massRecord?.error || "Invalid mass case" };
      const rear = solveSagForce(rearForce, maxRear, Math.max(0, massRecord.rearLoadKg - Number(state.sag.rearUnsprungMass)) * G);
      const front = solveSagForce(frontForce, maxFront, Math.max(0, massRecord.frontLoadKg - Number(state.sag.frontUnsprungMass)) * G);
      const casePitch = Math.atan2(rear.travel - front.travel, wheelbase);
      const caseRake = Number(state.stance.targetRake) + deg(casePitch);
      const caseTrail = (frontTyre.radius * Math.sin(rad(caseRake)) - Number(state.steering.upperOffset)) / Math.cos(rad(caseRake));
      return {
        ok: !rear.bottomed && !front.bottomed,
        frontForkSag: front.travel,
        rearShockSag: rearKinematicsAtTravel(rear.travel).shockTravel,
        frontWheelDisplacement: front.travel,
        rearWheelDisplacement: rear.travel,
        pitch: deg(casePitch),
        rake: caseRake,
        trail: caseTrail,
        wheelbase: wheelbase * Math.cos(casePitch),
        clearance: Number(state.stance.groundClearance) - (front.travel + rear.travel) / 2
      };
    };
    const loadCases = Object.fromEntries(Object.entries(massCases).map(([name, record]) => [name, solveNamedCase(record)]));
    // Load vs deflection at the wheel, sampled on the same force laws the equilibrium solver uses.
    // Front is fork coil + fork air; rear is spring x motion ratio + bump stop, so both are wheel-referred
    // and directly comparable on one pair of axes.
    const curveSteps = 60;
    const sampleCurve = (force, maxTravel) => Array.from({ length: curveSteps + 1 }, (_, i) => {
      const travel = maxTravel * i / curveSteps;
      const value = force(travel);
      return { travel, force: Number.isFinite(value) ? value : null };
    }).filter(point => point.force !== null);
    const markerAt = (force, travel, label, kind) => Number.isFinite(travel) ? { travel, force: force(travel), label, kind } : null;
    const rearTransitionWheel = (() => {
      // The rear spring transition is defined in shock stroke; map it back to the wheel axis.
      const target = Number(state.sag.rearTransition);
      let low = 0, high = maxRear;
      if (rearKinematicsAtTravel(high).shockTravel <= target) return null;
      for (let i = 0; i < 40; i += 1) {
        const mid = (low + high) / 2;
        if (rearKinematicsAtTravel(mid).shockTravel >= target) high = mid; else low = mid;
      }
      return (low + high) / 2;
    })();
    const frontMarkers = [
      markerAt(frontForce, loadCases.Kerb?.ok ? loadCases.Kerb.frontWheelDisplacement : null, "Kerb sag", "sag"),
      markerAt(frontForce, loadCases["Solo rider"]?.ok ? loadCases["Solo rider"].frontWheelDisplacement : null, "Solo rider sag", "sag"),
      markerAt(frontForce, loadCases["Rider + pillion"]?.ok ? loadCases["Rider + pillion"].frontWheelDisplacement : null, "Rider + pillion sag", "sag"),
      Number(state.sag.frontTransition) < maxFront ? markerAt(frontForce, Number(state.sag.frontTransition), "Spring transition", "transition") : null,
      markerAt(frontForce, maxFront, "Usable travel limit", "limit")
    ].filter(item => item && Number.isFinite(item.force));
    const rearMarkers = [
      markerAt(rearForce, loadCases.Kerb?.ok ? loadCases.Kerb.rearWheelDisplacement : null, "Kerb sag", "sag"),
      markerAt(rearForce, loadCases["Solo rider"]?.ok ? loadCases["Solo rider"].rearWheelDisplacement : null, "Solo rider sag", "sag"),
      markerAt(rearForce, loadCases["Rider + pillion"]?.ok ? loadCases["Rider + pillion"].rearWheelDisplacement : null, "Rider + pillion sag", "sag"),
      rearTransitionWheel !== null ? markerAt(rearForce, rearTransitionWheel, "Spring transition", "transition") : null,
      Number(state.suspension.bumpStopStart) < maxRear ? markerAt(rearForce, Number(state.suspension.bumpStopStart), "Bump stop engages", "bumpstop") : null,
      markerAt(rearForce, maxRear, "Usable travel limit", "limit")
    ].filter(item => item && Number.isFinite(item.force));
    const loadCurves = {
      front: { points: sampleCurve(frontForce, maxFront), markers: frontMarkers, maxTravel: maxFront, label: "Front wheel" },
      rear: { points: sampleCurve(rearForce, maxRear), markers: rearMarkers, maxTravel: maxRear, label: "Rear wheel" },
      definition: "Wheel-referred supporting force against wheel deflection. Front combines fork coil and fork air; rear combines spring force through the linkage motion ratio plus the bump stop. Damping, friction, tyre compliance and chassis flexibility are not modelled."
    };
    const expectedCaseValue = (caseName, field, member) => {
      const record = loadCases[caseName];
      return result(record?.ok ? record[field] : null, "mm", `${caseName} ${member} sag predicted from sprung load, spring force, preload and suspension kinematics`);
    };
    const expectedCasePercent = (caseName, field, usableTravel, member) => {
      const record = loadCases[caseName];
      return result(record?.ok ? record[field] / Math.max(1e-9, usableTravel) * 100 : null, "%", `${caseName} ${member} sag divided by usable member stroke`);
    };
    return {
      ok: !rearSag.bottomed && !frontSag.bottomed && loadedClearance >= 0,
      error: rearSag.bottomed || frontSag.bottomed ? "One or more axle loads cannot be supported within entered usable travel." : loadedClearance < 0 ? "Loaded ground clearance is negative." : null,
      frontForkSag: result(frontSag.travel, "mm", "Calculated front fork compression at the active load-case equilibrium"),
      rearShockSag: result(rearShockSag, "mm", "Calculated rear shock stroke interpolated at the active rear-wheel equilibrium"),
      frontForkTravelUsed: result(frontSag.travel / maxFront * 100, "%", "Front fork usable stroke consumed"),
      rearShockTravelUsed: result(rearShockSag / Math.max(1e-9, rearShockTravelAvailable) * 100, "%", "Rear shock usable stroke consumed"),
      rearShockTravelAvailable: result(rearShockTravelAvailable, "mm", "Shock stroke corresponding to the entered usable rear-wheel travel"),
      loadedGeometryInput: { frontWheelDisplacement: frontSag.travel, rearWheelDisplacement: rearSag.travel },
      frontWheelRate: result(frontRate, "N/mm", "Local front wheel-force gradient"),
      rearWheelRate: result(rearRate, "N/mm", "Local rear wheel-force gradient"),
      frontFrequency: result(Math.sqrt(Math.max(0, frontRate * 1000 / frontSprungMass)) / (2 * Math.PI), "Hz", "Undamped front ride-frequency screen"),
      rearFrequency: result(Math.sqrt(Math.max(0, rearRate * 1000 / rearSprungMass)) / (2 * Math.PI), "Hz", "Undamped rear ride-frequency screen"),
      expectedFrontForkStaticSag: expectedCaseValue("Kerb", "frontForkSag", "front fork"),
      expectedRearShockStaticSag: expectedCaseValue("Kerb", "rearShockSag", "rear shock"),
      expectedFrontForkRiderSag: expectedCaseValue("Solo rider", "frontForkSag", "front fork"),
      expectedRearShockRiderSag: expectedCaseValue("Solo rider", "rearShockSag", "rear shock"),
      expectedFrontForkStaticPercent: expectedCasePercent("Kerb", "frontForkSag", maxFront, "front fork"),
      expectedRearShockStaticPercent: expectedCasePercent("Kerb", "rearShockSag", rearShockTravelAvailable, "rear shock"),
      expectedFrontForkRiderPercent: expectedCasePercent("Solo rider", "frontForkSag", maxFront, "front fork"),
      expectedRearShockRiderPercent: expectedCasePercent("Solo rider", "rearShockSag", rearShockTravelAvailable, "rear shock"),
      loadedRake: result(loadedRake, "deg", "Rake after quasi-static front/rear sag"),
      loadedTrail: result(loadedTrail, "mm", "Ground trail after quasi-static chassis pitch"),
      loadedWheelbase: result(loadedWheelbase, "mm", "Contact spacing after quasi-static pitch"),
      loadedClearance: result(loadedClearance, "mm", "Ground clearance after average suspension displacement"),
      pitch: result(deg(pitch), "deg", "Chassis pitch caused by unequal front/rear sag"),
      loadCurves,
      loadCases
    };
  }

  function lineIntersection(a, b, c, d) {
    const r = { x: b.x - a.x, z: b.z - a.z };
    const s = { x: d.x - c.x, z: d.z - c.z };
    const denominator = r.x * s.z - r.z * s.x;
    if (Math.abs(denominator) < 1e-9) return null;
    const t = ((c.x - a.x) * s.z - (c.z - a.z) * s.x) / denominator;
    return { x: a.x + t * r.x, z: a.z + t * r.z };
  }

  function upperTangent(drive, wheel, driveRadius, wheelRadius) {
    const vx = wheel.x - drive.x;
    const vz = wheel.z - drive.z;
    const distance = Math.hypot(vx, vz);
    if (distance <= Math.abs(wheelRadius - driveRadius)) return null;
    const ex = vx / distance;
    const ez = vz / distance;
    const q = (wheelRadius - driveRadius) / distance;
    const root = Math.sqrt(Math.max(0, 1 - q * q));
    const candidates = [
      { x: q * ex - root * ez, z: q * ez + root * ex },
      { x: q * ex + root * ez, z: q * ez - root * ex }
    ];
    const normal = candidates.sort((a, b) => b.z - a.z)[0];
    return {
      drive: { x: drive.x + normal.x * driveRadius, z: drive.z + normal.z * driveRadius },
      wheel: { x: wheel.x + normal.x * wheelRadius, z: wheel.z + normal.z * wheelRadius }
    };
  }

  function lowerTangent(drive, wheel, driveRadius, wheelRadius) {
    const vx = wheel.x - drive.x;
    const vz = wheel.z - drive.z;
    const distance = Math.hypot(vx, vz);
    if (distance <= Math.abs(wheelRadius - driveRadius)) return null;
    const ex = vx / distance;
    const ez = vz / distance;
    const q = (wheelRadius - driveRadius) / distance;
    const root = Math.sqrt(Math.max(0, 1 - q * q));
    const candidates = [
      { x: q * ex - root * ez, z: q * ez + root * ex },
      { x: q * ex + root * ez, z: q * ez - root * ex }
    ];
    const normal = candidates.sort((a, b) => a.z - b.z)[0];
    return {
      drive: { x: drive.x + normal.x * driveRadius, z: drive.z + normal.z * driveRadius },
      wheel: { x: wheel.x + normal.x * wheelRadius, z: wheel.z + normal.z * wheelRadius }
    };
  }

  function antiSquatAt(state, masses, wheelTravel) {
    const kin = rearKinematicsAt(state, wheelTravel);
    if (!kin.ok) return kin;
    const rearTyre = tyre(state.stance.rearTyreWidth, state.stance.rearTyreAspect, state.stance.rearRim);
    if (!rearTyre.ok) return rearTyre;
    const contact = { x: kin.axle.x, z: kin.axle.z - rearTyre.radius };
    const loadedCgHeight = masses.cgZ - contact.z;
    const loadTan = loadedCgHeight / Math.max(1, state.stance.wheelbase);
    const pitch = Number(state.powertrain.chainPitch);
    const frontPitchRadius = pitch / (2 * Math.sin(Math.PI / Number(state.powertrain.frontTeeth)));
    const rearPitchRadius = pitch / (2 * Math.sin(Math.PI / Number(state.powertrain.rearTeeth)));
    const drive = { x: Number(state.powertrain.driveSprocketX), z: Number(state.powertrain.driveSprocketZ) };
    let instant;
    let tangent = null;
    if (state.antiSquat.driveType === "shaft") {
      instant = { x: 0, z: 0 };
    } else {
      tangent = upperTangent(drive, kin.axle, frontPitchRadius, rearPitchRadius);
      if (!tangent) return invalid("Sprocket circles do not admit the entered external tangent.");
      instant = lineIntersection(tangent.drive, tangent.wheel, { x: 0, z: 0 }, kin.axle);
    }
    if (!instant) return invalid("Drive line and swingarm are parallel; no finite force centre exists.");
    const denominator = contact.x - instant.x;
    if (Math.abs(denominator) < 1e-9 || Math.abs(loadTan) < 1e-9) return invalid("Anti-squat construction has a singular denominator.");
    const squatTan = (contact.z - instant.z) / denominator;
    const anti = 100 * squatTan / loadTan;
    const ratio = Math.abs(squatTan) > 1e-9 ? loadTan / squatTan : null;
    return finite(anti) ? { ok: true, wheelTravel, anti, ratio, angle: deg(Math.atan(squatTan)), instant, contact, axle: kin.axle, tangent, drive, frontPitchRadius, rearPitchRadius } : invalid("Anti-squat result is non-finite.");
  }

  function antiSquat(state, masses, kinematics) {
    if (!masses?.ok || !kinematics?.ok) return invalid("Anti-squat requires current Mass Properties and Suspension results.");
    const max = kinematics.usableWheelTravel.value;
    const steps = clamp(Math.round(Number(state.antiSquat.analysisSteps)), 3, 100);
    const samples = Array.from({ length: steps + 1 }, (_, index) => antiSquatAt(state, masses, max * index / steps));
    if (samples.some(item => !item.ok)) return samples.find(item => !item.ok);
    const values = samples.map(item => item.anti);
    let neutralCrossover = null;
    for (let index = 1; index < samples.length; index += 1) {
      const a = samples[index - 1];
      const b = samples[index];
      if ((a.anti - 100) * (b.anti - 100) <= 0 && a.anti !== b.anti) {
        neutralCrossover = a.wheelTravel + (100 - a.anti) * (b.wheelTravel - a.wheelTravel) / (b.anti - a.anti);
        break;
      }
    }
    return {
      ok: true,
      samples,
      start: result(samples[0].anti, "%", "Foale anti-squat at extension", { note: global.PRD_DATA?.sourceNotes.antiSquat }),
      mid: result(samples[Math.round(steps / 2)].anti, "%", "Foale anti-squat at mid travel"),
      end: result(samples.at(-1).anti, "%", "Foale anti-squat at full usable travel"),
      squatRatio: result(samples[0].ratio, "ratio", "Cossalter squat ratio at extension"),
      reciprocalCheck: result(samples[0].anti / 100 * samples[0].ratio, "identity", "(anti-squat / 100) x squat ratio"),
      range: result(Math.max(...values) - Math.min(...values), "% points", "Maximum minus minimum anti-squat through entered travel"),
      averageGradient: result((samples.at(-1).anti - samples[0].anti) / Math.max(1e-9, max), "%/mm", "End-to-end average anti-squat gradient"),
      neutralCrossover: result(neutralCrossover, "mm travel", "Interpolated wheel travel where the construction crosses 100%; blank when no crossover exists"),
      extensionForceCentreX: result(samples[0].instant.x, "mm", "Extension force-centre X coordinate"),
      extensionForceCentreZ: result(samples[0].instant.z, "mm", "Extension force-centre Z coordinate")
    };
  }

  function gearing(state, masses) {
    const rearTyre = tyre(state.stance.rearTyreWidth, state.stance.rearTyreAspect, state.stance.rearRim);
    if (!rearTyre.ok) return rearTyre;
    const p = state.powertrain;
    const finalRatio = Number(p.rearTeeth) / Math.max(1e-9, Number(p.frontTeeth));
    const ratios = [p.gear1, p.gear2, p.gear3, p.gear4, p.gear5, p.gear6].map(Number);
    const availableDutyTorque = Number(p.dutyRpm) <= Number(p.baseRpm) ? Number(p.maxTorque) : Number(p.maxTorque) * Number(p.baseRpm) / Math.max(1, Number(p.dutyRpm));
    if (ratios.some(v => v <= 0) || finalRatio <= 0 || Number(p.primaryRatio) <= 0 || Number(p.drivelineEfficiency) <= 0 || Number(p.drivelineEfficiency) > 1) return invalid("Ratios and tooth counts must be positive and driveline efficiency must be in (0, 1].");
    if (!(Number(p.maxTorque) > 0) || !(Number(p.baseRpm) > 0) || !(Number(p.maxRpm) >= Number(p.baseRpm)) || !(Number(p.dutyRpm) >= 0 && Number(p.dutyRpm) <= Number(p.maxRpm)) || !(Number(p.dutyTorque) >= 0 && Number(p.dutyTorque) <= availableDutyTorque + 1e-9)) return invalid("Torque-speed inputs require positive torque, 0 < base RPM <= max RPM, and a named-duty point inside the available envelope.");
    if (![p.frontTeeth,p.rearTeeth].every(value => Number.isInteger(Number(value)) && Number(value) >= 3)) return invalid("Sprocket tooth counts must be integers of at least three teeth.");
    const speedAt = (rpm, gearRatio) => rpm / (Number(p.primaryRatio) * gearRatio * finalRatio) * rearTyre.circumference / 1e6 * 60;
    const torqueAt = (torque, gearRatio) => torque * Number(p.primaryRatio) * gearRatio * finalRatio * Number(p.drivelineEfficiency);
    const torqueAtRpm = rpm => rpm <= Number(p.baseRpm) ? Number(p.maxTorque) : Number(p.maxTorque) * Number(p.baseRpm) / Math.max(1, rpm);
    const rows = ratios.map((gearRatio, index) => ({
      gear: index + 1,
      gearRatio,
      overallRatio: Number(p.primaryRatio) * gearRatio * finalRatio,
      speedAtMaxRpm: speedAt(Number(p.maxRpm), gearRatio),
      speedAtDutyRpm: speedAt(Number(p.dutyRpm), gearRatio),
      wheelTorqueAtDuty: torqueAt(Number(p.dutyTorque), gearRatio),
      curve: Array.from({ length: 41 }, (_, point) => {
        const rpm = Number(p.maxRpm) * point / 40;
        return { rpm, motorTorque: torqueAtRpm(rpm), speed: speedAt(rpm, gearRatio), wheelTorque: torqueAt(torqueAtRpm(rpm), gearRatio) };
      })
    }));
    const shaftPowerKw = Number(p.dutyTorque) * Number(p.dutyRpm) * 2 * Math.PI / 60 / 1000;
    const peakPowerKw = Number(p.maxTorque) * Number(p.baseRpm) * 2 * Math.PI / 60 / 1000;
    const dutyDurationMinutes = Number(p.dutyDurationMinutes);
    const dutyGear = Math.round(Number(p.dutyGear));
    if (!(dutyDurationMinutes > 0) || !(dutyGear >= 1 && dutyGear <= ratios.length)) return invalid("Named duty requires a positive duration and a selected gear from 1 to 6.");
    const dutyEnergyKWh = shaftPowerKw * dutyDurationMinutes / 60;
    const pitch = Number(p.chainPitch);
    const frontPitchRadius = pitch / (2 * Math.sin(Math.PI / Number(p.frontTeeth)));
    const rearPitchRadius = pitch / (2 * Math.sin(Math.PI / Number(p.rearTeeth)));
    const centreDistance = Math.hypot(Number(state.stance.rearAxleX) - Number(p.driveSprocketX), Number(state.stance.rearAxleZ) - Number(p.driveSprocketZ));
    const centrePitches = centreDistance / pitch;
    const chainLinks = 2 * centrePitches + (Number(p.frontTeeth) + Number(p.rearTeeth)) / 2 + Math.pow(Number(p.rearTeeth) - Number(p.frontTeeth), 2) / (4 * Math.PI * Math.PI * centrePitches);
    const driveCentre = { x: Number(p.driveSprocketX), z: Number(p.driveSprocketZ) };
    const rearCentre = { x: Number(state.stance.rearAxleX), z: Number(state.stance.rearAxleZ) };
    const upperChainTangent = upperTangent(driveCentre, rearCentre, frontPitchRadius, rearPitchRadius);
    const lowerChainTangent = lowerTangent(driveCentre, rearCentre, frontPitchRadius, rearPitchRadius);
    return {
      ok: true,
      rearTyre,
      finalRatio: result(finalRatio, "ratio", "Rear teeth divided by front teeth"),
      peakPower: result(peakPowerKw, "kW", "Peak of the entered constant-torque / constant-power envelope at base RPM"),
      shaftPower: result(shaftPowerKw, "kW", "Mechanical shaft power at named duty point"),
      dutyEnergy: result(dutyEnergyKWh, "kWh mechanical", "Named-duty shaft power multiplied by entered duration"),
      dutyRoadSpeed: result(rows[dutyGear - 1].speedAtDutyRpm, "km/h", "Kinematic road speed at named-duty RPM and selected duty gear"),
      rows,
      kinematicTopSpeed: result(rows.at(-1).speedAtMaxRpm, "km/h", "Kinematic speed in top gear at maximum RPM", { note: "Road-load feasibility is not evaluated by this result." }),
      powerToWeight: result(shaftPowerKw / Math.max(1e-9, masses.totalMass), "kW/kg", "Duty-point shaft power divided by reconciled load-case mass"),
      frontPitchRadius: result(frontPitchRadius, "mm", "Front sprocket pitch radius from chain pitch and tooth count"),
      rearPitchRadius: result(rearPitchRadius, "mm", "Rear sprocket pitch radius from chain pitch and tooth count"),
      chainCentreDistance: result(centreDistance, "mm", "Master-frame distance between drive sprocket and rear axle"),
      chainLinks: result(chainLinks, "pitches", "Ideal open-chain pitch count; select an allowable even link count separately"),
      driveCentre,
      rearCentre,
      upperChainTangent,
      lowerChainTangent,
      dutyCase: { id: state.meta.dutyCase, torqueNm: Number(p.dutyTorque), rpm: Number(p.dutyRpm), durationMinutes: dutyDurationMinutes, gear: dutyGear, roadSpeedKmh: rows[dutyGear - 1].speedAtDutyRpm, shaftPowerKw, mechanicalEnergyKWh: dutyEnergyKWh, sourceRevision: state.meta.revision }
    };
  }

  function vehicleStudy(state, gearingResult, masses) {
    if (!gearingResult?.ok || !masses?.ok) return invalid("Vehicle studies require current Powertrain and Mass Properties results.");
    const v = state.vehicle;
    const gear = clamp(Math.round(Number(v.studyGear)), 1, gearingResult.rows.length);
    const row = gearingResult.rows[gear - 1];
    const speed = Number(v.studyRpm) / row.overallRatio * gearingResult.rearTyre.circumference / 1e6 * 60;
    const wheelTorque = Number(v.studyTorque) * row.overallRatio * Number(state.powertrain.drivelineEfficiency);
    const tractiveForce = wheelTorque / (gearingResult.rearTyre.radius / 1000);
    const shaftPower = Number(v.studyTorque) * Number(v.studyRpm) * 2 * Math.PI / 60 / 1000;
    const wheelRpmAtTarget = Number(v.targetSpeed) * 1e6 / 60 / gearingResult.rearTyre.circumference;
    const requiredRpm = wheelRpmAtTarget * row.overallRatio;
    const speedMs = Number(v.targetSpeed) / 3.6;
    const rolling = masses.totalMass * G * Number(v.rollingResistance);
    const aero = 0.5 * Number(v.airDensity) * Number(v.dragCoefficientArea) * speedMs * speedMs;
    const grade = masses.totalMass * G * Math.sin(Math.atan(Number(v.targetGrade) / 100));
    const requiredPower = (rolling + aero + grade) * speedMs / 1000;
    const requiredTorque = requiredRpm > 0 ? requiredPower * 1000 / (requiredRpm * 2 * Math.PI / 60 * Number(state.powertrain.drivelineEfficiency)) : null;
    return {
      ok: true,
      speed: result(speed, "km/h", "Road speed from linked ratio, tyre and study RPM"),
      wheelTorque: result(wheelTorque, "N·m", "Ideal wheel torque after entered driveline efficiency"),
      tractiveForce: result(tractiveForce, "N", "Ideal tyre-contact tractive force"),
      requiredPower: result(requiredPower, "kW", "First-order road-load power at target speed and grade"),
      shaftPower: result(shaftPower, "kW", "Study shaft torque multiplied by angular speed"),
      requiredRpm: result(requiredRpm, "rpm", "Shaft RPM required for target speed in selected gear"),
      requiredTorque: result(requiredTorque, "N·m", "Ideal shaft torque required to deliver road-load power at required RPM"),
      wheelRpm: result(Number(v.studyRpm) / row.overallRatio, "rpm", "Wheel RPM from study shaft RPM and overall ratio"),
      wattsPerKg: result(shaftPower * 1000 / masses.totalMass, "W/kg", "Study shaft power divided by active load-case mass"),
      kilowattsPerTonne: result(shaftPower / (masses.totalMass / 1000), "kW/t", "Study shaft power divided by active load-case mass"),
      horsepowerPerTonne: result(shaftPower * 1.34102209 / (masses.totalMass / 1000), "hp/t", "Metric study power expressed as mechanical horsepower per tonne"),
      kilogramsPerKw: result(masses.totalMass / Math.max(1e-9, shaftPower), "kg/kW", "Active load-case mass per study kilowatt"),
      proposal: { targetSpeed: Number(v.targetSpeed), studyGear: gear, studyRpm: Number(v.studyRpm), studyTorque: Number(v.studyTorque) }
    };
  }

  function batteryPack(state) {
    const e = state.electrical;
    const series = Number(e.series);
    const parallel = Number(e.parallel);
    if (![series, parallel, e.cellMinV, e.cellNomV, e.cellMaxV, e.cellAh].every(v => Number(v) > 0) || !(Number(e.cellMinV) < Number(e.cellNomV) && Number(e.cellNomV) < Number(e.cellMaxV))) return invalid("Cell voltages must be positive and ordered min < nominal < max; series and parallel counts must be positive.");
    const minV = series * Number(e.cellMinV);
    const nominalV = series * Number(e.cellNomV);
    const maxV = series * Number(e.cellMaxV);
    const capacityAh = parallel * Number(e.cellAh);
    const nominalEnergyKWh = nominalV * capacityAh / 1000;
    const usableEnergyKWh = nominalEnergyKWh * (Number(e.socMax) - Number(e.socMin)) / 100;
    const resistanceOhm = series * Number(e.cellResistanceMilliOhm) / 1000 / parallel + Number(e.interconnectResistanceMilliOhm) / 1000;
    const validSoc = Number(e.socMax) > Number(e.socMin) && Number(e.socMin) >= 0 && Number(e.socMax) <= 100;
    return {
      ok: validSoc,
      error: validSoc ? null : "SOC limits must satisfy 0 <= minimum < maximum <= 100.",
      minV, nominalV, maxV, capacityAh, nominalEnergyKWh, usableEnergyKWh, resistanceOhm,
      cellCount: series * parallel,
      dischargeLimitA: capacityAh * Number(e.dischargeCLimit),
      chargeLimitA: capacityAh * Number(e.chargeCLimit)
    };
  }

  function solveDischarge(voltage, resistance, powerKw) {
    const power = powerKw * 1000;
    if (power < 0 || voltage <= 0 || resistance < 0) return invalid("Discharge inputs are outside the model domain.");
    if (resistance === 0) return { ok: true, current: power / voltage, terminalVoltage: voltage, lossKw: 0 };
    const discriminant = voltage * voltage - 4 * resistance * power;
    if (discriminant < 0) return invalid("Requested power exceeds the constant-Voc/resistance model limit.");
    const current = (voltage - Math.sqrt(discriminant)) / (2 * resistance);
    return { ok: true, current, terminalVoltage: voltage - current * resistance, lossKw: current * current * resistance / 1000 };
  }

  function electrical(state, powertrainResult, masses) {
    const pack = batteryPack(state);
    if (!pack.ok || !powertrainResult?.ok || !masses?.ok) return invalid(pack.error || "Electrical closure requires current pack, Powertrain and Mass Properties results.");
    const scenario = String(state.meta.electricalScenario);
    const tractionEnabled = scenario === "drive";
    const chargeEnabled = scenario === "charge";
    const mechanicalKw = tractionEnabled ? powertrainResult.shaftPower.value : 0;
    const batteryKw = mechanicalKw / Math.max(1e-9, Number(state.powertrain.motorEfficiency) * Number(state.powertrain.inverterEfficiency));
    const discharge = solveDischarge(pack.nominalV, pack.resistanceOhm, batteryKw);
    const graph = architectureGraph(state.meta.architectureVariant, state.components);
    const graphIssues = validatePowerGraph(graph, state, scenario);
    const active = state.components.filter(item => String(item.states).split(",").map(v => v.trim()).includes(scenario));
    const lvCategories = new Set(["Rider information", "Lighting", "Controllers / sensors", "Actuators / peripherals", "Custom"]);
    const enabledForScenario = item => String(item.enabledStates || "").split(",").map(value => value.trim()).includes(scenario);
    const activeNodeIds = new Set(graph.nodes.filter(node => enabledForScenario(node) && (!node.componentInstanceId || active.some(component => component.id === node.componentInstanceId))).map(node => node.id));
    const reachable = new Set(graph.nodes.filter(node => ["dcdc","lvBattery"].includes(node.componentInstanceId) && activeNodeIds.has(node.id)).map(node => node.id));
    let changed = true;
    while (changed) {
      changed = false;
      graph.edges.filter(edge => enabledForScenario(edge) && edge.graph === "power" && edge.voltageDomain === "LV" && activeNodeIds.has(edge.fromNodeId) && activeNodeIds.has(edge.toNodeId)).forEach(edge => {
        if (reachable.has(edge.fromNodeId) && !reachable.has(edge.toNodeId)) { reachable.add(edge.toNodeId); changed = true; }
      });
    }
    const reachableComponentIds = new Set(graph.nodes.filter(node => reachable.has(node.id) && node.componentInstanceId).map(node => node.componentInstanceId));
    const activeLv = active.filter(item => lvCategories.has(item.category) && reachableComponentIds.has(item.id));
    const lvContinuous = scenario === "off" ? 0 : activeLv.reduce((sum, item) => sum + Number(item.continuous || 0), 0);
    const lvPeak = scenario === "off" ? 0 : activeLv.reduce((sum, item) => sum + Number(item.peak || 0), 0);
    const headroom = Number(state.electrical.dcdcCapacity) - lvContinuous;
    const peakHeadroom = Number(state.electrical.dcdcPeakCapacity) - lvPeak;
    const electricalMass = state.components.reduce((sum, item) => sum + Number(item.mass || 0), 0);
    const validCable = Number(state.electrical.cableLength) > 0 && Number(state.electrical.cableArea) > 0 && Number(state.electrical.cableParallel) > 0;
    const cableResistance = validCable ? RHO_COPPER * Number(state.electrical.cableLength) * 2 / (Number(state.electrical.cableArea) * 1e-6 * Number(state.electrical.cableParallel)) : null;
    const packChargeLimitKw = pack.nominalV * pack.chargeLimitA / 1000;
    const packChargePower = chargeEnabled ? Math.min(Number(state.electrical.obcPower) * Number(state.electrical.obcEfficiency), packChargeLimitKw) : 0;
    const chargeCurrent = chargeEnabled ? packChargePower * 1000 / pack.nominalV : 0;
    const current = tractionEnabled && discharge.ok ? discharge.current : chargeEnabled ? chargeCurrent : 0;
    const cableDrop = current === null ? null : current * cableResistance;
    const cableLoss = current === null ? null : current * current * cableResistance;
    const prechargeR = pack.maxV / Math.max(1e-9, Number(state.electrical.prechargeInitialCurrent));
    const capacitance = Number(state.electrical.prechargeCapMicroF) * 1e-6;
    const targetFraction = Number(state.electrical.prechargeTarget) / 100;
    const prechargeTime = -prechargeR * capacitance * Math.log(Math.max(1e-9, 1 - targetFraction));
    const prechargeEnergy = 0.5 * capacitance * pack.maxV * pack.maxV * (1 - Math.pow(1 - targetFraction, 2));
    const essentialLoad = state.components.filter(item => item.essential && lvCategories.has(item.category)).reduce((sum, item) => sum + Number(item.continuous || 0), 0);
    const backupEnergyWh = Number(state.electrical.lvBusVoltage) * Number(state.electrical.lvBatteryAh) * Number(state.electrical.lvBackupUsableFraction);
    const backupMinutes = essentialLoad > 0 ? backupEnergyWh / essentialLoad * 60 : null;
    const electricalCgX = electricalMass > 0 ? state.components.reduce((sum, item) => sum + Number(item.mass || 0) * Number(item.x || 0), 0) / electricalMass : null;
    const electricalCgZ = electricalMass > 0 ? state.components.reduce((sum, item) => sum + Number(item.mass || 0) * Number(item.z || 0), 0) / electricalMass : null;
    const violations = [...graphIssues];
    if (!validCable) violations.push("Cable length, area and parallel count must be positive.");
    if (!(targetFraction > 0 && targetFraction < 1) || !(capacitance > 0) || !(Number(state.electrical.prechargeInitialCurrent) > 0)) violations.push("Precharge capacitance/current must be positive and target must be between 0 and 100 percent.");
    if (tractionEnabled && !discharge.ok) violations.push(discharge.error);
    if (tractionEnabled && discharge.ok && discharge.current > pack.dischargeLimitA) violations.push("Named traction duty exceeds the entered pack discharge-current limit.");
    if (tractionEnabled && discharge.ok && discharge.terminalVoltage < pack.minV) violations.push("Loaded pack voltage is below the entered cell minimum-voltage aggregate.");
    if (headroom < 0) violations.push("Enabled LV continuous load exceeds DC-DC continuous capacity.");
    if (peakHeadroom < 0) violations.push("Enabled LV peak/inrush load exceeds DC-DC peak capacity.");
    if (chargeEnabled && !(Number(state.electrical.obcEfficiency) > 0 && Number(state.electrical.obcEfficiency) <= 1)) violations.push("OBC efficiency must be in (0, 1].");
    return {
      ok: violations.length === 0,
      error: violations[0] || null,
      pack,
      batteryPower: result(batteryKw, "kW", "Battery-side traction power at the named duty point"),
      dutyBatteryEnergy: result(batteryKw * Number(state.powertrain.dutyDurationMinutes) / 60, "kWh", "Battery-side named-duty power multiplied by entered duty duration; auxiliaries and transient integration are excluded"),
      busCurrent: result(tractionEnabled ? (discharge.ok ? discharge.current : null) : chargeEnabled ? -chargeCurrent : 0, "A", chargeEnabled ? "Pack charge current; negative sign indicates energy entering storage" : tractionEnabled ? "Constant open-circuit-voltage/resistance discharge solution" : "No traction current in the selected state"),
      terminalVoltage: result(tractionEnabled ? (discharge.ok ? discharge.terminalVoltage : null) : pack.nominalV, "V", tractionEnabled ? "Loaded pack terminal voltage" : "Nominal pack voltage; no traction discharge solved in this state"),
      packLoss: result(tractionEnabled && discharge.ok ? discharge.lossKw : chargeEnabled ? chargeCurrent * chargeCurrent * pack.resistanceOhm / 1000 : 0, "kW", "Lumped pack I^2R loss in the selected state"),
      packChargePower: result(packChargePower, "kW", "Committed OBC output limited by OBC efficiency and pack charge-current limit"),
      lvContinuous: result(lvContinuous, "W", `Enabled continuous LV load in ${scenario}`),
      lvPeak: result(lvPeak, "W", `Enabled peak LV load in ${scenario}`),
      dcdcHeadroom: result(headroom, "W", "Entered DC-DC capacity minus enabled continuous LV load"),
      dcdcPeakHeadroom: result(peakHeadroom, "W", "Entered DC-DC peak capacity minus enabled peak/inrush LV load"),
      lvBackupRuntime: result(backupMinutes, "min", "Entered usable LV backup energy divided by configured essential continuous loads"),
      electricalMass: result(electricalMass, "kg", "Selected electrical component-instance mass"),
      electricalCgX: result(electricalCgX, "mm", "Mass-weighted electrical component X coordinate"),
      electricalCgZ: result(electricalCgZ, "mm", "Mass-weighted electrical component Z coordinate"),
      massReconciliation: result(electricalMass - masses.electricalMass, "kg", "Electrical BOM mass minus Mass Properties electrical contribution; zero is closed"),
      powerNodeCount: result(graph.nodes.length, "nodes", "Functional power/control node count in selected architecture template"),
      powerEdgeCount: result(graph.edges.length, "edges", "Functional power and communication edge count in selected architecture template"),
      cableDrop: result(cableDrop, "V", "First-order copper conductor voltage-drop screen"),
      cableLoss: result(cableLoss, "W", "First-order copper conductor loss screen"),
      currentDensity: result(current === null ? null : current / (Number(state.electrical.cableArea) * Number(state.electrical.cableParallel)), "A/mm²", "Current divided by total entered conductor area"),
      prechargeResistance: result(prechargeR, "Ω", "Resistance from maximum voltage and initial-current limit"),
      prechargeTime: result(prechargeTime, "s", "Ideal RC time to entered target voltage fraction"),
      prechargeEnergy: result(prechargeEnergy, "J", "Ideal resistor energy to entered target fraction"),
      graph,
      graphIssues,
      violations,
      scenario,
      boundaryNote: global.PRD_DATA?.sourceNotes.electricalBoundary
    };
  }

  function architectureGraph(variant, components = []) {
    // Charge energy path: AC inlet -> EMI/AC filter -> OBC -> HV junction -> pack.
    // The BMS is deliberately NOT in the power path. It measures cell voltage and temperature and commands
    // the OBC's constant-current / constant-voltage setpoint over CAN, which is how the current is regulated.
    const common = {
      hv: [
        ["AC inlet", "AC filter", "AC", "AC supply"], ["AC filter", "OBC", "AC", "filtered AC"],
        ["OBC", "HV junction", "HV", "CC/CV charge current"], ["DC inlet", "HV junction", "HV", "DC charge"],
        ["Battery", "HV junction", "HV", "pack energy"], ["HV junction", "Inverter", "HV", "traction DC"],
        ["Inverter", "Motor", "phase", "3-phase drive"], ["HV junction", "DC-DC", "HV", "LV supply feed"]
      ],
      control: [
        ["Throttle", "VCU / gateway", "signal", "rider torque demand"],
        ["BMS", "VCU / gateway", "CAN", "pack power limits"],
        ["VCU / gateway", "Inverter", "CAN", "torque command"],
        ["BMS", "OBC", "CAN", "CC/CV setpoint"],
        ["VCU / gateway", "Dashboard", "CAN", "vehicle state"]
      ]
    };
    const variants = {
      centralized_pdu: [["DC-DC", "Central PDU", "LV"], ["LV battery", "Central PDU", "LV"]],
      dashboard_ldu: [["DC-DC", "PDU", "LV"], ["LV battery", "PDU", "LV"], ["PDU", "Dashboard", "LV"], ["PDU", "LDU", "LV"]],
      front_rear_zonal: [["DC-DC", "Central feed", "LV"], ["LV battery", "Central feed", "LV"], ["Central feed", "Front zone", "LV"], ["Central feed", "Rear zone", "LV"]],
      distributed_smart_loads: [["DC-DC", "Protected branches", "LV"], ["LV battery", "Protected branches", "LV"]],
      redundant_critical_loads: [["DC-DC", "Protected distribution", "LV"], ["LV battery", "Protected distribution", "LV"], ["Protected distribution", "Critical bus", "LV"], ["Protected distribution", "Non-critical bus", "LV"]]
    };
    const hv = common.hv;
    const componentLabels = { bms: "BMS", vcu: "VCU / gateway", dashboard: "Dashboard", lighting: "Lighting", controllers: "Controllers / sensors", actuators: "Actuators / peripherals" };
    const terminalLoads = components.filter(component => componentLabels[component.id]);
    const loadEdges = terminalLoads.flatMap(component => {
      const label = componentLabels[component.id];
      if (variant === "dashboard_ldu" && component.id === "dashboard") return [];
      if (variant === "front_rear_zonal") return [[Number(component.x) >= 0 ? "Front zone" : "Rear zone", label, "LV"]];
      if (variant === "distributed_smart_loads") return [["Protected branches", label, "LV"]];
      if (variant === "redundant_critical_loads") return [[component.essential ? "Critical bus" : "Non-critical bus", label, "LV"]];
      return [[variant === "centralized_pdu" ? "Central PDU" : "LDU", label, "LV"]];
    });
    const lv = [...(variants[variant] || variants.dashboard_ldu), ...loadEdges];
    const control = common.control;
    const allTriples = [
      ...hv.map(edge => ({ from: edge[0], to: edge[1], domain: edge[2], purpose: edge[3] || null, graph: "power" })),
      ...lv.map(edge => ({ from: edge[0], to: edge[1], domain: edge[2], purpose: edge[3] || null, graph: "power" })),
      ...control.map(edge => ({ from: edge[0], to: edge[1], domain: edge[2], purpose: edge[3] || null, graph: "communication" }))
    ];
    const componentMap = {
      Battery: "battery", BMS: "bms", OBC: "obc", "HV junction": "hvJunction", Inverter: "inverter", Motor: "motor",
      "AC filter": "acFilter", "DC-DC": "dcdc", "LV battery": "lvBattery", Dashboard: "dashboard", "VCU / gateway": "vcu",
      PDU: "pdu", LDU: "ldu", "Central PDU": "pdu", Lighting: "lighting", "Controllers / sensors": "controllers", "Actuators / peripherals": "actuators"
    };
    const roleFor = label => /battery/i.test(label) ? "storage" : /inlet/i.test(label) ? "source" : /throttle/i.test(label) ? "sensor" : /filter/i.test(label) ? "filter" : /OBC|Inverter|DC-DC/.test(label) ? "converter" : /junction/i.test(label) ? "junction" : /feed|PDU|LDU|zone|bus|distribution|branches/.test(label) ? "distribution" : "load";
    const macroStatesFor = (from, to, graphName) => {
      const pair = `${from}|${to}`;
      if (graphName === "communication") return /Throttle/.test(pair) ? "drive" : /OBC/.test(pair) ? "charge" : "drive,charge";
      if (/AC inlet|AC filter|DC inlet|OBC/.test(pair)) return "charge";
      if (/Inverter|Motor/.test(pair)) return "drive";
      return "drive,charge";
    };
    const labels = [...new Set(allTriples.flatMap(edge => [edge.from, edge.to]))];
    const nodes = labels.map(label => ({
      id: label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""),
      label,
      role: roleFor(label),
      componentInstanceId: componentMap[label] || null,
      logicalNode: !componentMap[label],
      enabledStates: components.find(component => component.id === componentMap[label])?.states
        || (label === "AC inlet" || label === "DC inlet" ? "charge" : label === "Throttle" ? "drive" : "drive,charge")
    }));
    const nodeId = label => nodes.find(node => node.label === label)?.id;
    const edges = allTriples.map((edge, index) => ({
      id: `${edge.graph}_${index + 1}`,
      fromNodeId: nodeId(edge.from),
      toNodeId: nodeId(edge.to),
      voltageDomain: edge.domain,
      purpose: edge.purpose,
      graph: edge.graph,
      direction: edge.graph === "communication" ? "bidirectional" : "forward",
      enabledStates: macroStatesFor(edge.from, edge.to, edge.graph),
      returnPath: edge.graph === "power" ? "one-line abstraction" : null
    }));
    nodes.forEach(node => {
      const domains = [...new Set(edges.filter(edge => edge.graph === "power" && (edge.fromNodeId === node.id || edge.toNodeId === node.id)).map(edge => edge.voltageDomain))];
      node.voltageDomain = domains.join(" / ") || null;
    });
    return { variant, hv, lv, control, nodes, edges, abstraction: "Functional one-line; conductor return, protection coordination and detailed interfaces are not represented." };
  }

  function validatePowerGraph(graph, state, scenario) {
    const issues = [];
    if (!graph?.hv?.length || !graph?.lv?.length) issues.push("Selected architecture has an empty power domain.");
    const nodeIds = new Set((graph?.nodes || []).map(node => node.id));
    for (const edge of graph?.edges || []) {
      if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) issues.push(`Graph edge ${edge.id} references a missing node.`);
      if (!edge.voltageDomain) issues.push(`Graph edge ${edge.id} has no voltage domain.`);
    }
    const activeIds = new Set(state.components.filter(item => String(item.states).split(",").map(v => v.trim()).includes(scenario)).map(item => item.id));
    if (scenario === "drive" && !["battery", "bms", "hvJunction", "inverter", "motor", "dcdc", "vcu"].every(id => activeIds.has(id))) issues.push("Drive scenario is missing one or more required traction, supervisory or LV-source component instances.");
    const selectedComponentIds = new Set(state.components.map(item => item.id));
    for (const node of graph?.nodes || []) {
      if (node.componentInstanceId && !selectedComponentIds.has(node.componentInstanceId)) issues.push(`Physical graph node ${node.label} has no selected component instance.`);
      if (!["source","storage","converter","junction","distribution","load","filter","sensor"].includes(node.role)) issues.push(`Power node ${node.label} has unsupported role ${node.role}.`);
    }
    const enabledForScenario = item => String(item.enabledStates || "").split(",").map(value => value.trim()).includes(scenario);
    const activeNodeIds = new Set(graph.nodes.filter(node => enabledForScenario(node) && (!node.componentInstanceId || activeIds.has(node.componentInstanceId))).map(node => node.id));
    const reachable = new Set(graph.nodes.filter(node => ["dcdc","lvBattery"].includes(node.componentInstanceId) && activeNodeIds.has(node.id)).map(node => node.id));
    let changed = true;
    while (changed) {
      changed = false;
      graph.edges.filter(edge => enabledForScenario(edge) && edge.graph === "power" && edge.voltageDomain === "LV" && activeNodeIds.has(edge.fromNodeId) && activeNodeIds.has(edge.toNodeId)).forEach(edge => {
        if (reachable.has(edge.fromNodeId) && !reachable.has(edge.toNodeId)) { reachable.add(edge.toNodeId); changed = true; }
      });
    }
    graph.nodes.filter(node => node.componentInstanceId && activeIds.has(node.componentInstanceId) && graph.edges.some(edge => edge.graph === "power" && edge.voltageDomain === "LV" && edge.toNodeId === node.id)).forEach(node => {
      if (!reachable.has(node.id)) issues.push(`Active LV component ${node.label} has no enabled source path in ${scenario}.`);
    });
    if (graph.edges.some(edge => edge.graph === "communication" && [edge.fromNodeId,edge.toNodeId].includes("motor"))) issues.push("Motor phase hardware must not be inferred as a CAN node; network the drive controller instead.");
    return issues;
  }

  function batteryStudy(state, electricalResult) {
    if (!electricalResult?.pack) return invalid("Battery studies require a current committed pack.");
    const b = state.battery;
    const e = state.electrical;
    const socWindow = (Number(e.socMax) - Number(e.socMin)) / 100;
    const dischargeEfficiency = Number(b.dischargeEfficiency);
    const chargeEfficiency = Number(b.chargeEfficiency);
    const valid = Number(b.targetRange) > 0 && Number(b.consumption) > 0 && Number(b.reserve) >= 0 && socWindow > 0 && dischargeEfficiency > 0 && dischargeEfficiency <= 1 && chargeEfficiency > 0 && chargeEfficiency <= 1 && Number(b.capacityDerate) > 0 && Number(b.capacityDerate) <= 1;
    if (!valid) return invalid("Battery study requires positive range/consumption, non-negative reserve, a valid SOC window, and efficiencies/derate in (0, 1].");
    // LV demand solved by Energy & E/E is a real battery-sizing input, not a display figure.
    // Continuous LV load adds energy over the target range; peak LV load adds to the current the pack must supply.
    const tractionLoadEnergy = Number(b.targetRange) * Number(b.consumption) / 1000;
    const lvContinuousKw = Number(electricalResult.lvContinuous?.value || 0) / 1000;
    const lvPeakKw = Number(electricalResult.lvPeak?.value || 0) / 1000;
    const rangeHours = Number(b.averageSpeed) > 0 ? Number(b.targetRange) / Number(b.averageSpeed) : 0;
    const lvEnergyOverRange = lvContinuousKw * rangeHours;
    const requiredLoadEnergy = tractionLoadEnergy + lvEnergyOverRange;
    const requiredDelivered = requiredLoadEnergy * (1 + Number(b.reserve) / 100);
    const requiredNominal = requiredDelivered / (socWindow * dischargeEfficiency * Number(b.capacityDerate));
    const deliveredEnergy = electricalResult.pack.usableEnergyKWh * dischargeEfficiency * Number(b.capacityDerate);
    const range = deliveredEnergy * 1000 / Number(b.consumption);
    const requiredSeries = Math.ceil(Number(b.studyVoltage) / Number(state.electrical.cellNomV));
    const stringEnergy = requiredSeries * Number(e.cellNomV) * Number(e.cellAh) / 1000;
    const requiredParallelEnergy = Math.ceil(requiredNominal / Math.max(1e-9, stringEnergy));
    const requiredCurrent = (Number(b.runtimePower) + lvPeakKw) * 1000 / Math.max(1e-9, Number(b.studyVoltage));
    const cellCurrentLimit = Number(e.cellAh) * Number(e.dischargeCLimit);
    const requiredParallelCurrent = Math.ceil(requiredCurrent / Math.max(1e-9, cellCurrentLimit));
    const requiredParallelAh = Math.ceil(Number(b.studyCapacityAh) / Number(e.cellAh));
    const requiredParallel = Math.max(requiredParallelEnergy, requiredParallelCurrent, requiredParallelAh);
    const proposedNominalV = requiredSeries * Number(e.cellNomV);
    const proposedAh = requiredParallel * Number(e.cellAh);
    const proposedEnergy = proposedNominalV * proposedAh / 1000;
    const phaseFactor = Number(b.supplyPhases) === 3 ? Math.sqrt(3) : 1;
    const supplyPower = phaseFactor * Number(b.supplyVoltage) * Number(b.supplyCurrent) * Number(b.supplyPowerFactor) / 1000;
    const packChargeLimit = electricalResult.pack.nominalV * electricalResult.pack.chargeLimitA / 1000;
    const wallPower = Math.min(supplyPower, Number(b.chargerPower));
    const packChargePower = Math.min(wallPower * chargeEfficiency, packChargeLimit);
    const chargeSocWindow = (Number(b.chargeEndSoc) - Number(b.chargeStartSoc)) / 100;
    if (!(chargeSocWindow > 0 && Number(b.chargeStartSoc) >= 0 && Number(b.chargeEndSoc) <= 100) || !(packChargePower > 0) || !(Number(b.chargeTaperFactor) >= 1)) return invalid("Charge SOC limits, available power, or taper factor are invalid.");
    const chargeEnergy = electricalResult.pack.nominalEnergyKWh * chargeSocWindow;
    const chargeHours = chargeEnergy / packChargePower * Number(b.chargeTaperFactor);
    const usableAh = electricalResult.pack.capacityAh * socWindow * Number(b.capacityDerate);
    const currentRuntime = usableAh / Math.max(1e-9, Number(b.runtimeCurrent));
    const constantPowerRuntime = deliveredEnergy / Math.max(1e-9, Number(b.runtimePower) + Number(b.auxiliaryPower));
    const requiredObcPower = chargeEnergy / Math.max(1e-9, Number(b.desiredChargeHours)) * Number(b.chargeTaperFactor) / chargeEfficiency;
    const requiredLineCurrent = requiredObcPower * 1000 / Math.max(1e-9, phaseFactor * Number(b.supplyVoltage) * Number(b.supplyPowerFactor));
    const requiredCRate = Number(b.runtimeCurrent) / electricalResult.pack.capacityAh;
    const permittedPower = electricalResult.pack.nominalV * electricalResult.pack.dischargeLimitA / 1000;
    return {
      ok: true,
      tractionLoadEnergy: result(tractionLoadEnergy, "kWh", "Target range multiplied by named traction energy consumption; LV auxiliaries excluded"),
      lvContinuousDemand: result(lvContinuousKw, "kW", "Continuous LV demand solved by Energy & E/E for the active scenario, carried into battery sizing"),
      lvPeakDemand: result(lvPeakKw, "kW", "Peak / inrush LV demand solved by Energy & E/E, added to the pack current-capability requirement"),
      lvEnergyOverRange: result(lvEnergyOverRange, "kWh", "Continuous LV demand multiplied by target range divided by entered average speed"),
      requiredLoadEnergy: result(requiredLoadEnergy, "kWh", "Traction energy over the target range plus LV auxiliary energy for the same duration"),
      requiredUsable: result(requiredDelivered, "kWh", "Load energy increased by the entered reserve"),
      requiredNominal: result(requiredNominal, "kWh", "Required gross energy after SOC window, discharge efficiency and capacity derate"),
      deliveredEnergy: result(deliveredEnergy, "kWh", "Committed usable energy after discharge efficiency and capacity derate"),
      estimatedRange: result(range, "km", "Load-delivered energy divided by named consumption"),
      supplyPower: result(supplyPower, "kW", "Available AC supply power using entered phase convention, voltage, current and power factor"),
      packChargePower: result(packChargePower, "kW", "Governing pack charge power after supply, OBC, efficiency and pack current limits"),
      chargeTime: result(chargeHours, "h", "Charge-window energy divided by governing pack power and multiplied by entered taper factor"),
      actualChargeCurrent: result(packChargePower * 1000 / electricalResult.pack.nominalV, "A", "Governing pack charge power divided by nominal pack voltage"),
      actualChargeCRate: result(packChargePower * 1000 / electricalResult.pack.nominalV / electricalResult.pack.capacityAh, "C", "Actual charge current divided by committed Ah"),
      requiredObcPower: result(requiredObcPower, "kW AC", "AC OBC input power required to meet desired charge time under entered taper and efficiency"),
      requiredLineCurrent: result(requiredLineCurrent, "A", "Required AC line current under the entered single/three-phase convention"),
      currentRuntime: result(currentRuntime, "h", "Usable Ah divided by constant pack current; path energy efficiency is not applied"),
      constantPowerRuntime: result(constantPowerRuntime, "h", "Load-delivered energy divided by requested constant power plus auxiliaries"),
      runtimeDistance: result(constantPowerRuntime * Number(b.averageSpeed), "km", "Constant-power runtime multiplied by entered average speed"),
      requiredCRate: result(requiredCRate, "C", "Entered constant current divided by committed pack capacity"),
      permittedPower: result(permittedPower, "kW", "Nominal pack voltage multiplied by entered discharge-current limit"),
      proposedSeries: requiredSeries,
      proposedParallel: requiredParallel,
      proposedCells: requiredSeries * requiredParallel,
      proposedMinV: requiredSeries * Number(e.cellMinV),
      proposedNominalV,
      proposedMaxV: requiredSeries * Number(e.cellMaxV),
      proposedAh,
      proposedEnergy,
      voltageDelta: proposedNominalV - Number(b.studyVoltage),
      energyMargin: proposedEnergy - requiredNominal,
      proposal: { series: requiredSeries, parallel: requiredParallel, chargerPower: Number(b.chargerPower), nominalVoltage: proposedNominalV, capacityAh: proposedAh, grossEnergyKWh: proposedEnergy, sourceElectricalRevision: state.meta.domainRevisions?.electrical || state.meta.revision, sourceDutyCaseRevision: state.meta.domainRevisions?.powertrain || state.meta.revision, downstreamReviewRequired: true }
    };
  }

  function sensitivity(state, calculate) {
    const path = String(state.sensitivity.parameter).split(".");
    const step = Number(state.sensitivity.step);
    if (!(step > 0) || path.length !== 2 || !state[path[0]] || !(path[1] in state[path[0]])) return invalid("Select a valid parameter and positive perturbation step.");
    const base = JSON.parse(JSON.stringify(state));
    const plus = JSON.parse(JSON.stringify(state));
    const minus = JSON.parse(JSON.stringify(state));
    plus[path[0]][path[1]] = Number(plus[path[0]][path[1]]) + step;
    minus[path[0]][path[1]] = Number(minus[path[0]][path[1]]) - step;
    const baseResults = calculate(base, false);
    const plusResults = calculate(plus, false);
    const minusResults = calculate(minus, false);
    const pick = output => ({
      trail: output.steering?.groundTrail?.value,
      loadedRake: output.sag?.loadedRake?.value,
      loadedTrail: output.sag?.loadedTrail?.value,
      groundClearance: output.sag?.loadedClearance?.value,
      antiSquat: output.antiSquat?.start?.value,
      totalMass: output.massProperties?.totalMass,
      range: output.battery?.estimatedRange?.value,
      lvHeadroom: output.electrical?.dcdcHeadroom?.value
    });
    const b = pick(baseResults), p = pick(plusResults), m = pick(minusResults);
    const rows = Object.keys(b).map(key => {
      const validSamples = [b[key], p[key], m[key]].every(value => value !== null && value !== undefined && Number.isFinite(Number(value)));
      const forward = validSamples ? (p[key] - b[key]) / step : null;
      const backward = validSamples ? (b[key] - m[key]) / step : null;
      const derivative = validSamples ? (p[key] - m[key]) / (2 * step) : null;
      const asymmetry = validSamples ? Math.abs(forward - backward) / Math.max(1e-9, Math.abs(derivative)) * 100 : null;
      return {
        output: key,
        base: b[key],
        minus: m[key],
        plus: p[key],
        derivative,
        forward,
        backward,
        asymmetry,
        response: asymmetry === null ? "invalid-domain boundary" : asymmetry < 5 ? "linear" : asymmetry < 20 ? "mildly nonlinear" : "nonlinear",
        rssAtTolerance: validSamples ? Math.abs(derivative) * Number(state.sensitivity.tolerance) : null,
        arithmeticWorstCase: validSamples ? Math.max(Math.abs(forward), Math.abs(backward)) * Number(state.sensitivity.tolerance) : null,
        valid: validSamples
      };
    });
    return { ok: true, parameter: state.sensitivity.parameter, step, rows, proposalOnly: true };
  }

  function calculate(state, includeSensitivity = true) {
    const massCases = {
      Kerb: componentMassProperties(state, "Kerb"),
      "Solo rider": componentMassProperties(state, "Solo rider"),
      "Rider + pillion": componentMassProperties(state, "Rider + pillion")
    };
    const massProperties = massCases[state.meta?.loadCase] || massCases["Solo rider"];
    const workingState = Object.assign(Object.create(Object.getPrototypeOf(state)), state, { derived: { ...(state.derived || {}), massProperties, massCases } });
    const ergonomicsResult = ergonomics(state);
    const steeringResult = steering(workingState);
    const suspensionResult = suspension(state);
    const sagResult = sag(state, suspensionResult, massProperties, steeringResult, massCases);
    const antiSquatResult = antiSquat(state, massProperties, suspensionResult);
    const gearingResult = gearing(state, massProperties);
    const vehicleResult = vehicleStudy(state, gearingResult, massProperties);
    const electricalResult = electrical(state, gearingResult, massProperties);
    const batteryResult = batteryStudy(state, electricalResult);
    const outputs = {
      massProperties,
      massCases,
      ergonomics: ergonomicsResult,
      steering: steeringResult,
      suspension: suspensionResult,
      sag: sagResult,
      antiSquat: antiSquatResult,
      powertrain: gearingResult,
      vehicle: vehicleResult,
      electrical: electricalResult,
      battery: batteryResult
    };
    if (includeSensitivity) outputs.sensitivity = sensitivity(state, calculate);
    return outputs;
  }

  global.EngineeringCore = { calculate, tyre, ergonomics, steering, suspension, componentMassProperties, sag, antiSquat, gearing, vehicleStudy, batteryPack, solveDischarge, electrical, batteryStudy, sensitivity, round, clamp };
})(window);
