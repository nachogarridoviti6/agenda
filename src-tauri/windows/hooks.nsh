; Ganchos del instalador NSIS de Agenda.

!macro NSIS_HOOK_POSTUNINSTALL
  ; Quitar el arranque con Windows (lo crea la app en HKCU\...\Run al activarlo).
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Agenda"
!macroend
