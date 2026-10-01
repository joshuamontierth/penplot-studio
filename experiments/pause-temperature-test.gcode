; PenPlot Studio - pause temperature experiment (X1C, NOTHING ATTACHED)
; Question: is the wait after Resume the firmware waiting for the nozzle to reach its saved target?
; Our files set the target to 0 C, which a nozzle in a warm chamber never reaches, so it may run into a timeout.
; For each of the three pauses, time from pressing Resume to the 30 mm sideways move, and note the
; nozzle temperature on the screen when you press Resume.
;   A: target 0 C before the pause (what plots do now)
;   B: target 90 C set just before the pause (no waiting), heater off right after Resume
;   C: nozzle actually brought to 90 C before the pause (M109 waits), heater off right after Resume
; If B or C resume much faster than A, the plot files can do the same before each pause.
; Keep fingers off the nozzle: it is about 90 C during the pauses.

; ===== Start =====
G90 ; absolute coordinates
G21 ; millimetres
M83 ; relative extrusion (no extrusion is used)
M104 S0 ; hotend heater off - pen plotting needs no heat
M140 S0 ; bed heater off
M106 S0 ; part cooling fan off
M106 P2 S0 ; aux fan off
M106 P3 S0 ; chamber fan off
M220 S100 ; speed factor 100%
M204 S4000 ; acceleration
G91
M17 Z0.4 ; lower the Z motor current
G380 S2 Z30 F300 ; lower the bed (stops on contact)
G380 S2 Z-25 F300
G1 Z5 F300
G90
M17 X1.2 Y1.2 Z0.75 ; restore motor currents
G28 ; home all axes - the pen holder must NOT be attached yet
G90
G1 Z60 F900 ; lower the bed for pen clearance
G1 X80 Y245 F12000 ; park toolhead
M400 ; wait for moves to finish

; ===== Test A: target 0 (current behaviour) =====
M104 S0
M400
; PAUSE A: nothing attached - press Resume and time until the toolhead moves sideways
M400 U1
G90
; (heater already off)
G1 X110 Y245 F3000 ; marker: 30 mm to the right = Resume finished
G1 X80 Y245 F3000
M400

; ===== Test B: target 90 set before the pause =====
M104 S90 ; set the target, do not wait
M400
; PAUSE B: nothing attached - press Resume and time until the toolhead moves sideways
M400 U1
G90
M104 S0 ; heater off again right after Resume
G1 X110 Y245 F3000 ; marker: 30 mm to the right = Resume finished
G1 X80 Y245 F3000
M400

; ===== Test C: nozzle at 90 before the pause =====
M109 S90 ; heat to 90 and wait
M400
; PAUSE C: nothing attached - press Resume and time until the toolhead moves sideways
M400 U1
G90
M104 S0 ; heater off again right after Resume
G1 X110 Y245 F3000 ; marker: 30 mm to the right = Resume finished
G1 X80 Y245 F3000
M400

; ===== End =====
M104 S0
G1 Z80 F900
G1 X152 Y250 F12000
M400
; Done
