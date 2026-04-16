unit DecoderInterface;

interface

uses
  DataStructures, DatabaseAccess, Utilities,
  MylapsSDK,
  Forms, Vcl.Dialogs, Classes, SysUtils, StrUtils, ComCtrls, StdCtrls, ExtCtrls, System.TimeSpan,
  IdTCPConnection, IdTCPClient, IdBaseComponent, IdComponent, IdCustomTCPServer, IdTCPServer, IdUdpServer,
  IdGlobal, IdSocketHandle, System.SyncObjs, AdPort, Math, System.DateUtils,
  Winapi.Windows, Winapi.MMSystem, IdHttp, System.JSON;

const

  // MyLaps protocol P3 (source: http://www.hobbytalk.com/bbs1/archive/index.php/t-73738.html)

  // "TOR", i.e. "type of record" constants
   TOR_RESET = $00;
  TOR_PASSING = $01;
  TOR_STATUS = $02;
  TOR_VERSION_DECODER = $03;
  TOR_RESEND = $04;
   TOR_FIRST_CONTACT = $45;
   TOR_ERROR = $FFFF;
   TOR_CLEAR_PASSING = $05;
   TOR_WATCHDOG = $18;
   TOR_PING = $20;
   TOR_SIGNALS = $2d;
   TOR_SERVER_SETTINGS = $13;
  TOR_SESSION = $15;
   TOR_GENERAL_SETTINGS = $28;
   TOR_LOOP_TRIGGER = $2f;
   TOR_GPS_INFO = $30;
   TOR_TIMELINE = $4a;
  TOR_GET_TIME = $24;
   TOR_NETWORK_SETTINGS = $16;

  // message type "PASSING" constants
  PASSING_NUMBER = $01; //(4 byte) (example of "FOR" - 0x01(TOF):0x04(length):0x00:0x00:0x00:0x00)
  TRANSPONDER_ID_TYPE_TRANX = $03;
  TRANSPONDER_ID_TYPE_PROCHIPFLEXCHIP = $0a;
  RTC_ID = $13;
  RTC_TIME = $04;    // (8 byte, time microseconds after January 1, 1970 00:00:00 GMT)
  UTC_TIME = $10;    // (8 byte, time microseconds after January 1, 1970 00:00:00 GMT)
  STRENGTH = $05;
  HITS = $06;
  FLAGS = $08;
  USER_FLAG = $0e;
  DRIVER_ID = $0f;
  SPORT = $14;
  VOLTAGE = $30;     // (1 byte, V = (float)voltage/10)
  TEMPERATURE = $31; // (1 byte, T = temperature - 100)
  DECODER_ID = $81;

  // message type "STATUS" constants
  STATUS_NOISE = $01;
  STATUS_GPS = $06;          // (1 byte; 0=false, 1=true)
  STATUS_TEMPERATURE = $07;
  STATUS_SATINUSE = $0a;
  STATUS_LOOP_TRIGGERS = $0b;
  STATUS_INPUT_VOLTAGE = $0c;// (1 byte, Voltage = (float)input_voltage/10)

  // message type "RESEND" constants
  RESEND_FROM = $01;
  RESEND_TO = $02;

  // message type "RTC" constants
  FOM_RTC = $01;

  // message type "Session" constants
  LAST_PASSING_INDEX = $04;

  // TOR VERSION constants
  TOR_VERSION_DECODER_TYPE = $02;
  TOR_VERSION_DECODER_FIRMWARE = $03;
  TOR_VERSION_DECODER_ID = $81;

  // general message constants
  CONTROLLER_ID = $83;
  REQUEST_ID = $85;

