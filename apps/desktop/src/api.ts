import {invoke} from "@tauri-apps/api/core";
export type User={id:number;fullName:string;username:string;role:string;mustChangePassword:boolean;permissions:string[]};
export const api={call:<T>(command:string,args:Record<string,unknown>={})=>invoke<T>(command,args)};
