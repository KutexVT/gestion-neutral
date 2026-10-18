export type User = {
  id: string;
  name: string;
  username: string;
  role: "admin" | "waiter";
  active: boolean;
  personal_account_id?: string;
  personal_total?: number;
  personal_currency?: string;
};
export type Config = { name: string; currency: string; timezone: string };
export type Product = {
  id: string;
  name: string;
  photo_id: string;
  price: number;
  stock: number;
  active: boolean;
  version: number;
  currency: string;
};
export type Item = {
  id: string;
  product_id: string;
  product_name: string;
  unit_price: number;
  quantity: number;
  recorded_by: string;
  waiter_name: string;
  recorded_at: string;
};
export type Account = {
  id: string;
  kind: "customer" | "personal";
  name: string;
  created_by: string;
  creator_name: string;
  arrived_at: string;
  closed_at: string | null;
  calculated_total: number;
  final_total: number | null;
  cash_received: number | null;
  cash_change: number | null;
  adjusted_by_name?: string;
  version: number;
  currency: string;
  items: Item[];
  invoices: Invoice[];
};
export type Invoice = {
  id: number;
  revision: number;
  created_at: string;
  snapshot: Account & { bar_name: string; timezone: string };
};
export type Audit = {
  id: number;
  action: string;
  actor_name: string;
  created_at: string;
  entity_id: string | null;
  before_value: unknown;
  after_value: unknown;
};
