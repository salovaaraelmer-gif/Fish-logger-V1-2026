# AnglrLog Handheld — Device Logic Specification

**Status:** Baseline (2026-08-21). Update this document as decisions are made.  
**Firmware:** Do **not** implement ESP32 / keypad / OLED firmware from this spec yet.  
**Phone BLE:** Do **not** implement Web Bluetooth or a Connect Handheld UI until this document says so.

This file is the starting point for the dedicated physical catch logger. Change numbered sections here when a decision is made. Do not treat open items in [§26](#26-still-to-be-finalized) or [§27](#27-considerations--not-decided) as implementation tasks.

Related existing work (phone / database only; not firmware):

- `js/handheldCatchService.js` — save path for a decoded handheld payload
- `js/catchRecordMap.js` — `source`, `device_id`, `client_event_id`, timestamp preservation
- `supabase/migrations/20260820120000_catches_handheld_prep.sql` — catch origin columns
- `docs/NOTES_2026-08-21.md` — working agreement for this baseline

---

## 1. Purpose

The AnglrLog Handheld is a dedicated physical controller for quickly logging fish catches during an active AnglrLog fishing session.

The phone remains responsible for:

- Starting and ending sessions
- Managing session participants
- Storing and synchronizing catch data
- Providing the handheld with current session information

The handheld is responsible for:

- Fast one-handed catch entry
- Physical keypad input
- Displaying the catch logging workflow
- Receiving future NMEA data
- Sending completed catch records to AnglrLog

## 2. Prototype Hardware

Main components:

- Adafruit ESP32-S3 Feather
- 3×4 waterproof keypad
- EA OLEDM204-LGA OLED display
- 3.7 V rechargeable battery
- Red/green bi-colour status LED

### Display

EA OLEDM204-LGA:

- OLED
- 20 characters × 4 rows
- Character-based display
- 3.3 V compatible

All interface screens must therefore be designed around:

**20 characters × 4 lines**

A small custom-character pixel-art fish may be used on the startup screen if practical.

## 3. Keypad

Layout:

```
1 2 3
4 5 6
7 8 9
* 0 #
```

Functions:

- `0–9` = menu selections and numeric input
- `*` = OK / Enter
- `#` = Back / Delete

Long press:

- Hold `*` approximately 2 seconds = Power ON
- Hold `#` approximately 3 seconds = Power OFF

A long press must not also trigger the normal short-press function.

## 4. Startup

When powered on, display for approximately 2–3 seconds:

```
      ANGLRLOG

   [PIXEL FISH]
```

Then:

```
CONNECTING...
```

When communication with AnglrLog is established:

```
CONNECTION OK
```

The device then checks whether an AnglrLog session is active.

## 5. Bluetooth Architecture

The first prototype targets:

**Android + Chrome + AnglrLog PWA + Web Bluetooth**

The AnglrLog application runs in the browser.

Initial connection should therefore be initiated from AnglrLog, for example:

**Settings → Connect Handheld**

Chrome displays its Bluetooth device selection interface.

The user selects the AnglrLog Handheld.

No custom pairing code is required.

After connection, AnglrLog and the handheld exchange session and catch data over BLE.

Automatic reconnection should be used where browser capabilities permit it, but the system must not assume that browser BLE connections can always be restored silently.

### iPhone

Direct BLE communication between the current browser/PWA version of AnglrLog and the handheld is **not** part of the prototype.

The prototype will use an Android phone.

A future iOS implementation may require a native application layer.

## 6. No Active Session

If the phone connection is established but no fishing session is running:

```
CONNECTED

START SESSION
IN ANGLRLOG
```

A session cannot be started from the handheld.

When a session is started from the phone, the handheld automatically receives the active session information.

## 7. Active Session Home

Default screen:

```
SESSION ACTIVE

1 LOG CATCH
```

Lines not currently required remain empty.

Press:

- `1` → start catch logging.

## 8. Angler Selection

The handheld receives the anglers participating in the active session from AnglrLog.

Example:

```
WHO CAUGHT THE FISH
1 JOHN
2 MIKE
3 ELMER
```

Pressing the corresponding number immediately selects that angler.

Typical session size:

- Usually 3 anglers
- Sometimes 4–5 anglers

The exact UI for displaying more anglers will be finalized later.

## 9. Species Selection

Species mapping:

| Key | UI label | Database value |
|-----|----------|----------------|
| 1 | Pike | `pike` |
| 2 | Perch | `perch` |
| 3 | Zander | `zander` |
| 4 | Trout | `trout` |
| 5 | Salmon | `salmon` |
| 6 | Other | `other` |

The numbers are UI shortcuts only. Database species values remain the keys above.

Page 1:

```
1 PIKE
2 PERCH
3 ZANDER
4 TROUT
```

Controls:

- `1–4` = select species
- `*` = next page
- `#` = previous step

Page 2:

```
5 SALMON
6 OTHER
```

## 10. Length

```
LENGTH (CM)

[       ]

* OK    # BACK
```

Input uses whole centimetres.

Examples:

- `8` → 8 cm
- `87` → 87 cm
- `108` → 108 cm

Controls:

- `*` = accept
- Empty + `*` = skip
- `#` = remove previous digit
- Empty + `#` = return to previous step

Allowed range:

**0–200 cm**

## 11. Weight

```
WEIGHT (KG)

[       ]

* OK    # BACK
```

Weight uses one implicit decimal place.

Examples:

- `1` → 0.1 kg
- `10` → 1.0 kg
- `42` → 4.2 kg
- `108` → 10.8 kg

Controls:

- `*` = accept
- Empty + `*` = skip
- `#` = delete previous digit
- Empty + `#` = previous step

Allowed range:

**0–100.0 kg**

## 12. Depth

Depth also uses one implicit decimal place.

Examples:

- `1` → 0.1 m
- `10` → 1.0 m
- `53` → 5.3 m

Allowed range:

**0–99.9 m**

### Without NMEA data

```
DEPTH (M)

[       ]

* OK    # BACK
```

### With NMEA data

If sufficiently recent NMEA depth data exists:

```
DEPTH (M)

5.3 NMEA

* OK    # BACK
```

Behaviour:

- `*` accepts the displayed NMEA value
- Numeric input replaces the NMEA value with manual input
- Empty field + `*` skips depth
- The source of the accepted value is stored

Possible sources:

- `manual`
- `nmea`

Old NMEA values must not be used as current measurements.

## 13. Water Temperature

Water temperature uses one implicit decimal place.

Examples:

- `1` → 0.1 °C
- `100` → 10.0 °C
- `186` → 18.6 °C

Allowed range:

**0–40.0 °C**

### Without NMEA

```
WATER TEMP (C)

[       ]

* OK    # BACK
```

### With NMEA

```
WATER TEMP (C)

18.6 NMEA

* OK    # BACK
```

Behaviour is identical to depth:

- `*` accepts NMEA value
- Numeric input overrides it
- Empty + `*` skips
- Source is recorded as `manual` or `nmea`

## 14. Invalid Input

If a value exceeds its allowed range:

```
INVALID VALUE
```

The device returns to the same input field.

The existing input remains so it can be corrected with `#`.

## 15. Catch Saving

There is no final catch confirmation screen.

After Water Temperature is accepted or skipped, the handheld immediately sends the catch to AnglrLog.

The handheld waits up to **5 seconds** for AnglrLog to confirm that the catch has been saved.

Successful save:

```
CATCH SAVED
```

After a short delay:

```
SESSION ACTIVE

1 LOG CATCH
```

If no confirmation arrives:

```
SAVE FAILED

* RETRY
# CANCEL
```

Retrying must send the same catch event again, not create a new catch identity.

## 16. Catch Data

The handheld integration should use the existing AnglrLog database structure.

Relevant catch data currently includes:

- `session_id`
- `angler_id`
- `species`
- `length_cm`
- `weight_kg`
- `depth_m`
- `depth_source`
- `water_temp_c`
- `water_temp_source`
- `caught_at`
- `location_lat`
- `location_lng`
- `location_source`
- `location_timestamp`
- `source`
- `device_id`
- `client_event_id`

For handheld catches:

**`source` = `handheld`**

Each catch receives one persistent `client_event_id`.

The same `client_event_id` must be reused if sending is retried.

## 17. Timestamp

The handheld records the catch time when the catch actually occurs.

The timestamp must not be replaced later by the time at which the phone receives the catch.

The ESP32 clock is synchronized from the phone when communication is established.

For the prototype, the ESP32's own clock is used.

No separate RTC component is currently required.

## 18. GPS

GPS information must represent the location at approximately the time the catch occurred.

Each location measurement should have:

- latitude
- longitude
- source
- timestamp

A later GPS position must never be assigned to an earlier catch simply because connectivity returned later.

Future NMEA GPS data can provide the location directly to the handheld.

## 19. Future NMEA Architecture

NMEA data will not come through the phone.

Planned architecture:

```
NMEA 2000 NETWORK
       │
       ▼
NMEA / BLE GATEWAY
       │
       │ Bluetooth
       ▼
ANGLRLOG HANDHELD
```

Required NMEA information:

- Water depth
- Water temperature
- GPS position
- GPS time where available

Boat speed and heading are not required.

The handheld should ultimately be capable of communicating simultaneously with:

- The Android phone / AnglrLog
- The NMEA BLE gateway

The firmware architecture should account for this from the beginning (when firmware work starts). Do not build the gateway or NMEA client now.

## 20. Session Synchronization

The phone is the master source for session state.

When a session starts, AnglrLog sends the handheld:

- session information
- session ID
- participant information
- required angler identifiers
- current time

If participants change, the handheld receives the updated participant list.

When the session ends:

```
CONNECTED

START SESSION
IN ANGLRLOG
```

The handheld cannot end the session.

Phone and handheld catches may be logged into the same active session simultaneously.

## 21. Connection Loss

Offline catch logging is not included in the first version.

If the connection disappears:

```
CONNECTION LOST
```

Then:

```
CONNECTING...
```

The handheld attempts to restore communication automatically where possible.

Once restored:

```
CONNECTION OK
```

The device then returns to the correct screen based on session state.

If connection is lost while entering a catch:

- entered values remain temporarily in memory
- they are not discarded
- the catch is not considered saved until AnglrLog confirms it

## 22. Display and Power Saving

After approximately 5 minutes without keypad input:

- OLED turns off
- ESP32 enters an appropriate low-power state
- BLE should use an energy-efficient configuration

Any keypad button wakes the device.

The wake-up press itself performs no menu action.

After wake-up:

- If a session is active: **SESSION ACTIVE / 1 LOG CATCH**
- If connected without a session: **CONNECTED / START SESSION IN ANGLRLOG**
- If not connected: **CONNECTING...**

## 23. Battery LED

The external LED is a red/green bi-colour LED.

Red and green together produce yellow.

### Normal operation

- Green = battery OK
- Yellow = battery low
- Red = battery critical
- Blinking red = automatic shutdown imminent

Initial targets:

- Yellow below approximately 30%
- Red below approximately 10%

Final thresholds should be calibrated using the actual battery.

### Charging

- Slow blinking green = charging
- Steady green = fully charged

The device can be used normally while charging.

At critically low battery level, the device performs a controlled shutdown.

## 24. Power Off

Turning off the handheld does not end the AnglrLog fishing session.

When restarted:

- Connect to AnglrLog
- Synchronize device time
- Retrieve current session state
- Retrieve current participant list
- Return to the appropriate home screen

The prototype may implement Power OFF as a very low-power ESP32 sleep state if this is required to allow the keypad to wake the device.

## 25. Design Principles

The implementation should prioritize:

- Fast catch entry
- Minimum number of button presses
- One-handed operation
- Wet-hand and glove usability
- No unnecessary confirmation screens
- Phone controls the session
- Handheld controls catch entry
- NMEA values are automatically offered when available
- Manual input can override NMEA
- Every automatic measurement retains its source and timestamp
- Catch data must never be silently changed during synchronization
- The architecture must remain ready for the future NMEA BLE gateway

## 26. Still To Be Finalized

The following items remain open. They are **not** firmware tasks yet:

- Exact 20×4 OLED screen layouts
- Angler list layout for 4–5 participants
- Exact acceptable age of NMEA measurements
- Final battery percentage thresholds
- Exact ESP32 sleep / wake implementation
- Final Web Bluetooth reconnection behaviour in Android Chrome
- Final NMEA gateway hardware and BLE protocol

---

## 27. Considerations — not decided

These are points that follow from the baseline above. They do **not** change §§1–26. Record a decision in the relevant section when one is made.

### Catch time vs start of the form

§17 says the handheld records time when the catch actually occurs. That could mean:

- when the user presses `1 LOG CATCH`, or
- when water temperature is accepted and the catch is sent.

The first option matches “when it happened” better if filling length/weight takes a while. Needs one explicit line in §17.

### Prototype GPS without NMEA

§18 forbids assigning a later phone GPS fix to an earlier catch. The prototype has no NMEA GPS. If the phone stamps location at receive time, that violates §18 after a reconnect delay.

Until NMEA GPS exists, v1 handheld catches may need **null location**, or the phone must **push recent GPS to the handheld during the session** so the handheld can stamp location at catch time. Do not silently fill GPS on the phone when the BLE payload arrives.

`location_source` values are not listed in §16. Phone catches currently use `device`. Handheld tests currently use `handheld`. NMEA GPS would likely be `nmea`. Align later.

### Depth / water-temp source strings

§12–13 store `manual` or `nmea`. Existing handheld unit tests still use `sonar` / `sensor` as placeholders. When firmware/protocol work starts, use `manual` / `nmea` as in this spec.

### NMEA shown: how to skip

If NMEA is on screen, `*` accepts it. Empty + `*` skips. A field showing `5.3 NMEA` is not empty, so there is no specified way to skip NMEA without typing over it. Decide whether `#` clears NMEA to an empty skippable field, or whether skip is simply not offered while NMEA is displayed.

### Connection loss and sleep vs in-progress catch

§21 keeps entered values in memory on disconnect, then shows **CONNECTION LOST** / **CONNECTING...**. After restore, the device returns to the screen for **session state** (home), not necessarily the form.

§22 wake-from-sleep also returns to home, not the in-progress form.

Unspecified: how the user **resumes** an unsaved catch after reconnect or wake, and whether a wake-up or disconnect **discards the form UI** while keeping values.

Offline **new** catch logging is out of v1. Completing the current form while disconnected is also unspecified (send will fail until AnglrLog is back).

### `client_event_id` mint time

§15–16 require one persistent id, reused on retry, not on a later new catch. A practical rule (not yet in §16): mint the UUID when the catch is first assembled after water temperature, keep it through **SAVE FAILED → RETRY**, and mint a new id only after **CANCEL** or a later **1 LOG CATCH**.

`device_id` is required by the current phone mapping. How it is assigned (MAC, serial, flash string) is not specified.

### Angler identifiers

Cloud `catches.angler_id` is the session-scoped `public.anglers.id`, not the profile / `user_id`. The phone should send that id plus a short display name. Keypad `1–n` is UI only.

If participants change while a catch is being entered, slot numbers can shift. Store the selected **angler id** at keypress time, not the slot number.

Typical 3 anglers fit the example 20×4 layout (title + 3 names). A fourth/fifth angler does not fit that example; paging is still open (§26). Names longer than 18 characters (`N ` + name) need truncation.

### Species page 2

Page 1: `*` next page, `#` previous step (angler). Page 2: `#` and `*` are not specified (previous page vs previous step; wrap vs no-op).

### Validation vs current phone app

| Field | Handheld (this spec) | Phone app today |
|-------|----------------------|-----------------|
| Length | 0–200 cm, skip if empty | empty or **≥ 1** cm |
| Weight | 0–100.0 kg, implicit 1 decimal | empty or **> 0**; explicit decimal |
| Depth | 0–99.9 m | ≥ 0, no max |
| Water temp | 0–40.0 °C | **−2 … 30** °C |

`js/catchRecordMap.js` `positiveNumberOrNull()` currently treats length/weight **0** as null. That would collide with “0 is allowed” if 0 is ever sent. Likely fine if 0 is unused in practice; decide whether 0 is a real value or should be invalid/skip.

Implicit decimals (weight/depth/temp) are easy to mis-type on a wet keypad (user means 1 kg, types `1`, gets 0.1 kg). Showing the interpreted value while typing would help; not specified.

### Web Bluetooth (prototype risk)

Chrome on Android requires HTTPS (or localhost), a user gesture to pick the device, and often drops the GATT connection when the phone sleeps or Chrome is backgrounded. Silent reconnect is not reliable (§5). A 5-second save ACK can fail even when the catch is valid if the PWA is not in the foreground. This is expected for the prototype; it should not be treated as a firmware bug.

iOS browser BLE is out of scope (§5).

GATT service/characteristic UUIDs, payload encoding (JSON vs binary), and who sends notifications are **not** specified. That protocol belongs in this document (or a sibling) **before** firmware.

### Dual BLE (phone + NMEA gateway)

§19 asks the firmware architecture to allow two Bluetooth links later. Do not implement the gateway now. Note only: ESP32-S3 can support multiple connections, but the role split (peripheral to the phone, central to a NMEA gateway, or the reverse) is still open.

### Power, sleep, LED

Hold `*` for Power ON implies `*` is on a wake-capable GPIO if Power OFF is deep sleep (§24).

Charging shows blinking/steady green. Low battery is yellow/red. Priority when charging at a low percentage is unspecified; charging indication probably wins because §23 allows normal use while charging.

Battery % from a 3.7 V LiPo is non-linear; 30% / 10% stay calibration targets (§26).

### Pixel fish

EA OLEDM204-style character OLED typically allows a few custom 5×8 CGRAM glyphs. A small fish on the splash is practical; not required if it delays the prototype.