type
     TMyLapsProtocol = (mlpP3, mlpX2);
     TDecoderType = (dcUnknown, dcChipX, dcProChipSmart, dcX2, dcWebService);
     TDecoderListenerBase = class (TThread)
       private
         FMessage: string;
         FDecoderData: TDecoderData;
         FRtcQuerySendTime: TDateTime;
         FDecoderType: TDecoderType;
       public
         constructor Create (DecoderData: TDecoderData); reintroduce;
         destructor Destroy; override;
         property DecoderData: TDecoderData read FDecoderData;
         property DecoderType: TDecoderType read FDecoderType;
         procedure SendQuery(Msg: string); virtual; abstract;
         property RtcQuerySendTime: TDateTime read FRtcQuerySendTime;
     end;
     TDecoderListeners = array of TDecoderListenerBase;



     { TMyLapsP3MessageParser }

     TMyLapsP3Passing = record
       PassingNumber: integer;
       TransponderId: string;
       PassingTime: TDateTime;
       SignalStrength: integer;
       Hits: integer;
       Sport: byte;
       DecoderId: string;
       LowBattWarning: boolean;
     end;
     TMyLapsP3Passings = array of TMyLapsP3Passing;

     TMyLapsP3Status = record
       Noise: integer;
       Gps: boolean;
       Temperature: double;
       InputVoltage: double;
       DecoderId: string;
     end;

     TMyLapsP3VersionDecoder = record
       FirmwareVersion: string;
       DecoderType: string;   // "ProChip Smart Decoder" or "ChipX Decoder"
       DecoderId: string;
     end;

     TMyLapsP3RealTimeClock = record
       CurrentDecoderTime: TDateTime;
       DecoderId: string;
     end;

     TMyLapsP3Session = record
       LastPassingIndex: integer;
       DecoderId: string;
     end;

     TDecoderInfo = record
       IpAddress: string;
       Username: string;
       Password: string;
       DecoderVersion: TMyLapsP3VersionDecoder;
       BeepOnPassing: boolean;
       TimeHorizon: TDateTime;
     end;
     TDecoderInfos = array of TDecoderInfo;

     TDecoderStatusReceivedEvent = procedure (Status: TMyLapsP3Status) of object;
     TDecoderPassingReceivedEvent = procedure (Passing: TMyLapsP3Passing) of object;
     TDecoderRealTimeClockReceivedEvent = procedure (DecoderTime: TMyLapsP3RealTimeClock) of object;
     TDecoderSessionReceivedEvent = procedure (Session: TMyLapsP3Session) of object;
     TDecoderResponseTestEvent = procedure (TestPassed: boolean) of object;

     TMyLapsP3MessageParser = class
       private
         FOnStatus: TDecoderStatusReceivedEvent;
         FOnPassing: TDecoderPassingReceivedEvent;
         FOnRtc: TDecoderRealTimeClockReceivedEvent;
         FOnSession: TDecoderSessionReceivedEvent;
         FCrcTable: array[0..255] of word;
         FTimeDeltaDecoderPc: TTimeSpan; // time delta between decoder and PC clock
         function DecodePassingTime(AmbP3Time: string): TDateTime;
         function ParseRecordTypePassing(Body: string): TMyLapsP3Passing;
         function ParseRecordTypeStatus(Body: string): TMyLapsP3Status;
         function ParseRecordTypeVersionDecoder(Body: string): TMyLapsP3VersionDecoder;
         function ParseRecordTypeGetRtc(Body: string): TMyLapsP3RealTimeClock;
         function ParseRecordTypeSession(Body: string): TMyLapsP3Session;
         function DeEscapeMessage(Msg: string): string;
         function EscapeMessage(Msg: string): string;
         procedure initTable;
         function CalcCrc16(Msg: AnsiString): word;
       public
         constructor Create; virtual;
         procedure AddMessage(Msg: string; DecoderData: TDecoderData);
         procedure AddMessageFromWebservice(WebserviceMessage: TWebserviceMessage);
         function AddMessageDecoderSearch(Msg: string): TMyLapsP3VersionDecoder;
         function GetDecoderSearchPhrase: string;
         function GetDecoderSearchPhraseSmartDecoderBug: string;
         function GetResendPhrase(FromPassingNr, ToPassingNr: FixedUInt; DecoderId: string): string;
         function GetRtcPhrase: string;
         function GetSessionPhrase(DecoderId: string): string;
         property OnStatusReceived: TDecoderStatusReceivedEvent read FOnStatus write FOnStatus;
         property OnPassingReceived: TDecoderPassingReceivedEvent read FOnPassing write FOnPassing;
         property OnRealTimeClockReadingReceived: TDecoderRealTimeClockReceivedEvent read FOnRtc write FOnRtc;
         property OnSessionDataReceived: TDecoderSessionReceivedEvent read FOnSession write FOnSession;
         function ReverseParseRecordTypeVersionDecoder(FirmwareVersion, DecoderType, DecoderId: string): TIdBytes;
         property TimeDeltaDecoderPc: TTimeSpan read FTimeDeltaDecoderPc;
     end;



     { TMyLapsX2EventManager }

     TMyLapsX2EventManager = class
       private
         FOnPassing: TDecoderPassingReceivedEvent;
         FTimeDeltaDecoderPc: TTimeSpan;   // time delta between X2 server time domain and PC clock
         FIsSynched: boolean;
         FOnStatus: TDecoderStatusReceivedEvent;
         FRaceBase: TRaceBase;
         FResending: boolean;
         FLastStatus: array of TMyLapsP3Status;
         FBeepingOnPassingDecoderIds: TIntegerArray;
         procedure PlayShortBeep;
         function IsInBeepList(DecoderId: integer): boolean;
       public
         constructor Create; virtual;
         property TimeDeltaDecoderPc: TTimeSpan read FTimeDeltaDecoderPc;
         property OnPassingReceived: TDecoderPassingReceivedEvent read FOnPassing write FOnPassing;
         property OnStatusReceived: TDecoderStatusReceivedEvent read FOnStatus write FOnStatus;
         procedure AddPassing(Passing: TMyLapsP3Passing; CheckResend: boolean);
         procedure AddStatus(Status: TMyLapsP3Status);
         property RaceBase: TRaceBase write FRaceBase;
         property Resending: boolean write FResending;
         procedure BeepOnPassing(DecoderId: string; DoBeep: boolean);
     end;



     { TMyLapsP3Listener }

     TMyLapsP3Listener = class (TDecoderListenerBase)
       private
         FTcpClient: TIdTCPClient;
         FListBoxRawData: TListBox;
         FServerPort: word;
         FMessage: string;
         FNewData: string;
         FMyLapsParser: TMyLapsP3MessageParser;
         FQueryServerQueue: TStringList;
         FCriticalSection: TCriticalSection;
         FGetRtcPhrase: string;
         procedure PostMessage;
         procedure PostNewData;
         procedure SetMyLapsParser(const Value: TMyLapsP3MessageParser);
       public
         constructor Create (DecoderData: TDecoderData; ServerPort: word); reintroduce;
         destructor Destroy; override;
         procedure Execute; override;
         property MyLapsP3MessageParser: TMyLapsP3MessageParser read FMyLapsParser write SetMyLapsParser;
         property ListBoxRawData: TListBox read FListBoxRawData write FListBoxRawData;
         procedure SendQuery(Msg: string); override;
     end;
     TMyLapsP3Listeners = array of TMyLapsP3Listener;



     { TMyLapsX2Listener }

     TMyLapsX2Listener = class (TDecoderListenerBase)    // dummy class just to store decoder data
       private

       public
         constructor Create (DecoderData: TDecoderData); reintroduce;
         procedure Execute; override;
     end;



     { TMyLapsX2Connector }

     TX2Connection = record
       app_handle: Tmta_handle_t;
       sdk_handle: mdp_sdk_handle_t;
       event_handle: Tmta_eventdata_handle_t;
       Resending: boolean;
       LastContact: TDateTime;
       ServerIp: string;
       LoopId: TStringArray;
     end;
     TX2Connections = array of TX2Connection;

     TMyLapsX2Connector = class
       private
         FX2Connections: TX2Connections;
       public
         constructor Create;
         destructor Destroy;
         procedure Connect(IpAddress, Username, Password: string; TimeHorizon: TDateTime);
         procedure SubscribeLoop(LoopId, ServerIp: string);
         procedure ProcessMessages;
     end;



     { TMyLapsDecoderSearcher }

     TMyLapsDecoderSearcher = class
       private
         FUdpServer: TIdUdpServer;
         FParser: TMyLapsP3MessageParser;
         FDecoderInfos: TDecoderInfos;
         FOnDecoderFound: TNotifyEvent;
         FX2ServerReconnectTimeHorizon: TDateTime;  // only for X2 system
         procedure OnUdpRead(AThread: TIdUDPListenerThread; const AData: TIdBytes; ABinding: TIdSocketHandle);
         function GetAddress(i: integer): string;
         function GetData(i: integer): TMyLapsP3VersionDecoder;
         function GetInfo(i: integer): TDecoderInfo;
         function GetCount: integer;
       public
         constructor Create; virtual;
         destructor Destroy; override;
         property DecoderIpAddress[i: integer]: string read GetAddress;
         property DecoderData[i: integer]: TMyLapsP3VersionDecoder read GetData;
         property DecoderInfo[i: integer]: TDecoderInfo read GetInfo;
         property Count: integer read GetCount;
         property OnDecoderFound: TNotifyEvent read FOnDecoderFound write FOnDecoderFound;
         procedure Update;
         procedure UpdateX2(IpAddress, Username, Password: AnsiString; BeepOnPassing: boolean = false; TimeHorizon: TDateTime = 0.0);
         property X2ServerReconnectTimeHorizon: TDateTime read FX2ServerReconnectTimeHorizon write FX2ServerReconnectTimeHorizon;
         procedure Clear;
     end;






     { TWebServiceDecoderListener }

     TWebServiceDecoderListener = class (TDecoderListenerBase)
       private
         FUrl: string;
         FHttpClient: TIdHttp;
         FMyLapsParser: TMyLapsP3MessageParser;
         FWebserviceMessage: TWebserviceMessage;
         FLastReceivedRecordId: integer;
         procedure SetMyLapsParser(const Value: TMyLapsP3MessageParser);
         procedure PostMessage;
         function FetchDateTime(Time: string): TDateTime;
         procedure SetReceptionStartTime(StartTime: TDateTime);
       public
         constructor Create (DecoderData: TDecoderData); reintroduce;
         destructor Destroy; override;
         procedure Execute; override;
         property MyLapsP3MessageParser: TMyLapsP3MessageParser read FMyLapsParser write SetMyLapsParser;
     end;






     { TMandigoMessageParser }

     TMandigoMessageParser = class
       private
         FOnPassing: TDecoderPassingReceivedEvent;
         FOnRtc: TDecoderRealTimeClockReceivedEvent;
         FTimeDeltaDecoderPc: TTimeSpan; // time delta between decoder and PC clock
         FDecoderId: string;
         function ParseRecordTypePassing(Msg: string): TMyLapsP3Passing;
         function ParseRecordTypeGetRtc(Msg: string): TMyLapsP3RealTimeClock;
       public
         constructor Create; virtual;
         procedure AddMessage(Msg: string; DecoderData: TDecoderData);
         property OnPassingReceived: TDecoderPassingReceivedEvent read FOnPassing write FOnPassing;
         property OnRealTimeClockReadingReceived: TDecoderRealTimeClockReceivedEvent read FOnRtc write FOnRtc;
         property TimeDeltaDecoderPc: TTimeSpan read FTimeDeltaDecoderPc;
         property DecoderId: string read FDecoderId write FDecoderId;
         function GetRtcPhrase: string;
     end;



     { TMandigoDecoderListener }

     TMandigoDecoderListener = class (TDecoderListenerBase)
       private
         FComPort: TApdComPort;
         FListBoxRawData: TListBox;
         FMessage: string;
         FNewData: string;
         FMandigoMessageParser: TMandigoMessageParser;
         FQueryServerQueue: TStringList;
         FCriticalSection: TCriticalSection;
         FGetRtcPhrase: string;
         procedure PostMessage;
         procedure PostNewData;
         procedure SetMandigoParser(const Value: TMandigoMessageParser);
         function ReadLine(TimeOutMs: integer): string;
       public
         constructor Create (DecoderData: TDecoderData; ComPort: word); reintroduce;
         destructor Destroy; override;
         procedure Execute; override;
         property MandigoMessageParser: TMandigoMessageParser read FMandigoMessageParser write SetMandigoParser;
         property ListBoxRawData: TListBox read FListBoxRawData write FListBoxRawData;
         procedure SendQuery(Msg: string); override;
     end;



     { TRaceResultsMessageParser }

     TRaceResultsMessageParser = class
       private
         FOnPassing: TDecoderPassingReceivedEvent;
         FOnStatus: TDecoderStatusReceivedEvent;
         FOnRtc: TDecoderRealTimeClockReceivedEvent;
         FTimeDeltaDecoderPc: TTimeSpan; // time delta between decoder and PC clock
         FDecoderId: string;
       public
         constructor Create; virtual;
         procedure AddMessage(Msg: string; DecoderData: TDecoderData);
         property OnPassingReceived: TDecoderPassingReceivedEvent read FOnPassing write FOnPassing;
         property OnStatusReceived: TDecoderStatusReceivedEvent read FOnStatus write FOnStatus;
         property OnRealTimeClockReadingReceived: TDecoderRealTimeClockReceivedEvent read FOnRtc write FOnRtc;
         property TimeDeltaDecoderPc: TTimeSpan read FTimeDeltaDecoderPc;
         property DecoderId: string read FDecoderId write FDecoderId;
     end;


     { TRaceResultListener }

     TRaceResultListener = class (TDecoderListenerBase)
       private
         FTcpClient: TIdTCPClient;
         FListBoxRawData: TListBox;
         FServerPort: word;
         FMessage: string;
         FNewData: string;
         FQueryServerQueue: TStringList;
         FCriticalSection: TCriticalSection;
         FRaceResultsMessageParser: TRaceResultsMessageParser;
         procedure PostMessage;
         procedure PostNewData;
       public
         constructor Create (DecoderData: TDecoderData; ServerPort: word); reintroduce;
         destructor Destroy; override;
         procedure Execute; override;
         property RaceResultsMessageParser: TRaceResultsMessageParser read FRaceResultsMessageParser write FRaceResultsMessageParser;
         property ListBoxRawData: TListBox read FListBoxRawData write FListBoxRawData;
         procedure SendQuery(Msg: string); override;
         property DecoderData: TDecoderData read FDecoderData;
     end;
     TRaceResultListeners = array of TRaceResultListener;







     { TTransponderMultiplexer }

     TTransponderReference = record
       InCode: string;
       OutCode: string;
     end;
     TTransponderReferences = array of TTransponderReference;

     TTransponderMultiplexer = class
       private
         FTransponderReferences: TTransponderReferences;
         FCount: integer;
       public
         constructor Create; virtual;
         procedure SetTransponderReference(InCode, OutCode: string);
         procedure DeleteTransponderReference(InCode: string);
         property Count: integer read FCount;
         function GetOutCode(InCode: string): string;
         function GetTransponderReference(index: integer): TTransponderReference;
     end;



