# BMS Control Systems with Embedded C — 40-Hour Curriculum

## Target

In 10 days at 4 focused hours per day, build a working, testable BMS firmware model in C and gain the practical foundation needed to discuss and implement the main work of a junior BMS firmware/systems engineer.

Forty hours cannot cover every production detail. The goal is the high-value 80%:

- Lithium-ion cell and pack fundamentals
- Requirements, signals, units, limits, and failure behavior
- Embedded C patterns used in safety-oriented firmware
- Measurement acquisition and validation
- SOC estimation using coulomb counting plus OCV correction
- Voltage, current, and temperature protections
- Contactor and precharge control
- Passive balancing
- CAN signals, commands, status, and diagnostics
- Fault management, debouncing, latching, and recovery
- NVM concepts, watchdogs, timing, and safe-state behavior
- Unit, integration, boundary, and fault-injection testing
- Calibration, traceability, and basic safety engineering

## Capstone

Build a hardware-independent BMS controller for a simulated 12-cell pack. It will:

1. Read simulated cell voltages, pack current, and temperatures.
2. reject or flag invalid sensor data.
3. estimate SOC.
4. detect and debounce faults.
5. manage OFF, PRECHARGE, RUN, CHARGE, and FAULT states.
6. command contactors and passive balancing.
7. publish a CAN-style status frame.
8. store selected persistent values through an NVM abstraction.
9. pass automated normal, boundary, and fault-injection tests.

## Reference Firmware Architecture

The architecture is introduced on Day 1 and used throughout all 40 hours. Dependencies point downward only: application code may call services, services may call drivers, and drivers may call the HAL. Lower layers must never depend on application modules.

```text
┌─────────────────────────────────────────────────────────────────────┐
│ L5 — Vehicle/System Interface                                       │
│ BMS commands, published status, charge/discharge limits, diagnostics │
├─────────────────────────────────────────────────────────────────────┤
│ L4 — BMS Application and Control                                    │
│ SOC/SOH interface, protection, fault policy, state machine,          │
│ contactor/precharge decisions, balancing, thermal/derating           │
├─────────────────────────────────────────────────────────────────────┤
│ L3 — Platform Services                                              │
│ scheduler/time, acquisition, filtering, signal validation, CAN       │
│ transport, diagnostic storage, NVM service, watchdog supervision     │
├─────────────────────────────────────────────────────────────────────┤
│ L2 — Device Drivers                                                 │
│ battery-monitor/AFE, ADC, current sensor, temperature input,         │
│ contactor output/feedback, balancing output, CAN, NVM, watchdog      │
├─────────────────────────────────────────────────────────────────────┤
│ L1 — MCU/BSP/HAL                                                    │
│ clocks, GPIO, SPI, ADC, timers, CAN peripheral, reset/startup        │
├─────────────────────────────────────────────────────────────────────┤
│ Hardware                                                            │
│ cells, sensors, AFE, isolation, contactors, precharge, MCU, CAN      │
└─────────────────────────────────────────────────────────────────────┘

Cross-cutting concerns:

- **Configuration and calibration:** typed, range-checked inputs used by L3–L5.
- **Safety mechanisms:** plausibility checks, independent supervision, timeout handling, safe-state behavior, and watchdog strategy across layers.
- **Observability:** events, DTCs, freeze frames, traces, and debug data without changing control decisions.
- **Verification:** host simulator, mocks, unit tests, integration tests, and fault injection remain outside production layers.

### Module ownership

| Module | Layer | Owns | Must not own |
|---|---|---|---|
| `hal_*` | L1 | MCU peripheral access | Battery or vehicle policy |
| `drv_afe`, `drv_current`, `drv_contactor`, `drv_can` | L2 | Device transactions and raw status | SOC, protection thresholds, state decisions |
| `svc_measurement` | L3 | Scaling, filtering, timestamps, validity | Shutdown policy |
| `svc_time`, `svc_nvm`, `svc_diag`, `svc_comms` | L3 | Reusable infrastructure | BMS operating-state policy |
| `app_soc` | L4 | SOC state and estimator math | ADC/SPI/CAN access |
| `app_protection` | L4 | Detection and qualification of hazards | Direct GPIO or contactor writes |
| `app_fault` | L4 | Fault lifecycle and reaction requests | Device register access |
| `app_state` | L4 | Operating-state transitions | Raw sensor conversion |
| `app_contactor`, `app_balance`, `app_thermal` | L4 | Safe actuator decisions and permissions | MCU peripheral access |
| `sys_bms` | L5 | External commands, limits, status, orchestration | Hardware-specific transactions |
| `cfg_calibration` | Cross-cutting | Validated thresholds, timers, capacities | Mutable runtime state |
| `sim_*`, `test_*` | Verification | Plant model, mocks, scenarios, assertions | Production behavior |

### Runtime data flow

```text
Simulated plant or hardware
        ↓
