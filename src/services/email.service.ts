import { Resend } from "resend";
import { env } from "../config/env";

let resend: Resend | null = null;

function getClient(): Resend | null {
  if (!env.RESEND_API_KEY) return null;
  if (!resend) resend = new Resend(env.RESEND_API_KEY);
  return resend;
}

/**
 * Envía un correo. Nunca lanza: el fallo de un correo no debe romper el
 * flujo que lo disparó (una compra, un registro). Devuelve si Resend lo aceptó.
 */
export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const client = getClient();
  if (!client) {
    console.warn(`[email] RESEND_API_KEY no definida — no se envió "${subject}" a ${to}`);
    return false;
  }

  try {
    const { error } = await client.emails.send({ from: env.RESEND_FROM_EMAIL, to, subject, html });
    if (error) {
      console.error("[email] Resend rechazó el envío:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[email] send failed:", error);
    return false;
  }
}

const LOGO =
  "https://res.cloudinary.com/afwyrt75/image/upload/c_crop,w_360,h_130,x_44,y_158/f_png/pantuflasec/marca/kdiwg79agtwcurg3136v.jpg";

/** Plantilla base: tarjeta blanca centrada con el logo y pie de contacto. */
export function layout(siteUrl: string, title: string, body: string): string {
  const site = (siteUrl || env.FRONTEND_URL).replace(/\/$/, "");
  return `
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff6d6;padding:32px 0;font-family:Arial,Helvetica,sans-serif">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden">
        <tr><td align="center" style="background:#ffcc00;padding:18px 32px">
          <a href="${site}"><img src="${LOGO}" width="200" alt="Pantuflas Ecuador" style="display:block;border:0"></a>
        </td></tr>
        <tr><td style="padding:32px;color:#16213e;font-size:15px;line-height:1.6">
          <h1 style="margin:0 0 16px;font-size:22px;color:#16213e">${title}</h1>
          ${body}
        </td></tr>
        <tr><td style="padding:18px 32px;background:#fdfcfa;color:#8a8590;font-size:12px;line-height:1.6">
          Pantuflas Ecuador · La Garzota, Av. Agustín Freire frente al Garzocentro · La Joya, Plaza Sevilla<br>
          WhatsApp <a href="https://wa.me/593982401562" style="color:#2f7ce6">+593 98 240 1562</a> ·
          <a href="https://instagram.com/pantuflasec" style="color:#2f7ce6">Instagram</a> ·
          <a href="https://www.tiktok.com/@pantuflasec" style="color:#2f7ce6">TikTok</a> ·
          <a href="https://www.facebook.com/share/19QsuSy5Tc/" style="color:#2f7ce6">Facebook</a> ·
          <a href="${site}" style="color:#2f7ce6">pantuflas.ec</a>
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}