var GlobalMyLapsX2EventManager: TMyLapsX2EventManager;


implementation

var {GlobalDecoderInfos: TX2DecoderInfos;}
    CriticalSectionX2Event: TCriticalSection;

{ TMyLapsP3MessageParser }

constructor TMyLapsP3MessageParser.Create;
begin
 inherited;
 FOnStatus := nil;
 FOnPassing := nil;
 FOnRtc := nil;
 FOnSession := nil;
 FTimeDeltaDecoderPc := TTimeSpan.Zero;
 initTable;
end;



function TMyLapsP3MessageParser.DecodePassingTime(AmbP3Time: string): TDateTime;
var PassingTimeUs, UsPerDay: UInt64;
    FullDays: UInt64;
    FracDays, f: extended;
begin
 PassingTimeUs := StrToUInt64('$' + AmbP3Time);
 UsPerDay := UInt64(24)*3600*1000000;
 FullDays := PassingTimeUs div UsPerDay;
 f := 24.0;
 f := f*3600.0;
 f := f*1000000.0;
 FracDays := (PassingTimeUs mod UsPerDay)/f;
 result := EncodeDate(1970, 1, 1) + FullDays + FracDays;
end;



function TMyLapsP3MessageParser.ParseRecordTypePassing(Body: string): TMyLapsP3Passing;
var i, offset: integer;
    s, d: string;
    FieldOfMessage: integer;
    l: integer;
