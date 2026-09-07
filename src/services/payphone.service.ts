import axios from "axios";
import { env } from "../config/env";
import { CustomError } from "../errors/customError.error";

/**
 * Integración con la Cajita de Pagos de PayPhone.
 *
 * La cajita se pinta en el navegador con el token y el storeId; el servidor
 * solo interviene después: PayPhone redirige al front con `id` y
 * `clientTransactionId`, y nosotros confirmamos contra su API. Si no se
 * confirma en 5 minutos, PayPhone reversa el cobro solo.
 */
const CONFIRM_URL = "https://paymentbox.payphonetodoesposible.com/api/confirm";

export interface PayphoneConfirmation {
  statusCode: number;
  transactionStatus: string;
  clientTransactionId: string;
  authorizationCode?: string;
  transactionId?: number;
  amount?: number;
  email?: string;
  cardBrand?: string;
  message?: string;
  messageCode?: number;
  date?: string;
}

export function isPayphoneConfigured(): boolean {
  return Boolean(env.PAYPHONE_TOKEN && env.PAYPHONE_STORE_ID);
}

/** Lo que la cajita necesita en el navegador. El token es público por diseño de PayPhone. */
export function boxCredentials() {
  if (!isPayphoneConfigured()) {
    throw new CustomError("Los pagos con tarjeta no están disponibles por ahora", 503);
  }
  return { token: env.PAYPHONE_TOKEN, storeId: env.PAYPHONE_STORE_ID };
}

export const toCents = (usd: number) => Math.round(usd * 100);

export async function confirm(id: number, clientTxId: string): Promise<PayphoneConfirmation> {
  if (!isPayphoneConfigured()) {
    throw new CustomError("Los pagos con tarjeta no están disponibles por ahora", 503);
  }
  try {
    const { data } = await axios.post<PayphoneConfirmation>(
      CONFIRM_URL,
      { id, clientTxId },
      {
        headers: { Authorization: `Bearer ${env.PAYPHONE_TOKEN}`, "Content-Type": "application/json" },
        timeout: 15000,
      },
    );
    return data;
  } catch (error) {
    const detail = axios.isAxiosError(error) ? error.response?.data : error;
    console.error("[payphone] confirm falló:", detail);
    throw new CustomError("No pudimos confirmar el pago con PayPhone", 502);
  }
}
