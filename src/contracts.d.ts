/** Portable data contract. Platform acquisition / permissions are NOT implemented. */
export type Screen='inner'|'outer';
export type Scene='desktop'|'app';
export interface CaptureKey { contentRevision:string;screen:Screen;width:number;height:number;theme:string;fit:string;settingsRevision:string; }
export interface Block { id:number;kind:'content-card'|'content-control'|'content-text';bounds:[number,number,number,number];maskHandle:unknown; }
export interface PreparedSnapshot { key:CaptureKey;sourceTexture:unknown;contentMask:unknown;blocks:Block[];backgroundRGB:[number,number,number];readyFence?:unknown; }
export interface Frame { foldAngleDegrees:number;outerArrivalLeftToRight:boolean;fieldTimeSeconds:number;presentationTimeNanos:bigint; }
export interface NativeBridge {
 acquireOwnScene(screen:Screen):Promise<{key:CaptureKey;texture:unknown}>;
 prepare(capture:unknown,deadlineNanos:bigint):Promise<PreparedSnapshot>;
 render(snapshot:PreparedSnapshot,frame:Frame):void;
 release(snapshot:PreparedSnapshot):void;
}