begin
 // 01.04.11000000.03.04.37774700.04.08.400D72A900000000.05.02.4500.06.02.6C00.08.02.0000.81.04.54020200.02.01.01
 // 01.04.F72F0000.0A.08.4B502D3039303434.04.08.68C05AB2DF440500.05.02.A300.06.02.6C00.08.02.0000.14.01.01.81.04.40240400
 // 01.04.2B300000.0A.08.4B502D3039303434.04.08.7069674CF1440500.05.02.A100.06.02.6700.08.02.0000.14.01.01.81.04.40240400
 //
 // "switch" passing:
 // 01.04.99130000.03.04.08270000.04.08.38357E2CDA4E0500.08.02.0000.14.01.50.81.04.40240400.8F
 //
 // TranX-Chip (Leihkart) '01.04.4D320000.03.04.52B52F00.04.08.D04D8211C4840500.05.02.AE00.06.02.C700.08.02.0000.81.04.BF0A0400'
 // Transponder: 3126610 = 2FB552

 // init
 offset := 0;
 result.PassingTime := 0.0;
 result.LowBattWarning := false;

 repeat
  // field of message
  s := '$' + MidStr(Body, offset + 1, 2);
  FieldOfMessage := StrToInt(s);
  // length of field
  s := '$' + MidStr(Body, offset + 3, 2);
  l := StrToInt(s);
  // grab data of field
  s := '';
  for i:=l-1 downto 0 do
   s := s + MidStr(Body, offset + 5 + i*2, 2);
  // interpret things
  case FieldOfMessage of
    PASSING_NUMBER:
     result.PassingNumber := StrToInt('$'+s);
    TRANSPONDER_ID_TYPE_TRANX:
     begin
      result.TransponderId := '';
      d := '$';
      for i:=0 to l-1 do d := d + MidStr(s, 2*i+1, 2);
      result.TransponderId := IntToStr(StrToInt(d));
      // Tapeswitch connection: on decoder SubD15 plug, bridge pins 13 and 15
      //      and connect tapeswitch terminals to pins 12 and 5
      if result.TransponderId = '9992' then result.TransponderId := 'Switch'
      else if result.TransponderId = '9993' then result.TransponderId := 'SyncPulse'
      // CAUTION: photo cell input, not switch - but treated just like switch
      else if result.TransponderId = '9991' then result.TransponderId := 'FinishCamStart';
     end;
    TRANSPONDER_ID_TYPE_PROCHIPFLEXCHIP:
     begin
      result.TransponderId := '';
      for i:=l-1 downto 0 do
       begin
        d := '$' + MidStr(s, 2*i+1, 2);
        result.TransponderId := result.TransponderId + chr(StrToInt(d));
       end;
     end;
    STRENGTH:
     result.SignalStrength := StrToInt('$' + s);
    RTC_TIME:            // time of internal clock as manually adjusted
      if result.PassingTime = 0.0
        then result.PassingTime := DecodePassingTime(s);
    UTC_TIME:            // GPS time - when available (GPS receiver plugged in and satellites fixed)
      result.PassingTime := DecodePassingTime(s);
    HITS:
     result.Hits := StrToInt('$' + s);
    FLAGS:               // bit 0 'high' indicates low battery
     result.LowBattWarning := (StrToInt('$' + s) and 1) <> 0;
    SPORT:
     result.Sport := StrToInt('$' + s);
    DECODER_ID:
     begin
      result.DecoderId := '';
      for i:=l-1 downto 0 do result.DecoderId := result.DecoderId + MidStr(s, i*2+1, 2) + '-';
      result.DecoderId := MidStr(result.DecoderId, 1, length(result.DecoderId) - 1);
     end;
  end;
  //
  offset := offset + 4 + 2*l;
 until offset >= length(Body);
end;



function TMyLapsP3MessageParser.ParseRecordTypeStatus(Body: string): TMyLapsP3Status;
var i, offset: integer;
    s: string;
    FieldOfMessage: integer;
    l: integer;
begin
 //    VER LEN  CRC FLOR TOR  FOR
 // 8E.02.1F00.C5F8.0000.0200.01.02.0000.07.02.2900.0C.01.73.06.01.00.81.04.40240400.8F

 // init
 offset := 0;

 repeat
  // field of message
  s := '$' + MidStr(Body, offset + 1, 2);
  FieldOfMessage := StrToInt(s);
  // length of field
  s := '$' + MidStr(Body, offset + 3, 2);
  l := StrToInt(s);
  // grab data of field
  s := '';
  for i:=l-1 downto 0 do
   s := s + MidStr(Body, offset + 5 + i*2, 2);
  // interpret things
  case FieldOfMessage of
    STATUS_NOISE:
      result.Noise := StrToInt('$' + s);
    STATUS_GPS:
      if StrToInt('$' + s) = 1 then result.Gps := true else result.Gps := false;
    STATUS_TEMPERATURE:
      result.Temperature := StrToInt('$' + s);
    STATUS_INPUT_VOLTAGE:
      result.InputVoltage := StrToInt('$' + s)/10.0;
    DECODER_ID:
     begin
      result.DecoderId := '';
      for i:=l-1 downto 0 do result.DecoderId := result.DecoderId + MidStr(s, i*2+1, 2) + '-';
      result.DecoderId := MidStr(result.DecoderId, 1, length(result.DecoderId) - 1);
     end;
  end;
  //
  offset := offset + 4 + 2*l;
 until offset >= length(Body);
end;



function TMyLapsP3MessageParser.ParseRecordTypeVersionDecoder(Body: string): TMyLapsP3VersionDecoder;
// 8E02.4800.F1170000.0300.010114020D4368697058204465636F6465720309342E332E3132303138040480A12B58080833C552F24C42D46A0A027C410C04090000008104402404008F
var i, offset: integer;
    s: string;
    TypeFieldOfRecord: integer;
    l: integer;
begin
 // init
 offset := 0;

 repeat
  // type field of record
  s := '$' + MidStr(Body, offset + 1, 2);
  TypeFieldOfRecord := StrToInt(s);
  // length of field
  s := '$' + MidStr(Body, offset + 3, 2);
  l := StrToInt(s);
  // grab field data
  case TypeFieldOfRecord of
    TOR_VERSION_DECODER_TYPE:
      begin
       result.DecoderType := '';
       for i:=0 to l-1 do
        begin
         s := MidStr(Body, offset+5 + i*2, 2);
         result.DecoderType := result.DecoderType + char(StrToInt('$'+s));
        end;
      end;
    TOR_VERSION_DECODER_FIRMWARE:
      begin
       result.FirmwareVersion := '';
       for i:=0 to l-1 do
        begin
         s := MidStr(Body, offset+5 + i*2, 2);
         result.FirmwareVersion := result.FirmwareVersion + char(StrToInt('$'+s));
        end;
      end;
    TOR_VERSION_DECODER_ID:
      begin
       result.DecoderId := '';
       for i:=0 to l-1 do
        begin
         s := MidStr(Body, offset+5 + i*2, 2);
         result.DecoderId := result.DecoderId + s + '-';
        end;
       result.DecoderId := MidStr(result.DecoderId, 1, length(result.DecoderId) - 1);
      end;
  end;
  //
  offset := offset + 4 + 2*l;
 until offset >= length(Body);
end;



function TMyLapsP3MessageParser.ReverseParseRecordTypeVersionDecoder(FirmwareVersion, DecoderType, DecoderId: string): TIdBytes;
var i: integer;
    s: string;
begin
 s := '8E02.4800.F1170000.0300.01.01.14.02.0D.4368697058204465636F646572.03.09.342E332E3132303138.04.04.80A12B58.08.08.33C552F24C42D46A.0A.02.7C41.0C.04.09000000.81.04.402404008F';
 s := '8E024800F11700000300';
 s := s + '8104';
 s := s + MidStr(DecoderId, 1, 2);
 s := s + MidStr(DecoderId, 4, 2);
 s := s + MidStr(DecoderId, 7, 2);
 s := s + MidStr(DecoderId, 10, 2);
 s := s + IntToHex(TOR_VERSION_DECODER_TYPE, 2);
 s := s + IntToHex(length(DecoderType), 2);
 for i:=1 to length(DecoderType) do
   s := s + IntToHex(ord(DecoderType[i]), 2);
 s := s + IntToHex(TOR_VERSION_DECODER_FIRMWARE, 2);
 s := s + IntToHex(length(FirmwareVersion), 2);
 for i:=1 to length(FirmwareVersion) do
   s := s + IntToHex(ord(FirmwareVersion[i]), 2);
 s := s + '8F';
 setlength(result, length(s) shr 1);
 for i:=0 to (length(s) shr 1) - 1 do result[i] := StrToInt('$'+MidStr(s, 2*i+1, 2));
end;