L1 HAL → L2 drivers → L3 acquisition/filter/validation
                              ↓
                    validated signal snapshot
                              ↓
        L4 SOC + protection + faults + state/control
                              ↓
                    requested safe outputs
                              ↓
L3 output service → L2 drivers → L1 HAL → actuators
                              ↓
              L5 status, limits, and diagnostics
```

Application modules consume one immutable, time-consistent input snapshot per scheduler cycle. They produce requested outputs. A final output-arbitration step applies state and safety permissions before any driver is called.

## Working Method

Each hour uses the same rhythm:

- 15 minutes: concept
- 15 minutes: worked example or design
- 25 minutes: implementation or analysis
- 5 minutes: retrieval quiz and engineering log

At the end of every hour, commit or save one visible artifact: code, test, diagram, requirement, calibration table, or test result.

### Architecture-first feature workflow

Use this workflow for every feature, beginning in Hour 4:

1. **Requirement:** state trigger, timing, reaction, recovery, units, and failure behavior.
2. **Layer allocation:** identify which layer owns the mechanism and which layer owns the policy.
3. **Interface contract:** define typed inputs, outputs, validity, timing, units, ranges, and error behavior in a header.
4. **Unit test first:** add normal, boundary, stale-data, and failure cases using mocks below the target layer.
5. **Implement within one layer:** no direct calls that skip a layer; no application access to HAL or drivers.
6. **Integrate bottom-up:** HAL/driver stub → service → application → system interface.
7. **Trace and review:** link requirement → module → test; inspect dependency direction and timing.

### Dependency rules checked every day

- L5 may depend on L4 and L3 interfaces.
- L4 may depend on L3 interfaces and calibration, never directly on L2/L1.
- L3 may depend on L2 interfaces.
- L2 may depend on L1 interfaces.
- L1 is unaware of BMS policy.
- Modules communicate through headers and explicit data, not shared writable globals.
- Measurement producers attach validity and age; consumers must handle invalid data.
- Control decisions and physical output writes occur in separate modules.
- Tests may replace any lower layer with a fake or mock.

## Ten-Day Schedule

### Day 1 — Battery, Embedded-C, and Architecture Foundations

| Hour | Learn | Hands-on task | Evidence of completion |
|---|---|---|---|
| 1 | What a BMS controls; cell/module/pack hierarchy; voltage, current, temperature, capacity, energy, power, C-rate | Calculate series-pack voltage, current, energy, and C-rate for three examples | `day01_pack_math.md` with correct units and answers |
| 2 | Li-ion behavior: charge/discharge, OCV-SOC relationship, internal resistance, heat, aging, safe operating area | Plot or tabulate terminal voltage under three currents using `V_terminal = OCV - I*R` | Table explaining voltage sag and heat |
| 3 | Embedded C essentials: integer widths, signedness, fixed-width types, structs, enums, arrays, pointers, `const`, overflow | Implement pack measurement types and unit-safe naming | Compiling `bms_types.h` and example program |
| 4 | L1–L5 architecture, dependency direction, deterministic tasks, snapshots, requested vs applied outputs | Create layer directories, public interfaces, a host HAL, and a 10 ms orchestration loop | Dependency diagram plus program running 1,000 deterministic ticks |

**Day deliverable:** A compiling layered skeleton with `hal`, `drivers`, `services`, `application`, `system`, `config`, `sim`, and `tests`.

### Day 2 — Requirements and Measurement Chain

| Hour | Learn | Hands-on task | Evidence of completion |
|---|---|---|---|
| 5 | Translating safety goals into software requirements; shall statements; thresholds, timing, reaction, recovery | Write requirements for overvoltage, undervoltage, overtemperature, and overcurrent | Requirements with unique IDs and testable criteria |
| 6 | ADC and battery-monitor signal path; scaling, offset, resolution, saturation, plausibility | Convert raw counts to mV, mA, and deci-degrees C using integer arithmetic | Conversion functions plus boundary tests |
| 7 | Sampling effects: noise, aliasing, moving average, IIR filter, latency | Implement and compare raw, moving-average, and first-order IIR results | Test output showing noise/latency tradeoff |
| 8 | Data validity: range, stuck, timeout, rate-of-change, redundancy, open-wire concept | Add validity flags and timestamp/age checks for every measurement group | Injected invalid samples are detected |

**Day deliverable:** L2 driver stubs plus an L3 validated acquisition service that exposes physical-unit signal snapshots.

### Day 3 — Interface Contracts and SOC

| Hour | Learn | Hands-on task | Evidence of completion |
|---|---|---|---|
| 9 | Interface contracts between layers: ownership, units, validity, age, update rate, initialization, error behavior | Define L3 measurement-snapshot and L4 estimator contracts; add a dependency check | Reviewed headers with no circular or upward dependencies |
| 10 | SOC meaning, usable vs absolute capacity, coulomb counting, current sign, sample time | Implement `SOC += current * dt / capacity` with saturation | SOC changes correctly for charge and discharge |
| 11 | Numeric design: scaling, precision, accumulation, 32/64-bit overflow, time bases | Create a fixed-point SOC representation and overflow analysis | Documented numeric ranges and long-run test |
| 12 | Drift correction: initialization, OCV lookup, rest detection, capacity/efficiency calibration | Add OCV lookup/interpolation and correction only during qualified rest | SOC converges toward an OCV-derived value |

**Day deliverable:** An L4 SOC estimator consuming only the L3 validated snapshot and calibration interface.

### Day 4 — Protection and Fault Management

| Hour | Learn | Hands-on task | Evidence of completion |
|---|---|---|---|
| 13 | Protection classes and reaction levels: warning, derate, inhibit, shutdown | Build a protection matrix for voltage, current, and temperature | Matrix maps detection to system response |
| 14 | Debounce, hysteresis, confirmation timers, asymmetric set/clear behavior | Implement reusable threshold-with-time qualification | No chatter around thresholds; exact timing tests pass |
| 15 | Fault lifecycle: active, confirmed, latched, healed, cleared; first-fault capture | Implement fault bits and metadata | Fault injection produces expected lifecycle |
| 16 | Sensor/communication/internal faults and safe-state policy | Add stale-data and internal-consistency faults | Missing or contradictory data forces a defined response |

**Day deliverable:** L4 protection and fault-policy modules with deterministic detection and recovery.

### Day 5 — State Machine, Contactors, and Precharge

| Hour | Learn | Hands-on task | Evidence of completion |
|---|---|---|---|
| 17 | Hierarchical system states, transition guards, entry/exit actions, illegal transitions | Define INIT, OFF, PRECHARGE, RUN, CHARGE, and FAULT states | State-transition table and enum |
| 18 | Contactor topology, auxiliary feedback, weld/open detection, sequencing | Implement contactor command logic separate from feedback | Simulation detects command/feedback mismatch |
| 19 | Precharge RC behavior, timeout, success ratio, bus sensing, discharge path | Implement precharge success and timeout rules | Nominal and failed-precharge tests pass |
| 20 | Integration of requests, validity, protection, and state transitions | Run start, stop, charge, critical-fault, and recovery scenarios | Logged traces match the transition table |

**Day deliverable:** L4 operating-state and contactor-decision modules, with output application isolated behind L3/L2 interfaces.

### Day 6 — Balancing and Thermal Control

| Hour | Learn | Hands-on task | Evidence of completion |
|---|---|---|---|
| 21 | Passive balancing purpose, energy loss, delta-voltage logic, SOC region, charger interaction | Write balancing enable/inhibit criteria | Reviewable decision table |
| 22 | Balancing selection, maximum simultaneous channels, adjacency and thermal constraints | Implement channel selection using sorted or threshold logic | Tests show correct cell masks |
| 23 | Pack thermal model, sensor placement, gradients, cooling/heating commands, derating | Implement temperature extrema, gradient, and simple derate output | Thermal boundary tests pass |
| 24 | Coordinating balancing, thermal limits, charging, and faults | Integrate balancing with state and thermal permissions | Balancing stops under every inhibit condition |

**Day deliverable:** L4 passive-balancing and thermal-permission logic with explicit L3 output requests.

### Day 7 — CAN and Diagnostics

| Hour | Learn | Hands-on task | Evidence of completion |
|---|---|---|---|
| 25 | CAN fundamentals: identifiers, DLC, byte order, scaling, offset, cycle time, timeout, counters, CRC concept | Define a small BMS CAN database in a signal table | Signal definitions include units and valid ranges |
| 26 | Packing/unpacking without undefined behavior; endian-safe helpers | Implement status-frame encoding and command decoding | Golden-vector tests pass |
| 27 | Network management: alive counter, timeout, invalid command handling, degraded mode | Add command freshness and alive-counter validation | Dropped/frozen command frames are detected |
| 28 | Diagnostics: DTC status, freeze-frame data, service requests, clear authorization | Implement a small diagnostic snapshot and fault-clear API | Fault history is observable and controlled |

**Day deliverable:** L3 communication/diagnostic services and an L5 system-status interface, tested independently.

### Day 8 — Production Firmware Concerns

| Hour | Learn | Hands-on task | Evidence of completion |
|---|---|---|---|
| 29 | Startup, reset cause, brownout, watchdog, task deadline monitoring | Add initialization sequencing and watchdog-service conditions | Deliberate scheduler failure prevents watchdog service |
| 30 | NVM: atomicity, CRC, versioning, wear, defaults, interrupted writes | Design a dual-copy or versioned NVM record abstraction | Corrupted-record tests select a valid/default record |
| 31 | Defensive C: undefined behavior, volatile vs atomicity, reentrancy, race awareness, MISRA mindset | Review and repair a deliberately unsafe module | Review notes explain each defect |
| 32 | Calibration separation, bounds, version identity, immutable configuration | Move thresholds/timers into validated calibration data | Out-of-range calibration is rejected |

**Day deliverable:** L1 startup, L2 watchdog/NVM drivers, L3 supervision/NVM services, and cross-cutting calibration validation.

### Day 9 — Verification and Safety Thinking

| Hour | Learn | Hands-on task | Evidence of completion |
|---|---|---|---|
| 33 | Unit tests, equivalence classes, boundary values, decision tables, coverage thinking | Create a test catalog for each module | Every requirement maps to at least one test |
| 34 | Integration tests and plant simulation; closed-loop scenarios | Build scripted drive, charge, rest, and thermal scenarios | Scenario logs show expected SOC and states |
| 35 | Fault injection: sensors stuck/open, CAN loss, welded contactor, precharge failure, NVM corruption | Execute a fault-injection campaign | Results table records detection and reaction time |
| 36 | Safety lifecycle overview: hazard, safety goal, FMEA/FMEDA intuition, freedom from interference, ISO 26262 context | Perform a lightweight FMEA on contactor control | Failure modes have cause, effect, detection, mitigation |

**Day deliverable:** Traceable tests across every layer, integration scenarios, and a lightweight safety analysis.

### Day 10 — Integration and Engineer-Level Review

| Hour | Learn | Hands-on task | Evidence of completion |
|---|---|---|---|
| 37 | System tuning and calibration using traces; separating defect from calibration issue | Tune thresholds/timers against supplied scenarios | Before/after evidence and rationale |
| 38 | Debugging workflow: reproduce, instrument, isolate, hypothesize, test, prevent recurrence | Diagnose three seeded faults without reading their answers | Root-cause reports and regression tests |
| 39 | Design review: interfaces, failure containment, timing, memory, testability, assumptions | Conduct a checklist-based code and systems review | Prioritized findings with proposed actions |
| 40 | Capstone demonstration and interview-style defense | Run all tests; explain architecture, tradeoffs, safety behavior, and next gaps | Passing build plus a 10-minute technical walkthrough |

**Day deliverable:** Demonstrable L1–L5 BMS controller, architecture/dependency report, test report, and personal gap list.

## Layer Build Sequence Across the 40 Hours

| Hours | Architecture progress |
|---|---|
| 1–3 | Define domain quantities and C types shared through controlled interfaces |
| 4 | Establish L1–L5 folders, dependency rules, scheduler, simulator boundary, and orchestration |
| 5–8 | Specify behavior, stub L2 measurement drivers, and build L3 acquisition/validation |
| 9–12 | Freeze L3/L4 contracts and add the first L4 algorithm: SOC |
| 13–16 | Add L4 protection and fault policy without hardware dependencies |
| 17–20 | Add L4 state/contactor decisions; connect outputs downward through L3/L2 |
| 21–24 | Add L4 balancing and thermal control using the same snapshot/output pattern |
| 25–28 | Add L3 CAN/diagnostics and expose selected information through L5 |
| 29–32 | Strengthen L1–L3 platform behavior and cross-cutting configuration/safety mechanisms |
| 33–36 | Verify each layer in isolation, then verify vertical end-to-end behavior |
| 37–40 | Tune, debug, review dependency direction, and demonstrate the integrated architecture |

## Daily Routine

Before the four hours:

- State the day's output in one sentence.
- Recall yesterday's architecture from memory for five minutes.

After the four hours:

- Record three things learned, two uncertainties, and one defect found.
- Run the complete automated test suite.
- Explain one design choice aloud without notes.

## Assessment Gates

### Gate 1 — End of Day 2

You can explain pack quantities, read C data structures, convert raw measurements, and distinguish a bad sensor value from a real dangerous value.

### Gate 2 — End of Day 5

You can implement SOC, time-qualified protections, faults, and safe contactor/precharge state transitions.

### Gate 3 — End of Day 8

You can integrate balancing, thermal limits, CAN, diagnostics, watchdog, NVM, and calibrations without mixing their responsibilities.

### Gate 4 — End of Day 10

You can derive tests from requirements, inject failures, interpret traces, review code, and defend the capstone design.

## Definition of “80%”

At completion, you should be able to:

- Contribute to application-layer BMS firmware under review.
- Read a battery-monitor IC or MCU datasheet and design a driver interface.
- Turn system requirements into state, logic, calibrations, and tests.
- Debug common measurement, state-machine, protection, and CAN problems.
- Communicate with hardware, controls, validation, safety, and vehicle teams.

You will not yet be independently expert in:

- Production battery-monitor IC drivers and board bring-up
- AUTOSAR stacks and OEM-specific diagnostic protocols
- Advanced SOC/SOH algorithms such as EKF/UKF and electrochemical models
- Cell characterization and aging-model identification
- Full ISO 26262 work products and ASIL decomposition
- High-voltage laboratory procedures and compliance certification

These are the recommended next 80–160 hours after the capstone.

## Safety Boundary

Use simulation or a current-limited, isolated, low-voltage training setup. Do not connect beginner firmware to a live high-voltage battery pack. Real pack work requires approved hardware, PPE, isolation, discharge verification, supervision, and the organization's safety process.

## Hour 1 — Start Now

### Core model

- A **cell** is one electrochemical unit.
- Cells in **series** add voltage; their amp-hour capacity does not add.
- Parallel strings add current capability and amp-hour capacity.
- `Power (W) = Voltage (V) * Current (A)`.
- `Energy (Wh) = nominal voltage (V) * capacity (Ah)`.
- `C-rate = current (A) / capacity (Ah)`.
- A BMS observes the pack, estimates hidden state, enforces limits, controls energy paths, communicates status, and records faults.

Use the convention:

- Positive current = discharge
- Negative current = charge

Keep the convention explicit in every interface because inconsistent current signs are a common systems defect.

### Exercise

For a `12s2p` pack made from `3.6 V`, `5 Ah` cells:

1. Calculate nominal pack voltage.
2. Calculate pack capacity in Ah.
3. Calculate nominal energy in Wh.
4. Calculate pack C-rate at `20 A` discharge.
5. If each cell has `12 mΩ` internal resistance, calculate the pack's approximate resistance, voltage sag at `20 A`, and resistive heating. Assume ideal current sharing between the two parallel cells.
6. List the minimum measurements and actuators your BMS needs.
7. Explain why pack voltage alone cannot prove that every series cell is safe.

### Self-check answers

Do the exercise before expanding this section.

<details>
<summary>Answers</summary>

1. `12 * 3.6 V = 43.2 V`
2. `2 * 5 Ah = 10 Ah`
3. `43.2 V * 10 Ah = 432 Wh`
4. `20 A / 10 Ah = 2 C`
5. Two `12 mΩ` cells in parallel give `6 mΩ` per parallel group. Twelve groups in series give `72 mΩ`. Sag is `20 A * 0.072 Ω = 1.44 V`. Heating is `20^2 * 0.072 = 28.8 W`.
6. Typical measurements: every series-group voltage, pack current, representative cell/board/bus temperatures, pack or bus voltage, contactor feedback, and communication health. Typical actuators: main contactors, precharge path, discharge path where present, balancing channels, cooling/heating request, and status/diagnostic communication.
7. Individual cells can be imbalanced. Their voltages sum to an apparently valid pack voltage even while one cell is above or below its safe limit.

</details>

### Hour 1 exit test

Without notes, define voltage, current, power, energy, capacity, SOC, and C-rate, each with its unit. Then explain in two minutes why a BMS needs cell-level measurements and a controlled safe state.
