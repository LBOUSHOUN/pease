export const roles=['global_admin','manager','cashier','stock_worker'] as const;export type Role=typeof roles[number];
export type Permission=string;
export interface SafeUser{id:number;fullName:string;username:string;email:string|null;role:Role;mustChangePassword:boolean;permissions:Permission[]}
export interface ApiError{code:string;message:string;fieldErrors?:Record<string,string[]>;requestId?:string}
export interface Pagination{page:number;pageSize:number;totalRows:number;totalPages:number}
export interface DateRange{start:string;end:string}
export type MoneyCents=number;
export type ProductType="physical_product"|"service";
export type ActiveStatus="all"|"active"|"inactive";
export type SortDirection="asc"|"desc";
export type StockMovementType="opening_stock"|"stock_in"|"stock_out"|"damaged"|"lost"|"manual_adjustment"|"inventory_adjustment";
export interface Category{id:number;name:string;description:string|null;isActive:boolean;createdBy:number;createdAt:string;updatedAt:string;productCount?:number}
export interface CategoryListResponse extends Pagination{rows:Category[]}
export interface ProductListRow{id:number;categoryId:number|null;categoryName:string|null;name:string;productType:ProductType;sku:string|null;manufacturerBarcode?:string|null;internalBarcode:string;qrIdentifier?:string;purchasePriceCents?:number;sellingPriceCents:number;currentStock:number;minimumStock:number;unit:string;shelfLocation:string|null;isActive:boolean;trackStock:boolean;isLowStock:boolean;isOutOfStock:boolean}
export interface ProductDetail extends ProductListRow{description:string|null;manufacturerBarcode:string|null;qrIdentifier:string;wholesalePriceCents:number;wholesaleMinQuantity:number;createdBy:number;createdAt:string;updatedAt:string}
export interface ProductListResponse extends Pagination{rows:ProductListRow[]}
export interface ProductLookup{product:ProductListRow}
export interface StockSummary extends ProductListRow{stockValueCents?:number}
export interface StockListResponse extends Pagination{rows:StockSummary[]}
export interface StockMovement{id:number;productId:number;productName:string;movementType:StockMovementType;quantityChange:number;stockBefore:number;stockAfter:number;workerId:number;workerName:string;reason:string;referenceType:string|null;referenceId:number|null;createdAt:string}
export interface StockMovementListResponse extends Pagination{rows:StockMovement[]}