function TMyLapsP3MessageParser.ParseRecordTypeGetRtc(Body: string): TMyLapsP3RealTimeClock;
var i, offset: integer;
    s, d: string;
    FieldOfMessage: integer;
    l: integer;
begin
 //                           <BODY...
 //                           FOM
 // 8E.02.1F00.0D33.0000.2400.01.08.604B65A2B64A0500.04.02.0000.81.04.40240400.8F -> answer for GetRtc

 // init
 offset := 0;

 repeat
  // field of message
  s := '$' + MidStr(Body, offset + 1, 2);
  FieldOfMessage := StrToInt(s);
  // length of field
  s := '$' + MidStr(Body, offset + 3, 2);
  l := StrToInt(s);
  // grab data of field
  s := '';
  for i:=l-1 downto 0 do
   s := s + MidStr(Body, offset + 5 + i*2, 2);
  // interpret things
  case FieldOfMessage of
    FOM_RTC:
     begin
      result.CurrentDecoderTime := DecodePassingTime(s);
     end;
    DECODER_ID:
     begin
      result.DecoderId := '';
      for i:=l-1 downto 0 do result.DecoderId := result.DecoderId + MidStr(s, i*2+1, 2) + '-';
      result.DecoderId := MidStr(result.DecoderId, 1, length(result.DecoderId) - 1);
     end;
  end;
  //
  offset := offset + 4 + 2*l;
 until offset >= length(Body);
end;



function TMyLapsP3MessageParser.ParseRecordTypeSession(Body: string): TMyLapsP3Session;
var i, offset: integer;
    s, d: string;
    FieldOfMessage: integer;
    l: integer;
begin
 //                                                                        last passing index     MAC
 // 8E.02.3300.95E0.0000.1500.02.04.3271F455.01.04.01000000.03.04.00000000.04.04.120A0000.81.04.9B0F0200.85.08.0100000000000000.8F
 // init
 offset := 0;

 repeat
  // field of message
  s := '$' + MidStr(Body, offset + 1, 2);
  FieldOfMessage := StrToInt(s);
  // length of field
  s := '$' + MidStr(Body, offset + 3, 2);
  l := StrToInt(s);
  // grab data of field
  s := '';
  for i:=l-1 downto 0 do
   s := s + MidStr(Body, offset + 5 + i*2, 2);
  // interpret things
  case FieldOfMessage of
    LAST_PASSING_INDEX:
     begin
      result.LastPassingIndex := StrToInt('$'+s);
     end;
    DECODER_ID:
     begin
      result.DecoderId := '';
      for i:=l-1 downto 0 do result.DecoderId := result.DecoderId + MidStr(s, i*2+1, 2) + '-';
      result.DecoderId := MidStr(result.DecoderId, 1, length(result.DecoderId) - 1);
     end;
  end;
  //
  offset := offset + 4 + 2*l;
 until offset >= length(Body);
end;



function TMyLapsP3MessageParser.DeEscapeMessage(Msg: string): string;
var i, l, j: integer;
    b: string;
begin
 result := MidStr(Msg, 1, 2);
 l := length(Msg) div 2;
 j := 0;
 i := 1;
 repeat
   b := MidStr(Msg, 2*(i+j)+1, 2);
   if b = '8D' then
    begin
      inc(j);
      b := MidStr(Msg, 2*(i+j)+1, 2);
      result := result + IntToHex(StrToInt('$'+b) - $20, 2);
    end
    else result := result + b;
  inc(i);
 until i > (l-j) - 2;
 result := result + MidStr(Msg, length(Msg)-1, 2);
end;



function TMyLapsP3MessageParser.EscapeMessage(Msg: string): string;
var i, l: integer;
    s: string;
begin
 result := MidStr(Msg, 1, 2);
 l := length(Msg) div 2;
 for i:=1 to l-2 do
  begin
    s := MidStr(Msg, 2*i+1, 2);
    if (s = '8E') or (s='8D') or (s='8F') then result := result + '8D' + IntToHex((StrToInt('$'+s) + $20), 2)
      else result := result + s;
  end;
 result := result + MidStr(Msg, 2*(l-1)+1, 2);
end;



procedure TMyLapsP3MessageParser.AddMessage(Msg: string; DecoderData: TDecoderData);
var l: integer;
    s: string;
    IsValid: boolean;
    Version: integer;
    Checksum: integer;
    Flags: integer;
    TypeOfRecord: integer;
    P3Passing: TMyLapsP3Passing;
    P3Status: TMyLapsP3Status;
    P3VersionDecoder: TMyLapsP3VersionDecoder;
    P3Rtc: TMyLapsP3RealTimeClock;
    P3Session: TMyLapsP3Session;
    OrigMsg: string;
begin
 try
  //    VER LEN  CRC FLOR TOR  FOR
  // 8E.02.1F00.C5F8.0000.0200.01.02.0000.07.02.2900.0C.01.73.06.01.00.81.04.40240400.8F
  // 8E.02.3A00.0479.0000.0100.01.04.E6330000.0A.08.46432D3932333938.04.8F

  // 8E.02.1D00.48E0.0000.0400.01.04.00010204.02.04.4E000000.81.04.40240400.8F
  // 8E.02.1D00.8350.0000.0400.01.04.00000204.02.04.51000000.81.04.40240400.8F -> answer for "resend 0..1"
  // 8E.02.1D00.A606.0000.0400.01.04.00010204.02.04.52000000.81.04.40240400.8F -> answer for "resend 1..2"

  // 8E.02.1F00.0D33.0000.2400.01.08.604B65A2B64A0500.04.02.0000.81.04.40240400.8F -> answer for GetRtc
  //                                                                         Passing number        MAC
  // 8E.02.3300.95E0.0000.1500.02.04.3271F455.01.04.01000000.03.04.00000000.04.04.120A0000.81.04.9B0F0200.85.08.0100000000000000.8F

  OrigMsg := Msg;
  Msg := DeEscapeMessage(Msg);
  if length(Msg) >= 23 then
   begin
    // start
    s := '$' + MidStr(Msg, 1, 2);
    if StrToInt(s) <> $8E then IsValid := false;
    // Version
    Version := StrToInt('$' + MidStr(Msg, 3, 2));
    // length of message
    s := '$' + MidStr(Msg, 7, 2) + MidStr(Msg, 5, 2);
    l := StrToInt(s);
    // checksum
    s := '$' + MidStr(Msg, 11, 2) + MidStr(Msg, 9, 2);
    Checksum := StrToInt(s);
    // flags
    s := '$' + MidStr(Msg, 15, 2) + MidStr(Msg, 13, 2);
    Flags := StrToInt(s);
    // TOR (type of record) or message type
    s := '$' + MidStr(Msg, 19, 2) + MidStr(Msg, 17, 2);
    TypeOfRecord := StrToInt(s);

    case TypeOfRecord of
     TOR_PASSING:
       begin
        P3Passing := ParseRecordTypePassing(MidStr(Msg, 21, length(Msg) - 21 - 1));
        if not DecoderData.UseSoftwareSynch then
          begin
           // set FTimeDeltaDecoderPC upon FIRST CONTACT (make sure only ONE INSTANCE of this class is used in main!)
           if FTimeDeltaDecoderPc.Ticks = 0 then FTimeDeltaDecoderPc := TTimeSpan.Subtract(P3Passing.PassingTime, Now);
           // apply correction
           P3Passing.PassingTime := P3Passing.PassingTime - FTimeDeltaDecoderPc;
          end
          else begin
           P3Passing.PassingTime := P3Passing.PassingTime - DecoderData.DeltaTimeWithPc;
          end;
        if assigned(FOnPassing) then FOnPassing(P3Passing);
       end;
     TOR_STATUS:
       begin
        P3Status := ParseRecordTypeStatus(MidStr(Msg, 21, length(Msg) - 21 - 1));
        if assigned(FOnStatus) then FOnStatus(P3Status);
       end;
     TOR_VERSION_DECODER:
       begin
        P3VersionDecoder := ParseRecordTypeVersionDecoder(MidStr(Msg, 21, length(Msg) - 21 - 1));
       end;
     TOR_GET_TIME:
       begin
        P3Rtc := ParseRecordTypeGetRtc(MidStr(Msg, 21, length(Msg) - 21 - 1));
        if assigned(FOnRtc) then FOnRtc(P3Rtc);
       end;
     TOR_SESSION:
       begin
         P3Session := ParseRecordTypeSession(MidStr(Msg, 21, length(Msg) - 21 - 1));
         if assigned(FOnSession) then FOnSession(P3Session);
       end
     else begin
       Flags := 0;
     end;
    end;
   end;

 except
  s := '';
 end;
