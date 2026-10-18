import { date, money } from "./api";
import type { Config } from "./types";

const labels: Record<string, string> = {
  id: "Referencia",
  username: "Usuario",
  name: "Nombre",
  role: "Rol",
  active: "Activo",
  created_at: "Fecha",
  created_by: "Creado por",
  creator_name: "Mesero creador",
  photo_id: "Foto",
  product_id: "Producto",
  price: "Precio",
  unit_price: "Precio por unidad",
  product_name: "Producto",
  stock: "Unidades disponibles",
  currency: "Moneda",
  version: "Versión",
  kind: "Tipo de consumo",
  arrived_at: "Llegada",
  closed_at: "Salida",
  closed_by: "Cerrado por",
  calculated_total: "Total calculado",
  final_total: "Total cobrado",
  cash_received: "Efectivo recibido",
  cash_change: "Vuelto entregado",
  adjusted_by: "Ajustado por",
  adjusted_by_name: "Nombre de quien ajustó",
  items: "Productos consumidos",
  quantity: "Cantidad",
  recorded_by: "Registrado por",
  recorded_at: "Hora de entrega",
  waiter_name: "Mesero de la entrega",
  account_id: "Cuenta",
  sessions_revoked: "Sesiones cerradas",
};

export function HistoryValue({
  value,
  config,
  field = "",
  currency = config.currency,
}: {
  value: unknown;
  config: Config;
  field?: string;
  currency?: string;
}) {
  if (value == null) return <span className="muted">Sin valor</span>;
  if (Array.isArray(value))
    return (
      <div className="history-array">
        {value.length ? (
          value.map((item, i) => (
            <HistoryValue
              key={i}
              value={item}
              config={config}
              currency={currency}
            />
          ))
        ) : (
          <span>Sin productos</span>
        )}
      </div>
    );
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    return (
      <dl className="history-values">
        {Object.entries(object)
          .filter(
            ([key]) =>
              ![
                "id",
                "photo_id",
                "product_id",
                "created_by",
                "recorded_by",
                "account_id",
                "adjusted_by",
                "closed_by",
              ].includes(key),
          )
          .map(([key, data]) => (
            <div key={key}>
              <dt>{labels[key] || key.replaceAll("_", " ")}</dt>
              <dd>
                <HistoryValue
                  value={data}
                  config={config}
                  field={key}
                  currency={String(object.currency || currency)}
                />
              </dd>
            </div>
          ))}
      </dl>
    );
  }
  let text = String(value);
  if (typeof value === "boolean") text = value ? "Sí" : "No";
  if (
    typeof value === "number" &&
    [
      "price",
      "unit_price",
      "calculated_total",
      "final_total",
      "cash_received",
      "cash_change",
    ].includes(field)
  )
    text = money(value, currency);
  if (field.endsWith("_at") && typeof value === "string")
    text = date(value, config.timezone);
  if (field === "kind")
    text = value === "personal" ? "Consumo personal" : "Cliente";
  if (field === "role") text = value === "admin" ? "Dueño" : "Mesero";
  return <span>{text}</span>;
}
