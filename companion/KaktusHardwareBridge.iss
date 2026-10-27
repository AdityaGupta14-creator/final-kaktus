#define AppName "Kaktus Hardware Bridge"
#define AppVersion "1.0.1"
#define AppPublisher "Kaktus"
#define AppExe "KaktusHardwareBridge.exe"

[Setup]
AppId={{8D314E66-34B5-43BC-9DE2-5CDE199C5E35}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
DefaultDirName={localappdata}\Programs\Kaktus Hardware Bridge
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesInstallIn64BitMode=x64compatible
CloseApplications=yes
RestartApplications=no
OutputDir=..\dist
OutputBaseFilename=KaktusHardwareBridgeSetup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayIcon={app}\{#AppExe}

[Files]
Source: "..\dist\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion

[Run]
Filename: "{app}\{#AppExe}"; Parameters: "--background"; Flags: nowait skipifsilent

[Icons]
Name: "{group}\Kaktus Hardware Bridge"; Filename: "{app}\{#AppExe}"

[Registry]
Root: HKCU; Subkey: "Software\Classes\kaktus-bridge"; ValueType: string; ValueName: ""; ValueData: "URL:Kaktus Hardware Bridge"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\kaktus-bridge"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\kaktus-bridge\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"",0"; Flags: uninsdeletekeyifempty
Root: HKCU; Subkey: "Software\Classes\kaktus-bridge\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExe}"" ""%1"""; Flags: uninsdeletekeyifempty

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\Kaktus\HardwareBridge"

[UninstallRun]
Filename: "{sys}\taskkill.exe"; Parameters: "/IM {#AppExe} /F"; Flags: runhidden waituntilterminated
Filename: "{sys}\reg.exe"; Parameters: "delete ""HKCU\Software\Microsoft\Windows\CurrentVersion\Run"" /v KaktusHardwareBridge /f"; Flags: runhidden waituntilterminated