end;



procedure TMyLapsP3MessageParser.AddMessageFromWebservice(WebserviceMessage: TWebserviceMessage);
var
  P3Passing: TMyLapsP3Passing;
  P3Status: TMyLapsP3Status;
begin
 case WebserviceMessage.MessageType of
   dmtStatus:
     begin
      P3Status.Noise := WebserviceMessage.Noise;
      P3Status.Gps := false;
      P3Status.Temperature := WebserviceMessage.Temperature;
      P3Status.InputVoltage := 0.0;
      P3Status.DecoderId := WebserviceMessage.DecoderId;
      if assigned(FOnStatus) then FOnStatus(P3Status);
     end;
   dmtPassing:
     begin
      P3Passing.PassingNumber := WebserviceMessage.PassingNumber;
      P3Passing.TransponderId := WebserviceMessage.TransponderCode;
      P3Passing.PassingTime := WebserviceMessage.PassingTime;
      P3Passing.SignalStrength := 0;
      P3Passing.Hits := 0;
      P3Passing.Sport := 0;
      P3Passing.DecoderId := WebserviceMessage.DecoderId;
      P3Passing.LowBattWarning := false;
      if assigned(FOnPassing) then FOnPassing(P3Passing);
     end;
 end;
end;



function TMyLapsP3MessageParser.AddMessageDecoderSearch(Msg: string): TMyLapsP3VersionDecoder;
// 8E02.4800.F1170000.0300.01.01.14.02.0D.4368697058204465636F646572.03.09.342E332E3132303138.04.04.80A12B58.08.08.33C552F24C42D46A.0A.02.7C41.0C.04.09000000.81.04.40240400.8F
var l: integer;
    s: string;
    TypeOfRecord: integer;
begin
  //
  Msg := DeEscapeMessage(Msg);
  if length(Msg) >= 23 then
   begin
    // length of message
    s := '$' + MidStr(Msg, 7, 2) + MidStr(Msg, 5, 2);
    l := StrToInt(s);
    // TOR (type of record) or message type
    s := '$' + MidStr(Msg, 19, 2) + MidStr(Msg, 17, 2);
    TypeOfRecord := StrToInt(s);
    //
    case TypeOfRecord of
     TOR_VERSION_DECODER:
       begin
        result := ParseRecordTypeVersionDecoder(MidStr(Msg, 21, length(Msg) - 21 - 1));
       end;
    end;
   end;
end;



function TMyLapsP3MessageParser.GetDecoderSearchPhrase: string;
begin
 // 8E.00.1900.A539.0000.0300.0100.0200.0300.0400.0800.0A00.0C00.8F
 result := '8E001900A53900000300010002000300040008000A000C008F';
end;



function TMyLapsP3MessageParser.GetDecoderSearchPhraseSmartDecoderBug: string;
// search string for SmartDecoder LV Bayern which doesn't respond to standard 25 bytes request
begin
 result := '8E0021007CE3000016000800090006000A0005000E0085080A01010A000000008F';
end;



function TMyLapsP3MessageParser.GetResendPhrase(FromPassingNr, ToPassingNr: FixedUInt; DecoderId: string): string;
var i: integer;
    crc: word;
    s: string;
begin
  //         VER LEN  CRC FLOR TOR  FOR
  // old: 8E.02.1700.xxxx.0000.0400.01.04.xxxxxxxx.02.04.xxxxxxxx.8F
  // new: 8E.00.1D00.49DF.0000.0400.01.04.xxxxxxxx.02.04.xxxxxxxx.81.04.40240400.8F
  result := '8E001D00000000000400' + '0104';
  s := IntToHex(FromPassingNr, 8);
  for i:=4 downto 1 do
   begin
    result := result + s[i*2-1];
    result := result + s[i*2];
   end;
  result := result + '0204';
  s := IntToHex(ToPassingNr, 8);
  for i:=4 downto 1 do
   begin
    result := result + s[i*2-1];
    result := result + s[i*2];
   end;
  result := result + '8104';
  result := result + DecoderId[1] + DecoderId[2];
  result := result + DecoderId[4] + DecoderId[5];
  result := result + DecoderId[7] + DecoderId[8];
  result := result + DecoderId[10] + DecoderId[11];
  result := result + '8F';
  crc := CalcCrc16(result);
  s := IntToHex(crc, 4);
  result[9] := s[3];
  result[10] := s[4];
  result[11] := s[1];
  result[12] := s[2];
  result := EscapeMessage(result);
end;


function TMyLapsP3MessageParser.GetRtcPhrase: string;
var crc: word;
    s: string;
begin
  //    VER LEN  CRC FLOR TOR  FOR
  // 8E.00.1900.A539.0000.0300.0100.0200.0300.0400.0800.0A00.0C00.8F (decoder search)
  // 8E.02.1700.xxxx.0000.2400.0100.0200.0300.0400.0800.0A00.0C00.8F (get RTC)
  result := '8E021700000000002400010002000300040008000A000C008F';
  crc := CalcCrc16(result);
  s := IntToHex(crc, 4);
  result[9] := s[3];
  result[10] := s[4];
  result[11] := s[1];
  result[12] := s[2];
  result := EscapeMessage(result);
end;


function TMyLapsP3MessageParser.GetSessionPhrase(DecoderId: string): string;
var crc: word;
    s: string;
begin
  //    VER LEN  CRC FLOR TOR  FOR
  // 8E.00.2B00.9134.0000.1500.01.04.01000000.02.04.3271F455.0300.0400.81.04.9B0F0200.85.08.0100000000000000.8F
  //result := '8E001D00000000001500010002043271F4550300040081049B0F02008F';
  result := '8E001D00000000001500010002043271F45503000400'; //81049B0F02008F';
  result := result + '8104';
  result := result + DecoderId[1] + DecoderId[2];
  result := result + DecoderId[4] + DecoderId[5];
  result := result + DecoderId[7] + DecoderId[8];
  result := result + DecoderId[10] + DecoderId[11];
  result := result + '8F';
  crc := CalcCrc16(result);
  s := IntToHex(crc, 4);
  result[9] := s[3];
  result[10] := s[4];
  result[11] := s[1];
  result[12] := s[2];
  result := EscapeMessage(result);
