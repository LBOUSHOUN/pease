export const roles = [
  "global_admin",
  "manager",
  "cashier",
  "stock_worker",
] as const;
export type Role = (typeof roles)[number];
export type Permission = string;
export interface SafeUser {
  id: number;
  fullName: string;
  username: string;
  email: string | null;
  role: Role;
  mustChangePassword: boolean;
  permissions: Permission[];
}
export interface ApiError {
  code: string;
  message: string;
  fieldErrors?: Record<string, string[]>;
  requestId?: string;
}
export interface Pagination {
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}
export interface DateRange {
  start: string;
  end: string;
}
export type MoneyCents = number;
export type ProductType = "physical_product" | "service";
export type ActiveStatus = "all" | "active" | "inactive";
export type SortDirection = "asc" | "desc";
export type StockMovementType =
  | "opening_stock"
  | "stock_in"
  | "stock_out"
  | "damaged"
  | "lost"
  | "manual_adjustment"
  | "inventory_adjustment";
export interface Category {
  id: number;
  name: string;
  description: string | null;
  isActive: boolean;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  productCount?: number;
}
export interface CategoryListResponse extends Pagination {
  rows: Category[];
}
export interface ProductListRow {
  id: number;
  categoryId: number | null;
  categoryName: string | null;
  name: string;
  productType: ProductType;
  inventoryMode?: "quantity" | "serialized";
  sku: string | null;
  manufacturerBarcode?: string | null;
  internalBarcode: string;
  qrIdentifier?: string;
  purchasePriceCents?: number;
  sellingPriceCents: number;
  currentStock: number;
  minimumStock: number;
  unit: string;
  shelfLocation: string | null;
  isActive: boolean;
  archivedAt?: string | null;
  archivedBy?: number | null;
  canDeletePermanently?: boolean;
  trackStock: boolean;
  isLowStock: boolean;
  isOutOfStock: boolean;
}
export interface SerializedReceivingScan {
  id: number;
  barcode: string;
  createdAt: string;
}
export interface SerializedReceivingSession {
  id: number;
  productId: number;
  productName: string;
  supplierId: number | null;
  purchaseId: number | null;
  expectedQuantity: number;
  scannedQuantity: number;
  remainingQuantity: number;
  status: "draft" | "completed" | "cancelled";
  createdAt: string;
  completedAt: string | null;
  scans: SerializedReceivingScan[];
}
export interface ProductUnitLookup {
  unit: { id: number; barcode: string; status: "available" | "sold" | "damaged" | "lost" | "inactive" };
  product: ProductListRow & { inventoryMode: "serialized" };
}
export interface ProductDetail extends ProductListRow {
  description: string | null;
  manufacturerBarcode: string | null;
  qrIdentifier: string;
  wholesalePriceCents: number;
  wholesaleMinQuantity: number;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
}
export interface ProductListResponse extends Pagination {
  rows: ProductListRow[];
}
export interface ProductLookup {
  product: ProductListRow;
}
export interface StockSummary extends ProductListRow {
  stockValueCents?: number;
}
export interface StockListResponse extends Pagination {
  rows: StockSummary[];
}
export interface StockMovement {
  id: number;
  productId: number;
  productName: string;
  movementType: StockMovementType;
  quantityChange: number;
  stockBefore: number;
  stockAfter: number;
  workerId: number;
  workerName: string;
  reason: string;
  referenceType: string | null;
  referenceId: number | null;
  createdAt: string;
}
export interface StockMovementListResponse extends Pagination {
  rows: StockMovement[];
}
export type PaymentMode = "cash" | "credit" | "partial";
export interface DenominationLine {
  denominationCents: number;
  quantity: number;
  totalCents?: number;
}
export interface RegisterSummary {
  cashSalesCents: number;
  debtPaymentsCents: number;
  cashMovementCount: number;
  saleCount: number;
  cashSaleCount: number;
  employeeCount?: number;
}
export interface RegisterStatus {
  isOpen: boolean;
  sessionId?: number;
  cashierId?: number;
  cashierName?: string;
  openedAt?: string;
  openingCashCents: number;
  expectedCashCents: number;
  currentCashCents: number;
  summary: RegisterSummary;
}
export interface RegisterSession {
  id: number;
  cashierId: number;
  cashierName: string;
  openedAt: string;
  openingCashCents: number;
  closedAt: string | null;
  expectedCashCents: number | null;
  actualCashCents: number | null;
  differenceCents: number | null;
  differenceReason: string | null;
  openingNote: string | null;
  closingNote: string | null;
  status: "open" | "closed";
  denominations?: DenominationLine[];
  summary?: RegisterSummary;
}
export interface RegisterSessionListResponse extends Pagination {
  rows: RegisterSession[];
}
export interface RegisterMovement {
  id: number;
  registerSessionId: number;
  movementType: string;
  amountCents: number;
  direction: "in" | "out";
  reason: string | null;
  referenceType: string | null;
  referenceId: number | null;
  workerId: number;
  workerName: string;
  createdAt: string;
}
export interface RegisterMovementListResponse extends Pagination {
  rows: RegisterMovement[];
}
export interface Customer {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  creditLimitCents: number;
  currentDebtCents: number;
  isActive: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface CustomerListResponse extends Pagination {
  rows: Customer[];
}
export interface CustomerCreditTransaction {
  id: number;
  customerId: number;
  saleId: number | null;
  registerSessionId: number | null;
  transactionType: "credit_sale" | "debt_payment" | "adjustment";
  amountCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  notes: string | null;
  workerId: number;
  workerName: string;
  createdAt: string;
}
export interface CustomerCreditListResponse extends Pagination {
  rows: CustomerCreditTransaction[];
}
export interface SaleCartLine {
  productId: number;
  quantity: number;
}
export interface SaleResult {
  id: number;
  saleNumber: string;
  subtotalCents: number;
  totalCents: number;
  cashPaidCents: number;
  creditAmountCents: number;
  paymentMode: PaymentMode;
  duplicate: boolean;
}
export interface SaleListRow {
  id: number;
  saleNumber: string;
  createdAt: string;
  customerId: number | null;
  customerName: string | null;
  workerId: number;
  workerName: string;
  itemCount: number;
  totalCents: number;
  cashPaidCents: number;
  creditAmountCents: number;
  paymentMode: PaymentMode;
  status: string;
}
export interface SaleListResponse extends Pagination {
  rows: SaleListRow[];
}
export interface SaleItem {
  id: number;
  productId: number;
  productName: string;
  productType: ProductType;
  sku: string | null;
  barcode: string | null;
  quantity: number;
  unitPriceCents: number;
  lineTotalCents: number;
}
export interface SaleDetail extends SaleListRow {
  subtotalCents: number;
  discountCents: number;
  changeCents: number;
  registerSessionId: number | null;
  notes: string | null;
  items: SaleItem[];
  stockMovements?: StockMovement[];
  creditTransaction?: CustomerCreditTransaction | null;
  shopName: string;
  shopPhone: string | null;
  shopAddress: string | null;
  receiptFooter: string | null;
}
export interface Supplier {
  id: number;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string | null;
  currentDebtCents: number;
  isActive: boolean;
  createdBy: number | null;
  createdAt: string;
  updatedAt: string;
}
export interface SupplierListResponse extends Pagination {
  rows: Supplier[];
}
export interface SupplierLedgerTransaction {
  id: number;
  supplierId: number;
  purchaseId: number | null;
  registerSessionId: number | null;
  transactionType: "purchase_credit" | "supplier_payment";
  paymentSource: string | null;
  amountCents: number;
  balanceBeforeCents: number;
  balanceAfterCents: number;
  notes: string | null;
  workerName: string;
  createdAt: string;
}
export interface SupplierLedgerResponse extends Pagination {
  rows: SupplierLedgerTransaction[];
}
export interface PurchaseListRow {
  id: number;
  purchaseNumber: string;
  supplierId: number;
  supplierName: string;
  workerName: string;
  totalCents: number;
  cashPaidCents: number;
  creditAmountCents: number;
  paymentMode: PaymentMode;
  paymentSource: string;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  itemCount: number;
  createdAt: string;
}
export interface PurchaseListResponse extends Pagination {
  rows: PurchaseListRow[];
}
export interface PurchaseItem {
  id: number;
  productId: number;
  productName: string;
  quantity: number;
  purchaseUnitPriceCents: number;
  lineTotalCents: number;
}
export interface PurchaseDetail extends PurchaseListRow {
  notes: string | null;
  items: PurchaseItem[];
}
export interface Expense {
  id: number;
  category: string;
  description: string;
  amountCents: number;
  paymentSource: string;
  registerSessionId: number | null;
  expenseDate: string;
  status: string;
  correctionOfExpenseId: number | null;
  correctionReason: string | null;
  notes: string | null;
  workerName: string;
  createdAt: string;
}
export interface ExpenseListResponse extends Pagination {
  rows: Expense[];
}
export interface ReturnableItem {
  id: number;
  productId: number;
  productName: string;
  productType: ProductType;
  quantity: number;
  returnedQuantity: number;
  returnableQuantity: number;
  unitPriceCents: number;
  returnableValueCents: number;
  unitBarcodes?: string[];
}
export interface ReturnListRow {
  id: number;
  returnNumber: string;
  saleId: number;
  saleNumber: string;
  customerName: string | null;
  workerName: string;
  totalCents: number;
  debtReductionCents: number;
  cashRefundCents: number;
  status: string;
  createdAt: string;
}
export interface ReturnListResponse extends Pagination {
  rows: ReturnListRow[];
}
export interface ReturnItem {
  id: number;
  saleItemId: number;
  productName: string;
  quantity: number;
  amountCents: number;
  restock: boolean;
  condition: string | null;
}
export interface ReturnDetail extends ReturnListRow {
  reason: string;
  items: ReturnItem[];
}
export interface RefundAllocation {
  totalCents: number;
  debtReductionCents: number;
  cashRefundCents: number;
}
export interface Employee {
  id: number;
  displayName: string;
  username: string;
  email: string | null;
  role: Role;
  isActive: boolean;
  mustChangePassword: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface EmployeeListResponse extends Pagination {
  rows: Employee[];
}
export interface AuditEntry {
  id: number;
  action: string;
  entityType: string;
  entityId: number | null;
  workerId: number | null;
  workerName: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}
export interface AuditListResponse extends Pagination {
  rows: AuditEntry[];
}
export interface AppSettings {
  shopName: string;
  phone: string | null;
  address: string | null;
  receiptFooter: string | null;
  currency: "MAD";
  timezone: string;
  barcodePrefix: string;
  lowStockDefault: number;
  receiptWidth: 58 | 80;
  showBarcodeOnReceipt: boolean;
  showQrOnLabel: boolean;
  showPriceOnLabel: boolean;
  labelSize: "40x30" | "50x30" | "A4";
  backupRetention: number;
  sessionTimeoutMinutes: number;
}
export interface ReportResponse {
  kind: string;
  range: { start: string; end: string };
  summary: Record<string, number>;
  rows: Record<string, unknown>[];
  page: number;
  pageSize: number;
  totalRows: number;
  totalPages: number;
}
export interface DashboardReport {
  salesTodayCents: number;
  cashSalesTodayCents: number;
  creditSalesTodayCents: number;
  returnsTodayCents: number;
  netSalesTodayCents: number;
  estimatedProfitTodayCents: number | null;
  customerDebtCents: number;
  supplierDebtCents: number;
  expensesTodayCents: number;
  lowStockCount: number;
  outOfStockCount: number;
  openRegisters: number;
  recentSales: {
    id: number;
    saleNumber: string;
    totalCents: number;
    createdAt: string;
  }[];
}
export interface BackupMetadata {
  id: number;
  filename: string;
  sizeBytes: number;
  checksumSha256: string | null;
  status: string;
  creatorName: string;
  verifiedAt: string | null;
  createdAt: string;
}
