; Ganchos del instalador NSIS de Agenda.

; Agenda vive en la bandeja con el widget y no se cierra cuando Windows se lo pide
; (Restart Manager), así que el instalador no podía cerrarla. Se cierra a la fuerza,
; junto con sus procesos de WebView2, antes de la comprobación de "app abierta".
!macro CLOSE_AGENDA
  nsExec::Exec 'taskkill /F /T /IM "${MAINBINARYNAME}.exe"'
  Pop $0
  ; Dar tiempo a que Windows libere los archivos.
  Sleep 1500
!macroend

!macro NSIS_HOOK_PREINSTALL
  !insertmacro CLOSE_AGENDA
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  !insertmacro CLOSE_AGENDA
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Quitar el arranque con Windows (lo crea la app en HKCU\...\Run al activarlo).
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Agenda"
!macroend
