let csrf = "";
export const setCsrf = (value: string) => {
  csrf = value;
};
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== "GET") {
    headers["x-csrf-token"] = csrf;
    headers["idempotency-key"] = crypto.randomUUID();
  }
  if (body !== undefined && !(body instanceof FormData))
    headers["Content-Type"] = "application/json";
  const options = {
    method,
    headers,
    credentials: "same-origin" as const,
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
    signal,
  };
  let response: Response;
  try {
    response = await fetch(`/api${path}`, options);
  } catch (error) {
    if (signal?.aborted) throw error;
    // Same idempotency key on a network retry; a committed sale cannot be duplicated.
    try {
      response = await fetch(`/api${path}`, options);
    } catch {
      throw new ApiError(
        0,
        "Sin conexión. Comprueba la cuenta antes de volver a registrar productos",
      );
    }
  }
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401 && path !== "/entry")
      window.dispatchEvent(new Event("session-ended"));
    throw new ApiError(
      response.status,
      result.message || "No se pudo completar la operación",
    );
  }
  return result;
}
export function money(value: number, currency = "CRC") {
  return new Intl.NumberFormat("es-CR", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value / 100);
}
export function parseMoney(text: string): number {
  const value = text.trim().replace(",", ".");
  if (!/^\d{1,11}(\.\d{1,2})?$/.test(value))
    throw new Error("Escribe un importe positivo con hasta dos decimales");
  const [whole, fraction = ""] = value.split(".");
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (minor > 9_000_000_000_000)
    throw new Error("El importe es demasiado alto");
  return minor;
}
export function date(value: string | null, timezone: string, timeOnly = false) {
  return value
    ? new Intl.DateTimeFormat("es-CR", {
        timeZone: timezone,
        ...(timeOnly
          ? {}
          : { day: "2-digit", month: "short", year: "numeric" }),
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "En el bar";
}
export function localTime(value: string, timezone: string) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