end;



{$IFOPT R+}
  {$DEFINE RANGEON}
  {$R-}
{$ELSE}
  {$UNDEF RANGEON}
{$ENDIF}
procedure TMyLapsP3MessageParser.initTable;
var i, j: integer;
    crc: word;
begin
 for i:=0 to 255 do
  begin
   crc := i shl 8;
   for j:=0 to 7 do
    begin
      if crc and $8000 > 0 then crc := (crc shl 1) xor $1021
        else crc := (crc shl 1) xor 0;
    end;
   FCrcTable[i] := crc;
  end;
end;
{$IFDEF RANGEON}
  {$R+}
  {$UNDEF RANGEON}
{$ENDIF}



{$IFOPT R+}
  {$DEFINE RANGEON}
  {$R-}
{$ELSE}
  {$UNDEF RANGEON}
{$ENDIF}
function TMyLapsP3MessageParser.CalcCrc16(Msg: AnsiString): word;
var crc: word;
    i, l: integer;
    b: byte;
begin
 crc := $FFFF;
 l := length(Msg) div 2;
 for i:=0 to l-1 do
  begin
   b := StrToInt('$'+MidStr(Msg, 2*i+1, 2));
   crc := (FCrcTable[(crc shr 8) and 255] xor (crc shl 8)) xor b;
  end;
 result := crc;
end;
{$IFDEF RANGEON}
  {$R+}
  {$UNDEF RANGEON}
{$ENDIF}






{ TDecoderListenerBase }

constructor TDecoderListenerBase.Create(DecoderData: TDecoderData);
begin
 inherited Create(true);
 FDecoderData := DecoderData;
 if FDecoderData.DecoderType = 'ChipX Decoder' then FDecoderType := dcChipX
  else if FDecoderData.DecoderType = 'ProChip Smart Decoder' then FDecoderType := dcProChipSmart
    else if FDecoderData.DecoderType = 'Webservice decoder' then FDecoderType := dcWebService
      else FDecoderType := dcUnknown;
end;



destructor TDecoderListenerBase.Destroy;
begin
  inherited;
end;






{ TMyLapsP3Listener }

constructor TMyLapsP3Listener.Create(DecoderData: TDecoderData; ServerPort: word);
begin
 inherited Create(DecoderData);
 FTcpClient := TIdTCPClient.Create(nil);
 FTcpClient.ConnectTimeout := 1000;
 FTcpClient.ReadTimeout := 1000;
 FServerPort := ServerPort;
 FListBoxRawData := nil;
 FQueryServerQueue := TStringList.Create;
 FCriticalSection := TCriticalSection.Create;
end;



destructor TMyLapsP3Listener.Destroy;
begin
 FreeAndNil(FTcpClient);
 FreeAndNil(FQueryServerQueue);
 FreeAndNil(FCriticalSection);
 inherited Destroy;
end;



procedure TMyLapsP3Listener.Execute;
var i, j, k, l: integer;
    InByte: Byte;
    ExpectedMsgLengthBytes: integer;
    s: string;
    ABuffer: TIdBytes;
    sdk_handle: mdp_sdk_handle_t;
    app_handle: Tmta_handle_t;
    event_handle: Tmta_eventdata_handle_t;
    appname: AnsiString;
    ip, user, pw: AnsiString;
    app: Pavailableappliance_t;
    utcfromtime: Tmdp_time_t;
    Start: TDateTime;
    id: cardinal;
    LastContact: TDateTime;
begin
   repeat
    try
    if FTcpClient.Connected then
     begin
      try
        InByte := FTcpClient.IOHandler.ReadByte;
        FNewData := FNewData + IntToHex(InByte, 2);
        //if assigned(FListBoxRawData) then Synchronize(PostNewData);    // just for debug purposes
        i := PosEx('8E', FNewData);
        if i > 0 then
          begin
           k := i;
           repeat
            j := PosEx('8F', FNewData, k);
            if (j-i) mod 2 = 1 then k := j + 1;
           until (j = 0) or ((j-i) mod 2 = 0) ;
           if (j > 0) and ((j-i) mod 2 = 0) then
            begin
              FMessage := MidStr(FNewData, i, j-i+2);
              FNewData := MidStr(FNewData, j+2, length(FNewData)-j-2+1);
              Synchronize(PostMessage);
            end;
          end;
        // write to decoder (or relay)
        {if FCriticalSection.TryEnter} FCriticalSection.Enter; {then}
         try
           if FQueryServerQueue.Count > 0 then
            begin
             for i:=0 to FQueryServerQueue.Count - 1 do
              begin
               // string to TIdBytes
               l := length(FQueryServerQueue[i]) div 2;
               setlength(ABuffer, l);
               for j:=0 to l-1 do
                begin
                 s := MidStr(FQueryServerQueue[i], 2*j+1, 2);
                 ABuffer[j] := StrToInt('$'+s);
                end;
               // send TIdBytes
               if FQueryServerQueue[i] = FGetRtcPhrase then FRtcQuerySendTime := Now;
               FTcpClient.IOHandler.Write(ABuffer, l);
              end;
             FQueryServerQueue.Clear;
            end;
         finally
           FCriticalSection.Leave;
         end;
      except

      end;
     end
     else
     FTcpClient.Connect(FDecoderData.Address, FServerPort);
    except

    end;
   until Terminated;
   if FTcpClient.Connected then FTcpClient.Disconnect;
end;



procedure TMyLapsP3Listener.SendQuery(Msg: string);
begin
 FCriticalSection.Enter;
 try
  FQueryServerQueue.Add(Msg);
 finally
  FCriticalSection.Leave;
 end;
end;



procedure TMyLapsP3Listener.SetMyLapsParser(const Value: TMyLapsP3MessageParser);
begin
 FMyLapsParser := Value;
 FGetRtcPhrase := FMyLapsParser.GetRtcPhrase;
end;



procedure TMyLapsP3Listener.PostMessage;
begin
 if assigned(FMyLapsParser) and (not Terminated) then
  begin
   FMyLapsParser.AddMessage(FMessage, FDecoderData);
   FMessage := '';
  end;
end;



procedure TMyLapsP3Listener.PostNewData;
begin
 if assigned(FListBoxRawData) then FListBoxRawData.Items.Add(FNewData);
end;






{ TMyLapsDecoderSearcher }

constructor TMyLapsDecoderSearcher.Create;
begin
 inherited;
 setlength(FDecoderInfos, 0);
 FOnDecoderFound := nil;
 FParser := TMyLapsP3MessageParser.Create;
 FUdpServer := TIdUDPServer.Create(nil);
 FUdpServer.ReuseSocket := rsTrue;
 FUdpServer.DefaultPort := 5303;
 FUdpServer.BroadcastEnabled := true;
 FUdpServer.OnUDPRead := OnUdpRead;
 FUdpServer.Active := true;
end;



destructor TMyLapsDecoderSearcher.Destroy;
begin
 if assigned(FParser) then FreeAndNil(FParser);
 if assigned(FUdpServer) then
  begin
   FUdpServer.OnUDPRead := nil;
   FUdpServer.Active := false;
   FUdpServer.Bindings.Clear;
   FreeAndNil(FUdpServer);
  end;
 inherited;
