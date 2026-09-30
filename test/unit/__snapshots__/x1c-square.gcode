; HEADER_BLOCK_START
; PenPlot Studio 1.0.0
; model printing time: 3s; total estimated time: 48s
; total layer number: 1
; HEADER_BLOCK_END
; ============================================================
; PenPlot Studio 1.0.0 - pen plotter G-code
; Generated: 2026-01-01 00:00:00 UTC
; Design: square
; Printer profile: Bambu Lab X1 Carbon
; Pen mount: Falu UMTS / "Head Mount V1 - Series X & P" (pen about 28 mm left of and 35 mm in front of the nozzle - confirm with the Offset finder)
; Pen offset from nozzle: X-28 Y-35 mm
; Z-Draw: 14 mm   Z-Lift: 20 mm   Attach height: 60 mm
; Draw speed: 30 mm/s   Travel: 200 mm/s   Z: 15 mm/s   Accel: 4000 mm/s^2
; Layers: 1   Pen-down paths: 1   Draw length: 40 mm   Travel: 120 mm
; Estimated plotting time: 48s (excluding pauses)
; Coordinates below are NOZZLE coordinates (pen position minus pen offset).
; ============================================================

; ===== Start =====
M73 P0 R1
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
; **********************************************************
; PAUSE: attach the pen holder now, check the pen height,
;        then press RESUME on the printer screen.
; **********************************************************
; PP_PAUSE attach
M400 U1
G90 ; re-assert absolute mode after resume
G1 Z20 F900 ; pen up (travel height)

; ===== Layer 1/1: Layer 1 (#000000) =====
G1 X128 Y135 F12000
G1 Z14 F900 ; pen down
M400 P50
G1 X138 Y135 F1800
G1 X138 Y145
G1 X128 Y145
G1 X128 Y135
G1 Z20 F900 ; pen up
M73 P100 R0

; ===== End =====
G1 Z80 F900 ; lower the bed away from the pen
G1 X80 Y245 F12000 ; park toolhead
M400
; PAUSE: remove the pen holder now, then press RESUME to finish
; PP_PAUSE remove
M400 U1
G90
G1 X152 Y250 F12000 ; move toolhead out of the way
M400
M73 P100 R0
; Done - remove the pen holder before your next 3D print.
