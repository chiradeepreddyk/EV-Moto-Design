(function (global) {
  "use strict";

  /*
   * Contextual reference data for concept comparison only.
   * A missing value is deliberately null: it must not be inferred from a similar model.
   * Manufacturer figures are rated claims, not measured torque curves or acceptance limits.
   */
  global.POWERTRAIN_BENCHMARKS = Object.freeze({
    schemaVersion: "1.0",
    accessedOn: "2026-08-13",
    records: [
      {
        id: "yamaha-r7-2026",
        manufacturer: "Yamaha",
        model: "R7",
        modelYear: 2026,
        category: "Sport",
        powertrainType: "ICE",
        transmission: "6-speed, chain final drive",
        peakPowerKw: 54.0,
        peakPowerRpm: 8750,
        peakTorqueNm: 68.0,
        peakTorqueRpm: 6500,
        frontTeeth: null,
        rearTeeth: null,
        massKg: null,
        provenance: {
          sourceType: "manufacturer_rated",
          qualityFlag: "published",
          url: "https://www.yamaha-motor.eu/gb/en/motorcycles/supersport/pdp/r7/",
          note: "Official Yamaha product specification. Rated power and torque only; no measured curve."
        }
      },
      {
        id: "yamaha-mt09-2025",
        manufacturer: "Yamaha",
        model: "MT-09",
        modelYear: 2025,
        category: "Naked",
        powertrainType: "ICE",
        transmission: "6-speed, chain final drive",
        peakPowerKw: 87.5,
        peakPowerRpm: 10000,
        peakTorqueNm: 93.0,
        peakTorqueRpm: 7000,
        frontTeeth: null,
        rearTeeth: null,
        massKg: null,
        provenance: {
          sourceType: "manufacturer_rated",
          qualityFlag: "published",
          url: "https://www.yamaha-motor.eu/gb/en/motorcycles/hyper-naked/pdp/mt-09/",
          note: "Official Yamaha product specification. Rated power and torque only; no measured curve."
        }
      },
      {
        id: "yamaha-tenere700-2026",
        manufacturer: "Yamaha",
        model: "Tenere 700",
        modelYear: 2026,
        category: "Adventure",
        powertrainType: "ICE",
        transmission: "6-speed, chain final drive",
        peakPowerKw: 54.0,
        peakPowerRpm: 9000,
        peakTorqueNm: 68.0,
        peakTorqueRpm: 6500,
        frontTeeth: null,
        rearTeeth: null,
        massKg: null,
        provenance: {
          sourceType: "manufacturer_rated",
          qualityFlag: "published",
          url: "https://www.yamaha-motor.eu/gb/en/motorcycles/adventure/pdp/t-n-r-700/",
          note: "Official Yamaha product specification. Rated power and torque only; no measured curve."
        }
      },
      {
        id: "yamaha-tracer9gtplus-2025",
        manufacturer: "Yamaha",
        model: "TRACER 9 GT+ Y-AMT",
        modelYear: 2025,
        category: "Touring",
        powertrainType: "ICE",
        transmission: "6-speed Y-AMT, chain final drive",
        peakPowerKw: 87.5,
        peakPowerRpm: 10000,
        peakTorqueNm: 93.0,
        peakTorqueRpm: 7000,
        frontTeeth: null,
        rearTeeth: null,
        massKg: null,
        provenance: {
          sourceType: "manufacturer_rated",
          qualityFlag: "published",
          url: "https://kiosk.yamaha-motor.eu/gb/en/motorcycles/sport-touring/pdp/tracer-9-gt-plus-y-amt/",
          note: "Official Yamaha product specification. Rated power and torque only; no measured curve."
        }
      },
      {
        id: "yamaha-r1-gytr-2025",
        manufacturer: "Yamaha",
        model: "R1 GYTR",
        modelYear: 2025,
        category: "Sport",
        powertrainType: "ICE",
        transmission: "Race specification 520 chain",
        peakPowerKw: null,
        peakPowerRpm: null,
        peakTorqueNm: null,
        peakTorqueRpm: null,
        frontTeeth: 15,
        rearTeeth: 42,
        massKg: null,
        provenance: {
          sourceType: "manufacturer_rated",
          qualityFlag: "published",
          url: "https://www.yamaha-motor.eu/gb/en/motorcycles/supersport/pdp/r1-gytr/",
          note: "Official Yamaha product page publishes the 15T/42T race final-drive combination."
        }
      }
    ]
  });
})(window);