end;



procedure TMyLapsDecoderSearcher.OnUdpRead(AThread: TIdUDPListenerThread; const AData: TIdBytes; ABinding: TIdSocketHandle);
var i, j: integer;
    IsKnown: boolean;
    Msg: string;
begin
 IsKnown := false;
 for i:=0 to length(FDecoderInfos) - 1 do
   if FDecoderInfos[i].IpAddress = ABinding.PeerIP then IsKnown := true;
 if not IsKnown then
  begin
    i := length(FDecoderInfos);
    setlength(FDecoderInfos, i+1);
    FDecoderInfos[i].IpAddress := ABinding.PeerIP;
    Msg := '';
    for j:=0 to length(AData) - 1 do Msg := Msg + IntToHex(AData[j], 2);
    FDecoderInfos[i].DecoderVersion := FParser.AddMessageDecoderSearch(Msg);
  end;
 if assigned(FOnDecoderFound) and not IsKnown then FOnDecoderFound(self);
end;



procedure TMyLapsDecoderSearcher.Update;
var i: integer;
    sReq, sReq2: string;
    s: string;
    ReqBuf, ReqBuf2: TIdBytes;
    NetworkAdapters: TNetworkAdapters;
    AdapterIp, SubnetMask: cardinal;
    BroadcastIp: cardinal;
begin
 // init
 setlength(FDecoderInfos, 0);
 // fetch search phrase for decoder
 sReq := FParser.GetDecoderSearchPhrase;
 sReq2 := FParser.GetDecoderSearchPhraseSmartDecoderBug;
 setlength(ReqBuf, trunc(length(sReq)/2));
 for i:=0 to length(ReqBuf) - 1 do
  begin
   s := MidStr(sReq, 2*i+1, 2);
   ReqBuf[i] := StrToInt('$' + s);
  end;
 setlength(ReqBuf2, trunc(length(sReq2)/2));
 for i:=0 to length(ReqBuf2) - 1 do
  begin
   s := MidStr(sReq2, 2*i+1, 2);
   ReqBuf2[i] := StrToInt('$' + s);
  end;
 // send "limited broadcast"
 FUdpServer.SendBuffer('255.255.255.255', 5403, ReqBuf);
 FUdpServer.SendBuffer('255.255.255.255', 5403, ReqBuf2);
 // loop all network interfaces and send "directed broadcast"
 if GetNetworkAdapters(NetworkAdapters) then
  for i:=0 to length(NetworkAdapters) - 1 do
   begin
    AdapterIp := IpStrToInt(NetworkAdapters[i].IP);
    SubnetMask := IpStrToInt(NetworkAdapters[i].SubnetMask);
    BroadcastIp := (AdapterIp and SubnetMask) or (not SubnetMask);
    if AdapterIp > 0 then
     begin
      FUdpServer.SendBuffer(IntToIpStr(BroadcastIp), 5403, ReqBuf);
      FUdpServer.SendBuffer(IntToIpStr(BroadcastIp), 5403, ReqBuf2);
     end;
   end;
end;



procedure TMyLapsDecoderSearcher.UpdateX2(IpAddress, Username, Password: AnsiString; BeepOnPassing: boolean; TimeHorizon: TDateTime);
var i, j, k, oldlength: integer;
    sdk_handle: mdp_sdk_handle_t;
    app_handle: Tmta_handle_t;
    event_handle: Tmta_eventdata_handle_t;
    appname: AnsiString;
    connected: boolean;
    app: Pavailableappliance_t;
    loop: Ploop_t;
    IsKnown: boolean;
    name: AnsiString;
    bytes: array[0..15] of byte;
begin
 //
 oldlength := length(FDecoderInfos);
 appname := 'Spins';
 try
  sdk_handle := mdp_sdk_alloc(PChar(appname), self);
  app_handle := mta_handle_alloc(sdk_handle, self);
  event_handle := mta_eventdata_handle_alloc_live(app_handle, self);

	mta_objectdata_subscribe(app_handle, mtaLoop);

  if mta_connect(app_handle, PChar(IpAddress), PChar(Username), PChar(Password), true) then
   begin
    // process message loop to query decoder data
    for i:=0 to 50 do
     begin
      mdp_sdk_messagequeue_process(sdk_handle, true, 100000);
     end;
    // try to get data
    loop := mta_loop_get_head(app_handle);
    while loop <> nil do
      begin
       // insert in list
       IsKnown := false;
       j := 0;
       while (j < length(FDecoderInfos)) and (not IsKnown) do
        begin
          if FDecoderInfos[j].DecoderVersion.DecoderId = IntToStr(loop.twowayid) then IsKnown := true;
          inc(j);
        end;
       if not IsKnown then
        begin
          setlength(FDecoderInfos, length(FDecoderInfos) + 1);
          FDecoderInfos[high(FDecoderInfos)].DecoderVersion.DecoderType := 'X2 decoder';
          FDecoderInfos[high(FDecoderInfos)].IpAddress := IpAddress;
          FDecoderInfos[high(FDecoderInfos)].Username := Username;
          FDecoderInfos[high(FDecoderInfos)].Password := Password;
          FDecoderInfos[high(FDecoderInfos)].DecoderVersion.DecoderId := IntToStr(loop.twowayid);
          FDecoderInfos[high(FDecoderInfos)].BeepOnPassing := BeepOnPassing;
          FDecoderInfos[high(FDecoderInfos)].TimeHorizon := TimeHorizon;
        end;
       loop := mta_loop_get_next(app_handle);
      end;
   //end;
   end
   else MessageDlg('Connection failed!', mtError, [mbOk], 0);

   if length(FDecoderInfos) > oldlength then
    if assigned(FOnDecoderFound) then FOnDecoderFound(self);

 finally
  mta_disconnect(app_handle);
  mta_objectdata_unsubscribe(app_handle, mtaLoop);
  mta_eventdata_handle_dealloc(app_handle, event_handle);
  mta_handle_dealloc(sdk_handle, app_handle);
  mdp_sdk_dealloc(sdk_handle);
 end;

end;



procedure TMyLapsDecoderSearcher.Clear;
begin
 setlength(FDecoderInfos, 0);
end;



function TMyLapsDecoderSearcher.GetAddress(i: integer): string;
begin
 if (i >= 0) and (i < length(FDecoderInfos)) then result := FDecoderInfos[i].IpAddress else result := '';
end;


function TMyLapsDecoderSearcher.GetData(i: integer): TMyLapsP3VersionDecoder;
begin
 if (i >= 0) and (i < length(FDecoderInfos)) then result := FDecoderInfos[i].DecoderVersion;
end;


function TMyLapsDecoderSearcher.GetInfo(i: integer): TDecoderInfo;
begin
 if (i >= 0) and (i < length(FDecoderInfos)) then
  begin
    result.IpAddress := FDecoderInfos[i].IpAddress;
    result.Username := FDecoderInfos[i].Username;
    result.Password := FDecoderInfos[i].Password;
    result.DecoderVersion := FDecoderInfos[i].DecoderVersion;
    result.BeepOnPassing := FDecoderInfos[i].BeepOnPassing;
    result.TimeHorizon := FDecoderInfos[i].TimeHorizon;
  end;
end;



function TMyLapsDecoderSearcher.GetCount: integer;
begin
 result := length(FDecoderInfos);
end;










end.
