; HEADER_BLOCK_START
; PenPlot Studio 1.0.0
; model printing time: 11s; total estimated time: 56s
; total layer number: 2
; HEADER_BLOCK_END
; ============================================================
; PenPlot Studio 1.0.0 - pen plotter G-code
; Generated: 2026-01-01 00:00:00 UTC
; Design: golden
; Printer profile: Bambu Lab X1 Carbon
; Pen mount: Falu UMTS / "Head Mount V1 - Series X & P" (pen about 28 mm left of and 35 mm in front of the nozzle - confirm with the Offset finder)
; Pen offset from nozzle: X-28 Y-35 mm
; Z-Draw: 14 mm   Z-Lift: 20 mm   Attach height: 60 mm
; Draw speed: 30 mm/s   Travel: 200 mm/s   Z: 15 mm/s   Accel: 4000 mm/s^2
; Layers: 2   Pen-down paths: 3   Draw length: 165 mm   Travel: 166 mm
; Estimated plotting time: 56s (excluding pauses)
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
M109 S90 ; warm the nozzle to 90 C first, so Resume does not wait for it to cool
; **********************************************************
; PAUSE: attach the pen holder now, check the pen height,
;        then press RESUME on the printer screen.
; **********************************************************
; PP_PAUSE attach
M400 U1
G90 ; re-assert absolute mode after resume
M104 S0 ; heater off again before anything moves
G1 Z20 F900 ; pen up (travel height)

; ===== Layer 1/2: Ink (#1a1a1a) =====
G1 X128 Y135 F12000
G1 Z14 F900 ; pen down
M400 P50
G1 X138 Y135 F1800
G1 X138 Y145
G1 X128 Y145
G1 X128 Y135
G1 Z20 F900 ; pen up
M73 P85 R0

; ===== Layer 2/2: Cut (#e11d48) - knife =====
G1 Z60 F900 ; lower the bed for pen change
G1 X80 Y245 F12000 ; park toolhead
M400
M109 S90 ; warm the nozzle to 90 C first, so Resume does not wait for it to cool
; PAUSE: swap the pen holder for the knife holder, then press RESUME
; PP_PAUSE swap
M400 U1
G90
M104 S0 ; heater off again before anything moves
G1 Z20 F900 ; pen up
; PP_TOOL knife
G1 X168.25 Y140 F12000
G1 Z14 F900 ; knife down
G1 X173.25 Y140 F1200
G1 X173.246 Y140.043
G1 X173.235 Y140.086
G1 X173.217 Y140.125
G1 X173.192 Y140.161
G1 X173.161 Y140.192
G1 X173.125 Y140.217
G1 X173.086 Y140.235
G1 X173.043 Y140.246
G1 X173 Y140.25
G1 X173 Y150.25
G1 X172.957 Y150.246
G1 X172.914 Y150.235
G1 X172.875 Y150.217
G1 X172.839 Y150.192
G1 X172.808 Y150.161
G1 X172.783 Y150.125
G1 X172.765 Y150.086
G1 X172.754 Y150.043
G1 X172.75 Y150
G1 X162.75 Y150
G1 X162.754 Y149.957
G1 X162.765 Y149.914
G1 X162.783 Y149.875
G1 X162.808 Y149.839
G1 X162.839 Y149.808
G1 X162.875 Y149.783
G1 X162.914 Y149.765
G1 X162.957 Y149.754
G1 X163 Y149.75
G1 X163 Y139.75
G1 X163.043 Y139.754
G1 X163.086 Y139.765
G1 X163.125 Y139.783
G1 X163.161 Y139.808
G1 X163.192 Y139.839
G1 X163.217 Y139.875
G1 X163.235 Y139.914
G1 X163.246 Y139.957
G1 X163.25 Y140
G1 X168.25 Y140
G1 X169.25 Y140
G1 Z20 F900 ; knife up
M73 P90 R0
G1 X168.25 Y135 F12000
G1 Z14 F900 ; knife down
G1 X178.25 Y135 F1200
G1 X178.246 Y135.043
G1 X178.235 Y135.086
G1 X178.217 Y135.125
G1 X178.192 Y135.161
G1 X178.161 Y135.192
G1 X178.125 Y135.217
G1 X178.086 Y135.235
G1 X178.043 Y135.246
G1 X178 Y135.25
G1 X178 Y155.25
G1 X177.957 Y155.246
G1 X177.914 Y155.235
G1 X177.875 Y155.217
G1 X177.839 Y155.192
G1 X177.808 Y155.161
G1 X177.783 Y155.125
G1 X177.765 Y155.086
G1 X177.754 Y155.043
G1 X177.75 Y155
G1 X157.75 Y155
G1 X157.754 Y154.957
G1 X157.765 Y154.914
G1 X157.783 Y154.875
G1 X157.808 Y154.839
G1 X157.839 Y154.808
G1 X157.875 Y154.783
G1 X157.914 Y154.765
G1 X157.957 Y154.754
G1 X158 Y154.75
G1 X158 Y134.75
G1 X158.043 Y134.754
G1 X158.086 Y134.765
G1 X158.125 Y134.783
G1 X158.161 Y134.808
G1 X158.192 Y134.839
G1 X158.217 Y134.875
G1 X158.235 Y134.914
G1 X158.246 Y134.957
G1 X158.25 Y135
G1 X168.25 Y135
G1 X169.25 Y135
G1 Z20 F900 ; knife up
M73 P100 R0

; ===== End =====
G1 Z80 F900 ; lower the bed away from the pen
G1 X152 Y250 F12000 ; move toolhead out of the way
M400
M73 P100 R0
; Done - remove the pen holder before your next 3D print.
