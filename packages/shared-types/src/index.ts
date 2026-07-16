export const roles=['global_admin','manager','cashier','stock_worker'] as const;export type Role=typeof roles[number];
export type Permission=string;
export interface SafeUser{id:number;fullName:string;username:string;email:string|null;role:Role;mustChangePassword:boolean;permissions:Permission[]}
export interface ApiError{code:string;message:string;fieldErrors?:Record<string,string[]>;requestId?:string}
export interface Pagination{page:number;pageSize:number;totalRows:number;totalPages:number}
export interface DateRange{start:string;end:string}
export type MoneyCents=number;
